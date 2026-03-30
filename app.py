"""Marquee — The Daily Movie Connections Puzzle
Flask app serving the public game, /create page, and admin tools.
"""

import json
import os
import re
import random
import hashlib
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from functools import wraps

from flask import (
    Flask, render_template, jsonify, request,
    redirect, url_for, session, Response,
)

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR          = Path(__file__).parent
# On Render the git root IS the marquee/ dir; locally app.py lives one level up.
MARQUEE_DIR       = BASE_DIR / "marquee" if (BASE_DIR / "marquee").is_dir() else BASE_DIR
MOVIES_PATH       = MARQUEE_DIR / "movies.json"
MOVIES_FULL_PATH  = MARQUEE_DIR / "movies_full.json"

# If DATA_DIR env var is set (e.g. Render persistent disk at /data), use that.
# Otherwise fall back to the shared data/ folder at the project root.
_env_data_dir = os.environ.get("DATA_DIR", "")
DATA_DIR      = Path(_env_data_dir) if _env_data_dir else BASE_DIR / "data"
PUZZLES_DIR   = DATA_DIR / "puzzles"

TRIVIA_PATH       = BASE_DIR / "trivia" / "trivia.json"
TRIVIA_DATA_PATH  = DATA_DIR / "trivia_questions.json"
TRIVIA_PUZZLES_DIR = DATA_DIR / "trivia_puzzles"
SUBMISSIONS_PATH  = DATA_DIR / "community_submissions.json"
CATEGORIES_PATH   = DATA_DIR / "saved_categories.json"
DRAFTS_PATH       = DATA_DIR / "drafts.json"
SETTINGS_PATH     = DATA_DIR / "settings.json"


def _init_persistent_disk() -> None:
    """On first boot with a fresh persistent disk, seed it from the repo's data/ folder."""
    if not _env_data_dir:
        return  # local dev — nothing to do
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    TRIVIA_PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    repo_data           = BASE_DIR / "data"
    repo_puzzles        = BASE_DIR / "data" / "puzzles"
    repo_trivia_puzzles = BASE_DIR / "data" / "trivia_puzzles"
    import shutil
    # Copy data files only if they don't already exist on the disk
    for src in repo_data.glob("*.json"):
        dst = DATA_DIR / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
    # Copy puzzle files only if they don't already exist on the disk
    for src in repo_puzzles.glob("*.json"):
        dst = PUZZLES_DIR / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
    # Copy trivia puzzle files only if they don't already exist on the disk
    for src in repo_trivia_puzzles.glob("*.json"):
        dst = TRIVIA_PUZZLES_DIR / src.name
        if not dst.exists():
            shutil.copy2(src, dst)


_init_persistent_disk()


def _migrate_puzzle_ids() -> None:
    """One-time migration: remap movie_ids in all puzzle files after the dataset expansion."""
    remap_path   = BASE_DIR / "id_remap.json"
    marker_path  = DATA_DIR / "puzzle_id_migration_v1.done"
    if marker_path.exists() or not remap_path.exists():
        return
    if not PUZZLES_DIR.exists():
        return
    with open(remap_path, "r", encoding="utf-8") as f:
        remap = {int(k): v for k, v in json.load(f).items()}
    changed = 0
    for puzzle_file in PUZZLES_DIR.glob("*.json"):
        with open(puzzle_file, "r", encoding="utf-8") as f:
            puzzle = json.load(f)
        updated = False
        for cat in puzzle.get("categories", []):
            new_ids = []
            for mid in cat.get("movie_ids", []):
                new_id = remap.get(mid, mid)
                new_ids.append(new_id)
                if new_id != mid:
                    updated = True
            cat["movie_ids"] = new_ids
        if updated:
            with open(puzzle_file, "w", encoding="utf-8") as f:
                json.dump(puzzle, f, indent=2, ensure_ascii=False)
            changed += 1
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    marker_path.write_text("done")


_migrate_puzzle_ids()
# Ensure trivia_puzzles dir always exists locally too
TRIVIA_PUZZLES_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_PASSWORD    = os.environ.get("MARQUEE_ADMIN_PASSWORD", "marquee-admin-2026")
DEV_MODE          = os.environ.get("MARQUEE_DEV_MODE", "0") == "1"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

app = Flask(__name__, template_folder=str(MARQUEE_DIR / "templates"), static_folder=str(MARQUEE_DIR / "static"))
app.secret_key = os.environ.get("MARQUEE_SECRET_KEY", "marquee-secret-dev-2026")

@app.context_processor
def inject_globals():
    return {"dev_mode": DEV_MODE}

# ── Data ──────────────────────────────────────────────────────────────────────
_movies_cache = None

def get_settings() -> dict:
    if not SETTINGS_PATH.exists():
        return {"active_dataset": "curated", "progress_version": 1}
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        s = json.load(f)
    if "progress_version" not in s:
        s["progress_version"] = 1
    return s

def save_settings(settings: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)

def get_movies() -> list:
    global _movies_cache
    if _movies_cache is None:
        path = MOVIES_FULL_PATH if MOVIES_FULL_PATH.exists() else MOVIES_PATH
        with open(path, "r", encoding="utf-8") as f:
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

# ── Trivia helpers ────────────────────────────────────────────────────────────
_trivia_cache = None

def get_trivia_questions() -> list:
    """Return trivia questions. Prefer editable copy on persistent disk."""
    global _trivia_cache
    if _trivia_cache is None:
        if TRIVIA_DATA_PATH.exists():
            with open(TRIVIA_DATA_PATH, "r", encoding="utf-8") as f:
                _trivia_cache = json.load(f)
        elif TRIVIA_PATH.exists():
            with open(TRIVIA_PATH, "r", encoding="utf-8") as f:
                _trivia_cache = json.load(f)["questions"]
        else:
            _trivia_cache = []
    return _trivia_cache


def save_trivia_questions(questions: list) -> None:
    global _trivia_cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(TRIVIA_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(questions, f, indent=2, ensure_ascii=False)
    _trivia_cache = questions


def get_daily_trivia(questions: list, today_str: str, count: int = 3) -> list:
    """Return `count` questions for today using a deterministic shuffle."""
    active = [q for q in questions if q.get("active", True)]
    seed_key = "spiker-trivia-v1"
    shuffled = sorted(
        active,
        key=lambda q: hashlib.md5(f"{seed_key}{q['id']}".encode()).hexdigest(),
    )
    n = len(shuffled)
    if n == 0:
        return []
    epoch = date(2026, 1, 1)
    day_offset = (date.fromisoformat(today_str) - epoch).days
    return [shuffled[(day_offset * count + i) % n] for i in range(count)]


def get_trivia_puzzle(puzzle_date: str) -> dict | None:
    path = TRIVIA_PUZZLES_DIR / f"{puzzle_date}.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_all_trivia_puzzle_dates() -> list:
    if not TRIVIA_PUZZLES_DIR.exists():
        return []
    return sorted(p.stem for p in TRIVIA_PUZZLES_DIR.glob("*.json"))


# ── Public Routes ─────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return render_template("home.html")


@app.get("/trivia")
def trivia_index():
    # Let the client determine today's local date — the server runs UTC on Render,
    # which would show tomorrow's puzzle for US users in the evening.
    return """<!DOCTYPE html>
<html><head><title>Trivia</title></head><body><script>
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, '0');
const day = String(d.getDate()).padStart(2, '0');
window.location.replace('/trivia/' + y + '-' + m + '-' + day);
</script></body></html>"""


@app.get("/trivia/<puzzle_date>")
def trivia_puzzle(puzzle_date: str):
    today = date.today().isoformat()
    puzzle = get_trivia_puzzle(puzzle_date)
    questions_by_id = {q["id"]: q for q in get_trivia_questions()}
    if puzzle is None:
        return render_template("no_trivia.html", puzzle_date=puzzle_date, today=today)
    qs = [questions_by_id.get(qid) for qid in puzzle.get("questions", [])]
    qs = [q for q in qs if q]
    if not qs:
        return render_template("no_trivia.html", puzzle_date=puzzle_date, today=today)
    all_dates = get_all_trivia_puzzle_dates()
    quiz_number = all_dates.index(puzzle_date) + 1 if puzzle_date in all_dates else 1
    return render_template("trivia.html", questions=qs, today=puzzle_date, quiz_number=quiz_number)


@app.get("/trivia/archive")
def trivia_archive():
    puzzle_dates = get_all_trivia_puzzle_dates()
    today = date.today().isoformat()
    questions_by_id = {q["id"]: q for q in get_trivia_questions()}
    past_dates = [d for d in puzzle_dates if d <= today]
    puzzles = []
    for d in reversed(past_dates[-60:]):  # last 60, past only
        puzzle = get_trivia_puzzle(d)
        if puzzle is None:
            continue
        qs = [questions_by_id.get(qid) for qid in puzzle.get("questions", [])]
        qs = [q for q in qs if q]
        quiz_number = puzzle_dates.index(d) + 1
        puzzles.append({"date": d, "questions": qs, "quiz_number": quiz_number})
    return render_template("trivia_archive.html", puzzles=puzzles, today=today)


@app.get("/marquee")
def marquee_index():
    return render_template("date_redirect.html")


@app.get("/marquee/<puzzle_date>")
def marquee_puzzle(puzzle_date: str):
    puzzle = get_puzzle(puzzle_date)
    today = date.today().isoformat()
    max_allowed = (date.today() + timedelta(days=1)).isoformat()

    # Block access to puzzles more than 1 day in the future (timezone tolerance)
    if puzzle_date > max_allowed:
        return redirect(url_for("marquee_puzzle", puzzle_date=today)) if get_puzzle(today) else redirect(url_for("marquee_index"))

    if puzzle is None:
        all_dates = get_all_puzzle_dates()
        if all_dates:
            return redirect(url_for("marquee_puzzle", puzzle_date=all_dates[-1]))
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

    # Prev / next navigation
    all_dates = get_all_puzzle_dates()
    prev_date = next_date = None
    puzzle_number = 1
    if puzzle_date in all_dates:
        idx = all_dates.index(puzzle_date)
        puzzle_number = idx + 1
        if idx > 0:
            prev_date = all_dates[idx - 1]
        if idx < len(all_dates) - 1:
            next_date = all_dates[idx + 1]

    # Puzzle data sent to client (categories include titles — revealed only when solved)
    puzzle_for_client = {
        "date": puzzle["date"],
        "puzzle_number": puzzle_number,
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

    return render_template(
        "game.html",
        puzzle=puzzle_for_client,
        puzzle_json=json.dumps(puzzle_for_client),
        tiles_json=json.dumps(tiles),
        puzzle_date=puzzle_date,
        today=today,
        prev_date=prev_date,
        next_date=next_date,
        progress_version=get_settings().get("progress_version", 1),
    )


@app.get("/marquee/archive")
def marquee_archive():
    all_dates = get_all_puzzle_dates()
    today = date.today().isoformat()
    puzzles_meta = []
    for i, d in enumerate(all_dates):
        if d > today:
            continue
        puzzles_meta.append({
            "date": d,
            "puzzle_number": i + 1,
            "is_today": d == today,
            "is_past": d < today,
            "is_future": False,
        })
    puzzles_meta.reverse()
    return render_template("archive.html", puzzles=puzzles_meta, today=today)


@app.get("/marquee/create")
def marquee_create():
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


@app.post("/marquee/create/submit")
def marquee_create_submit():
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
    # Pass (date, number) pairs so the template shows the same number as players see
    puzzle_dates_numbered = [(d, i + 1) for i, d in enumerate(all_dates)]
    pending = [s for s in get_submissions() if s.get("status") == "pending"]
    return render_template(
        "admin.html",
        puzzle_dates=all_dates,
        puzzle_dates_numbered=puzzle_dates_numbered,
        pending_count=len(pending),
        today=date.today().isoformat(),
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

    # Mark matching saved categories as used
    pub_movie_id_sets = [frozenset(cat["movie_ids"]) for cat in data.get("categories", [])]
    saved_cats = get_saved_categories()
    changed = False
    for cat in saved_cats:
        if frozenset(cat.get("movie_ids", [])) in pub_movie_id_sets:
            cat["times_used"] = cat.get("times_used", 0) + 1
            changed = True
    if changed:
        save_saved_categories(saved_cats)

    return jsonify({"ok": True, "puzzle_number": puzzle_number})


@app.post("/admin/puzzles/<puzzle_date>/redate")
@admin_required
def admin_redate_puzzle(puzzle_date: str):
    new_date = (request.get_json(force=True) or {}).get("new_date", "").strip()
    if not new_date:
        return jsonify({"error": "new_date required"}), 400
    old_path = PUZZLES_DIR / f"{puzzle_date}.json"
    new_path = PUZZLES_DIR / f"{new_date}.json"
    if not old_path.exists():
        return jsonify({"error": "puzzle not found"}), 404
    if new_path.exists() and new_date != puzzle_date:
        return jsonify({"error": f"A puzzle for {new_date} already exists"}), 409
    with open(old_path, "r", encoding="utf-8") as f:
        puzzle = json.load(f)
    puzzle["date"] = new_date
    with open(new_path, "w", encoding="utf-8") as f:
        json.dump(puzzle, f, indent=2, ensure_ascii=False)
    if new_date != puzzle_date:
        old_path.unlink()
    return jsonify({"ok": True, "new_date": new_date})


@app.delete("/admin/puzzles/<puzzle_date>")
@admin_required
def admin_delete_puzzle(puzzle_date: str):
    path = PUZZLES_DIR / f"{puzzle_date}.json"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return jsonify({"ok": True})


@app.post("/admin/puzzles/renumber")
@admin_required
def admin_renumber_puzzles():
    all_dates = sorted(p.stem for p in PUZZLES_DIR.glob("*.json"))
    for i, d in enumerate(all_dates, start=1):
        path = PUZZLES_DIR / f"{d}.json"
        with open(path, "r", encoding="utf-8") as f:
            puzzle = json.load(f)
        puzzle["puzzle_number"] = i
        with open(path, "w", encoding="utf-8") as f:
            json.dump(puzzle, f, indent=2, ensure_ascii=False)
    return jsonify({"ok": True, "total": len(all_dates)})

@app.get("/admin/submissions")
@admin_required
def admin_get_submissions():
    return jsonify(get_submissions())

@app.delete("/admin/submissions")
@admin_required
def admin_clear_submissions():
    save_submissions([])
    return jsonify({"ok": True})

@app.post("/admin/reset-progress")
@admin_required
def admin_reset_progress():
    settings = get_settings()
    settings["progress_version"] = settings.get("progress_version", 1) + 1
    save_settings(settings)
    return jsonify({"ok": True, "progress_version": settings["progress_version"]})

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
    source          = data.get("source", "manual")   # manual | submission | ai
    connection_type = str(data.get("connection_type") or "").strip()[:40]
    try:
        difficulty = max(1, min(4, int(data.get("difficulty") or 0))) or None
    except (ValueError, TypeError):
        difficulty = None

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
        "id":              str(uuid.uuid4())[:8],
        "title":           title,
        "movie_ids":       movie_ids,
        "movie_titles":    movie_titles,
        "source":          source,
        "connection_type": connection_type,
        "difficulty":      difficulty,
        "created_at":      datetime.now().isoformat(timespec="seconds"),
        "times_used":      0,
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

@app.patch("/admin/categories/<cat_id>")
@admin_required
def admin_update_category(cat_id: str):
    data = request.get_json(force=True)
    cats = get_saved_categories()
    cat  = next((c for c in cats if c["id"] == cat_id), None)
    if not cat:
        return jsonify({"error": "not_found"}), 404
    if "title" in data:
        cat["title"] = str(data["title"]).strip()[:80]
    if "movie_ids" in data and "movie_titles" in data:
        if len(data["movie_ids"]) == 4:
            cat["movie_ids"]    = data["movie_ids"]
            cat["movie_titles"] = data["movie_titles"]
    if "source" in data and data["source"] in ("manual", "ai", "submission"):
        cat["source"] = data["source"]
    if "connection_type" in data:
        cat["connection_type"] = str(data.get("connection_type") or "").strip()[:40]
    if "difficulty" in data:
        try:
            cat["difficulty"] = max(1, min(4, int(data["difficulty"]))) if data["difficulty"] else None
        except (ValueError, TypeError):
            pass
    save_saved_categories(cats)
    return jsonify({"ok": True, "category": cat})


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


# ── Connections Index ─────────────────────────────────────────────────────────
@app.get("/admin/connections")
@admin_required
def admin_connections():
    movies = get_movies()
    index  = {}

    def add(type_, name, movie):
        key = (type_, name)
        if key not in index:
            index[key] = {"name": name, "type": type_, "movies": []}
        index[key]["movies"].append({"id": movie["id"], "title": movie["title"], "year": movie.get("year", "")})

    for m in movies:
        for d in m.get("directors", []):
            if d: add("director", d, m)
        for a in (m.get("cast") or m.get("actors", [])):
            if a: add("actor", a, m)
        for w in m.get("writers", []):
            if w: add("writer", w, m)
        for c in m.get("oscar_categories", []):
            # oscar_categories can be "Best Actor; Best Picture" strings
            for part in str(c).split(";"):
                part = part.strip()
                if part: add("oscar", part, m)

    result = [v for v in index.values() if len(v["movies"]) >= 4]
    result.sort(key=lambda x: -len(x["movies"]))
    return jsonify(result)


# ── Settings ──────────────────────────────────────────────────────────────────
@app.get("/admin/settings")
@admin_required
def admin_get_settings():
    settings = get_settings()
    return jsonify({
        "ai_tiers":     settings.get("ai_tiers",     [1]),
        "random_tiers": settings.get("random_tiers", [1]),
    })

@app.post("/admin/settings")
@admin_required
def admin_update_settings():
    data     = request.get_json(force=True)
    settings = get_settings()

    if "ai_tiers" in data:
        tiers = [int(t) for t in data["ai_tiers"] if int(t) in (1, 2)]
        settings["ai_tiers"] = tiers or [1]
    if "random_tiers" in data:
        tiers = [int(t) for t in data["random_tiers"] if int(t) in (1, 2)]
        settings["random_tiers"] = tiers or [1]

    save_settings(settings)
    return jsonify({"ok": True, "ai_tiers": settings["ai_tiers"], "random_tiers": settings["random_tiers"]})


# ── AI Puzzle Builder ──────────────────────────────────────────────────────────
def _titles_only_list(movies: list) -> str:
    """Compact title+year list — lets Claude use its own knowledge of each film."""
    return "\n".join(f'"{m["title"]}" ({m["year"]})' for m in movies)

def _stratified_sample(movies: list, n: int) -> list:
    """Sample n movies spread proportionally across decades for variety."""
    buckets: dict[int, list] = {}
    for m in movies:
        decade = (int(m.get("year", 2000)) // 10) * 10
        buckets.setdefault(decade, []).append(m)
    result = []
    total  = len(movies)
    for decade in sorted(buckets):
        bucket = buckets[decade]
        target = max(1, round(n * len(bucket) / total))
        result.extend(random.sample(bucket, min(target, len(bucket))))
    # top up / trim to exactly n
    if len(result) < n:
        remaining = [m for m in movies if m not in result]
        result.extend(random.sample(remaining, min(n - len(result), len(remaining))))
    return result[:n]

def _match_titles_to_ids(titles: list, movies_by_title: dict) -> list:
    """Match movie title strings back to IDs using exact → case-insensitive → article-stripped fallback."""
    import re
    ids = []
    def normalise(t):
        t = t.lower().strip()
        t = re.sub(r'^(the|a|an)\s+', '', t)
        return t
    norm_map = {normalise(k): v for k, v in movies_by_title.items()}
    for title in titles:
        tl = title.lower().strip()
        if tl in movies_by_title:
            ids.append(movies_by_title[tl]["id"])
        elif normalise(title) in norm_map:
            ids.append(norm_map[normalise(title)]["id"])
    return ids

def _extract_json(raw: str) -> str:
    """Strip markdown fences and extract the first JSON object or array from a string."""
    import re
    raw = raw.strip()
    # Remove ```json ... ``` or ``` ... ``` fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw.strip())
    raw = raw.strip()
    # If still not starting with { or [, find first occurrence
    m = re.search(r'(\{|\[)', raw)
    if m:
        raw = raw[m.start():]
    return raw

def _call_claude(system: str, user: str, max_tokens: int = 1024) -> str | None:
    """Call Claude API and return the text response, or None on failure."""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text
    except Exception as e:
        print(f"Claude API error: {e}")
        return None

@app.post("/admin/ai/suggest")
@admin_required
def admin_ai_suggest():
    """Mode 2: Movie Suggest — given a category concept, find the best matching movies."""
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 503

    data        = request.get_json(force=True)
    prompt      = (data.get("prompt") or "").strip()[:200]
    exclude_ids = set(data.get("exclude_ids", []))
    ai_tiers    = data.get("ai_tiers") or get_settings().get("ai_tiers", [1])
    ai_tiers    = set(int(t) for t in ai_tiers if int(t) in (1, 2))

    if not prompt:
        return jsonify({"error": "prompt required"}), 400

    full_movies = get_movies()

    # Filter by selected tiers; movies with no tier field (curated fallback) are treated as tier 1
    pool = [m for m in full_movies
            if m["id"] not in exclude_ids and (m.get("tier") or 1) in ai_tiers]

    # Pre-filter: score each movie by how many prompt tokens appear in its metadata
    prompt_tokens = set(re.sub(r"[^a-z0-9 ]", " ", prompt.lower()).split())

    def score_movie(m):
        blob = " ".join([
            m.get("title", ""),
            str(m.get("year", "")),
            " ".join(m.get("directors", [])),
            " ".join(m.get("actors", [])[:5]),
            " ".join(m.get("genres", [])),
            " ".join(m.get("keywords", [])[:10]) if isinstance(m.get("keywords"), list)
                else str(m.get("keywords", "")),
            " ".join(m.get("oscar_categories", [])),
        ]).lower()
        return sum(1 for t in prompt_tokens if len(t) > 2 and t in blob)

    scored = sorted(pool, key=score_movie, reverse=True)
    # Take top 150 keyword-matched for broad coverage
    candidates = scored[:150]

    # Build compact metadata block for Claude
    movies_by_id    = {m["id"]: m for m in full_movies}
    movies_by_title = {m["title"].lower(): m for m in full_movies}

    def movie_line(m):
        dirs  = ", ".join(m.get("directors", []))
        acts  = ", ".join((m.get("actors") or m.get("cast", []))[:3])
        genres = ", ".join(m.get("genres", []))
        kws   = m.get("keywords", [])
        kw_str = ", ".join(kws[:6]) if isinstance(kws, list) else str(kws)[:60]
        oscars = "; ".join(m.get("oscar_categories", []))
        return (f'"{m["title"]}" ({m["year"]}) | dir: {dirs} | cast: {acts} '
                f'| genres: {genres} | keywords: {kw_str}'
                + (f' | oscars: {oscars}' if oscars else ''))

    movies_block = "\n".join(movie_line(m) for m in candidates)

    raw = _call_claude(
        "You are an expert puzzle designer for Marquee, a daily movie connections game. "
        "You have deep knowledge of film history, plots, production facts, and thematic connections.",
        f'The puzzle designer wants to build a category around this concept:\n"{prompt}"\n\n'
        f"From the movies listed below, identify the 8–10 BEST matches for this concept.\n"
        f"For each pick, explain WHY it fits and rate its strength:\n"
        f'- "strong": a perfect, unambiguous fit\n'
        f'- "good": fits well but with a caveat or minor stretch\n\n'
        f"Movies:\n{movies_block}\n\n"
        f"Rules:\n"
        f"- Only pick movies from the provided list\n"
        f"- Prioritise the strongest fits; don't pad with weak matches\n"
        f"- Be specific in your reasoning (reference plot details, facts, or themes)\n\n"
        'Respond ONLY with valid JSON:\n'
        '{"picks": [\n'
        '  {"title": "Exact Title", "year": 2001, "reasoning": "Specific reason this fits", "strength": "strong"}\n'
        ']}',
        max_tokens=3000,
    )

    if not raw:
        return jsonify({"error": "AI unavailable"}), 503

    try:
        picks_raw = json.loads(_extract_json(raw)).get("picks", [])
        out = []
        for p in picks_raw:
            ids = _match_titles_to_ids([p.get("title", "")], movies_by_title)
            if not ids:
                continue
            mid = ids[0]
            m   = movies_by_id.get(mid)
            if not m:
                continue
            out.append({
                "id":        mid,
                "title":     m["title"],
                "year":      m.get("year", ""),
                "directors": m.get("directors", []),
                "reasoning": p.get("reasoning", ""),
                "strength":  p.get("strength", "good"),
            })
        return jsonify({"picks": out})
    except (json.JSONDecodeError, KeyError) as e:
        return jsonify({"error": f"AI parse error: {e}", "raw": raw}), 500


@app.post("/admin/ai/workshop")
@admin_required
def admin_ai_workshop():
    """Mode 1: Category Workshop — generate 8 standalone category ideas."""
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 503

    data             = request.get_json(force=True)
    exclude_ids      = set(data.get("exclude_ids", []))
    connection_types = data.get("connection_types", ["plot", "meta", "tonal", "subverted", "thematic"])
    ai_tiers         = data.get("ai_tiers") or get_settings().get("ai_tiers", [1])
    ai_tiers         = set(int(t) for t in ai_tiers if int(t) in (1, 2))

    full_movies = get_movies()

    # Filter by selected tiers; movies with no tier field (curated fallback) are treated as tier 1
    pool            = [m for m in full_movies
                       if m["id"] not in exclude_ids and (m.get("tier") or 1) in ai_tiers]
    movies_by_title = {m["title"].lower(): m for m in full_movies}
    movies_by_id    = {m["id"]: m for m in full_movies}
    titles_list     = _titles_only_list(pool)

    type_descriptions = {
        "plot":      "Plot-level — something that specifically happens in the film (a death, a heist, a twist, a setting detail)",
        "meta":      "Meta connection — a production fact, award win, source material, or behind-the-scenes link",
        "tonal":     "Tonal/vibe — shared mood, atmosphere, or emotional register across all four films",
        "subverted": "Subverted expectation — looks like one obvious category, but the real connection is something else entirely",
        "thematic":  "Thematic — shared philosophical theme, moral question, or symbolic preoccupation",
    }
    active_types = [type_descriptions[t] for t in connection_types if t in type_descriptions]
    if not active_types:
        active_types = list(type_descriptions.values())
    types_block = "\n".join(f"- {t}" for t in active_types)

    raw = _call_claude(
        "You are an expert puzzle designer for Marquee, a daily movie connections game. "
        "You have deep knowledge of film history, plots, production facts, and thematic connections. "
        "Your category titles must be clever and REFRAME how players think about the films — "
        "never a plain genre label or a filmmaker's name.",
        f"Generate exactly 8 movie category ideas. Each must:\n"
        f"- Contain exactly 4 movies chosen from the provided list\n"
        f"- Use ONE of these connection types:\n{types_block}\n"
        f"- NOT be a single-actor or single-director filmography\n"
        f"- NOT use a basic genre label as the title (no 'Sci-Fi Films', 'Horror Movies', etc.)\n"
        f"- Have a punchy title that reframes how you see the films\n"
        f"- Mix difficulties: some easy (1–2) and some hard (3–4)\n\n"
        f"Movies to choose from:\n{titles_list}\n\n"
        'Respond ONLY with valid JSON:\n'
        '{"categories": [\n'
        '  {"title": "Punchy name ≤60 chars", "movies": ["Title A","Title B","Title C","Title D"],\n'
        '   "connection_type": "plot|meta|tonal|subverted|thematic",\n'
        '   "difficulty": 1,\n'
        '   "reasoning": "One sentence explaining exactly why these 4 films share this connection"}\n'
        ']}',
        max_tokens=4096,
    )
    if not raw:
        return jsonify({"error": "AI unavailable"}), 503

    try:
        cats = json.loads(_extract_json(raw)).get("categories", [])
        out  = []
        for cat in cats:
            ids = _match_titles_to_ids(cat.get("movies", []), movies_by_title)
            if len(ids) < 4:
                continue
            ids = ids[:4]
            out.append({
                "title":           cat.get("title", ""),
                "movie_ids":       ids,
                "movie_titles":    [movies_by_id[i]["title"] for i in ids if i in movies_by_id],
                "connection_type": cat.get("connection_type", ""),
                "difficulty":      int(cat.get("difficulty", 2)),
                "reasoning":       cat.get("reasoning", ""),
            })
        return jsonify({"categories": out})
    except (json.JSONDecodeError, KeyError) as e:
        return jsonify({"error": f"AI parse error: {e}", "raw": raw}), 500


@app.post("/admin/ai/suggest-difficulty")
@admin_required
def admin_ai_suggest_difficulty():
    """Ultra-minimal call: given category title + 4 movie titles, return difficulty 1–4."""
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "no_key"}), 503
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()[:80]
    movie_titles = [str(t).strip() for t in (data.get("movie_titles") or [])[:4]]
    if not title or len(movie_titles) != 4:
        return jsonify({"error": "invalid"}), 400
    films = ", ".join(f'"{t}"' for t in movie_titles)
    raw = _call_claude(
        "You rate the difficulty of movie connection puzzles.",
        f'Category: "{title}"\nFilms: {films}\n\n'
        f'How hard is this connection for an average movie fan to spot? '
        f'Reply with ONLY one word: yellow green blue purple',
        max_tokens=5,
    )
    if not raw:
        return jsonify({"error": "ai_unavailable"}), 503
    word = raw.strip().lower().split()[0] if raw.strip() else ""
    mapping = {"yellow": 1, "green": 2, "blue": 3, "purple": 4}
    diff = mapping.get(word)
    if diff is None:
        return jsonify({"error": "bad_response", "raw": raw}), 500
    return jsonify({"difficulty": diff, "label": word})


# ── Trivia Admin Routes ───────────────────────────────────────────────────────

@app.get("/admin/trivia/questions")
@admin_required
def admin_trivia_list():
    return jsonify(get_trivia_questions())


@app.get("/admin/trivia/schedule")
@admin_required
def admin_trivia_schedule():
    """Return 14-day question schedule starting from today."""
    questions = get_trivia_questions()
    today = date.today()
    schedule = []
    for i in range(14):
        d = (today + timedelta(days=i)).isoformat()
        qs = get_daily_trivia(questions, d, count=3)
        schedule.append({
            "date": d,
            "questions": [{"id": q["id"], "question": q["question"],
                           "answer": q["answer"], "category": q["category"]} for q in qs],
        })
    return jsonify(schedule)


@app.put("/admin/trivia/questions/<int:qid>")
@admin_required
def admin_trivia_update(qid: int):
    data = request.get_json(force=True)
    questions = [q.copy() for q in get_trivia_questions()]
    for i, q in enumerate(questions):
        if q["id"] == qid:
            for field in ("question", "answer", "category", "difficulty", "active"):
                if field in data:
                    questions[i][field] = data[field]
            save_trivia_questions(questions)
            return jsonify({"ok": True, "question": questions[i]})
    return jsonify({"ok": False, "error": "Not found"}), 404


@app.post("/admin/trivia/questions")
@admin_required
def admin_trivia_add():
    data = request.get_json(force=True)
    q_text = data.get("question", "").strip()
    a_text = data.get("answer", "").strip()
    if not q_text or not a_text:
        return jsonify({"ok": False, "error": "Question and answer are required"}), 400
    questions = list(get_trivia_questions())
    new_id = max((q["id"] for q in questions), default=0) + 1
    new_q = {
        "id": new_id,
        "question": q_text,
        "answer": a_text,
        "category": data.get("category", "GENERAL").strip().upper(),
        "difficulty": max(1, min(10, int(data.get("difficulty", 5)))),
        "active": True,
    }
    questions.append(new_q)
    save_trivia_questions(questions)
    return jsonify({"ok": True, "question": new_q})


@app.delete("/admin/trivia/questions/<int:qid>")
@admin_required
def admin_trivia_delete(qid: int):
    questions = get_trivia_questions()
    new_list = [q for q in questions if q["id"] != qid]
    if len(new_list) == len(questions):
        return jsonify({"ok": False, "error": "Not found"}), 404
    save_trivia_questions(new_list)
    return jsonify({"ok": True})


@app.get("/admin/trivia/puzzles")
@admin_required
def admin_trivia_list_puzzles():
    dates = get_all_trivia_puzzle_dates()
    questions_by_id = {q["id"]: q for q in get_trivia_questions()}
    puzzles = []
    for d in reversed(dates):
        p = get_trivia_puzzle(d)
        if p is None:
            continue
        qs = [questions_by_id.get(qid) for qid in p.get("questions", [])]
        qs = [q for q in qs if q]
        puzzles.append({
            "date": d,
            "questions": [{"id": q["id"], "question": q["question"], "answer": q["answer"], "category": q["category"]} for q in qs]
        })
    return jsonify(puzzles)


@app.post("/admin/trivia/puzzles")
@admin_required
def admin_trivia_publish_puzzle():
    data = request.get_json(force=True)
    puzzle_date = data.get("date", "").strip()
    question_ids = data.get("questions", [])
    if not puzzle_date or len(question_ids) != 3:
        return jsonify({"error": "date and exactly 3 question ids required"}), 400
    TRIVIA_PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    puzzle = {"date": puzzle_date, "questions": question_ids, "created_at": datetime.now().isoformat(timespec="seconds")}
    path = TRIVIA_PUZZLES_DIR / f"{puzzle_date}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(puzzle, f, indent=2)
    return jsonify({"ok": True})


@app.delete("/admin/trivia/puzzles/<puzzle_date>")
@admin_required
def admin_trivia_delete_puzzle(puzzle_date: str):
    path = TRIVIA_PUZZLES_DIR / f"{puzzle_date}.json"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return jsonify({"ok": True})


@app.get("/admin/trivia/puzzles/<puzzle_date>")
@admin_required
def admin_trivia_get_puzzle(puzzle_date: str):
    puzzle = get_trivia_puzzle(puzzle_date)
    if puzzle is None:
        return jsonify({"error": "not found"}), 404
    questions_by_id = {q["id"]: q for q in get_trivia_questions()}
    qs = [questions_by_id.get(qid) for qid in puzzle.get("questions", [])]
    qs = [q for q in qs if q]
    return jsonify({"date": puzzle_date, "questions": qs})


@app.post("/admin/trivia/import-questions")
@admin_required
def admin_trivia_import_questions():
    """Replace the entire trivia_questions.json with the posted array."""
    data = request.get_json(force=True)
    if not isinstance(data, list):
        return jsonify({"error": "expected a JSON array"}), 400
    save_trivia_questions(data)
    return jsonify({"ok": True, "count": len(data)})


@app.post("/admin/trivia/import-puzzles")
@admin_required
def admin_trivia_import_puzzles():
    """Bulk-create puzzle files. Accepts a list of {date, questions} objects."""
    data = request.get_json(force=True)
    if not isinstance(data, list):
        return jsonify({"error": "expected a JSON array"}), 400
    TRIVIA_PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    for item in data:
        puzzle_date = item.get("date", "").strip()
        question_ids = item.get("questions", [])
        if not puzzle_date or len(question_ids) != 3:
            continue
        puzzle = {"date": puzzle_date, "questions": question_ids,
                  "created_at": datetime.now().isoformat(timespec="seconds")}
        path = TRIVIA_PUZZLES_DIR / f"{puzzle_date}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(puzzle, f, indent=2)
        saved.append(puzzle_date)
    return jsonify({"ok": True, "saved": saved})


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRIVIA_PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    print("Starting Marquee at http://127.0.0.1:5002")
    app.run(host="127.0.0.1", port=5002, debug=True, use_reloader=False)
