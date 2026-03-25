"""
enrich_movies.py
Enriches movies.json and movies_full.json with additional TMDB data:
  genres, runtime, tagline, writers, cast (top 10), cinematographer

Usage:
    python enrich_movies.py --api-key YOUR_TMDB_KEY
    python enrich_movies.py --api-key YOUR_TMDB_KEY --file movies_full.json
    python enrich_movies.py --api-key YOUR_TMDB_KEY --all   (enriches both files)
"""

import json
import time
import argparse
import urllib.request
import urllib.error
from pathlib import Path

BASE_DIR = Path(__file__).parent
TMDB_BASE = "https://api.themoviedb.org/3"
SLEEP_BETWEEN = 0.03   # ~33 req/s, well under the 40/s limit


def tmdb_get(path: str, api_key: str) -> dict | None:
    # Bearer token (JWT) vs v3 API key
    if api_key.startswith("eyJ"):
        req = urllib.request.Request(
            f"{TMDB_BASE}{path}",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
    else:
        req = urllib.request.Request(f"{TMDB_BASE}{path}?api_key={api_key}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception as e:
        print(f"  ERROR fetching {path}: {e}")
        return None


def enrich_movie(movie: dict, api_key: str) -> dict:
    tmdb_id = movie.get("tmdb_id", "")
    if not tmdb_id:
        return movie

    # Fetch main movie details
    details = tmdb_get(f"/movie/{tmdb_id}", api_key)
    if details:
        movie["genres"]  = [g["name"] for g in details.get("genres", [])]
        movie["runtime"] = details.get("runtime") or 0
        movie["tagline"] = (details.get("tagline") or "").strip()
    else:
        movie.setdefault("genres", [])
        movie.setdefault("runtime", 0)
        movie.setdefault("tagline", "")

    time.sleep(SLEEP_BETWEEN)

    # Fetch credits
    credits = tmdb_get(f"/movie/{tmdb_id}/credits", api_key)
    if credits:
        # Cast: top 10 by order
        cast = credits.get("cast", [])
        cast.sort(key=lambda c: c.get("order", 9999))
        movie["cast"] = [c["name"] for c in cast[:10]]

        # Crew: writers and cinematographer
        crew = credits.get("crew", [])
        writer_jobs = {"Screenplay", "Writer", "Story", "Novel", "Characters"}
        writers = []
        cinematographer = ""
        seen_writers = set()
        for person in crew:
            job = person.get("job", "")
            name = person.get("name", "")
            if job in writer_jobs and name not in seen_writers:
                writers.append(name)
                seen_writers.add(name)
            if job == "Director of Photography" and not cinematographer:
                cinematographer = name

        movie["writers"]        = writers
        movie["cinematographer"] = cinematographer
    else:
        movie.setdefault("cast", movie.get("actors", []))
        movie.setdefault("writers", [])
        movie.setdefault("cinematographer", "")

    time.sleep(SLEEP_BETWEEN)
    return movie


def enrich_file(filepath: Path, api_key: str):
    print(f"\nEnriching {filepath.name} ...")
    with open(filepath, encoding="utf-8") as f:
        data = json.load(f)

    movies = data["movies"]
    total  = len(movies)

    for i, movie in enumerate(movies, 1):
        # Skip if already enriched (has non-empty genres and writers)
        if movie.get("genres") and movie.get("writers"):
            if i % 100 == 0:
                print(f"  [{i}/{total}] already enriched, skipping...")
            continue

        movies[i - 1] = enrich_movie(movie, api_key)

        if i % 50 == 0 or i == total:
            print(f"  [{i}/{total}] enriched {movie.get('title', '?')}")
            # Save incrementally every 50 movies
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump({"movies": movies}, f, indent=2, ensure_ascii=False)

    # Final save
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump({"movies": movies}, f, indent=2, ensure_ascii=False)
    print(f"Done. Saved {filepath.name}")


def main():
    parser = argparse.ArgumentParser(description="Enrich movie JSON files with TMDB data")
    parser.add_argument("--api-key", required=True, help="TMDB API key")
    parser.add_argument("--file",    default="movies.json", help="JSON file to enrich (default: movies.json)")
    parser.add_argument("--all",     action="store_true",   help="Enrich both movies.json and movies_full.json")
    args = parser.parse_args()

    if args.all:
        files = [BASE_DIR / "movies.json", BASE_DIR / "movies_full.json"]
    else:
        files = [BASE_DIR / args.file]

    for filepath in files:
        if not filepath.exists():
            print(f"Skipping {filepath.name} (not found)")
            continue
        enrich_file(filepath, args.api_key)

    print("\nAll done!")


if __name__ == "__main__":
    main()
