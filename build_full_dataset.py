"""
build_full_dataset.py
Generates movies_full.json (1,978 movies) from the full scored CSV.
Curated movies (1-658) keep their existing IDs for backward compatibility.
New movies get IDs starting at 659.

Usage: python build_full_dataset.py
"""

import json
import csv
from pathlib import Path

BASE_DIR  = Path(__file__).parent
ROOT_DIR  = BASE_DIR.parent
CURATED   = BASE_DIR / "movies.json"
FULL_CSV  = ROOT_DIR / "source-data" / "movies" / "dualrank_ALL_selected_with_oscars.csv"
OUTPUT    = BASE_DIR / "movies_full.json"


def parse_directors(val):
    if not val:
        return []
    return [d.strip() for d in val.split(",") if d.strip()]


def parse_list(val):
    if not val:
        return []
    return [a.strip() for a in val.split(",") if a.strip()]


def parse_oscar_wins(wins_str):
    if not wins_str or wins_str.strip() == "":
        return 0, []
    categories = [c.strip() for c in wins_str.split(";") if c.strip()]
    return len(categories), categories


def main():
    # Load curated dataset and build tmdb_id -> sequential_id map
    with open(CURATED, encoding="utf-8") as f:
        curated_data = json.load(f)["movies"]

    curated_map = {m["tmdb_id"]: m["id"] for m in curated_data}
    curated_by_id = {m["id"]: m for m in curated_data}
    print(f"Loaded {len(curated_data)} curated movies (IDs 1-{len(curated_data)})")

    # Load full CSV
    with open(FULL_CSV, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"Loaded {len(rows)} movies from full CSV")

    movies = []
    next_id = max(m["id"] for m in curated_data) + 1
    seen_tmdb_ids = set()

    for row in rows:
        tmdb_id = str(row["id"]).strip()
        if tmdb_id in seen_tmdb_ids:
            continue
        seen_tmdb_ids.add(tmdb_id)

        if tmdb_id in curated_map:
            # Use existing curated movie object (preserves any enrichment done later)
            movie = dict(curated_by_id[curated_map[tmdb_id]])
        else:
            # New movie — build from CSV fields
            oscar_wins, oscar_categories = parse_oscar_wins(row.get("oscars_wins_categories", ""))
            try:
                year = int(float(row.get("year", 0)))
            except (ValueError, TypeError):
                year = 0
            try:
                vote_avg = float(row.get("vote_average", 0))
            except (ValueError, TypeError):
                vote_avg = 0.0

            directors = parse_directors(row.get("directors", ""))
            actors    = parse_list(row.get("cast_top5", ""))

            try:
                tier = int(row.get("tier", 2) or 2)
            except (ValueError, TypeError):
                tier = 2
            keywords = parse_list(row.get("keywords", ""))
            genres   = parse_list(row.get("genres", ""))
            writers  = parse_list(row.get("writers", ""))
            cast     = parse_list(row.get("cast", "") or row.get("cast_top5", ""))

            movie = {
                "id":               next_id,
                "tmdb_id":          tmdb_id,
                "title":            row.get("title", "").strip(),
                "year":             year,
                "directors":        directors,
                "actors":           actors,
                "cast":             cast,
                "writers":          writers,
                "genres":           genres,
                "poster_url":       row.get("poster_url", "").strip(),
                "vote_average":     vote_avg,
                "oscar_wins":       oscar_wins,
                "oscar_categories": oscar_categories,
                "tier":             tier,
                "keywords":         keywords,
            }
            next_id += 1

        movies.append(movie)

    # Sort: curated first (by ID), then new movies (by ID)
    movies.sort(key=lambda m: m["id"])

    output = {"movies": movies}
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    curated_count = sum(1 for m in movies if m["id"] <= len(curated_data))
    new_count     = len(movies) - curated_count
    print(f"\nWrote {len(movies)} movies to movies_full.json")
    print(f"  Curated (kept existing IDs): {curated_count}")
    print(f"  New (IDs {len(curated_data)+1}+):            {new_count}")


if __name__ == "__main__":
    main()
