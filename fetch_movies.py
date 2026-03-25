"""
fetch_movies.py
===============
Clean, standalone movie-fetch pipeline.

Usage:
    python fetch_movies.py \\
      --years 1970-1999 \\
      --api-key YOUR_KEY \\
      --oscar-csv source-data/movies/the_oscar_award.csv \\
      --output-dir source-data/movies/ \\
      --per-year 75 \\
      --gap-report \\
      --append
"""

# ─────────────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import math
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import requests

# ─────────────────────────────────────────────────────────────────────────────
#  CONFIG / CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
BASE_URL = "https://api.themoviedb.org/3"
POSTER_BASE = "https://image.tmdb.org/t/p/w342"
SLEEP_BETWEEN_CALLS = 0.05   # seconds between TMDB calls
MAX_RETRIES = 6
PAGES_PER_LIST = 5           # 5 pages × 20 results = 100 per list
TIER_1_CUTOFF = 25           # rank 1–25 → tier 1; 26+ → tier 2

# Era-aware minimum vote counts for Discover filter
MIN_VOTES_BY_ERA = {
    "modern": (2000, 9999, 500),   # (start_year, end_year, min_votes)
    "nineties": (1990, 1999, 300),
    "classic": (0, 1989, 150),
}

# Oscar categories to track (and force-include)
OSCAR_CATS_TRACKED = [
    "Best Picture",
    "Best Director",
    "Best Actor",
    "Best Actress",
    "Best Supporting Actor",
    "Best Supporting Actress",
    "Best Animated Movie",
    "Best Original Screenplay",
    "Best Adapted Screenplay",
]

# Raw Oscar category strings → canonical name
OSCAR_CAT_MAP = {
    "Best Picture": "Best Picture",
    "Best Motion Picture of the Year": "Best Picture",
    "Outstanding Picture": "Best Picture",
    "Outstanding Motion Picture": "Best Picture",
    "Outstanding Production": "Best Picture",
    "Actor in a Leading Role": "Best Actor",
    "Performance by an actor in a leading role": "Best Actor",
    "Best Actor": "Best Actor",
    "Actress in a Leading Role": "Best Actress",
    "Performance by an actress in a leading role": "Best Actress",
    "Best Actress": "Best Actress",
    "Actor in a Supporting Role": "Best Supporting Actor",
    "Performance by an actor in a supporting role": "Best Supporting Actor",
    "Best Supporting Actor": "Best Supporting Actor",
    "Actress in a Supporting Role": "Best Supporting Actress",
    "Performance by an actress in a supporting role": "Best Supporting Actress",
    "Best Supporting Actress": "Best Supporting Actress",
    "Directing": "Best Director",
    "Achievement in directing": "Best Director",
    "Best Director": "Best Director",
    "Animated Feature Film": "Best Animated Movie",
    "Best Animated Feature": "Best Animated Movie",
    "Best Animated Feature Film": "Best Animated Movie",
    "Best Animated Feature Film of the Year": "Best Animated Movie",
    "Writing (Original Screenplay)": "Best Original Screenplay",
    "Writing (Screenplay Written Directly for the Screen)": "Best Original Screenplay",
    "Original Screenplay": "Best Original Screenplay",
    "Writing (Adapted Screenplay)": "Best Adapted Screenplay",
    "Writing (Screenplay Based on Material Previously Produced or Published)": "Best Adapted Screenplay",
    "Adapted Screenplay": "Best Adapted Screenplay",
}
OSCAR_CAT_MAP_LC = {k.lower(): v for k, v in OSCAR_CAT_MAP.items()}

# Column names for Oscar flags in output CSV
OSCAR_COL_NAMES = {
    "Best Picture": "oscars_best_picture",
    "Best Director": "oscars_best_director",
    "Best Actor": "oscars_best_actor",
    "Best Actress": "oscars_best_actress",
    "Best Supporting Actor": "oscars_best_supporting_actor",
    "Best Supporting Actress": "oscars_best_supporting_actress",
    "Best Animated Movie": "oscars_best_animated_movie",
    "Best Original Screenplay": "oscars_best_original_screenplay",
    "Best Adapted Screenplay": "oscars_best_adapted_screenplay",
}

OUTPUT_COLUMNS = [
    "score_combined", "year", "popularity", "cast_top5", "release_date",
    "rank_revenue", "budget", "directors", "id", "vote_average", "revenue",
    "rank_revenue_fill", "title", "rank_votes", "poster_url", "poster_path",
    "rank_votes_fill", "vote_count", "film_norm", "film_raw",
    "oscars_wins_categories", "oscars_nom_categories", "oscars_years",
    "oscars_best_picture", "oscars_best_actor", "oscars_best_actress",
    "oscars_best_supporting_actor", "oscars_best_supporting_actress",
    "oscars_best_director", "oscars_best_animated_movie",
    "oscars_best_original_screenplay", "oscars_best_adapted_screenplay",
    "tier", "keywords", "genres", "writers", "cast",
]

# ─────────────────────────────────────────────────────────────────────────────
#  PROGRESS HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _bar(done: int, total: int, width: int = 20) -> str:
    if total == 0:
        return "[" + "░" * width + "]"
    filled = int(width * done / total)
    return "[" + "█" * filled + "░" * (width - filled) + "]"


def _fmt_dur(seconds: float) -> str:
    td = timedelta(seconds=int(seconds))
    h, rem = divmod(td.seconds, 3600)
    m, s = divmod(rem, 60)
    if td.days or h:
        return f"{td.days * 24 + h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def print_year_header(year_idx: int, total_years: int, year: int) -> None:
    print(f"\n[Year {year_idx:2d}/{total_years}]  {year}  — Discovering movies...")


def print_year_scoring(year_idx: int, total_years: int, year: int) -> None:
    print(f"[Year {year_idx:2d}/{total_years}]  {year}  — Scoring & selecting...")


def print_detail_progress(
    year_idx: int, total_years: int, year: int,
    done: int, total: int, eta_secs: Optional[float]
) -> None:
    bar = _bar(done, total)
    eta_str = f"ETA {_fmt_dur(eta_secs)}" if eta_secs is not None else "ETA --:--"
    print(
        f"\r[Year {year_idx:2d}/{total_years}]  {year}  — Fetching details:  "
        f"{bar}  {done}/{total}  {eta_str}    ",
        end="", flush=True,
    )


def print_year_done(
    year_idx: int, total_years: int, year: int,
    n_selected: int, n_oscar_additions: int, elapsed: float
) -> None:
    print(
        f"\r[Year {year_idx:2d}/{total_years}]  {year}  "
        f"✓  {n_selected} selected  ({n_oscar_additions} Oscar additions)  "
        f"in {_fmt_dur(elapsed)}                    "
    )


def print_overall_progress(
    year_idx: int, total_years: int, elapsed: float, eta_secs: Optional[float]
) -> None:
    bar = _bar(year_idx, total_years, width=20)
    eta_str = f"ETA ~{_fmt_dur(eta_secs)}" if eta_secs is not None else ""
    print(
        f"Overall: {bar}  {year_idx}/{total_years} years  —  "
        f"elapsed {_fmt_dur(elapsed)}  {eta_str}"
    )


def print_summary(
    total_movies: int, oscar_additions: int, api_calls: int, elapsed: float
) -> None:
    print("\n" + "=" * 56)
    print(f"  Done.")
    print(f"  Total movies selected : {total_movies}")
    print(f"  Oscar force-additions  : {oscar_additions}")
    print(f"  TMDB API calls made    : {api_calls}")
    print(f"  Total time             : {_fmt_dur(elapsed)}")
    print("=" * 56)


# ─────────────────────────────────────────────────────────────────────────────
#  TMDB API HELPERS
# ─────────────────────────────────────────────────────────────────────────────

_session = requests.Session()
_session.headers.update({"Accept": "application/json"})
_api_call_count = 0


def _get_min_votes(year: int) -> int:
    for _, (start, end, mv) in MIN_VOTES_BY_ERA.items():
        if start <= year <= end:
            return mv
    return 150


def tmdb_get(path: str, params: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    global _api_call_count
    full_params = {**params, "api_key": api_key}
    for attempt in range(MAX_RETRIES):
        r = _session.get(f"{BASE_URL}{path}", params=full_params, timeout=20)
        _api_call_count += 1
        if r.status_code == 200:
            time.sleep(SLEEP_BETWEEN_CALLS)
            return r.json()
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 10)) + 2
            print(f"\n  [rate limit] waiting {wait}s before retry {attempt + 1}...")
            time.sleep(wait)
            continue
        if r.status_code in (500, 502, 503, 504):
            time.sleep(3 * (attempt + 1))
            continue
        r.raise_for_status()
    raise RuntimeError(f"TMDB GET failed after {MAX_RETRIES} attempts: {path}")


def discover_top_list(
    year: int, sort_by: str, api_key: str, pages: int = PAGES_PER_LIST
) -> pd.DataFrame:
    min_votes = _get_min_votes(year)
    rows: List[Dict[str, Any]] = []
    for page in range(1, pages + 1):
        data = tmdb_get(
            "/discover/movie",
            {
                "sort_by": sort_by,
                "primary_release_year": year,
                "with_original_language": "en",
                "include_adult": "false",
                "vote_count.gte": min_votes,
                "page": page,
            },
            api_key,
        )
        results = data.get("results", [])
        rows.extend(results)
        if page >= data.get("total_pages", 1):
            break
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    # Keep only columns we need
    keep = [c for c in ["id", "title", "release_date", "vote_count", "vote_average", "popularity", "poster_path"] if c in df.columns]
    df = df[keep].copy()
    df["year"] = df["release_date"].fillna("").str[:4]
    df = df[df["year"] == str(year)]
    return df.reset_index(drop=True)


def fetch_details(movie_id: int, api_key: str) -> Dict[str, Any]:
    m = tmdb_get(f"/movie/{movie_id}", {}, api_key)
    genres = ", ".join(g["name"] for g in (m.get("genres") or []) if g.get("name"))
    return {
        "id": m["id"],
        "title": m.get("title", ""),
        "release_date": m.get("release_date", ""),
        "vote_count": m.get("vote_count") or 0,
        "vote_average": m.get("vote_average") or 0,
        "popularity": m.get("popularity") or 0,
        "revenue": m.get("revenue") or 0,
        "budget": m.get("budget") or 0,
        "poster_path": m.get("poster_path") or "",
        "genres": genres,
    }


def fetch_credits(movie_id: int, api_key: str) -> Dict[str, str]:
    try:
        c = tmdb_get(f"/movie/{movie_id}/credits", {}, api_key)
    except Exception:
        return {"directors": "", "cast_top5": "", "cast": "", "writers": ""}

    crew = c.get("crew") or []
    cast = c.get("cast") or []

    allowed_jobs = {"Director", "Co-Director"}
    directors: List[str] = []
    seen: set = set()
    for p in crew:
        job = (p.get("job") or "").strip()
        name = (p.get("name") or "").strip()
        if not name or job not in allowed_jobs or name in seen:
            continue
        directors.append(name)
        seen.add(name)
        if len(directors) >= 2:
            break

    writing_jobs = {"Screenplay", "Writer", "Story", "Novel", "Adaptation", "Original Story"}
    writers: List[str] = []
    seen_writers: set = set()
    for p in crew:
        dept = (p.get("department") or "").strip()
        job = (p.get("job") or "").strip()
        name = (p.get("name") or "").strip()
        if not name or name in seen_writers:
            continue
        if dept == "Writing" or job in writing_jobs:
            writers.append(name)
            seen_writers.add(name)

    cast_sorted = sorted(cast, key=lambda x: x.get("order", 9999))
    cast_names: List[str] = []
    seen_cast: set = set()
    for p in cast_sorted:
        nm = (p.get("name") or "").strip()
        if not nm or nm in seen_cast:
            continue
        cast_names.append(nm)
        seen_cast.add(nm)
        if len(cast_names) >= 10:
            break

    return {
        "directors": ", ".join(directors),
        "cast_top5": ", ".join(cast_names[:5]),
        "cast": ", ".join(cast_names),
        "writers": ", ".join(writers),
    }


def fetch_keywords(movie_id: int, api_key: str) -> str:
    try:
        data = tmdb_get(f"/movie/{movie_id}/keywords", {}, api_key)
        kws = data.get("keywords") or []
        return ", ".join(k["name"] for k in kws if k.get("name"))
    except Exception:
        return ""


def tmdb_search_title_year(title: str, year: int, api_key: str) -> Optional[int]:
    if not title:
        return None
    for y in (year, year - 1, year + 1):
        try:
            data = tmdb_get(
                "/search/movie",
                {"query": title, "year": y, "include_adult": "false"},
                api_key,
            )
            results = data.get("results") or []
            if not results:
                continue
            eng = [r for r in results if r.get("original_language") == "en"]
            pick = eng[0] if eng else results[0]
            return int(pick["id"])
        except Exception:
            continue
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  OSCAR HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def normalize_title(title: str) -> str:
    if not isinstance(title, str):
        return ""
    t = title.lower()
    t = unicodedata.normalize("NFKD", t)
    t = re.sub(r"[\u0300-\u036f]", "", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.split(r"[:\-\(]", t)[0].strip()
    return t


def load_oscars(path: str) -> pd.DataFrame:
    """Load and aggregate the Oscar CSV into one row per (film, year) with per-category flags."""
    df = pd.read_csv(path, sep=None, engine="python")
    df.columns = [c.strip() for c in df.columns]

    cat_col = "canon_category" if "canon_category" in df.columns else "category"
    df["category_canon"] = df[cat_col].astype(str).apply(
        lambda c: OSCAR_CAT_MAP_LC.get(c.strip().lower(), "")
    )
    df = df[df["category_canon"] != ""].copy()
    if df.empty:
        return pd.DataFrame()

    df["film_norm"] = df["film"].astype(str).apply(normalize_title)
    df["year_film"] = pd.to_numeric(df["year_film"], errors="coerce")

    def to_status(v: Any) -> str:
        s = str(v).strip().lower()
        return "Winner" if s in {"true", "1", "winner", "yes", "y"} else "Nominee"

    df["status"] = df["winner"].apply(to_status)

    agg: Dict[str, Dict[str, Any]] = {}
    for _, r in df.iterrows():
        if pd.isna(r["year_film"]) or not r["film_norm"]:
            continue
        key = f"{r['film_norm']}||{int(r['year_film'])}"
        cur = agg.setdefault(
            key,
            {"wins": set(), "noms": set(), "years": set(), "film_raw": str(r["film"])},
        )
        (cur["wins"] if r["status"] == "Winner" else cur["noms"]).add(r["category_canon"])
        cur["years"].add(int(r["year_film"]))

    rows: List[Dict[str, Any]] = []
    for k, v in agg.items():
        wins = sorted(v["wins"])
        noms = sorted([c for c in v["noms"] if c not in wins])
        years = sorted(v["years"])
        row: Dict[str, Any] = {
            "match_key": k,
            "film_norm": k.split("||")[0],
            "film_raw": v.get("film_raw", ""),
            "oscars_wins_categories": "; ".join(wins),
            "oscars_nom_categories": "; ".join(noms),
            "oscars_years": "; ".join(map(str, years)),
        }
        for cat in OSCAR_CATS_TRACKED:
            col = OSCAR_COL_NAMES[cat]
            row[col] = "Winner" if cat in wins else ("Nominee" if cat in noms else "")
        rows.append(row)
    return pd.DataFrame(rows)


def attach_oscars(df: pd.DataFrame, osc: pd.DataFrame) -> pd.DataFrame:
    """Merge Oscar data onto df using fuzzy year matching (±1 year)."""
    if osc.empty or "match_key" not in osc.columns:
        for col in [
            "oscars_wins_categories", "oscars_nom_categories", "oscars_years",
        ] + list(OSCAR_COL_NAMES.values()):
            if col not in df.columns:
                df[col] = ""
        return df

    expected_cols = [
        "oscars_wins_categories", "oscars_nom_categories", "oscars_years",
    ] + list(OSCAR_COL_NAMES.values())

    work = df.copy()
    work["title_norm"] = work["title"].apply(normalize_title)

    def make_key(title_series: pd.Series, year_series: pd.Series, offset: int) -> pd.Series:
        y = pd.to_numeric(year_series, errors="coerce")
        y = (y + offset).astype("Int64").astype(str).replace({"<NA>": ""})
        return title_series + "||" + y

    for off in (0, -1, 1):
        work["match_key"] = make_key(work["title_norm"], work["year"], off)
        merged = work.merge(osc, on="match_key", how="left", suffixes=("", "_osc"))
        for c in expected_cols:
            if c not in merged.columns:
                merged[c] = ""
        if off == 0:
            result = merged.copy()
        else:
            # Only fill rows still missing oscar data
            miss = result["oscars_wins_categories"].isna() | (result["oscars_wins_categories"] == "")
            for c in expected_cols:
                result.loc[miss, c] = merged.loc[miss, c].values

    return result.drop(columns=["match_key", "title_norm"], errors="ignore").fillna("")


def get_oscar_nominees_for_year(osc: pd.DataFrame, year: int) -> List[Tuple[str, str]]:
    """Return (film_norm, film_raw) pairs for any Oscar-tracked nomination in the given year."""
    if osc.empty or "match_key" not in osc.columns:
        return []
    mask = osc["match_key"].astype(str).str.endswith(f"||{year}")
    # Also check year-1 (Oscar ceremony year offset)
    mask2 = osc["match_key"].astype(str).str.endswith(f"||{year - 1}")
    sub = osc.loc[mask | mask2, ["film_norm", "film_raw"]].drop_duplicates()
    return list(sub.itertuples(index=False, name=None))


# ─────────────────────────────────────────────────────────────────────────────
#  SCORING & SELECTION
# ─────────────────────────────────────────────────────────────────────────────

def rank_series(values: pd.Series) -> pd.Series:
    s = pd.to_numeric(values, errors="coerce")
    r = s.rank(method="dense", ascending=False)
    worst = int(r.max()) if not r.isna().all() else len(s) + 1
    return r.fillna(worst).astype(int)


def dual_rank(df: pd.DataFrame, votes_df: pd.DataFrame, revenue_df: pd.DataFrame) -> pd.DataFrame:
    """
    Merge details with ranked lists, compute score_combined.
    Tiebreaker: vote_average descending.
    """
    top_votes = votes_df.assign(rank_votes=range(1, len(votes_df) + 1))[["id", "rank_votes"]]
    top_rev = revenue_df.assign(rank_revenue=range(1, len(revenue_df) + 1))[["id", "rank_revenue"]]

    merged = df.merge(top_votes, on="id", how="left").merge(top_rev, on="id", how="left")
    merged["rank_votes_fill"] = rank_series(merged["vote_count"])
    merged["rank_revenue_fill"] = rank_series(merged["revenue"])
    merged["rank_votes"] = merged["rank_votes"].fillna(merged["rank_votes_fill"]).astype(int)
    merged["rank_revenue"] = merged["rank_revenue"].fillna(merged["rank_revenue_fill"]).astype(int)
    merged["score_combined"] = (merged["rank_votes"] + merged["rank_revenue"]).astype(int)
    return merged


def select_movies(
    year: int,
    scored: pd.DataFrame,
    osc: pd.DataFrame,
    per_year: int,
    api_key: str,
    year_idx: int,
    total_years: int,
) -> Tuple[pd.DataFrame, pd.DataFrame, int]:
    """
    Select top `per_year` movies and force-include Oscar nominees.

    Returns (selected_df, full_union_df, n_oscar_additions).
    """
    sort_cols = ["score_combined", "vote_average"]
    sort_asc = [True, False]

    union = scored.sort_values(sort_cols, ascending=sort_asc).reset_index(drop=True)
    top_n = union.head(per_year).copy()
    sel_norms = set(top_n["title"].apply(normalize_title))

    # Oscar force-includes
    oscar_noms = get_oscar_nominees_for_year(osc, year)
    oscar_norms = {fn for fn, _ in oscar_noms}
    missing_oscar_norms = oscar_norms - sel_norms

    added_from_oscar: List[pd.DataFrame] = []
    if missing_oscar_norms:
        # First check if they're in union (just not in top_n)
        union_norms = union["title"].apply(normalize_title)
        in_union = union[union_norms.isin(missing_oscar_norms)].copy()
        still_missing_norms = missing_oscar_norms - set(in_union["title"].apply(normalize_title))

        if not in_union.empty:
            added_from_oscar.append(in_union)
            sel_norms |= set(in_union["title"].apply(normalize_title))

        # For films not in union, search TMDB
        if still_missing_norms:
            # Build map: film_norm → film_raw
            norm_to_raw = {fn: fr for fn, fr in oscar_noms if fn in still_missing_norms}
            for film_norm, film_raw in norm_to_raw.items():
                title_query = film_raw or film_norm
                mid = tmdb_search_title_year(title_query, year, api_key)
                if mid is None:
                    print(f"\n      ⚠ Oscar nominee not found on TMDB: {title_query} ({year})")
                    continue
                try:
                    det = fetch_details(mid, api_key)
                    cred = fetch_credits(mid, api_key)
                    kws = fetch_keywords(mid, api_key)
                    row = {**det, **cred, "keywords": kws}
                    row["year"] = str(year)
                    row["poster_url"] = (
                        f"{POSTER_BASE}{row['poster_path']}" if row.get("poster_path") else ""
                    )
                    row["rank_votes"] = len(union) + 1
                    row["rank_revenue"] = len(union) + 1
                    row["rank_votes_fill"] = len(union) + 1
                    row["rank_revenue_fill"] = len(union) + 1
                    row["score_combined"] = row["rank_votes"] + row["rank_revenue"]
                    added_from_oscar.append(pd.DataFrame([row]))
                except Exception as e:
                    print(f"\n      ⚠ Failed fetching Oscar nominee {mid}: {e}")

    n_oscar_additions = sum(len(a) for a in added_from_oscar)

    selected = pd.concat([top_n] + added_from_oscar, ignore_index=True).drop_duplicates(subset=["id"])
    return selected, union, n_oscar_additions


def assign_tiers(df: pd.DataFrame) -> pd.DataFrame:
    """Assign tier=1 for top 25 by score_combined, tier=2 for the rest."""
    df = df.copy()
    df = df.sort_values(["score_combined", "vote_average"], ascending=[True, False]).reset_index(drop=True)
    df["tier"] = 2
    df.loc[df.index[:TIER_1_CUTOFF], "tier"] = 1
    return df


# ─────────────────────────────────────────────────────────────────────────────
#  GAP REPORT
# ─────────────────────────────────────────────────────────────────────────────

def build_gap_report(
    year: int,
    union: pd.DataFrame,
    selected_ids: set,
    osc: pd.DataFrame,
) -> pd.DataFrame:
    """
    Rows 76–150 from union that didn't make the cut,
    plus Oscar-nominated films that were force-included.
    """
    rows: List[Dict[str, Any]] = []
    union_sorted = union.sort_values(
        ["score_combined", "vote_average"], ascending=[True, False]
    ).reset_index(drop=True)

    oscar_noms = get_oscar_nominees_for_year(osc, year)
    oscar_norms_set = {fn for fn, _ in oscar_noms}

    for rank_0, (_, row) in enumerate(union_sorted.iterrows()):
        rank = rank_0 + 1  # 1-indexed
        tmdb_id = row.get("id")
        title_norm = normalize_title(str(row.get("title", "")))
        in_selected = tmdb_id in selected_ids

        is_oscar = title_norm in oscar_norms_set

        if in_selected and is_oscar:
            reason = "Oscar force-include"
        elif not in_selected and 76 <= rank <= 150:
            reason = "Near-miss (rank 76-150)"
        else:
            continue

        rows.append(
            {
                "title": row.get("title", ""),
                "year": year,
                "rank": rank,
                "score_combined": row.get("score_combined", ""),
                "vote_count": row.get("vote_count", ""),
                "vote_average": row.get("vote_average", ""),
                "revenue": row.get("revenue", ""),
                "oscars_wins_categories": row.get("oscars_wins_categories", ""),
                "oscars_nom_categories": row.get("oscars_nom_categories", ""),
                "near_miss_reason": reason,
            }
        )
    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────────────────────────
#  OUTPUT WRITERS
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_output_columns(df: pd.DataFrame) -> pd.DataFrame:
    for col in OUTPUT_COLUMNS:
        if col not in df.columns:
            df[col] = ""
    return df[OUTPUT_COLUMNS]


def write_selected(df: pd.DataFrame, output_dir: str, year_range_str: str) -> str:
    path = os.path.join(output_dir, f"selected_{year_range_str}_with_oscars.csv")
    _ensure_output_columns(df).to_csv(path, index=False)
    return path


def write_gap_report(df: pd.DataFrame, output_dir: str, year_range_str: str) -> str:
    path = os.path.join(output_dir, f"gap_report_{year_range_str}.csv")
    df.to_csv(path, index=False)
    return path


def append_to_main(new_df: pd.DataFrame, output_dir: str) -> str:
    main_path = os.path.join(output_dir, "dualrank_ALL_selected_with_oscars.csv")
    new_prep = _ensure_output_columns(new_df.copy())

    if os.path.exists(main_path):
        existing = pd.read_csv(main_path, dtype=str)
        # Ensure new columns exist
        for col in ["tier", "keywords"]:
            if col not in existing.columns:
                existing[col] = ""
        # Merge: new data wins on tier/keywords, else keep existing
        combined = pd.concat([existing, new_prep.astype(str)], ignore_index=True)
        # Dedup by id — keep last occurrence (new data)
        combined = combined.drop_duplicates(subset=["id"], keep="last")
        combined.to_csv(main_path, index=False)
        print(f"  Appended → {main_path}  ({len(combined)} total rows)")
    else:
        new_prep.to_csv(main_path, index=False)
        print(f"  Created  → {main_path}  ({len(new_prep)} rows)")
    return main_path


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def parse_years(years_arg: str) -> List[int]:
    """Parse '1970-1999', '2010-2019', or '1975,1980' into a list of ints."""
    years_arg = years_arg.strip()
    if re.match(r"^\d{4}-\d{4}$", years_arg):
        start, end = years_arg.split("-")
        return list(range(int(start), int(end) + 1))
    return [int(y.strip()) for y in years_arg.split(",")]


def year_range_str(years: List[int]) -> str:
    if len(years) == 1:
        return str(years[0])
    if years == list(range(years[0], years[-1] + 1)):
        return f"{years[0]}-{years[-1]}"
    return "_".join(map(str, years))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch and rank movies from TMDB with Oscar data."
    )
    parser.add_argument(
        "--years",
        required=True,
        help="Year range (e.g. 1970-1999), span (2010-2019), or list (1975,1980)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("TMDB_API_KEY"),
        help="TMDB v3 API key (or set TMDB_API_KEY env var)",
    )
    parser.add_argument(
        "--oscar-csv",
        default=os.path.join("source-data", "movies", "the_oscar_award.csv"),
        help="Path to Oscar awards CSV",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join("source-data", "movies"),
        help="Directory to write output files",
    )
    parser.add_argument(
        "--per-year",
        type=int,
        default=75,
        help="Base max movies per year (Oscar additions may exceed this)",
    )
    parser.add_argument(
        "--gap-report",
        action="store_true",
        help="Also output gap report CSV",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Merge results into dualrank_ALL_selected_with_oscars.csv",
    )
    args = parser.parse_args()

    api_key = args.api_key
    if not api_key:
        raise SystemExit("ERROR: TMDB API key required. Pass --api-key or set TMDB_API_KEY env var.")

    years = parse_years(args.years)
    total_years = len(years)
    yr_str = year_range_str(years)

    os.makedirs(args.output_dir, exist_ok=True)

    print("=" * 56)
    print(f"fetch_movies.py  |  Years: {yr_str}  |  {total_years} year(s)")
    print("=" * 56)

    print(f"\nLoading Oscars from: {args.oscar_csv}")
    osc = load_oscars(args.oscar_csv)
    print(f"  Loaded {len(osc)} Oscar entries across tracked categories.\n")

    all_selected: List[pd.DataFrame] = []
    all_gap: List[pd.DataFrame] = []
    global_oscar_additions = 0
    global_start = time.time()
    year_times: List[float] = []

    for year_idx, year in enumerate(years, start=1):
        year_start = time.time()

        # ── Step 1: Discover ─────────────────────────────────────────────────
        print_year_header(year_idx, total_years, year)
        votes_list = discover_top_list(year, "vote_count.desc", api_key)
        rev_list = discover_top_list(year, "revenue.desc", api_key)

        # ── Step 2: Score ────────────────────────────────────────────────────
        print_year_scoring(year_idx, total_years, year)
        all_ids = (
            pd.concat(
                [votes_list[["id"]], rev_list[["id"]]], ignore_index=True
            )
            .drop_duplicates()["id"]
            .tolist()
        )
        if not all_ids:
            print(f"  ⚠ No movies found for {year}, skipping.")
            continue

        # ── Step 3: Fetch details for all discovered movies ──────────────────
        details_rows: List[Dict[str, Any]] = []
        n_ids = len(all_ids)
        detail_start = time.time()
        for i, mid in enumerate(all_ids):
            elapsed_detail = time.time() - detail_start
            if i > 0:
                avg_per = elapsed_detail / i
                eta = avg_per * (n_ids - i)
            else:
                eta = None
            print_detail_progress(year_idx, total_years, year, i, n_ids, eta)
            try:
                det = fetch_details(int(mid), api_key)
                det["year"] = det["release_date"][:4] if det.get("release_date") else ""
                det["poster_url"] = (
                    f"{POSTER_BASE}{det['poster_path']}" if det.get("poster_path") else ""
                )
                details_rows.append(det)
            except Exception as e:
                print(f"\n      ⚠ skip details {mid}: {e}")

        print_detail_progress(year_idx, total_years, year, n_ids, n_ids, 0)
        print()  # newline after progress bar

        if not details_rows:
            print(f"  ⚠ No detail rows for {year}, skipping.")
            continue

        details_df = pd.DataFrame(details_rows)
        details_df = details_df[details_df["year"] == str(year)].copy()

        # ── Step 4: Dual rank + select ───────────────────────────────────────
        scored = dual_rank(details_df, votes_list, rev_list)
        selected, union, n_oscar = select_movies(
            year, scored, osc, args.per_year, api_key, year_idx, total_years
        )
        global_oscar_additions += n_oscar

        # ── Step 5: Fetch credits + keywords for selected movies ─────────────
        print(f"[Year {year_idx:2d}/{total_years}]  {year}  — Fetching credits & keywords for {len(selected)} movies...")
        cred_start = time.time()
        for i, (idx, row) in enumerate(selected.iterrows()):
            elapsed_cred = time.time() - cred_start
            if i > 0:
                avg_per = elapsed_cred / i
                eta = avg_per * (len(selected) - i)
            else:
                eta = None
            print_detail_progress(year_idx, total_years, year, i, len(selected), eta)
            mid = int(row["id"])
            try:
                cred = fetch_credits(mid, api_key)
                kws = fetch_keywords(mid, api_key)
                selected.at[idx, "directors"] = cred["directors"]
                selected.at[idx, "cast_top5"] = cred["cast_top5"]
                selected.at[idx, "keywords"] = kws
            except Exception as e:
                print(f"\n      ⚠ credits/keywords for {mid}: {e}")

        print_detail_progress(year_idx, total_years, year, len(selected), len(selected), 0)
        print()

        # ── Step 6: Attach Oscars, assign tiers ─────────────────────────────
        selected["year"] = str(year)
        selected = attach_oscars(selected, osc)
        selected = assign_tiers(selected)

        # Add film_norm / film_raw for output compat
        selected["film_norm"] = selected["title"].apply(normalize_title)
        selected["film_raw"] = selected["title"]

        all_selected.append(selected)

        # ── Gap report ───────────────────────────────────────────────────────
        if args.gap_report:
            union["year"] = str(year)
            union = attach_oscars(union, osc)
            gap = build_gap_report(year, union, set(selected["id"].tolist()), osc)
            all_gap.append(gap)

        year_elapsed = time.time() - year_start
        year_times.append(year_elapsed)
        print_year_done(year_idx, total_years, year, len(selected), n_oscar, year_elapsed)

        # Overall progress
        overall_elapsed = time.time() - global_start
        if year_times:
            avg_year_time = sum(year_times) / len(year_times)
            remaining = total_years - year_idx
            overall_eta = avg_year_time * remaining
        else:
            overall_eta = None
        print_overall_progress(year_idx, total_years, overall_elapsed, overall_eta)

    # ── Write outputs ────────────────────────────────────────────────────────
    if not all_selected:
        print("\n⚠ No movies selected for any year. Nothing written.")
        return

    combined = pd.concat(all_selected, ignore_index=True)
    out_path = write_selected(combined, args.output_dir, yr_str)
    print(f"\nWrote: {out_path}  ({len(combined)} movies)")

    if args.gap_report and all_gap:
        gap_combined = pd.concat(all_gap, ignore_index=True)
        gap_path = write_gap_report(gap_combined, args.output_dir, yr_str)
        print(f"Wrote: {gap_path}  ({len(gap_combined)} gap rows)")

    if args.append:
        append_to_main(combined, args.output_dir)

    total_elapsed = time.time() - global_start
    print_summary(len(combined), global_oscar_additions, _api_call_count, total_elapsed)


if __name__ == "__main__":
    main()
