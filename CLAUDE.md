# Marquee (git repo root)

Full project context is one level up in `../CLAUDE.md`.

This directory is the git repo root deployed to Render. The primary app file is `app.py` (~2200 lines).

## Key Files

| File/Dir | Purpose |
|----------|---------|
| `app.py` | All Flask routes — Marquee puzzle, Trivia, admin, API |
| `templates/admin.html` | Admin dashboard UI (2300 lines) |
| `static/admin.js` | Admin dashboard logic (3500 lines) |
| `static/game.js` | Marquee puzzle game (player-facing) |
| `static/trivia.js` | Trivia quiz (player-facing) |
| `static/style.css` | Full design system — single CSS file |
| `movies.json` | Curated movie library (~658 films) |
| `movies_full.json` | Full TMDB library (7 MB) used by admin movie search |
| `data/` | Render persistent disk copy of puzzle/trivia data |
