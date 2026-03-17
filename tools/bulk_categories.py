#!/usr/bin/env python3
"""
Marquee Bulk Category Builder
------------------------------
Local script for fast thematic category generation.
No web server needed — runs directly from the command line.

Usage:
    python tools/bulk_categories.py
    python tools/bulk_categories.py --dataset full
    python tools/bulk_categories.py --output /path/to/saved_categories.json

Requires:
    pip install anthropic
    ANTHROPIC_API_KEY environment variable (or .env file in this directory)
"""

import argparse
import json
import os
import re
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

# ── Resolve paths ──────────────────────────────────────────────────────────────
TOOLS_DIR  = Path(__file__).parent
MARQUEE    = TOOLS_DIR.parent
DATA_DIR   = MARQUEE / "data"

# ── Load .env if present ───────────────────────────────────────────────────────
_env_file = TOOLS_DIR / ".env"
if not _env_file.exists():
    _env_file = MARQUEE / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_movies(dataset_override: str | None = None) -> list:
    """Load movies from the active dataset (or override)."""
    settings_path = DATA_DIR / "settings.json"
    dataset = dataset_override
    if not dataset:
        try:
            with open(settings_path) as f:
                dataset = json.load(f).get("active_dataset", "curated")
        except Exception:
            dataset = "curated"

    fname = "movies_full.json" if dataset == "full" else "movies.json"
    fpath = MARQUEE / fname
    if not fpath.exists():
        fpath = MARQUEE / "movies.json"  # fallback

    with open(fpath, encoding="utf-8") as f:
        data = json.load(f)
    movies = data["movies"] if isinstance(data, dict) and "movies" in data else data
    print(f"Loaded {len(movies)} movies from {fpath.name}")
    return movies


def load_saved_categories() -> list:
    """Load existing saved categories."""
    cat_path = DATA_DIR / "saved_categories.json"
    try:
        with open(cat_path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_categories(cats: list, output_path: Path) -> None:
    """Atomic write: write to .tmp then rename."""
    tmp = output_path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cats, f, indent=2, ensure_ascii=False)
    tmp.replace(output_path)
    print(f"Saved {len(cats)} categories → {output_path}")


def _titles_only_list(movies: list) -> str:
    """Compact title+year list for Claude prompts."""
    return "\n".join(f'"{m["title"]}" ({m["year"]})' for m in movies)


def _normalise(title: str) -> str:
    t = title.lower().strip()
    t = re.sub(r'^(the|a|an)\s+', '', t)
    return t


def _match_titles_to_ids(titles: list, movies_by_title: dict) -> list:
    """Fuzzy title matching: exact → case-insensitive → strip articles."""
    ids = []
    norm_map = {_normalise(k): v for k, v in movies_by_title.items()}
    for title in titles:
        tl = title.lower().strip()
        if tl in movies_by_title:
            ids.append(movies_by_title[tl]["id"])
        elif _normalise(title) in norm_map:
            ids.append(norm_map[_normalise(title)]["id"])
    return ids


def _build_movies_by_title(movies: list) -> dict:
    return {m["title"].lower(): m for m in movies}


def _call_claude(system: str, user: str, api_key: str) -> str | None:
    """Call Claude and return the raw text response."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package not installed. Run: pip install anthropic")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    try:
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text if msg.content else None
    except Exception as e:
        print(f"Claude API error: {e}")
        return None


def _extract_json(text: str) -> dict | list | None:
    """Extract JSON from Claude response, even if wrapped in markdown."""
    if not text:
        return None
    text = text.strip()
    # Try direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip ```json ... ``` fences
    m = re.search(r'```(?:json)?\s*([\s\S]+?)```', text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            pass
    # Find first { or [ to end
    m = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None


def is_duplicate(new_ids: list, existing_cats: list) -> bool:
    """Check if a category with the same movie_ids set already exists."""
    new_set = set(new_ids)
    for cat in existing_cats:
        if set(cat.get("movie_ids", [])) == new_set:
            return True
    return False


def make_category_record(title: str, movie_ids: list, movies: list) -> dict:
    """Build a saved_categories.json record."""
    id_to_title = {m["id"]: m["title"] for m in movies}
    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "movie_ids": movie_ids,
        "movie_titles": [id_to_title.get(i, str(i)) for i in movie_ids],
        "source": "manual",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "times_used": 0,
    }


# ── Mode 1: Thematic AI Batch ──────────────────────────────────────────────────

def mode_thematic(movies: list, api_key: str, output_path: Path) -> None:
    """User enters themes; Claude finds 4 movies per theme using its film knowledge."""

    movies_by_title = _build_movies_by_title(movies)
    titles_list     = _titles_only_list(movies)

    system = (
        "You are a puzzle designer for Marquee, a daily movie connections game. "
        "You have expert knowledge of film history, plots, settings, themes, casting, and real-world facts about movies. "
        "Given a list of movie titles and a theme, find exactly 4 movies from the list that best fit the theme — "
        "using your knowledge of what actually happens in these films, where they are set, "
        "who stars in them, narrative outcomes, tone, or any other meaningful connection. "
        "The connection must be specific and verifiable, not vague. "
        "Use the exact title as it appears in the list. "
        "Respond ONLY with valid JSON, no prose:\n"
        '{"title": "Clever Category Name (≤60 chars)", "movies": ["Exact Title A", "Exact Title B", "Exact Title C", "Exact Title D"]}'
    )

    print("\n── THEMATIC AI BATCH ──────────────────────────────────────────────")
    print("Enter themes one per line. Leave blank and press Enter when done.")
    print('Examples: "movies set in Japan", "protagonist dies at the end",')
    print('          "musician turned actor", "post-apocalyptic survival"\n')

    themes = []
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            break
        themes.append(line)

    if not themes:
        print("No themes entered.")
        return

    saved_cats = load_saved_categories()
    new_cats   = []

    print(f"\nProcessing {len(themes)} theme(s) against {len(movies)} movies...\n")

    for i, theme in enumerate(themes, 1):
        print(f"[{i}/{len(themes)}] \"{theme}\"")
        raw = _call_claude(system, f"Theme: {theme}\n\nMovies to choose from:\n{titles_list}", api_key)
        result = _extract_json(raw)

        if not result or "movies" not in result:
            print(f"  ✗ No valid response from Claude. Raw: {repr(raw)[:200]}\n")
            continue

        cat_title     = result.get("title", theme.title())
        matched_titles = result.get("movies", [])
        matched_ids   = _match_titles_to_ids(matched_titles, movies_by_title)

        print(f"  Suggested title: \"{cat_title}\"")
        print(f"  Movies: {', '.join(matched_titles)}")
        if len(matched_ids) < 4:
            unmatched = [t for t in matched_titles if t.lower() not in movies_by_title and _normalise(t) not in {_normalise(k) for k in movies_by_title}]
            if unmatched:
                print(f"  ⚠ Could not match: {unmatched}")

        if len(matched_ids) < 2:
            print("  ✗ Too few matched movies. Skipping.\n")
            continue

        if is_duplicate(matched_ids, saved_cats + new_cats):
            print("  ✗ Duplicate of existing category. Skipping.\n")
            continue

        print("  [a]ccept  [r]eject  [e]dit title  ", end="", flush=True)
        try:
            choice = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            choice = "r"

        if choice == "a" or choice == "":
            record = make_category_record(cat_title, matched_ids, movies)
            new_cats.append(record)
            print(f"  ✓ Accepted: \"{cat_title}\"\n")

        elif choice == "e":
            try:
                new_title = input("  New title: ").strip()
            except (EOFError, KeyboardInterrupt):
                new_title = cat_title
            if new_title:
                cat_title = new_title
            record = make_category_record(cat_title, matched_ids, movies)
            new_cats.append(record)
            print(f"  ✓ Accepted: \"{cat_title}\"\n")

        else:
            print("  ✗ Rejected.\n")

    if new_cats:
        all_cats = saved_cats + new_cats
        save_categories(all_cats, output_path)
        print(f"\n✓ Added {len(new_cats)} new category/categories.")
    else:
        print("\nNo new categories added.")


# ── Mode 2: Structural Browser ─────────────────────────────────────────────────

def mode_structural(movies: list, output_path: Path) -> None:
    """Browse director/actor/writer groups with 4+ films; pick 4, name category, save."""

    # Build groups
    groups: dict[str, dict[str, list]] = {
        "director": defaultdict(list),
        "actor":    defaultdict(list),
        "writer":   defaultdict(list),
    }

    for m in movies:
        for d in m.get("directors", []):
            groups["director"][d].append(m)
        for a in m.get("actors", m.get("cast", []))[:5]:  # top 5 actors
            groups["actor"][a].append(m)
        for w in m.get("writers", []):
            groups["writer"][w].append(m)

    # Build flat list of (type, name, movies) with 4+ entries, sorted by count desc
    entries = []
    for gtype, gmap in groups.items():
        for name, mlist in gmap.items():
            if len(mlist) >= 4:
                entries.append((gtype, name, mlist))
    entries.sort(key=lambda x: -len(x[2]))

    if not entries:
        print("No director/actor/writer groups with 4+ movies found.")
        return

    saved_cats = load_saved_categories()
    new_cats   = []

    print(f"\n── STRUCTURAL BROWSER ─────────────────────────────────────────────")
    print(f"Found {len(entries)} groups with 4+ movies.\n")
    print("Commands: [n]ext  [p]rev  [s]elect  [q]uit\n")

    idx = 0
    selected_ids: list[int] = []

    def show_entry():
        gtype, name, mlist = entries[idx]
        print(f"\n── [{idx+1}/{len(entries)}] {gtype.upper()}: {name} ({len(mlist)} films) ──")
        for j, m in enumerate(mlist[:12], 1):
            print(f"  {j:2}. {m['title']} ({m['year']})")
        if len(mlist) > 12:
            print(f"  ... and {len(mlist) - 12} more")

    show_entry()

    while True:
        try:
            cmd = input("\nCommand: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            break

        if cmd in ("q", "quit"):
            break

        elif cmd in ("n", "next", ""):
            idx = (idx + 1) % len(entries)
            show_entry()

        elif cmd in ("p", "prev"):
            idx = (idx - 1) % len(entries)
            show_entry()

        elif cmd.startswith("s") or cmd.startswith("select"):
            gtype, name, mlist = entries[idx]
            print(f"\nSelect 4 movies from \"{name}\" (enter numbers separated by spaces):")
            for j, m in enumerate(mlist, 1):
                print(f"  {j:2}. {m['title']} ({m['year']})")

            try:
                picks_str = input("Pick 4: ").strip()
                picks = [int(x) - 1 for x in picks_str.split()]
            except (ValueError, EOFError):
                print("Invalid input.")
                continue

            if len(picks) != 4:
                print(f"Need exactly 4 picks, got {len(picks)}.")
                continue

            if any(p < 0 or p >= len(mlist) for p in picks):
                print("Pick numbers out of range.")
                continue

            selected = [mlist[p] for p in picks]
            selected_ids = [m["id"] for m in selected]
            titles_str = ", ".join(m["title"] for m in selected)
            print(f"\nSelected: {titles_str}")

            if is_duplicate(selected_ids, saved_cats + new_cats):
                print("✗ Duplicate of existing category. Skipping.")
                continue

            try:
                cat_title = input("Category name: ").strip()
            except (EOFError, KeyboardInterrupt):
                continue

            if not cat_title:
                print("No title entered. Skipping.")
                continue

            record = make_category_record(cat_title, selected_ids, movies)
            new_cats.append(record)
            print(f"✓ Saved: \"{cat_title}\"")

        elif cmd in ("h", "help", "?"):
            print("  [n]ext / [p]rev — browse groups")
            print("  [s]elect        — pick 4 movies from this group")
            print("  [q]uit          — save and exit")

        else:
            print("Unknown command. Type h for help.")

    if new_cats:
        all_cats = saved_cats + new_cats
        save_categories(all_cats, output_path)
        print(f"\n✓ Added {len(new_cats)} new category/categories.")
    else:
        print("\nNo new categories added.")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Marquee Bulk Category Builder")
    parser.add_argument("--dataset", choices=["curated", "full"], help="Override active dataset")
    parser.add_argument("--output", help="Path to saved_categories.json (default: data/saved_categories.json)")
    args = parser.parse_args()

    output_path = Path(args.output) if args.output else DATA_DIR / "saved_categories.json"

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    movies = load_movies(args.dataset)

    print("\n╔═══════════════════════════════════════╗")
    print("║   Marquee Bulk Category Builder       ║")
    print("╠═══════════════════════════════════════╣")
    print("║  1. Thematic AI Batch (recommended)   ║")
    print("║  2. Structural Browser (no AI)        ║")
    print("╚═══════════════════════════════════════╝")

    try:
        choice = input("\nSelect mode [1/2]: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        return

    if choice == "1":
        if not api_key:
            print("\nERROR: ANTHROPIC_API_KEY not set.")
            print("Add it to your environment or create a .env file in marquee/tools/ with:")
            print("  ANTHROPIC_API_KEY=sk-ant-...")
            sys.exit(1)
        mode_thematic(movies, api_key, output_path)

    elif choice == "2":
        mode_structural(movies, output_path)

    else:
        print("Invalid choice.")


if __name__ == "__main__":
    main()
