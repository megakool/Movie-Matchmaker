/* ================================================================
   MARQUEE — create.js
   Build-a-Category page: fetch 8 random movies, pick 4, name it,
   submit to /create/submit. Shows result card on success.
   ================================================================ */

/* ── State ── */
const state = {
  movies:   [],         // [{id, title}] — current 8 movies
  selected: new Set(),  // Set of movie ids currently selected
};

/* ── DOM refs ── */
const $loading  = document.getElementById('create-loading');
const $area     = document.getElementById('create-area');
const $grid     = document.getElementById('create-grid');
const $nameInput = document.getElementById('category-name');
const $submit   = document.getElementById('btn-create-submit');
const $result   = document.getElementById('create-result');
const $resultTitle  = document.getElementById('result-category-name');
const $resultMovies = document.getElementById('result-movies');
const $error    = document.getElementById('create-error');
const $tryAgain = document.getElementById('btn-try-again');
const $refreshAll        = document.getElementById('btn-refresh-all');
const $refreshUnselected = document.getElementById('btn-refresh-unselected');

/* ── Init ── */
async function init() {
  await loadMovies();
  bindEvents();
}

/* ── Load 8 random movies ── */
async function loadMovies() {
  $loading.style.display = 'block';
  $area.style.display    = 'none';
  $error.style.display   = 'none';

  try {
    const res  = await fetch('/api/random-movies');
    if (!res.ok) throw new Error('Failed to load movies');
    const data = await res.json();
    state.movies   = data;
    state.selected = new Set();
    renderGrid();
    $loading.style.display = 'none';
    $area.style.display    = 'block';
    $result.style.display  = 'none';
    $nameInput.value       = '';
    updateSubmitBtn();
  } catch (err) {
    $loading.textContent = 'Could not load movies. Please refresh and try again.';
  }
}

/* ── Render tile grid ── */
function renderGrid() {
  $grid.innerHTML = '';
  state.movies.forEach(movie => {
    const div = document.createElement('div');
    div.className = 'create-tile';
    div.textContent = movie.title;
    div.dataset.id  = movie.id;

    if (state.selected.has(movie.id)) {
      div.classList.add('create-tile--selected');
    }

    div.addEventListener('click', () => onTileClick(movie.id, div));
    $grid.appendChild(div);
  });
}

/* ── Tile click ── */
function onTileClick(movieId, el) {
  if (state.selected.has(movieId)) {
    state.selected.delete(movieId);
    el.classList.remove('create-tile--selected');
  } else {
    if (state.selected.size >= 4) return;
    state.selected.add(movieId);
    el.classList.add('create-tile--selected');
  }
  updateSubmitBtn();
}

/* ── Submit button state ── */
function updateSubmitBtn() {
  $submit.disabled = !(state.selected.size === 4 && $nameInput.value.trim().length > 0);
}

/* ── Submit ── */
async function onSubmit() {
  const categoryName = $nameInput.value.trim();
  if (state.selected.size !== 4 || !categoryName) return;

  $submit.disabled = true;
  $error.style.display = 'none';

  const movieIds = [...state.selected];

  try {
    const res = await fetch('/create/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movie_ids: movieIds, category_name: categoryName }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.message || data.error || 'Something went wrong. Please try again.');
      $submit.disabled = false;
      return;
    }

    // Show result card
    $resultTitle.textContent  = categoryName;
    $resultMovies.textContent = data.submission.movie_titles.join(' · ');
    $result.style.display     = 'block';

    // Hide grid + form
    $grid.style.display     = 'none';
    document.querySelector('.create-form').style.display = 'none';
    document.querySelector('.create-submit-row').style.display = 'none';

  } catch (err) {
    showError('Network error. Please try again.');
    $submit.disabled = false;
  }
}

/* ── Try Again ── */
async function onTryAgain() {
  // Restore visibility
  $grid.style.display     = '';
  document.querySelector('.create-form').style.display = '';
  document.querySelector('.create-submit-row').style.display = '';

  await loadMovies();
}

/* ── Refresh unselected only (keep selected movies) ── */
async function loadUnselected() {
  const selectedMovies = state.movies.filter(m => state.selected.has(m.id));
  const needed = 8 - selectedMovies.length;
  if (needed <= 0) return; // all 4 slots selected, nothing to refresh

  const excludeIds = state.movies.map(m => m.id).join(','); // exclude all current to get fresh ones
  $error.style.display = 'none';

  try {
    const res = await fetch(`/api/random-movies?exclude=${excludeIds}&count=${needed}`);
    if (!res.ok) throw new Error();
    const newMovies = await res.json();
    state.movies = [...selectedMovies, ...newMovies];
    renderGrid();
  } catch {
    showError('Could not load movies. Please try again.');
  }
}

/* ── Error display ── */
function showError(msg) {
  $error.textContent    = msg;
  $error.style.display  = 'block';
}

/* ── Events ── */
function bindEvents() {
  $submit.addEventListener('click', onSubmit);
  $tryAgain.addEventListener('click', onTryAgain);
  $nameInput.addEventListener('input', updateSubmitBtn);
  $refreshAll.addEventListener('click', loadMovies);
  $refreshUnselected.addEventListener('click', loadUnselected);
}

/* ── Start ── */
init();
