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
const STORAGE_KEY_VERSION = 'marquee_progress_version';
const MAX_MISTAKES = 4;

// If the server's progress version is newer, wipe all stored history
(function checkProgressVersion() {
  const stored = parseInt(localStorage.getItem(STORAGE_KEY_VERSION) || '0', 10);
  if (stored < PROGRESS_VERSION) {
    localStorage.removeItem(STORAGE_KEY_HISTORY);
    localStorage.removeItem(STORAGE_KEY_STREAK);
    localStorage.setItem(STORAGE_KEY_VERSION, String(PROGRESS_VERSION));
  }
})();

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

/* ── Canvas context for text measurement (font auto-fit) ── */
const _fitCtx = (() => {
  try { return document.createElement('canvas').getContext('2d'); }
  catch(e) { return null; }
})();

/* ── DOM refs ── */
const $grid       = document.getElementById('tile-grid');
const $solved     = document.getElementById('solved-list');
const $submit     = document.getElementById('btn-submit');
const $shuffle    = document.getElementById('btn-shuffle');
const $deselect   = document.getElementById('btn-deselect');
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
  updateSubmitBtn();
  bindEvents();

  // If game was already finished (from localStorage), show result immediately
  if (state.gameOver) {
    setTimeout(() => showResult(), 300);
  }
}

/* ── Font auto-fit ── */
// Finds the largest font size where the longest word fits horizontally
// AND all wrapped lines fit vertically — no word breaks, uniform boxes.
function fitTileText() {
  if (!_fitCtx) return;

  const tiles = Array.from($grid.querySelectorAll('.tile'));
  if (!tiles.length) return;

  const tileW = tiles[0].offsetWidth;
  if (!tileW) return;

  const isMobile = window.innerWidth <= 600;
  const availW = tileW - 26;   // 13px padding each side (extra buffer for canvas vs browser rendering)
  // Mobile: tiles are square (aspect-ratio:1), so height === width
  // Desktop: measure actual tile height from the grid layout
  const availH = isMobile
    ? tileW - 16
    : (tiles[0].offsetHeight || tileW) - 22;
  const LINE_H = isMobile ? 1.2 : 1.3;
  const loFont = isMobile ? 5.5 : 9;
  const hiFont = isMobile ? 12 : 13.5;

  tiles.forEach(tile => {
    const words = tile.textContent.trim().split(/\s+/);
    const longestWord = words.reduce((m, w) => w.length > m.length ? w : m, '');

    let lo = loFont, hi = hiFont, best = loFont;
    while (hi - lo > 0.2) {
      const mid = (lo + hi) / 2;
      _fitCtx.font = `700 ${mid}px "DM Sans", system-ui, sans-serif`;

      // Reject if the longest word overflows horizontally
      if (_fitCtx.measureText(longestWord).width > availW) { hi = mid; continue; }

      // Count how many lines the full title needs at this size
      let lines = 1, lineW = 0;
      for (const word of words) {
        const ww = _fitCtx.measureText(word).width;
        const sp = _fitCtx.measureText(' ').width;
        if (lineW > 0 && lineW + sp + ww > availW) { lines++; lineW = ww; }
        else { lineW = lineW > 0 ? lineW + sp + ww : ww; }
      }

      // Reject if lines overflow vertically
      if (lines * mid * LINE_H <= availH) { best = mid; lo = mid; }
      else { hi = mid; }
    }

    tile.style.fontSize = best.toFixed(1) + 'px';
  });
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
      const len = tile.title.length;
      // maxWord ensures the longest single word fits in the tile width without breaking
      const maxWord = tile.title.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
      if      (maxWord > 13 || len > 50) div.classList.add('tile--xxxlong'); // e.g. BLACKKKLANSMAN
      else if (maxWord > 11 || len > 38) div.classList.add('tile--xxlong');
      else if (maxWord > 9  || len > 28) div.classList.add('tile--vlong');
      else if (maxWord > 7  || len > 18) div.classList.add('tile--long');
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

  // Fit text after layout is painted
  requestAnimationFrame(fitTileText);
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
  $submit.disabled   = (state.selected.size !== 4 || state.gameOver);
  $shuffle.disabled  = state.gameOver;
  $deselect.disabled = (state.selected.size === 0 || state.gameOver);
}

/* ── Tile Interaction ── */
function onTileClick(movieId, el) {
  if (state.gameOver) return;

  if (state.selected.has(movieId)) {
    state.selected.delete(movieId);
    el.classList.remove('tile--selected');
  } else {
    if (state.selected.size >= 4) {
      // Pulse the submit button to signal the limit
      $submit.classList.remove('btn--pulse');
      void $submit.offsetWidth; // force reflow to restart animation
      $submit.classList.add('btn--pulse');
      setTimeout(() => $submit.classList.remove('btn--pulse'), 320);
      return;
    }
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

  // One-away message
  if (oneAway) {
    showOneAway();
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

  setTimeout(() => { saveProgress(); showResult(); }, unsolved.length * 500 + 600);
}

/* ── Deselect All ── */
function onDeselect() {
  state.selected.clear();
  renderGrid();
  updateSubmitBtn();
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
  // Build result grid — wrong-guess squares colored by actual category
  $resultGrid.innerHTML = '';
  state.guessHistory.forEach(guess => {
    const row = document.createElement('div');
    row.className = 'result-row';
    guess.movie_ids.forEach(id => {
      const sq = document.createElement('div');
      if (guess.color) {
        sq.className = `result-square result-square--${guess.color}`;
      } else {
        const actualCat = PUZZLE_DATA.categories.find(c => c.movie_ids.includes(id));
        if (actualCat) {
          sq.className = `result-square result-square--${actualCat.color}`;
        } else {
          sq.className = 'result-square';
          sq.style.background = '#ddd';
        }
      }
      row.appendChild(sq);
    });
    $resultGrid.appendChild(row);
  });

  const stats = loadStats();
  document.getElementById('stat-streak').textContent   = stats.streak;
  document.getElementById('stat-best').textContent     = stats.best;
  document.getElementById('stat-mistakes').textContent = state.mistakes;
  document.getElementById('stat-played').textContent   = stats.played;

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
    return guess.movie_ids.map(id => {
      if (guess.color) return emojiMap[guess.color];
      const actualCat = PUZZLE_DATA.categories.find(c => c.movie_ids.includes(id));
      return actualCat ? emojiMap[actualCat.color] : '⬜';
    }).join('');
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

/* ── One Away ── */
function showOneAway() {
  const el = document.getElementById('one-away-msg');
  if (!el) return;
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 2200);
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
  $deselect.addEventListener('click', onDeselect);
  $share.addEventListener('click', onShare);
  $closeResult.addEventListener('click', () => {
    $overlay.style.display = 'none';
  });

  // Click overlay bg to close
  $overlay.addEventListener('click', (e) => {
    if (e.target === $overlay) $overlay.style.display = 'none';
  });

  // Escape key closes result overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $overlay.style.display !== 'none') {
      $overlay.style.display = 'none';
    }
  });

  // Refit tile text on orientation change / resize
  let _fitResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_fitResizeTimer);
    _fitResizeTimer = setTimeout(fitTileText, 150);
  });
}

/* ── Start ── */
init();
