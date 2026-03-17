# Marquee — Project Handoff Document

> This file exists to onboard a new Claude session. Read it fully before making any changes.

---

## What Is Marquee?

**Marquee** is a public, NYT Connections-style daily movie puzzle game. Players see 16 movie titles on screen and must group them into 4 categories of 4 movies each. Each category has a color-coded difficulty (yellow = easiest → purple = hardest). Players get 4 mistakes before the game ends. Progress, streaks, and archive history are stored in browser localStorage.

There is also a **Build-a-Category** (`/create`) page where players see 8 random movies, pick 4 that share a hidden connection, and name it. Submissions go to an admin review pool.

A **password-protected admin** page at `/admin` lets the puzzle creator build new puzzles (browse/search all 658 movies, fill 4 category slots, set a publish date) and review community submissions.

---

## How to Run

```bash
cd "C:\Users\Eli Brooks\OneDrive\Documents\Movie Connections\marquee"
python app.py
# → http://127.0.0.1:5002
```

- Admin login: http://127.0.0.1:5002/admin (default password: `marquee-admin-2026`)
- Set env var `MARQUEE_ADMIN_PASSWORD` to override
- Set env var `MARQUEE_SECRET_KEY` for Flask session security in production

Dependencies: `pip install flask`  (see `requirements.txt`)

---

## Complete File Map

```
marquee/
├── app.py                          ← Flask app, all routes
├── requirements.txt                ← flask>=3.0.0
│
├── puzzles/
│   └── 2026-03-08.json             ← Sample puzzle (PLACEHOLDER IDs — replace with real ones via admin)
│
├── data/
│   └── community_submissions.json  ← Auto-created; stores /create submissions
│
├── static/
│   ├── style.css                   ← Full design system (tokens, all components)
│   ├── game.js                     ← Puzzle game logic
│   ├── create.js                   ← Build-a-Category page logic
│   └── admin.js                    ← Admin puzzle builder + submissions manager
│
└── templates/
    ├── base.html                   ← Shared header (logo, nav: Archive, Create★)
    ├── game.html                   ← Main puzzle page
    ├── archive.html                ← All published puzzles, with localStorage emoji history
    ├── create.html                 ← Build-a-Category page
    ├── no_puzzle.html              ← Fallback when no puzzle exists for a date
    ├── admin.html                  ← Admin dashboard (3 tabs: Builder, Submissions, Published)
    └── admin_login.html            ← Password login form
```

**External data file (not in marquee/):**
```
C:\Users\Eli Brooks\OneDrive\Documents\Movie Connections\
    dualrank_ALL_selected_with_oscars_pruned.json   ← 658 curated movies
```
Each movie entry has: `id` (int), `title`, `year`, `directors` (list), `actors` (list, top 5), `poster_url`, `vote_average`, `oscar_wins`, `oscar_categories`.

---

## app.py — Route Reference

| Method | Route | Description |
|---|---|---|
| GET | `/` | Redirect to today's puzzle (or most recent) |
| GET | `/puzzle/<date>` | Play a specific puzzle |
| GET | `/archive` | List all published puzzles |
| GET | `/create` | Build-a-Category page |
| POST | `/create/submit` | Submit a community category (rate-limited: 5/IP/day) |
| GET | `/api/puzzle/<date>` | JSON puzzle data |
| GET | `/api/random-movies` | 8 random movies for /create page |
| GET | `/admin/login` | Admin login form |
| POST | `/admin/login` | Auth check |
| GET | `/admin/logout` | Clear session |
| GET | `/admin` | Admin dashboard (requires auth) |
| GET | `/admin/movies` | All 658 movies as JSON (for admin builder) |
| POST | `/admin/publish` | Save a puzzle JSON file |
| GET | `/admin/submissions` | All community submissions as JSON |
| POST | `/admin/submissions/<id>/use` | Mark submission as used |
| POST | `/admin/submissions/<id>/dismiss` | Mark submission as dismissed |

**Key patterns in app.py:**
```python
# Auth decorator
@admin_required   # redirects to /admin/login if session["admin"] not set

# Movie data (cached after first load)
get_movies()         # → list of all 658 movie dicts
get_movies_by_id()   # → dict keyed by movie id
get_puzzle(date_str) # → puzzle dict or None
```

---

## Puzzle JSON Format

```json
{
  "date": "2026-03-08",
  "puzzle_number": 1,
  "categories": [
    {
      "title": "Directed by Ridley Scott",
      "difficulty": 1,
      "color": "yellow",
      "movie_ids": [2, 16, 34, 52]
    },
    {
      "title": "Tom Hanks films",
      "difficulty": 2,
      "color": "green",
      "movie_ids": [1, 8, 23, 45]
    },
    {
      "title": "Won Best Picture at the Oscars",
      "difficulty": 3,
      "color": "blue",
      "movie_ids": [10, 30, 55, 70]
    },
    {
      "title": "Movies where the hero never speaks to another person",
      "difficulty": 4,
      "color": "purple",
      "movie_ids": [19, 40, 60, 75]
    }
  ],
  "created_at": "2026-03-07T20:00:00",
  "author_note": ""
}
```

**Rules:**
- Exactly 4 categories, colors must be yellow/green/blue/purple
- Each category has exactly 4 `movie_ids`
- All 16 IDs must be unique across all 4 categories (app.py deduplicates, but puzzle files should be correct)
- IDs must correspond to valid entries in the movie JSON (integers matching `id` fields)
- Files saved as `puzzles/YYYY-MM-DD.json`

---

## style.css — Design Tokens

```css
:root {
  --bg:       #faf4ef;   /* warm cream background */
  --surface:  #ffffff;
  --text:     #1a1a1a;
  --text2:    #666666;
  --border:   #111111;
  --bw:       2.5px;     /* border width */
  --shadow:   4px 4px 0 var(--border);    /* offset drop shadow */
  --shadow-sm: 3px 3px 0 var(--border);
  --shadow-xs: 2px 2px 0 var(--border);
  --radius:   10px;

  /* Category colors */
  --yellow: #f9df6d;   --yellow-text: #7a5c00;
  --green:  #6abf69;   --green-text:  #1a4d19;
  --blue:   #6ab0d4;   --blue-text:   #0f3d5a;
  --purple: #b07ecf;   --purple-text: #3d1460;
}
```

**Typography:** Google Fonts — `Fraunces` weight 900 italic (logo/display) + `DM Sans` (UI)

**Key CSS classes:**
- `.tile` — puzzle tile (unselected state)
- `.tile--selected` — dark background, offset in; `transform: translate(2px,2px)`
- `.tile--popping` — brief scale-up animation on correct guess (keyframe: `tilePop`)
- `.tile--wrong` — red border shake animation on wrong guess (keyframe: `tileShake`)
- `.tile--solved` — no longer used in grid (solved tiles are removed from DOM); used as transient state during animation
- `.solved-banner`, `.solved-banner--yellow/green/blue/purple` — full-width solved category rows
- `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--sm` — button variants
- `.create-tile`, `.create-tile--selected` — Build-a-Category tiles
- `.result-overlay` — win/lose overlay (z-index: 200)
- `.share-toast` — clipboard copy toast (z-index: 300)

---

## game.js — Architecture

**State object:**
```js
const state = {
  tiles:        [...TILES],    // mutable tile order (for shuffle); all 16 including solved
  selected:     new Set(),     // movie_ids currently selected (max 4)
  solved:       [],            // [{color, title, movie_ids, movieTitles}] in order solved
  mistakes:     0,             // 0–4
  guessHistory: [],            // [{movie_ids: [...], color: 'yellow'|null}]
  gameOver:     false,
  won:          false,
};
```

**Injected globals (from game.html Jinja):**
```js
const PUZZLE_DATA = { date, puzzle_number, categories: [{color, difficulty, title, movie_ids}] };
const TILES       = [{id, title}];   // all 16 tiles
const PUZZLE_DATE = "2026-03-08";
```

**Key functions:**
```
init()               → loads localStorage, renders, binds events
renderGrid()         → renders ONLY unsolved tiles (filters out state.solved ids)
renderSolvedBanners()→ re-renders the solved-list div with color banners
renderLives()        → updates the 4 dots (dot--lost class)
onTileClick()        → select/deselect tile (max 4)
onSubmit()           → check 4 selected against PUZZLE_DATA.categories; calls onCorrectGuess or onWrongGuess
onCorrectGuess(cat)  → animate tile--popping at 350ms, then at 400ms: renderSolvedBanners + renderGrid (removes solved tiles from grid) + check win
onWrongGuess()       → tile--wrong shake, renderLives, one-away toast, check loss → revealAll()
revealAll()          → staggered 500ms reveal of remaining categories; each calls renderSolvedBanners + renderGrid
onShuffle()          → Fisher-Yates on unsolved tiles only
showResult()         → builds emoji grid, reads localStorage stats, shows overlay
onShare()            → navigator.clipboard.writeText with emoji grid text
saveProgress()       → writes to localStorage key "marquee_history"[PUZZLE_DATE]
loadProgress()       → reads from localStorage
restoreState(saved)  → called on init if saved progress exists
updateStreak(won)    → updates "marquee_streak" key in localStorage
```

**localStorage keys:**
- `marquee_history` — object keyed by date string → `{solved: [colors], mistakes, gameOver, won, guessHistory, tileOrder}`
- `marquee_streak` — `{current, best, played, last_played}`

---

## create.js — Architecture

**Flow:** page load → `fetch('/api/random-movies')` → render 8 tiles → user selects 4 + names category → `POST /create/submit` → show result card or error

**State:**
```js
state.movies   = [];         // [{id, title, year}] current 8
state.selected = new Set();  // selected movie ids (max 4)
```

Submit enabled only when `selected.size === 4` AND category name input is non-empty.

On success: hides grid + form, shows `#create-result` card with category name and movie titles.
"Try Again" button fetches 8 new movies and resets.

Rate limit response (HTTP 429): shows error message in `#create-error`.

---

## admin.js — Architecture

**State:**
```js
let allMovies = [];  // all 658 movies from /admin/movies
let query     = '';  // search filter string

const slots = [     // 4 category slots
  { color: 'yellow', difficulty: 1, title: '', movies: [] },
  { color: 'green',  difficulty: 2, title: '', movies: [] },
  { color: 'blue',   difficulty: 3, title: '', movies: [] },
  { color: 'purple', difficulty: 4, title: '', movies: [] },
];
```

**Flow:**
1. Load all movies → render searchable pool list (greyed out if already in a slot)
2. Click pool movie → adds to next slot with `< 4` movies
3. Edit slot title inline (input field per slot)
4. × chip button removes movie from slot
5. Publish button → validates (all slots have 4 movies + titles + date set) → POST `/admin/publish`

**Tabs:** Puzzle Builder | Community Submissions | Published Puzzles
- Submissions tab loads lazily on first click via `fetch('/admin/submissions')`
- Use/Dismiss buttons POST to `/admin/submissions/<id>/use` or `.../dismiss`

---

## What Still Needs to Be Done

### High Priority
1. **Real puzzle data** — The sample puzzle at `puzzles/2026-03-08.json` uses placeholder IDs that don't correspond to real movie groupings. Use the admin builder at `/admin` to create a proper first puzzle. The movie IDs in the JSON file must match `id` fields in `dualrank_ALL_selected_with_oscars_pruned.json`.

2. **Gemini AI category suggestions** — The plan called for a `/admin/generate` route that calls the Gemini API to suggest puzzle categories from the movie pool. This is not yet implemented. The admin builder currently requires fully manual puzzle assembly.

### Medium Priority
3. **Poster display in admin builder** — The admin movie pool only shows title + year. Adding poster thumbnails would help with movie identification.

4. **Admin "load existing puzzle"** — The builder always starts blank. There's no way to load and edit a previously published puzzle. If you publish with a date that already exists it overwrites silently.

5. **Next/prev navigation on game page** — `prev_date` and `next_date` are passed to `game.html` but the template needs nav arrows to use them.

### Nice-to-Have
6. **Animate tile removal** — Currently when a category is solved, tiles disappear abruptly after the color flash. A smooth slide-up or fade-out toward the banner would feel better.

7. **Mobile layout polish** — The 4×4 grid works on mobile but tile text can be tight on small screens. Tile font size scales down to 10px at 600px viewport width.

8. **Streak display on game page** — The result overlay shows streak/played stats but the in-game header doesn't show the current streak.

---

## Known Issues Fixed in This Session

- **Duplicate tiles**: app.py now deduplicates `all_movie_ids` across categories before shuffling
- **Solved tiles clogging grid**: `renderGrid()` now filters solved tiles out entirely; they only appear as banners above the grid
- **Click failures**: No more duplicate tiles to fight with; solved tiles fully removed from DOM

---

## Visual Design Reference

The aesthetic is "warm game board" — inspired by the Inkwell Games style:
- Warm cream background (`#faf4ef`), white cards
- Thick black borders (`2.5px`) with hard offset drop shadows (`4px 4px 0 #111`)
- Tiles press inward when selected (`transform: translate(2px,2px)`)
- Bold chunky typography — Fraunces 900 italic for the "Marquee" logo
- Color-coded difficulty: yellow (easy) → green → blue → purple (hard)

This is intentionally distinct from the dark admin tool (`Movie_Connections_Rereviewer_3.py`) which uses a dark background and green accents.

---

## Related Files (Outside the marquee/ folder)

| File | Location | Purpose |
|---|---|---|
| `dualrank_ALL_selected_with_oscars_pruned.json` | `Movie Connections/` | 658 curated movie objects — the master movie pool |
| `dualrank_ALL_selected_with_oscars_pruned.csv` | `Movie Connections/` | Same data as CSV |
| `Movie_Connections_Rereviewer_3.py` | Downloads/ | Separate Flask app (port 5001) for reviewing dropped movies and deciding whether to add them back to the pool |
| `movie_deck_builder.py` | alphabet_soup/ working dir | Earlier tool for building movie groups; has Gemini AI validation pattern that could be reused |
| `Alph_soup.py` | alphabet_soup/ working dir | Main alphabet soup project (separate, unrelated) |
