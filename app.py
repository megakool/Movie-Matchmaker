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
BASE_DIR          = Path(__file__).parent
MOVIES_PATH       = BASE_DIR / "movies.json"
MOVIES_FULL_PATH  = BASE_DIR / "movies_full.json"

# If DATA_DIR env var is set (e.g. Render persistent disk at /data), use that.
# Otherwise fall back to the local data/ folder so local dev is unchanged.
_env_data_dir = os.environ.get("DATA_DIR", "")
DATA_DIR      = Path(_env_data_dir) if _env_data_dir else BASE_DIR / "data"
PUZZLES_DIR   = DATA_DIR / "puzzles"

SUBMISSIONS_PATH  = DATA_DIR / "community_submissions.json"
CATEGORIES_PATH   = DATA_DIR / "saved_categories.json"
DRAFTS_PATH       = DATA_DIR / "drafts.json"
SETTINGS_PATH     = DATA_DIR / "settings.json"


def _init_persistent_disk() -> None:
    """On first boot with a fresh persistent disk, seed it from the repo's data/ and puzzles/."""
    if not _env_data_dir:
        return  # local dev — nothing to do
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    repo_data    = BASE_DIR / "data"
    repo_puzzles = BASE_DIR / "puzzles"
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


_init_persistent_disk()

ADMIN_PASSWORD    = os.environ.get("MARQUEE_ADMIN_PASSWORD", "marquee-admin-2026")
DEV_MODE          = os.environ.get("MARQUEE_DEV_MODE", "0") == "1"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

app = Flask(__name__)
app.secret_key = os.environ.get("MARQUEE_SECRET_KEY", "marquee-secret-dev-2026")

@app.context_processor
def inject_globals():
    return {"dev_mode": DEV_MODE}

# ── Data ──────────────────────────────────────────────────────────────────────
_movies_cache = None

def get_settings() -> dict:
    if not SETTINGS_PATH.exists():
        return {"active_dataset": "curated"}
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_settings(settings: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)

def get_movies() -> list:
    global _movies_cache
    if _movies_cache is None:
        settings = get_settings()
        if settings.get("active_dataset") == "full" and MOVIES_FULL_PATH.exists():
            path = MOVIES_FULL_PATH
        else:
            path = MOVIES_PATH
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
    full_available = MOVIES_FULL_PATH.exists()
    return jsonify({
        "active_dataset": settings.get("active_dataset", "curated"),
        "full_available": full_available,
        "curated_count": None,   # computed client-side after fetch
    })

@app.post("/admin/settings")
@admin_required
def admin_update_settings():
    global _movies_cache
    data    = request.get_json(force=True)
    dataset = data.get("active_dataset", "curated")
    if dataset not in ("curated", "full"):
        return jsonify({"error": "invalid dataset"}), 400
    if dataset == "full" and not MOVIES_FULL_PATH.exists():
        return jsonify({"error": "movies_full.json not found — run build_full_dataset.py first"}), 400

    settings = get_settings()
    settings["active_dataset"] = dataset
    save_settings(settings)
    _movies_cache = None   # invalidate cache
    movie_count   = len(get_movies())
    return jsonify({"ok": True, "active_dataset": dataset, "movie_count": movie_count})


# ── AI Puzzle Builder ──────────────────────────────────────────────────────────
def _compact_movie_list(movies: list) -> str:
    """Build a compact text representation of movies for Claude prompts."""
    lines = []
    for m in movies:
        genres     = ", ".join(m.get("genres", []))
        directors  = ", ".join(m.get("directors", []))
        actors     = ", ".join((m.get("cast") or m.get("actors", []))[:5])
        writers    = ", ".join(m.get("writers", [])[:3])
        extra = " | ".join(filter(None, [
            f"genres: {genres}" if genres else "",
            f"dir: {directors}" if directors else "",
            f"cast: {actors}" if actors else "",
            f"written by: {writers}" if writers else "",
        ]))
        lines.append(f'id={m["id"]} "{m["title"]}" ({m["year"]}) — {extra}')
    return "\n".join(lines)

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
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 503

    data        = request.get_json(force=True)
    theme       = (data.get("theme") or "").strip()[:200]
    exclude_ids = set(data.get("exclude_ids", []))

    if not theme:
        return jsonify({"error": "theme required"}), 400

    movies  = [m for m in get_movies() if m["id"] not in exclude_ids]
    movies_by_id = {m["id"]: m for m in get_movies()}
    compact = _compact_movie_list(movies)

    system = (
        "You are a puzzle designer for Marquee, a daily movie connections game. "
        "Given a list of movies with their IDs, suggest ONE category of exactly 4 movies "
        "that share a meaningful connection matching the user's theme. "
        "Respond ONLY with valid JSON, no prose. Format:\n"
        '{"title": "Category Name (≤60 chars)", "movie_ids": [id1, id2, id3, id4]}'
    )
    user = f"Theme: {theme}\n\nAvailable movies:\n{compact}"

    raw = _call_claude(system, user)
    if raw is None:
        return jsonify({"error": "AI unavailable"}), 503

    try:
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        ids    = result.get("movie_ids", [])
        if len(ids) != 4:
            return jsonify({"error": "AI returned wrong number of movies"}), 500
        result["movie_titles"] = [movies_by_id[i]["title"] for i in ids if i in movies_by_id]
        return jsonify(result)
    except (json.JSONDecodeError, KeyError) as e:
        return jsonify({"error": f"AI parse error: {e}", "raw": raw}), 500


@app.post("/admin/ai/discover")
@admin_required
def admin_ai_discover():
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 503

    data        = request.get_json(force=True)
    exclude_ids = set(data.get("exclude_ids", []))
    count       = min(int(data.get("count", 4)), 8)

    movies       = [m for m in get_movies() if m["id"] not in exclude_ids]
    movies_by_id = {m["id"]: m for m in get_movies()}
    compact      = _compact_movie_list(movies)

    system = (
        "You are a puzzle designer for Marquee, a daily movie connections game. "
        "Given a list of movies, discover interesting non-obvious category connections. "
        "Look for: shared directors/actors/writers/cinematographers, shared genres or themes, "
        "shared franchise/universe, award connections, or other creative links. "
        "Avoid categories that are too easy (e.g. 'Tom Hanks movies' if actor is listed). "
        "Respond ONLY with valid JSON, no prose. Format:\n"
        '{"categories": [{"title": "...", "connection_type": "...", "movie_ids": [id1,id2,id3,id4]}, ...]}'
    )
    user = f"Find {count} interesting category connections from these movies:\n{compact}"

    raw = _call_claude(system, user)
    if raw is None:
        return jsonify({"error": "AI unavailable"}), 503

    try:
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        cats   = result.get("categories", [])
        for cat in cats:
            ids = cat.get("movie_ids", [])
            cat["movie_titles"] = [movies_by_id[i]["title"] for i in ids if i in movies_by_id]
        return jsonify({"categories": cats})
    except (json.JSONDecodeError, KeyError) as e:
        return jsonify({"error": f"AI parse error: {e}", "raw": raw}), 500


@app.post("/admin/ai/puzzle")
@admin_required
def admin_ai_puzzle():
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 503

    data        = request.get_json(force=True)
    theme       = (data.get("theme") or "").strip()[:200]
    exclude_ids = set(data.get("exclude_ids", []))

    movies       = [m for m in get_movies() if m["id"] not in exclude_ids]
    movies_by_id = {m["id"]: m for m in get_movies()}
    compact      = _compact_movie_list(movies)

    theme_line = f"Direction from the puzzle maker: {theme}" if theme else "Create a diverse, surprising puzzle with varied connection types."

    system = (
        "You are a puzzle designer for Marquee, a daily movie connections game similar to NYT Connections. "
        "Generate a complete daily puzzle: exactly 4 categories, each containing exactly 4 movies. "
        "Rules:\n"
        "- Every movie ID must come from the provided list\n"
        "- No movie may appear in more than one category (16 unique movies total)\n"
        "- Vary difficulty from straightforward to cleverly non-obvious\n"
        "- Vary connection types (shared director, actor, theme, genre, award, franchise, decade, etc.)\n"
        "- Category names should be concise and punchy (≤60 chars)\n"
        "Respond ONLY with valid JSON, no prose. Format:\n"
        '{"puzzle": [{"title": "Category Name", "connection_type": "director|actor|theme|award|other", '
        '"movie_ids": [id1, id2, id3, id4]}, ...]}'
    )
    user = f"{theme_line}\n\nAvailable movies:\n{compact}"

    raw = _call_claude(system, user, max_tokens=2048)
    if raw is None:
        return jsonify({"error": "AI unavailable"}), 503

    try:
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        cats   = result.get("puzzle", [])
        if len(cats) != 4:
            return jsonify({"error": f"AI returned {len(cats)} categories, expected 4"}), 500
        all_ids = [i for cat in cats for i in cat.get("movie_ids", [])]
        if len(all_ids) != len(set(all_ids)):
            return jsonify({"error": "AI returned duplicate movies across categories"}), 500
        for cat in cats:
            if len(cat.get("movie_ids", [])) != 4:
                return jsonify({"error": f"Category '{cat.get('title')}' has wrong movie count"}), 500
            cat["movie_titles"] = [movies_by_id[i]["title"] for i in cat["movie_ids"] if i in movies_by_id]
        return jsonify({"puzzle": cats})
    except (json.JSONDecodeError, KeyError) as e:
        return jsonify({"error": f"AI parse error: {e}", "raw": raw}), 500


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    PUZZLES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Starting Marquee at http://127.0.0.1:5002")
    app.run(host="127.0.0.1", port=5002, debug=True, use_reloader=False)
