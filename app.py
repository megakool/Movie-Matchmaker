"""Marquee — The Daily Movie Connections Puzzle
Flask app serving the public game, /create page, and admin tools.
"""

import json
import os
import random
import hashlib
import uuid
from datetime import date, datetime
from pathlib import Path
from functools import wraps

from flask import (
    Flask, render_template, jsonify, request,
    redirect, url_for, session, Response,
)

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
MOVIES_PATH = BASE_DIR / "movies.json"
PUZZLES_DIR = BASE_DIR / "puzzles"
DATA_DIR    = BASE_DIR / "data"
SUBMISSIONS_PATH  = DATA_DIR / "community_submissions.json"
CATEGORIES_PATH   = DATA_DIR / "saved_categories.json"
DRAFTS_PATH       = DATA_DIR / "drafts.json"

ADMIN_PASSWORD  = os.environ.get("MARQUEE_ADMIN_PASSWORD", "marquee-admin-2026")
DEV_MODE        = os.environ.get("MARQUEE_DEV_MODE", "0") == "1"

app = Flask(__name__)
app.secret_key = os.environ.get("MARQUEE_SECRET_KEY", "marquee-secret-dev-2026")

@app.context_processor
def inject_globals():
    return {"dev_mode": DEV_MODE}

# ── Data ──────────────────────────────────────────────────────────────────────
_movies_cache = None

def get_movies() -> list:
    global _movies_cache
    if _movies_cache is None:
        with open(MOVIES_PATH, "r", encoding="utf-8") as f:
            _movies_cache = json.load(f)["movies"]
    return _movies_cache

def get_movies_by_id() -> dict:
    return {m["id"]: m for m in get_movies()}

def get_puzzle(puzzle_date: str) -> dict | None:
    path = PUZZLES_DIR / f"{puzzle_date}.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def get_all_puzzle_dates() -> list:
    if not PUZZLES_DIR.exists():
        return []
    return sorted(p.stem for p in PUZZLES_DIR.glob("*.json"))

def get_submissions() -> list:
    if not SUBMISSIONS_PATH.exists():
        return []
    with open(SUBMISSIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_submissions(submissions: list):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SUBMISSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(submissions, f, indent=2, ensure_ascii=False)

def get_saved_categories() -> list:
    if not CATEGORIES_PATH.exists():
        return []
    with open(CATEGORIES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_saved_categories(cats: list):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CATEGORIES_PATH, "w", encoding="utf-8") as f:
        json.dump(cats, f, indent=2, ensure_ascii=False)

def get_drafts() -> list:
    if not DRAFTS_PATH.exists():
        return []
    with open(DRAFTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_drafts(drafts: list):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DRAFTS_PATH, "w", encoding="utf-8") as f:
        json.dump(drafts, f, indent=2, ensure_ascii=False)

# ── Auth ──────────────────────────────────────────────────────────────────────
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if DEV_MODE or session.get("admin"):
            return f(*args, **kwargs)
        return redirect(url_for("admin_login"))
    return decorated

# ── Public Routes ─────────────────────────────────────────────────────────────
@app.get("/")
def index():
    today = date.today().isoformat()
    # Try today's puzzle; fall back to most recent
    if get_puzzle(today):
        return redirect(url_for("play_puzzle", puzzle_date=today))
    all_dates = get_all_puzzle_dates()
    if all_dates:
        return redirect(url_for("play_puzzle", puzzle_date=all_dates[-1]))
    return render_template("no_puzzle.html", puzzle_date=today)


@app.get("/puzzle/<puzzle_date>")
def play_puzzle(puzzle_date: str):
    puzzle = get_puzzle(puzzle_date)
    today = date.today().isoformat()

    if puzzle is None:
        all_dates = get_all_puzzle_dates()
        if all_dates:
            return redirect(url_for("play_puzzle", puzzle_date=all_dates[-1]))
        return render_template("no_puzzle.html", puzzle_date=puzzle_date)

    movies_by_id = get_movies_by_id()

    # Collect tile movie_ids, deduplicating so no movie appears twice
    seen_ids = set()
    all_movie_ids = []
    for cat in puzzle["categories"]:
        for mid in cat["movie_ids"]:
            if mid not in seen_ids:
                seen_ids.add(mid)
                all_movie_ids.append(mid)
    random.shuffle(all_movie_ids)

    tiles = []
    for mid in all_movie_ids:
        movie = movies_by_id.get(mid)
        if movie:
            tiles.append({"id": mid, "title": movie["title"]})

    # Puzzle data sent to client (categories include titles — revealed only when solved)
    puzzle_for_client = {
        "date": puzzle["date"],
        "puzzle_number": puzzle.get("puzzle_number", 1),
        "categories": [
            {
                "color": cat["color"],
                "difficulty": cat["difficulty"],
                "title": cat["title"],
                "movie_ids": cat["movie_ids"],
            }
            for cat in puzzle["categories"]
        ],
    }

    # Prev / next navigation
    all_dates = get_all_puzzle_dates()
    prev_date = next_date = None
    if puzzle_date in all_dates:
        idx = all_dates.index(puzzle_date)
        if idx > 0:
            prev_date = all_dates[idx - 1]
        if idx < len(all_dates) - 1:
            next_date = all_dates[idx + 1]

    return render_template(
        "game.html",
        puzzle=puzzle_for_client,
        puzzle_json=json.dumps(puzzle_for_client),
        tiles_json=json.dumps(tiles),
        puzzle_date=puzzle_date,
        today=today,
        prev_date=prev_date,
        next_date=next_date,
    )


@app.get("/archive")
def archive():
    all_dates = get_all_puzzle_dates()
    today = date.today().isoformat()
    puzzles_meta = []
    for d in reversed(all_dates):
        p = get_puzzle(d)
        puzzles_meta.append({
            "date": d,
            "puzzle_number": p.get("puzzle_number", "?") if p else "?",
            "is_today": d == today,
            "is_past": d < today,
            "is_future": d > today,
        })
    return render_template("archive.html", puzzles=puzzles_meta, today=today)


@app.get("/create")
def create():
    return render_template("create.html")


@app.get("/api/puzzle/<puzzle_date>")
def api_puzzle(puzzle_date: str):
    puzzle = get_puzzle(puzzle_date)
    if puzzle is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(puzzle)


@app.get("/api/random-movies")
def api_random_movies():
    movies = get_movies()
    # Optional exclusion list (comma-separated ids) and count
    exclude_raw = request.args.get("exclude", "")
    try:
        exclude_ids = {int(x) for x in exclude_raw.split(",") if x.strip()}
    except ValueError:
        exclude_ids = set()
    count = min(int(request.args.get("count", 8)), 8)
    pool = [m for m in movies if m["id"] not in exclude_ids]
    sample = random.sample(pool, min(count, len(pool)))
    return jsonify([
        {"id": m["id"], "title": m["title"], "year": m["year"]}
        for m in sample
    ])


@app.post("/create/submit")
def create_submit():
    data = request.get_json(force=True)
    category_name = (data.get("category_name") or "").strip()[:60]
    movie_ids = data.get("movie_ids", [])

    if not category_name or len(movie_ids) != 4:
        return jsonify({"error": "invalid"}), 400

    # Rate limit: 5 per IP per day
    ip_raw = request.headers.get("X-Forwarded-For", request.remote_addr or "")
    ip_hash = hashlib.sha256(
        f"{ip_raw}{date.today().isoformat()}".encode()
    ).hexdigest()[:16]

    submissions = get_submissions()
    today_count = sum(
        1 for s in submissions
        if s.get("ip_hash") == ip_hash
        and s.get("submitted_at", "")[:10] == date.today().isoformat()
    )
    if today_count >= 5:
        return jsonify({"error": "rate_limit", "message": "Max 5 submissions per day."}), 429

    movies_by_id = get_movies_by_id()
    movie_titles = [movies_by_id[mid]["title"] for mid in movie_ids if mid in movies_by_id]
    if len(movie_titles) != 4:
        return jsonify({"error": "invalid_ids"}), 400

    submission = {
        "id": str(uuid.uuid4())[:8],
        "submitted_at": datetime.now().isoformat(timespec="seconds"),
        "category_name": category_name,
        "movie_ids": movie_ids,
        "movie_titles": movie_titles,
        "ip_hash": ip_hash,
        "status": "pending",
    }
    submissions.append(submission)
    save_submissions(submissions)
    return jsonify({"ok": True, "submission": submission})


# ── Admin Routes ──────────────────────────────────────────────────────────────
@app.get("/admin/login")
def admin_login():
    return render_template("admin_login.html")

@app.post("/admin/login")
def admin_login_post():
    if request.form.get("password") == ADMIN_PASSWORD:
        session["admin"] = True
        return redirect(url_for("admin_dashboard"))
    return render_template("admin_login.html", error="Wrong password.")

@app.get("/admin/logout")
def admin_logout():
    session.pop("admin", None)
    return redirect(url_for("admin_login"))

@app.get("/admin")
@admin_required
def admin_dashboard():
    all_dates = get_all_puzzle_dates()
    pending = [s for s in get_submissions() if s.get("status") == "pending"]
    return render_template(
        "admin.html",
        puzzle_dates=all_dates,
        pending_count=len(pending),
    )

@app.get("/admin/movies")
@admin_required
def admin_movies():
    return jsonify(get_movies())

@app.post("/admin/publish")
@admin_required
def admin_publish():
    data = request.get_json(force=True)
    puzzle_date = data.get("date", "").strip()
    if not puzzle_date:
        return jsonify({"error": "no date"}), 400

    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    all_dates = get_all_puzzle_dates()
    if puzzle_date in all_dates:
        puzzle_number = all_dates.index(puzzle_date) + 1
    else:
        puzzle_number = len(all_dates) + 1

    puzzle = {
        "date": puzzle_date,
        "puzzle_number": puzzle_number,
        "categories": data.get("categories", []),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "author_note": data.get("author_note", ""),
    }
    path = PUZZLES_DIR / f"{puzzle_date}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(puzzle, f, indent=2, ensure_ascii=False)
    return jsonify({"ok": True, "puzzle_number": puzzle_number})

@app.get("/admin/submissions")
@admin_required
def admin_get_submissions():
    return jsonify(get_submissions())

@app.post("/admin/submissions/<sub_id>/use")
@admin_required
def admin_use_submission(sub_id: str):
    submissions = get_submissions()
    for s in submissions:
        if s["id"] == sub_id:
            s["status"] = "used"
            break
    save_submissions(submissions)
    return jsonify({"ok": True})

@app.post("/admin/submissions/<sub_id>/dismiss")
@admin_required
def admin_dismiss_submission(sub_id: str):
    submissions = get_submissions()
    for s in submissions:
        if s["id"] == sub_id:
            s["status"] = "dismissed"
            break
    save_submissions(submissions)
    return jsonify({"ok": True})


# ── Saved Categories ───────────────────────────────────────────────────────────
@app.get("/admin/categories")
@admin_required
def admin_get_categories():
    return jsonify(get_saved_categories())

@app.post("/admin/categories")
@admin_required
def admin_create_category():
    data         = request.get_json(force=True)
    title        = (data.get("title") or "").strip()[:80]
    movie_ids    = data.get("movie_ids", [])
    movie_titles = data.get("movie_titles", [])
    source       = data.get("source", "manual")   # manual | submission | ai

    if not title or len(movie_ids) != 4:
        return jsonify({"error": "invalid"}), 400

    movies_by_id = get_movies_by_id()
    if not all(mid in movies_by_id for mid in movie_ids):
        return jsonify({"error": "invalid_ids"}), 400

    # Enrich titles if missing
    if len(movie_titles) != 4:
        movie_titles = [movies_by_id[mid]["title"] for mid in movie_ids if mid in movies_by_id]

    cats = get_saved_categories()
    cat  = {
        "id":           str(uuid.uuid4())[:8],
        "title":        title,
        "movie_ids":    movie_ids,
        "movie_titles": movie_titles,
        "source":       source,
        "created_at":   datetime.now().isoformat(timespec="seconds"),
        "times_used":   0,
    }
    cats.append(cat)
    save_saved_categories(cats)
    return jsonify({"ok": True, "category": cat}), 201

@app.delete("/admin/categories/<cat_id>")
@admin_required
def admin_delete_category(cat_id: str):
    cats = [c for c in get_saved_categories() if c["id"] != cat_id]
    save_saved_categories(cats)
    return jsonify({"ok": True})


# ── Drafts ────────────────────────────────────────────────────────────────────
@app.get("/admin/drafts")
@admin_required
def admin_get_drafts():
    return jsonify(get_drafts())

@app.post("/admin/drafts")
@admin_required
def admin_save_draft():
    data        = request.get_json(force=True)
    draft_id    = data.get("id")
    name        = (data.get("name") or "Untitled Draft").strip()[:60]
    pub_date    = data.get("date", "")
    categories  = data.get("categories", [])
    author_note = data.get("author_note", "").strip()
    now         = datetime.now().isoformat(timespec="seconds")

    drafts = get_drafts()
    if draft_id:
        for d in drafts:
            if d["id"] == draft_id:
                d.update({"name": name, "date": pub_date, "categories": categories,
                           "author_note": author_note, "saved_at": now})
                save_drafts(drafts)
                return jsonify({"ok": True, "draft": d})

    draft = {"id": str(uuid.uuid4())[:8], "name": name, "date": pub_date,
             "categories": categories, "author_note": author_note, "saved_at": now}
    drafts.append(draft)
    save_drafts(drafts)
    return jsonify({"ok": True, "draft": draft}), 201

@app.delete("/admin/drafts/<draft_id>")
@admin_required
def admin_delete_draft(draft_id: str):
    save_drafts([d for d in get_drafts() if d["id"] != draft_id])
    return jsonify({"ok": True})


# ── Published detail (expand view) ────────────────────────────────────────────
@app.get("/admin/published-detail/<puzzle_date>")
@admin_required
def admin_published_detail(puzzle_date: str):
    puzzle = get_puzzle(puzzle_date)
    if puzzle is None:
        return jsonify({"error": "not found"}), 404
    movies_by_id = get_movies_by_id()
    detail = []
    for cat in puzzle["categories"]:
        detail.append({
            "color":  cat["color"],
            "title":  cat["title"],
            "movies": [{"id": mid, "title": movies_by_id[mid]["title"]}
                       for mid in cat["movie_ids"] if mid in movies_by_id],
        })
    return jsonify({"date": puzzle_date, "categories": detail})


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Starting Marquee at http://127.0.0.1:5002")
    app.run(host="127.0.0.1", port=5002, debug=True, use_reloader=False)
