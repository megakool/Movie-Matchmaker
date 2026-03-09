/* ================================================================
   MARQUEE — game.js
   Core puzzle game logic: tile selection, guessing, win/lose,
   share (emoji grid), streak / history via localStorage.
   Expects PUZZLE_DATA, TILES, PUZZLE_DATE injected from game.html.
   ================================================================ */

/* ── Constants ── */
const COLOR_ORDER = ['yellow', 'green', 'blue', 'purple'];
const STORAGE_KEY_HISTORY = 'marquee_history';
const STORAGE_KEY_STREAK  = 'marquee_streak';
const MAX_MISTAKES = 4;

/* ── State ── */
const state = {
  tiles:      [...TILES],   // mutable order (for shuffle)
  selected:   new Set(),    // Set of movie_ids currently selected
  solved:     [],           // array of {color, title, movie_ids} in solve order
  mistakes:   0,
  guessHistory: [],         // [{movie_ids, color|null}] for emoji grid
  gameOver:   false,
  won:        false,
};

/* ── DOM refs ── */
const $grid       = document.getElementById('tile-grid');
const $solved     = document.getElementById('solved-list');
const $submit     = document.getElementById('btn-submit');
const $shuffle    = document.getElementById('btn-shuffle');
const $overlay    = document.getElementById('result-overlay');
const $headline   = document.getElementById('result-headline');
const $resultSub  = document.getElementById('result-sub');
const $resultGrid = document.getElementById('result-grid');
const $share      = document.getElementById('btn-share');
const $closeResult = document.getElementById('btn-close-result');

/* ── Init ── */
function init() {
  if (!DEV_MODE) {
    const saved = loadProgress();
    if (saved) {
      restoreState(saved);
    }
  }
  renderGrid();
  renderSolvedBanners();
  renderLives();
  bindEvents();

  // If game was already finished (from localStorage), show result immediately
  if (state.gameOver) {
    setTimeout(() => showResult(), 300);
  }
}

/* ── Render ── */
function renderGrid() {
  $grid.innerHTML = '';
  const solvedIds = new Set(state.solved.flatMap(c => c.movie_ids));

  state.tiles
    .filter(tile => !solvedIds.has(tile.id))
    .forEach(tile => {
      const div = document.createElement('div');
      div.className = 'tile';
      div.textContent = tile.title;
      div.dataset.id = tile.id;

      if (state.selected.has(tile.id)) {
        div.classList.add('tile--selected');
      }

      if (!state.gameOver) {
        div.addEventListener('click', () => onTileClick(tile.id, div));
      }
      $grid.appendChild(div);
    });
}

function renderLives() {
  for (let i = 0; i < MAX_MISTAKES; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) {
      dot.classList.toggle('dot--lost', i >= (MAX_MISTAKES - state.mistakes));
    }
  }
}

function renderSolvedBanners() {
  $solved.innerHTML = '';
  state.solved.forEach(cat => {
    const div = document.createElement('div');
    div.className = `solved-banner solved-banner--${cat.color}`;
    div.innerHTML = `
      <div class="solved-banner__title">${cat.title}</div>
      <div class="solved-banner__movies">${cat.movieTitles.join(' · ')}</div>
    `;
    $solved.appendChild(div);
  });
}

function updateSubmitBtn() {
  $submit.disabled = (state.selected.size !== 4 || state.gameOver);
}

/* ── Tile Interaction ── */
function onTileClick(movieId, el) {
  if (state.gameOver) return;

  if (state.selected.has(movieId)) {
    state.selected.delete(movieId);
    el.classList.remove('tile--selected');
  } else {
    if (state.selected.size >= 4) return;
    state.selected.add(movieId);
    el.classList.add('tile--selected');
  }
  updateSubmitBtn();
}

/* ── Submit Guess ── */
function onSubmit() {
  if (state.selected.size !== 4 || state.gameOver) return;
  const guessIds = [...state.selected];

  // Check against each unsolved category
  const solvedColors = new Set(state.solved.map(c => c.color));
  let matched = null;

  for (const cat of PUZZLE_DATA.categories) {
    if (solvedColors.has(cat.color)) continue;
    const catSet = new Set(cat.movie_ids);
    if (guessIds.every(id => catSet.has(id)) && guessIds.length === cat.movie_ids.length) {
      matched = cat;
      break;
    }
  }

  if (matched) {
    onCorrectGuess(matched);
  } else {
    // Check for "one away" hint
    let oneAway = false;
    for (const cat of PUZZLE_DATA.categories) {
      if (solvedColors.has(cat.color)) continue;
      const catSet = new Set(cat.movie_ids);
      const overlap = guessIds.filter(id => catSet.has(id)).length;
      if (overlap === 3) { oneAway = true; break; }
    }
    onWrongGuess(guessIds, oneAway);
  }
}

function onCorrectGuess(cat) {
  const movieTitles = cat.movie_ids.map(id => {
    const t = TILES.find(t => t.id === id);
    return t ? t.title : String(id);
  });

  state.guessHistory.push({ movie_ids: [...cat.movie_ids], color: cat.color });
  state.solved.push({ ...cat, movieTitles });
  state.selected.clear();

  // Animate tiles popping into color
  cat.movie_ids.forEach(id => {
    const el = document.querySelector(`.tile[data-id="${id}"]`);
    if (el) {
      el.classList.add('tile--popping');
      setTimeout(() => {
        el.classList.remove('tile--popping', 'tile--selected');
        el.classList.add('tile--solved', `tile--${cat.color}`);
        el.style.cursor = 'default';
        el.removeEventListener('click', el._clickHandler);
      }, 350);
    }
  });

  setTimeout(() => {
    renderSolvedBanners();
    renderGrid();
    updateSubmitBtn();
    saveProgress();

    if (state.solved.length === PUZZLE_DATA.categories.length) {
      state.won = true;
      state.gameOver = true;
      saveProgress();
      updateStreak(true);
      setTimeout(() => showResult(), 700);
    }
  }, 400);
}

function onWrongGuess(guessIds, oneAway) {
  state.mistakes++;
  state.guessHistory.push({ movie_ids: guessIds, color: null });

  // Shake selected tiles
  const selectedEls = guessIds.map(id => document.querySelector(`.tile[data-id="${id}"]`)).filter(Boolean);
  selectedEls.forEach(el => {
    el.classList.add('tile--wrong');
    setTimeout(() => el.classList.remove('tile--wrong'), 480);
  });

  renderLives();

  // One-away toast
  if (oneAway) {
    showToast('One away…');
  }

  if (state.mistakes >= MAX_MISTAKES) {
    state.gameOver = true;
    state.won = false;
    state.selected.clear();
    saveProgress();
    updateStreak(false);
    setTimeout(() => revealAll(), 600);
  } else {
    saveProgress();
  }

  updateSubmitBtn();
}

function revealAll() {
  // Reveal unsolved categories one by one
  const solvedColors = new Set(state.solved.map(c => c.color));
  const unsolved = PUZZLE_DATA.categories.filter(c => !solvedColors.has(c.color));

  unsolved.forEach((cat, i) => {
    setTimeout(() => {
      const movieTitles = cat.movie_ids.map(id => {
        const t = TILES.find(t => t.id === id);
        return t ? t.title : String(id);
      });
      state.solved.push({ ...cat, movieTitles });
      renderSolvedBanners();
      renderGrid();
    }, i * 500);
  });

  setTimeout(() => showResult(), unsolved.length * 500 + 600);
}

/* ── Shuffle ── */
function onShuffle() {
  const solvedIds = new Set(state.solved.flatMap(c => c.movie_ids));
  const unsolved = state.tiles.filter(t => !solvedIds.has(t.id));
  const solved   = state.tiles.filter(t =>  solvedIds.has(t.id));

  // Fisher-Yates on unsolved only
  for (let i = unsolved.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unsolved[i], unsolved[j]] = [unsolved[j], unsolved[i]];
  }
  // Keep solved at the start of state.tiles (hidden from grid anyway)
  state.tiles = [...solved, ...unsolved];
  renderGrid();
}

/* ── Result overlay ── */
function showResult() {
  // Build emoji grid
  const emojiMap = { yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪', null: '⬜' };
  $resultGrid.innerHTML = '';
  state.guessHistory.forEach(guess => {
    const row = document.createElement('div');
    row.className = 'result-row';
    guess.movie_ids.forEach(() => {
      const sq = document.createElement('div');
      sq.className = `result-square result-square--${guess.color || 'grey'}`;
      if (!guess.color) sq.style.background = '#ddd';
      row.appendChild(sq);
    });
    $resultGrid.appendChild(row);
  });

  const stats = loadStats();
  document.getElementById('stat-streak').textContent  = stats.streak;
  document.getElementById('stat-mistakes').textContent = state.mistakes;
  document.getElementById('stat-played').textContent  = stats.played;

  if (state.won) {
    $headline.textContent = state.mistakes === 0 ? 'Perfect!' : 'Nicely done!';
    $resultSub.textContent = `You solved Puzzle #${PUZZLE_DATA.puzzle_number}`;
  } else {
    $headline.textContent = 'Better luck next time';
    $resultSub.textContent = `Puzzle #${PUZZLE_DATA.puzzle_number} — ${MAX_MISTAKES} mistakes`;
  }

  $overlay.style.display = 'flex';
}

/* ── Share ── */
function buildShareText() {
  const emojiMap = { yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪' };
  const header = `Marquee #${PUZZLE_DATA.puzzle_number}`;
  const mistakeStr = state.mistakes === 0
    ? 'No mistakes!'
    : `${state.mistakes} mistake${state.mistakes > 1 ? 's' : ''}`;

  const rows = state.guessHistory.map(guess => {
    return guess.movie_ids.map(() => emojiMap[guess.color] || '⬜').join('');
  }).join('\n');

  return `${header} — ${mistakeStr}\n\n${rows}`;
}

function onShare() {
  const text = buildShareText();
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    // Fallback: show text in a prompt
    prompt('Copy this result:', text);
  });
}

/* ── Toast ── */
function showToast(msg) {
  const existing = document.querySelector('.share-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'share-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

/* ── localStorage ── */
function saveProgress() {
  const history = loadHistoryRaw();
  history[PUZZLE_DATE] = {
    solved:       state.solved.map(c => c.color),
    mistakes:     state.mistakes,
    gameOver:     state.gameOver,
    won:          state.won,
    guessHistory: state.guessHistory,
    tileOrder:    state.tiles.map(t => t.id),
  };
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

function loadProgress() {
  const history = loadHistoryRaw();
  return history[PUZZLE_DATE] || null;
}

function restoreState(saved) {
  // Restore tile order
  if (saved.tileOrder) {
    const byId = Object.fromEntries(TILES.map(t => [t.id, t]));
    state.tiles = saved.tileOrder.map(id => byId[id]).filter(Boolean);
  }

  // Restore solved categories
  const solvedColors = new Set(saved.solved || []);
  PUZZLE_DATA.categories.forEach(cat => {
    if (solvedColors.has(cat.color)) {
      const movieTitles = cat.movie_ids.map(id => {
        const t = TILES.find(t => t.id === id);
        return t ? t.title : String(id);
      });
      state.solved.push({ ...cat, movieTitles });
    }
  });

  state.mistakes     = saved.mistakes     || 0;
  state.gameOver     = saved.gameOver     || false;
  state.won          = saved.won          || false;
  state.guessHistory = saved.guessHistory || [];
}

function loadHistoryRaw() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '{}'); }
  catch(e) { return {}; }
}

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY_STREAK) || '{}');
    return { streak: s.current || 0, best: s.best || 0, played: s.played || 0 };
  } catch(e) {
    return { streak: 0, best: 0, played: 0 };
  }
}

function updateStreak(won) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY_STREAK) || '{}'); }
  catch(e) {}

  const today = PUZZLE_DATE;
  const yesterday = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  if (s.last_played === today) return; // Already counted today

  s.played = (s.played || 0) + 1;
  if (won) {
    s.current = (s.last_played === yesterday) ? (s.current || 0) + 1 : 1;
    s.best = Math.max(s.best || 0, s.current);
  } else {
    s.current = 0;
  }
  s.last_played = today;
  localStorage.setItem(STORAGE_KEY_STREAK, JSON.stringify(s));

  // Also store emoji in history for archive display
  const history = loadHistoryRaw();
  if (history[PUZZLE_DATE]) {
    const emojiMap = { yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪' };
    const rows = state.guessHistory.slice(0, 4).map(g =>
      g.movie_ids.map(() => emojiMap[g.color] || '⬜').join('')
    );
    history[PUZZLE_DATE].emoji = rows.join(' ');
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
  }
}

/* ── Event Binding ── */
function bindEvents() {
  $submit.addEventListener('click', onSubmit);
  $shuffle.addEventListener('click', onShuffle);
  $share.addEventListener('click', onShare);
  $closeResult.addEventListener('click', () => {
    $overlay.style.display = 'none';
  });

  // Click overlay bg to close
  $overlay.addEventListener('click', (e) => {
    if (e.target === $overlay) $overlay.style.display = 'none';
  });
}

/* ── Start ── */
init();
