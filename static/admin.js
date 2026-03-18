/* ================================================================
   MARQUEE — admin.js v2
   Puzzle Builder · Categories · Submissions · Published · AI
   ================================================================ */

// ── Constants ──────────────────────────────────────────────────────
const COLOR_ORDER = ['yellow', 'green', 'blue', 'purple'];
const DIFF_LABELS = ['Easiest', 'Easy', 'Hard', 'Hardest'];
const COLOR_HEX   = { yellow: '#f9df6d', green: '#6abf69', blue: '#6ab0d4', purple: '#b07ecf' };
const COLOR_TEXT  = { yellow: '#7a5c00', green: '#1a4d19', blue: '#0f3d5a', purple: '#3d1460' };

// ── Builder State ──────────────────────────────────────────────────
let allMovies     = [];
let builderQuery  = '';
let activeSlot    = 0;
let currentDraftId = null;

const slots = COLOR_ORDER.map((color, i) => ({
  color, difficulty: i + 1, title: '', movies: [],
}));

// ── Categories Tab State ───────────────────────────────────────────
let catBrowseSelected    = [];   // [{id, title, year}] — max 4
let savedCategories      = [];
let catLibraryQuery      = '';
let catLibraryHideUsed   = true;

// ── Connections State ──────────────────────────────────────────────
let connectionsData      = [];   // raw from /admin/connections
let connectionsType      = 'director';
let connectionsQuery     = '';
let selectedConnection   = null; // {name, type, movies:[]}
let connectionsLoaded    = false;

// ── Published Tab State ────────────────────────────────────────────
const publishedDetailCache = {};

// ── Panel Load Flags ───────────────────────────────────────────────
let categoriesLoaded  = false;

// ── Trivia Builder State ───────────────────────────────────────────
let triviaBuilderSlots   = [null, null, null];  // each: question object or null
let triviaBuilderLoaded  = false;
let triviaBankQuery      = '';

// ── Trivia Published State ─────────────────────────────────────────
let triviaPublishedLoaded = false;

// ── Active Game ────────────────────────────────────────────────────
let activeGame = 'marquee'; // 'marquee' | 'trivia'

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
async function init() {
  document.getElementById('pub-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('trivia-pub-date').value = new Date().toISOString().slice(0, 10);
  bindNav();
  bindBuilderEvents();
  bindDatasetEvents();
  bindAIEvents();
  bindCategoriesEvents();
  bindCatSearchEvents();
  bindSubTabs();
  bindRandomDiscoveryEvents();
  bindPublishedEvents();
  bindSettingsEvents();
  bindTriviaEvents();
  bindTriviaPuzzleBuilderEvents();
  bindTriviaPublishedEvents();
  await initDataset();
  await loadMovies();
  pickRandomMovies();
}

function switchToGame(game) {
  activeGame = game;
  const navMarquee = document.getElementById('nav-marquee');
  const navTrivia  = document.getElementById('nav-trivia');
  const pillMarquee = document.getElementById('pill-marquee');
  const pillTrivia  = document.getElementById('pill-trivia');
  const movieDatasetCard = document.getElementById('settings-movie-dataset');

  if (game === 'marquee') {
    navMarquee.style.display = '';
    navTrivia.style.display  = 'none';
    pillMarquee.classList.remove('game-pill--inactive');
    pillTrivia.classList.add('game-pill--inactive');
    if (movieDatasetCard) movieDatasetCard.style.display = '';
    switchToPanel('builder');
  } else {
    navMarquee.style.display = 'none';
    navTrivia.style.display  = '';
    pillTrivia.classList.remove('game-pill--inactive');
    pillMarquee.classList.add('game-pill--inactive');
    if (movieDatasetCard) movieDatasetCard.style.display = 'none';
    switchToPanel('trivia-builder');
    loadTriviaData();
  }
}

// ══════════════════════════════════════════════════════════════════
// BUILDER TAB
// ══════════════════════════════════════════════════════════════════

async function loadMovies() {
  const res = await fetch('/admin/movies');
  allMovies = await res.json();
  document.getElementById('pool-count').textContent = `${allMovies.length} movies`;
  renderPool();
  renderSlotSelector();
  renderSlots();
  renderPreview();
}

/* ── Movie pool ── */
function renderPool() {
  const $list   = document.getElementById('pool-list');
  const usedIds = new Set(slots.flatMap(s => s.movies.map(m => m.id)));
  const q       = builderQuery.toLowerCase();

  const filtered = q
    ? allMovies.filter(m =>
        m.title.toLowerCase().includes(q) ||
        String(m.year).includes(q) ||
        (m.directors || []).some(d => d.toLowerCase().includes(q)) ||
        (m.actors    || []).some(a => a.toLowerCase().includes(q)) ||
        (m.cast      || []).some(a => a.toLowerCase().includes(q)) ||
        (m.genres    || []).some(g => g.toLowerCase().includes(q)) ||
        (m.writers   || []).some(w => w.toLowerCase().includes(q))
      )
    : allMovies;

  $list.innerHTML = '';
  if (!filtered.length) {
    $list.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.5;font-size:13px;">No matches</div>';
    return;
  }
  filtered.forEach(m => {
    const div = document.createElement('div');
    div.className = 'pool-movie' + (usedIds.has(m.id) ? ' in-use' : '');
    div.innerHTML = `<span>${escHtml(m.title)}</span><span class="pool-movie__year">${m.year || ''}</span>`;
    if (!usedIds.has(m.id)) div.addEventListener('click', () => onPoolMovieClick(m));
    $list.appendChild(div);
  });
}

/* ── Slot selector ── */
function renderSlotSelector() {
  const $sel = document.getElementById('slot-selector');
  $sel.innerHTML = '';
  slots.forEach((slot, i) => {
    const dot = document.createElement('div');
    dot.className = 'slot-dot' + (i === activeSlot ? ' active-slot' : '');
    dot.style.background = COLOR_HEX[slot.color];
    dot.title = `${DIFF_LABELS[i]} (${slot.color})`;
    dot.addEventListener('click', () => { activeSlot = i; renderSlotSelector(); renderSlots(); });
    $sel.appendChild(dot);
  });
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:12px;font-weight:700;opacity:0.7;margin-left:4px;white-space:nowrap;';
  lbl.textContent = `→ ${DIFF_LABELS[activeSlot]} (${slots[activeSlot].color})`;
  $sel.appendChild(lbl);
}

/* ── Category slots ── */
function renderSlots() {
  const $area = document.getElementById('categories-area');
  $area.innerHTML = '';

  slots.forEach((slot, si) => {
    const isActive = si === activeSlot;
    const div = document.createElement('div');
    div.className = 'cat-slot' + (isActive ? ' active-target' : '');

    const movieChips = slot.movies.map((m, mi) => `
      <div class="cat-movie-chip">
        ${escHtml(m.title)}
        <button class="cat-movie-chip__remove" data-slot="${si}" data-movie="${mi}" title="Remove">×</button>
      </div>`).join('');

    const moviesContent = slot.movies.length === 0
      ? '<span class="cat-empty">Click header to activate, then pick movies from pool</span>'
      : movieChips + (slot.movies.length < 4
          ? `<span style="font-size:12px;opacity:0.4;align-self:center;">${slot.movies.length}/4</span>`
          : '');

    div.innerHTML = `
      <div class="cat-slot__header" data-slot="${si}">
        <div class="cat-dot" style="background:${COLOR_HEX[slot.color]};border:2.5px solid #333;"></div>
        <input class="cat-slot__title" type="text" maxlength="80"
               placeholder="Category name…" value="${escHtml(slot.title)}" data-slot="${si}">
        <span class="cat-difficulty">${DIFF_LABELS[si]}</span>
        <div class="cat-slot__actions">
          <button class="slot-reorder-btn" data-slot="${si}" data-dir="up"
                  ${si === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="slot-reorder-btn" data-slot="${si}" data-dir="down"
                  ${si === slots.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="btn btn--ghost btn--sm from-lib-btn" data-slot="${si}"
                  style="font-size:11px;padding:3px 8px;">Library ▾</button>
        </div>
      </div>
      <div class="cat-slot__movies">${moviesContent}</div>`;

    // Click header → activate slot
    div.querySelector('.cat-slot__header').addEventListener('click', e => {
      if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      activeSlot = si;
      renderSlotSelector();
      renderSlots();
    });

    $area.appendChild(div);
  });

  // Title inputs
  $area.querySelectorAll('.cat-slot__title').forEach(input => {
    input.addEventListener('input', e => {
      slots[+e.target.dataset.slot].title = e.target.value;
      renderPreview();
    });
    input.addEventListener('focus', e => {
      activeSlot = +e.target.dataset.slot;
      renderSlotSelector();
    });
  });

  // Remove chips
  $area.querySelectorAll('.cat-movie-chip__remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      slots[+e.target.dataset.slot].movies.splice(+e.target.dataset.movie, 1);
      renderSlots(); renderPool(); renderPreview();
    });
  });

  // Reorder
  $area.querySelectorAll('.slot-reorder-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const si       = +e.target.dataset.slot;
      const swapWith = e.target.dataset.dir === 'up' ? si - 1 : si + 1;
      [slots[si].title,  slots[swapWith].title]  = [slots[swapWith].title,  slots[si].title];
      [slots[si].movies, slots[swapWith].movies]  = [slots[swapWith].movies, slots[si].movies];
      if      (activeSlot === si)       activeSlot = swapWith;
      else if (activeSlot === swapWith) activeSlot = si;
      renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
    });
  });

  // From Library
  $area.querySelectorAll('.from-lib-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showLibraryOverlay(+e.target.dataset.slot, btn);
    });
  });
}

/* ── Live preview ── */
function renderPreview() {
  const $prev = document.getElementById('preview-cats');
  if (!$prev) return;
  $prev.innerHTML = '';
  slots.forEach(slot => {
    const filled = slot.movies.length === 4;
    const div    = document.createElement('div');
    div.className = `preview-cat preview-cat--${slot.color}${filled ? ' filled' : ''}`;
    div.title     = slot.movies.map(m => m.title).join(' · ') || 'Empty';
    div.innerHTML = `
      <div style="flex:1;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${escHtml(slot.title.trim() || `(${slot.color})`)}
      </div>
      <span style="font-size:11px;opacity:0.7;white-space:nowrap;">${slot.movies.length}/4</span>`;
    $prev.appendChild(div);
  });
}

/* ── Pool click ── */
function onPoolMovieClick(movie) {
  const slot = slots[activeSlot];
  if (slot.movies.length >= 4) {
    showValidation(`The ${slot.color} slot is full. Remove a movie or choose a different slot.`);
    return;
  }
  if (slots.some(s => s.movies.some(m => m.id === movie.id))) {
    showValidation(`"${movie.title}" is already in a slot.`);
    return;
  }
  slot.movies.push({ id: movie.id, title: movie.title, year: movie.year || '' });
  clearValidation();
  if (slot.movies.length === 4) {
    const next = slots.findIndex((s, i) => i > activeSlot && s.movies.length < 4);
    if (next !== -1) { activeSlot = next; renderSlotSelector(); }
  }
  renderSlots(); renderPool(); renderPreview();
}

/* ── Library overlay ── */
let _overlaySlot = 0;
function showLibraryOverlay(slotIdx, anchorBtn) {
  const existing = document.getElementById('lib-overlay');
  if (existing) existing.remove();

  _overlaySlot = slotIdx;
  const overlay = document.createElement('div');
  overlay.id = 'lib-overlay';
  overlay.style.cssText =
    'position:absolute;background:#fff;border:2px solid #111;border-radius:10px;' +
    'box-shadow:4px 4px 0 #111;padding:10px;width:290px;max-height:340px;overflow-y:auto;z-index:500;';
  const rect = anchorBtn.getBoundingClientRect();
  overlay.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  overlay.style.left = Math.min(rect.left + window.scrollX,
                                window.innerWidth - 310) + 'px';

  if (!savedCategories.length) {
    overlay.innerHTML = '<div style="opacity:0.5;font-size:13px;padding:8px;">No categories saved yet. Visit the Categories tab to create some.</div>';
  } else {
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search library…';
    search.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;border:1.5px solid #ccc;border-radius:6px;font-family:inherit;font-size:13px;margin-bottom:8px;';
    overlay.appendChild(search);

    const list = document.createElement('div');
    renderOverlayList(list, savedCategories);
    overlay.appendChild(list);

    search.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderOverlayList(list, savedCategories.filter(c => c.title.toLowerCase().includes(q)));
    });
  }

  document.body.appendChild(overlay);
  setTimeout(() => document.addEventListener('click', closeLibraryOverlay, { once: true }), 50);
}

function renderOverlayList(container, cats) {
  container.innerHTML = '';
  if (!cats.length) {
    container.innerHTML = '<div style="opacity:0.5;font-size:13px;padding:6px;">No matches</div>';
    return;
  }
  cats.forEach(cat => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:7px 8px;border-radius:6px;cursor:pointer;font-size:13px;';
    item.innerHTML = `
      <div style="font-weight:700;">${escHtml(cat.title)}</div>
      <div style="font-size:11px;opacity:0.6;">${(cat.movie_titles || []).slice(0, 4).join(' · ')}</div>`;
    item.addEventListener('mouseenter', () => item.style.background = '#f0ebe5');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', e => {
      e.stopPropagation();
      loadCategoryIntoSlot(cat, _overlaySlot);
      closeLibraryOverlay();
    });
    container.appendChild(item);
  });
}

function closeLibraryOverlay() {
  const el = document.getElementById('lib-overlay');
  if (el) el.remove();
}

function loadCategoryIntoSlot(cat, slotIdx) {
  slots[slotIdx].title  = cat.title;
  slots[slotIdx].movies = (cat.movie_ids || []).map((id, j) => ({
    id, title: cat.movie_titles?.[j] || String(id), year: '',
  }));
  renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
}

/* ── Validation ── */
function showValidation(msg) {
  const el = document.getElementById('validation-msg');
  el.textContent = msg; el.style.display = 'block';
}
function clearValidation() {
  document.getElementById('validation-msg').style.display = 'none';
}
function validatePuzzle() {
  const errors = [];
  slots.forEach((s, i) => {
    if (!s.title.trim()) errors.push(`${COLOR_ORDER[i]} needs a name.`);
    if (s.movies.length !== 4) errors.push(`${COLOR_ORDER[i]} needs 4 movies (has ${s.movies.length}).`);
  });
  const allIds = slots.flatMap(s => s.movies.map(m => m.id));
  const seen = new Set(), dups = new Set();
  allIds.forEach(id => { if (seen.has(id)) dups.add(id); seen.add(id); });
  if (dups.size) {
    const titles = [...dups].map(id => allMovies.find(m => m.id === id)?.title || id);
    errors.push(`Duplicate movies: ${titles.join(', ')}`);
  }
  if (!document.getElementById('pub-date').value) errors.push('Select a publish date.');
  return errors;
}

/* ── Publish ── */
async function onPublish() {
  clearValidation();
  const errors = validatePuzzle();
  if (errors.length) { showValidation(errors.join(' ')); return; }

  const $btn = document.getElementById('btn-publish');
  const $msg = document.getElementById('publish-msg');
  $btn.disabled = true; $msg.textContent = ''; $msg.className = 'publish-msg';

  const payload = {
    date:        document.getElementById('pub-date').value,
    author_note: document.getElementById('pub-note').value.trim(),
    categories:  slots.map(s => ({
      color: s.color, difficulty: s.difficulty,
      title: s.title.trim(), movie_ids: s.movies.map(m => m.id),
    })),
  };

  try {
    const res  = await fetch('/admin/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      $msg.textContent = `✓ Published as Puzzle #${data.puzzle_number}!`;
      $msg.className   = 'publish-msg ok';
    } else {
      $msg.textContent = data.error || 'Error publishing.';
      $msg.className   = 'publish-msg err';
    }
  } catch {
    $msg.textContent = 'Network error.'; $msg.className = 'publish-msg err';
  }
  $btn.disabled = false;
}

/* ── Drafts ── */
async function onSaveDraft() {
  const pubDate = document.getElementById('pub-date').value;
  const name    = pubDate
    ? `Draft for ${pubDate}`
    : `Draft ${new Date().toLocaleDateString()}`;

  const payload = {
    id:           currentDraftId,
    name,
    date:         pubDate,
    author_note:  document.getElementById('pub-note').value.trim(),
    categories:   slots.map(s => ({
      color: s.color, difficulty: s.difficulty, title: s.title,
      movie_ids: s.movies.map(m => m.id), movie_titles: s.movies.map(m => m.title),
    })),
  };

  const res  = await fetch('/admin/drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    currentDraftId = data.draft.id;
    const $msg = document.getElementById('publish-msg');
    $msg.textContent = '✓ Draft saved'; $msg.className = 'publish-msg ok';
  }
}

async function onLoadDraft() {
  const res    = await fetch('/admin/drafts');
  const drafts = await res.json();
  if (!drafts.length) { alert('No saved drafts yet.'); return; }

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border:2.5px solid #111;border-radius:12px;box-shadow:4px 4px 0 #111;padding:20px;min-width:340px;max-width:520px;max-height:80vh;overflow-y:auto;';
  card.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:14px;">Load Draft</div>';

  drafts.slice().reverse().forEach(draft => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;border:1.5px solid #e5ddd5;margin-bottom:8px;';
    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(draft.name)}</div>
        <div style="font-size:12px;opacity:0.5;">${(draft.saved_at || '').slice(0, 16)} — ${draft.date || 'no date'}</div>
      </div>
      <button class="btn btn--sm load-btn">Load</button>
      <button class="btn btn--ghost btn--sm del-btn" style="color:#cc2200;">Delete</button>`;
    row.querySelector('.load-btn').addEventListener('click', () => {
      applyDraftToBuilder(draft);
      document.body.removeChild(modal);
    });
    row.querySelector('.del-btn').addEventListener('click', async e => {
      e.stopPropagation();
      await fetch(`/admin/drafts/${draft.id}`, { method: 'DELETE' });
      row.remove();
    });
    card.appendChild(row);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn--ghost';
  cancelBtn.style.marginTop = '10px';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => document.body.removeChild(modal));
  card.appendChild(cancelBtn);

  modal.appendChild(card);
  modal.addEventListener('click', e => { if (e.target === modal) document.body.removeChild(modal); });
  document.body.appendChild(modal);
}

function applyDraftToBuilder(draft) {
  currentDraftId = draft.id;
  document.getElementById('pub-date').value = draft.date || '';
  document.getElementById('pub-note').value = draft.author_note || '';
  (draft.categories || []).forEach((cat, i) => {
    if (i >= slots.length) return;
    slots[i].title  = cat.title || '';
    slots[i].movies = (cat.movie_ids || []).map((id, j) => ({
      id, title: cat.movie_titles?.[j] || String(id), year: '',
    }));
  });
  renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  const $msg = document.getElementById('publish-msg');
  $msg.textContent = `Loaded: ${draft.name}`; $msg.className = 'publish-msg ok';
}

function onClearBuilder() {
  if (!confirm('Clear all category slots?')) return;
  currentDraftId = null;
  slots.forEach(s => { s.title = ''; s.movies = []; });
  document.getElementById('pub-note').value = '';
  activeSlot = 0;
  renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  clearValidation();
  document.getElementById('publish-msg').textContent = '';
}

/* ── Builder events ── */
function bindBuilderEvents() {
  document.getElementById('pool-search').addEventListener('input', e => {
    builderQuery = e.target.value; renderPool();
  });
  document.getElementById('btn-publish').addEventListener('click', onPublish);
  document.getElementById('btn-save-draft').addEventListener('click', onSaveDraft);
  document.getElementById('btn-load-draft').addEventListener('click', onLoadDraft);
  document.getElementById('btn-clear-builder').addEventListener('click', onClearBuilder);
}

// ══════════════════════════════════════════════════════════════════
// CATEGORIES TAB
// ══════════════════════════════════════════════════════════════════

async function loadCategoryLibrary() {
  const res   = await fetch('/admin/categories');
  savedCategories = await res.json();
  renderCategoryLibrary();
}

/* ── Connections Index ── */
async function loadConnections() {
  document.getElementById('conn-list').innerHTML = '<div class="conn-empty">Loading…</div>';
  const res  = await fetch('/admin/connections');
  connectionsData = await res.json();
  renderConnectionsIndex();
}

function renderConnectionsIndex() {
  const $list = document.getElementById('conn-list');
  const q     = connectionsQuery.toLowerCase();
  const items = connectionsData.filter(c =>
    c.type === connectionsType &&
    (!q || c.name.toLowerCase().includes(q))
  );

  $list.innerHTML = '';
  if (!items.length) {
    $list.innerHTML = `<div class="conn-empty">No ${connectionsType}s with 4+ movies${q ? ' matching "' + escHtml(q) + '"' : ''}.</div>`;
    return;
  }

  items.forEach(conn => {
    const div   = document.createElement('div');
    const isActive = selectedConnection && selectedConnection.name === conn.name && selectedConnection.type === conn.type;
    div.className = 'conn-item' + (isActive ? ' active' : '');
    div.innerHTML = `
      <span class="conn-item__name" title="${escHtml(conn.name)}">${escHtml(conn.name)}</span>
      <span class="conn-item__count ${conn.movies.length >= 4 ? 'enough' : ''}">${conn.movies.length}</span>`;
    div.addEventListener('click', () => onConnectionClick(conn));
    $list.appendChild(div);
  });
}

function onConnectionClick(conn) {
  selectedConnection = conn;
  catBrowseSelected  = [];
  renderConnectionsIndex();   // refresh active highlight
  renderConnectionMovies();
  updateBrowseActions();
  // Auto-fill name input
  document.getElementById('cat-lib-name').value = conn.name;
  updateBrowseActions();
}

function renderConnectionMovies() {
  if (!selectedConnection) return;
  const conn   = selectedConnection;
  const usedIds = new Set(slots.flatMap(s => s.movies.map(m => m.id)));
  const $title = document.getElementById('conn-movies-title');
  const $sub   = document.getElementById('conn-movies-sub');
  const $list  = document.getElementById('conn-movie-list');

  $title.textContent = conn.name;
  $sub.textContent   = `${conn.movies.length} movie${conn.movies.length !== 1 ? 's' : ''} · select up to 4`;
  $list.innerHTML = '';

  const sorted = [...conn.movies].sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

  sorted.forEach(m => {
    const alreadySel = catBrowseSelected.some(s => s.id === m.id);
    const inUse      = usedIds.has(m.id);
    const row        = document.createElement('div');
    row.className    = 'conn-movie-row' + (inUse ? ' in-use' : '');
    row.innerHTML    = `
      <input type="checkbox" data-id="${m.id}" ${alreadySel ? 'checked' : ''} ${inUse ? 'disabled' : ''}>
      <span style="flex:1;">${escHtml(m.title)}</span>
      <span style="font-size:11px;opacity:0.45;">${m.year || ''}</span>`;
    if (!inUse) {
      const cb = row.querySelector('input');
      const toggle = () => {
        if (cb.checked) {
          if (catBrowseSelected.length >= 4) { cb.checked = false; return; }
          catBrowseSelected.push({ id: m.id, title: m.title, year: m.year || '' });
        } else {
          catBrowseSelected = catBrowseSelected.filter(s => s.id !== m.id);
        }
        updateBrowseActions();
      };
      cb.addEventListener('change', toggle);
      row.addEventListener('click', e => { if (e.target !== cb) { cb.checked = !cb.checked; toggle(); } });
    }
    $list.appendChild(row);
  });
}

function updateBrowseActions() {
  const n    = catBrowseSelected.length;
  const name = document.getElementById('cat-lib-name').value.trim();
  document.getElementById('browse-selected-count').textContent = `${n}/4 selected`;
  document.getElementById('btn-save-to-lib').disabled    = !(n === 4 && name);
  document.getElementById('btn-load-to-builder').disabled = n === 0;
}

async function onSaveToLibrary() {
  const title = document.getElementById('cat-lib-name').value.trim();
  if (!title || catBrowseSelected.length !== 4) return;

  const res  = await fetch('/admin/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      movie_ids:    catBrowseSelected.map(m => m.id),
      movie_titles: catBrowseSelected.map(m => m.title),
      source: 'manual',
    }),
  });
  const data = await res.json();
  if (data.ok) {
    savedCategories.unshift(data.category);
    renderCategoryLibrary();
    catBrowseSelected = [];
    document.getElementById('cat-lib-name').value = '';
    updateBrowseActions();
    renderConnectionMovies();
    const btn = document.getElementById('btn-save-to-lib');
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; }, 2000);
  }
}

function onLoadBrowseToBuilder() {
  if (!catBrowseSelected.length) return;
  const name = document.getElementById('cat-lib-name').value.trim();
  slots[activeSlot].movies = [...catBrowseSelected];
  if (name) slots[activeSlot].title = name;
  switchToPanel('builder');
  renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
}

/* ── Library list ── */
function renderCategoryLibrary() {
  const $list = document.getElementById('category-library-list');
  const q     = catLibraryQuery.toLowerCase();
  let shown   = q ? savedCategories.filter(c => c.title.toLowerCase().includes(q)) : savedCategories;
  if (catLibraryHideUsed) shown = shown.filter(c => !c.times_used || c.times_used === 0);

  document.getElementById('lib-count').textContent = `${shown.length} saved`;
  $list.innerHTML = '';

  if (!shown.length) {
    $list.innerHTML = '<p style="opacity:0.5;font-size:13px;">No categories yet. Browse the connections index and save a group.</p>';
    return;
  }

  shown.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'cat-library-card';
    div.innerHTML = `
      <div class="cat-library-card__title">${escHtml(cat.title)}</div>
      <div class="cat-library-card__movies">${(cat.movie_titles || []).map(t => escHtml(t)).join(' · ')}</div>
      <div class="cat-library-card__footer">
        <span class="source-badge source-badge--${cat.source || 'manual'}">${cat.source || 'manual'}</span>
        ${cat.times_used > 0 ? `<span style="font-size:11px;opacity:0.5;margin-left:4px;">used ${cat.times_used}×</span>` : ''}
        <button class="btn btn--sm load-lib-btn" data-cat="${cat.id}"
                style="margin-left:auto;font-size:11px;padding:4px 10px;">→ Builder</button>
        <button class="btn btn--ghost btn--sm del-lib-btn" data-cat="${cat.id}"
                style="font-size:11px;padding:4px 10px;color:#cc2200;">Delete</button>
      </div>`;
    $list.appendChild(div);
  });

  $list.querySelectorAll('.load-lib-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = savedCategories.find(c => c.id === btn.dataset.cat);
      if (cat) { loadCategoryIntoSlot(cat, activeSlot); switchToPanel('builder'); }
    });
  });

  $list.querySelectorAll('.del-lib-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this category?')) return;
      await fetch(`/admin/categories/${btn.dataset.cat}`, { method: 'DELETE' });
      savedCategories = savedCategories.filter(c => c.id !== btn.dataset.cat);
      renderCategoryLibrary();
    });
  });
}

function bindCategoriesEvents() {
  document.querySelectorAll('[data-conntype]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-conntype]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      connectionsType  = btn.dataset.conntype;
      connectionsQuery = '';
      document.getElementById('conn-search').value = '';
      selectedConnection = null;
      renderConnectionsIndex();
      document.getElementById('conn-movie-list').innerHTML =
        '<div class="conn-empty">Choose a name from the list.</div>';
      document.getElementById('conn-movies-title').textContent = 'Select a name to see movies';
      document.getElementById('conn-movies-sub').textContent   = 'Click any name on the left';
      catBrowseSelected = [];
      updateBrowseActions();
    });
  });
  document.getElementById('conn-search').addEventListener('input', e => {
    connectionsQuery = e.target.value; renderConnectionsIndex();
  });
  document.getElementById('cat-lib-name').addEventListener('input', updateBrowseActions);
  document.getElementById('btn-save-to-lib').addEventListener('click', onSaveToLibrary);
  document.getElementById('btn-load-to-builder').addEventListener('click', onLoadBrowseToBuilder);
  document.getElementById('lib-search').addEventListener('input', e => {
    catLibraryQuery = e.target.value; renderCategoryLibrary();
  });
  const hideUsedBtn = document.getElementById('btn-lib-hide-used');
  // Reflect default state (true)
  hideUsedBtn.textContent      = 'Show All';
  hideUsedBtn.style.background = '#2a2a2a';
  hideUsedBtn.style.color      = '#fff';
  hideUsedBtn.addEventListener('click', function() {
    catLibraryHideUsed        = !catLibraryHideUsed;
    this.textContent          = catLibraryHideUsed ? 'Show All' : 'Hide Used';
    this.style.background     = catLibraryHideUsed ? '#2a2a2a' : '';
    this.style.color          = catLibraryHideUsed ? '#fff' : '';
    renderCategoryLibrary();
  });
}

async function deletePuzzle(puzzleDate) {
  if (!confirm(`Delete puzzle for ${puzzleDate}? This cannot be undone.`)) return;
  const res = await fetch(`/admin/puzzles/${puzzleDate}`, { method: 'DELETE' });
  if (res.ok) {
    document.querySelector(`.pub-row[data-date="${puzzleDate}"]`)?.remove();
  } else {
    alert('Delete failed.');
  }
}

async function renumberAll() {
  if (!confirm('Renumber all puzzles chronologically (#1 = oldest)? This updates every puzzle file.')) return;
  const btn = document.getElementById('btn-renumber-all');
  btn.disabled = true;
  const res  = await fetch('/admin/puzzles/renumber', { method: 'POST' });
  const data = await res.json();
  btn.disabled = false;
  if (data.ok) {
    alert(`Renumbered ${data.total} puzzles. Reload to see updated numbers.`);
    location.reload();
  } else {
    alert('Renumber failed.');
  }
}

// ══════════════════════════════════════════════════════════════════
// CATEGORY MOVIE SEARCH
// ══════════════════════════════════════════════════════════════════

let catSearchSelected = [];  // [{id, title, year}]

function renderCatMovieSearch(query) {
  const $list = document.getElementById('cat-movie-results');
  if (!query.trim()) {
    $list.innerHTML = '<div class="conn-empty">Type to search movies</div>';
    return;
  }
  const q = query.toLowerCase();
  const matches = allMovies.filter(m =>
    m.title.toLowerCase().includes(q) ||
    String(m.year).includes(q) ||
    (m.directors || []).some(d => d.toLowerCase().includes(q)) ||
    (m.cast || m.actors || []).some(a => a.toLowerCase().includes(q)) ||
    (m.writers || []).some(w => w.toLowerCase().includes(q)) ||
    (m.genres || []).some(g => g.toLowerCase().includes(q))
  ).slice(0, 60);

  if (!matches.length) {
    $list.innerHTML = '<div class="conn-empty">No movies found</div>';
    return;
  }
  $list.innerHTML = '';
  matches.forEach(m => {
    const alreadySel = catSearchSelected.some(s => s.id === m.id);
    const row = document.createElement('div');
    row.className = 'conn-movie-row' + (alreadySel ? ' in-use' : '');
    row.innerHTML = `
      <input type="checkbox" data-id="${m.id}" ${alreadySel ? 'checked disabled' : ''}>
      <span style="flex:1;">${escHtml(m.title)}</span>
      <span style="font-size:11px;opacity:0.45;">${m.year || ''}</span>`;
    if (!alreadySel) {
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (catSearchSelected.length >= 4) { cb.checked = false; return; }
          catSearchSelected.push({ id: m.id, title: m.title, year: m.year || '' });
        } else {
          catSearchSelected = catSearchSelected.filter(s => s.id !== m.id);
        }
        updateCatSearchActions();
        renderCatSearchSelected();
        // Re-render results to grey out already-selected
        renderCatMovieSearch(document.getElementById('cat-movie-search').value);
      });
    }
    $list.appendChild(row);
  });
}

function renderCatSearchSelected() {
  const $panel = document.getElementById('cat-search-selected');
  if (!catSearchSelected.length) {
    $panel.innerHTML = '<div class="conn-empty">Select movies from the search results.</div>';
    return;
  }
  $panel.innerHTML = '';
  catSearchSelected.forEach(m => {
    const row = document.createElement('div');
    row.className = 'conn-movie-row';
    row.innerHTML = `
      <span style="flex:1;">${escHtml(m.title)}</span>
      <span style="font-size:11px;opacity:0.45;">${m.year || ''}</span>
      <button style="background:none;border:none;cursor:pointer;font-size:14px;opacity:0.5;padding:0;line-height:1;"
              title="Remove">✕</button>`;
    row.querySelector('button').addEventListener('click', () => {
      catSearchSelected = catSearchSelected.filter(s => s.id !== m.id);
      updateCatSearchActions();
      renderCatSearchSelected();
      renderCatMovieSearch(document.getElementById('cat-movie-search').value);
    });
    $panel.appendChild(row);
  });
}

function updateCatSearchActions() {
  const count = catSearchSelected.length;
  document.getElementById('cat-search-sub').textContent = `${count}/4 selected`;
  const ready = count >= 1;
  document.getElementById('btn-cat-search-save').disabled = count !== 4;
  document.getElementById('btn-cat-search-load').disabled = !ready;
}

function bindCatSearchEvents() {
  document.getElementById('cat-movie-search').addEventListener('input', e => {
    renderCatMovieSearch(e.target.value);
  });

  document.getElementById('btn-cat-search-clear').addEventListener('click', () => {
    catSearchSelected = [];
    document.getElementById('cat-movie-search').value = '';
    document.getElementById('cat-search-name').value = '';
    renderCatMovieSearch('');
    renderCatSearchSelected();
    updateCatSearchActions();
  });

  document.getElementById('btn-cat-search-save').addEventListener('click', async () => {
    const name = document.getElementById('cat-search-name').value.trim();
    if (!name || catSearchSelected.length !== 4) return;
    const btn = document.getElementById('btn-cat-search-save');
    btn.disabled = true;
    await fetch('/admin/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:        name,
        movie_ids:    catSearchSelected.map(m => m.id),
        movie_titles: catSearchSelected.map(m => m.title),
        source:       'manual',
      }),
    });
    await loadCategoryLibrary();
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; btn.disabled = false; }, 2000);
    catSearchSelected = [];
    document.getElementById('cat-search-name').value = '';
    document.getElementById('cat-movie-search').value = '';
    renderCatMovieSearch('');
    renderCatSearchSelected();
    updateCatSearchActions();
  });

  document.getElementById('btn-cat-search-load').addEventListener('click', () => {
    const name = document.getElementById('cat-search-name').value.trim();
    slots[activeSlot].title  = name;
    slots[activeSlot].movies = catSearchSelected.map(m => ({ id: m.id, title: m.title, year: m.year || '' }));
    switchToPanel('builder');
    renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  });
}

// ══════════════════════════════════════════════════════════════════
// RANDOM DISCOVERY
// ══════════════════════════════════════════════════════════════════

let randomPickMovies  = [];   // current 8 movies shown
let randomPickSelected = new Set();  // selected movie ids

function pickRandomMovies() {
  if (!allMovies.length) return;
  const pool = [...allMovies];
  // Fisher-Yates shuffle, take first 8
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  randomPickMovies   = pool.slice(0, 8);
  randomPickSelected = new Set();
  renderRandomPick();
  updateRandomActions();
}

function renderRandomPick() {
  const $grid = document.getElementById('random-pick-grid');
  $grid.innerHTML = '';
  randomPickMovies.forEach(m => {
    const card = document.createElement('div');
    const isSel = randomPickSelected.has(m.id);
    card.className = 'random-pick-card' + (isSel ? ' selected' : '');

    if (m.poster_url) {
      const img = document.createElement('img');
      img.className = 'random-poster-img';
      img.src = m.poster_url;
      img.alt = m.title;
      img.draggable = false;
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'random-poster-placeholder';
      ph.textContent = '🎬';
      card.appendChild(ph);
    }

    const label = document.createElement('div');
    label.className = 'random-card-label';
    label.innerHTML = `${escHtml(m.title)}<span class="random-pick-card__year">${m.year || ''}</span>`;
    card.appendChild(label);

    card.addEventListener('click', () => {
      if (randomPickSelected.has(m.id)) {
        randomPickSelected.delete(m.id);
        card.classList.remove('selected');
        card.querySelector('.random-card-label').style.cssText = '';
      } else {
        if (randomPickSelected.size >= 4) return;
        randomPickSelected.add(m.id);
        card.classList.add('selected');
      }
      // Grey out unselected cards when 4 are picked
      $grid.querySelectorAll('.random-pick-card').forEach((c, idx) => {
        const cid = randomPickMovies[idx]?.id;
        if (!randomPickSelected.has(cid) && randomPickSelected.size >= 4) {
          c.classList.add('disabled-card');
        } else {
          c.classList.remove('disabled-card');
        }
      });
      updateRandomActions();
    });
    $grid.appendChild(card);
  });
}

function refreshUnselected() {
  if (!allMovies.length) return;
  const selectedIds = new Set(
    randomPickMovies.filter(m => randomPickSelected.has(m.id)).map(m => m.id)
  );
  const selectedMovies = randomPickMovies.filter(m => selectedIds.has(m.id));
  const needed = 8 - selectedMovies.length;
  const pool = allMovies.filter(m => !selectedIds.has(m.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  randomPickMovies = [...selectedMovies, ...pool.slice(0, needed)];
  renderRandomPick();
  updateRandomActions();
}

function updateRandomActions() {
  const count = randomPickSelected.size;
  document.getElementById('random-sel-count').textContent = `${count}/4 selected`;
  const ready = count === 4;
  document.getElementById('btn-random-save').disabled = !ready;
  document.getElementById('btn-random-load').disabled = !ready;
  document.getElementById('btn-random-refresh-unselected').disabled = count === 0;
}

function bindRandomDiscoveryEvents() {
  document.getElementById('btn-random-refresh').addEventListener('click', pickRandomMovies);
  document.getElementById('btn-random-refresh-unselected').addEventListener('click', refreshUnselected);

  document.getElementById('btn-random-save').addEventListener('click', async () => {
    const name = document.getElementById('random-cat-name').value.trim();
    if (!name || randomPickSelected.size !== 4) return;
    const selectedMovies = randomPickMovies.filter(m => randomPickSelected.has(m.id));
    const btn = document.getElementById('btn-random-save');
    btn.disabled = true;
    await fetch('/admin/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:        name,
        movie_ids:    selectedMovies.map(m => m.id),
        movie_titles: selectedMovies.map(m => m.title),
        source:       'manual',
      }),
    });
    await loadCategoryLibrary();
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; btn.disabled = false; }, 2000);
    document.getElementById('random-cat-name').value = '';
    randomPickSelected = new Set();
    renderRandomPick();
    updateRandomActions();
  });

  document.getElementById('btn-random-load').addEventListener('click', () => {
    const name = document.getElementById('random-cat-name').value.trim();
    const selectedMovies = randomPickMovies.filter(m => randomPickSelected.has(m.id));
    slots[activeSlot].title  = name;
    slots[activeSlot].movies = selectedMovies.map(m => ({ id: m.id, title: m.title, year: m.year || '' }));
    switchToPanel('builder');
    renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  });
}

// ══════════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ══════════════════════════════════════════════════════════════════

function bindSettingsEvents() {
  const btn = document.getElementById('btn-reset-progress-settings');
  if (btn) btn.addEventListener('click', async () => {
    if (!confirm('This will wipe ALL players\' progress and streaks on their next visit. Continue?')) return;
    const res  = await fetch('/admin/reset-progress', { method: 'POST' });
    const data = await res.json();
    if (data.ok) alert(`Done. All players will start fresh (version ${data.progress_version}).`);
  });
}

// ══════════════════════════════════════════════════════════════════
// PUBLISHED TAB
// ══════════════════════════════════════════════════════════════════

function bindPublishedEvents() {
  document.querySelectorAll('.pub-row__summary').forEach(summary => {
    summary.addEventListener('click', async () => {
      const row    = summary.closest('.pub-row');
      const date   = row.dataset.date;
      const detail = document.getElementById(`detail-${date}`);
      const icon   = summary.querySelector('.pub-row__expand');
      const isOpen = detail.classList.contains('open');

      if (isOpen) {
        detail.classList.remove('open');
        icon.textContent = '▶ Expand';
        return;
      }
      detail.classList.add('open');
      icon.textContent = '▼ Collapse';

      if (publishedDetailCache[date]) {
        renderPublishedDetail(detail, publishedDetailCache[date]);
        return;
      }

      detail.innerHTML = '<div style="opacity:0.5;font-size:12px;padding:8px 0;">Loading…</div>';
      const res  = await fetch(`/admin/published-detail/${date}`);
      const data = await res.json();
      publishedDetailCache[date] = data;
      renderPublishedDetail(detail, data);
    });
  });

  document.querySelectorAll('.pub-redate-btn').forEach(btn => {
    btn.addEventListener('click', () => redatePuzzle(btn.dataset.date));
  });
  document.querySelectorAll('.pub-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePuzzle(btn.dataset.date));
  });

}

async function redatePuzzle(oldDate) {
  const newDate = prompt(`Change date for puzzle "${oldDate}" to:`, oldDate);
  if (!newDate || newDate === oldDate) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert('Date must be in YYYY-MM-DD format.');
    return;
  }
  const res  = await fetch(`/admin/puzzles/${oldDate}/redate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_date: newDate }),
  });
  const data = await res.json();
  if (data.ok) {
    location.reload();
  } else {
    alert(`Error: ${data.error}`);
  }
}

function renderPublishedDetail(container, data) {
  container.innerHTML = '';
  data.categories.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'pub-cat-detail';
    div.style.background = COLOR_HEX[cat.color] || '#eee';
    div.style.color      = COLOR_TEXT[cat.color] || '#000';
    div.innerHTML = `<strong>${escHtml(cat.title)}</strong>${cat.movies.map(m => escHtml(m.title)).join(' · ')}`;
    container.appendChild(div);
  });

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;';

  const loadBtn = document.createElement('button');
  loadBtn.className   = 'btn btn--ghost btn--sm';
  loadBtn.textContent = 'Load into Builder';
  loadBtn.addEventListener('click', () => {
    data.categories.forEach((cat, i) => {
      if (i >= slots.length) return;
      slots[i].title  = cat.title;
      slots[i].movies = cat.movies.map(m => ({ id: m.id, title: m.title, year: '' }));
    });
    switchToPanel('builder');
    renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  });
  row.appendChild(loadBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn btn--ghost btn--sm';
  saveBtn.textContent = '★ Save All to Library';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    for (const cat of data.categories) {
      await fetch('/admin/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:        cat.title,
          movie_ids:    cat.movies.map(m => m.id),
          movie_titles: cat.movies.map(m => m.title),
          source:       'manual',
        }),
      });
    }
    await loadCategoryLibrary();
    saveBtn.textContent = '✓ Saved';
  });
  row.appendChild(saveBtn);
  container.appendChild(row);
}

// ══════════════════════════════════════════════════════════════════
// DATASET TOGGLE
// ══════════════════════════════════════════════════════════════════

async function initDataset() {
  const res  = await fetch('/admin/settings');
  const data = await res.json();
  updateDatasetUI(data.active_dataset, data.full_available);
}

function updateDatasetUI(active, fullAvailable) {
  const curBtn  = document.getElementById('btn-dataset-curated');
  const fullBtn = document.getElementById('btn-dataset-full');
  const status  = document.getElementById('dataset-status');

  curBtn.classList.toggle('active', active === 'curated');
  fullBtn.classList.toggle('active', active === 'full');
  if (!fullAvailable) {
    fullBtn.disabled = true;
    fullBtn.title    = 'Run build_full_dataset.py first';
  }
  status.textContent = active === 'full' ? 'Full dataset active' : 'Curated dataset active';
}

function bindDatasetEvents() {
  document.querySelectorAll('.dataset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dataset = btn.dataset.dataset;
      const status  = document.getElementById('dataset-status');
      status.textContent = 'Switching…';
      const res  = await fetch('/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_dataset: dataset }),
      });
      const data = await res.json();
      if (data.error) { status.textContent = `Error: ${data.error}`; return; }
      updateDatasetUI(dataset, true);
      status.textContent = `${data.movie_count} movies loaded`;
      await loadMovies();
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// AI ASSISTANT
// ══════════════════════════════════════════════════════════════════

function bindAIEvents() {
  document.getElementById('btn-ai-workshop').addEventListener('click', onAIWorkshop);

  // Connection-type toggle buttons
  document.getElementById('workshop-toggles').addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (btn) btn.classList.toggle('active');
  });
}

function getExcludeIds() {
  return slots.flatMap(s => s.movies.map(m => m.id));
}

function getActiveConnectionTypes() {
  return [...document.querySelectorAll('#workshop-toggles .toggle-btn.active')]
    .map(b => b.dataset.type);
}


// ── Mode 1: Category Workshop ──────────────────────────────────────

async function onAIWorkshop() {
  const btn      = document.getElementById('btn-ai-workshop');
  const $results = document.getElementById('ai-workshop-results');
  const types    = getActiveConnectionTypes();
  if (!types.length) {
    $results.innerHTML = '<div style="color:#cc2200;font-size:13px;">Select at least one connection type.</div>';
    return;
  }
  btn.disabled       = true;
  $results.innerHTML = '<div class="ai-spinner">✦ Generating category ideas… this may take a moment.</div>';
  try {
    const res  = await fetch('/admin/ai/workshop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_types: types, exclude_ids: getExcludeIds() }),
    });
    const data = await res.json();
    if (data.error) {
      $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Error: ${escHtml(data.error)}</div>`;
      return;
    }
    $results.innerHTML = '';
    const cats = data.categories || [];
    if (!cats.length) {
      $results.innerHTML = '<div style="font-size:13px;opacity:0.5;">No categories returned — try different toggles.</div>';
      return;
    }
    cats.forEach(cat => $results.appendChild(renderWorkshopCard(cat)));
  } catch (e) {
    $results.innerHTML = '<div style="color:#cc2200;font-size:13px;">Request failed.</div>';
  } finally {
    btn.disabled = false;
  }
}

function renderWorkshopCard(cat) {
  const card = document.createElement('div');
  card.className = 'ai-result-card';

  const titleEl = document.createElement('div');
  titleEl.className   = 'ai-result-card__title';
  titleEl.textContent = cat.title;
  card.appendChild(titleEl);

  const moviesEl = document.createElement('div');
  moviesEl.className   = 'ai-result-card__movies';
  moviesEl.textContent = (cat.movie_titles || []).join(' · ');
  card.appendChild(moviesEl);

  if (cat.reasoning) {
    const reasonEl = document.createElement('div');
    reasonEl.className   = 'ai-result-card__reasoning';
    reasonEl.textContent = cat.reasoning;
    card.appendChild(reasonEl);
  }

  const footer = document.createElement('div');
  footer.className = 'ai-result-card__footer';

  // Badges
  const metaRow = document.createElement('div');
  metaRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-right:auto;flex-wrap:wrap;';
  if (cat.connection_type) {
    const typeBadge = document.createElement('span');
    typeBadge.className   = 'ai-conn-type';
    typeBadge.textContent = cat.connection_type;
    metaRow.appendChild(typeBadge);
  }
  if (cat.difficulty) {
    const diffBadge = document.createElement('span');
    diffBadge.className   = 'ai-difficulty';
    diffBadge.textContent = `Diff ${cat.difficulty}`;
    metaRow.appendChild(diffBadge);
  }
  footer.appendChild(metaRow);

  // Load into slot buttons
  slots.forEach((slot, i) => {
    const btn = document.createElement('button');
    btn.className   = 'btn btn--ghost btn--sm';
    btn.textContent = `→ Slot ${i + 1}`;
    btn.style.borderLeft = `3px solid ${COLOR_HEX[slot.color]}`;
    btn.addEventListener('click', () => {
      slot.title  = cat.title;
      slot.movies = (cat.movie_ids || []).map((id, j) => ({
        id, title: cat.movie_titles?.[j] || String(id), year: '',
      }));
      activeSlot = i;
      renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
    });
    footer.appendChild(btn);
  });

  // Save to library
  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn btn--ghost btn--sm';
  saveBtn.textContent = '+ Library';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    await fetch('/admin/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:        cat.title,
        movie_ids:    cat.movie_ids,
        movie_titles: cat.movie_titles,
        source:       'ai',
      }),
    });
    saveBtn.textContent = '✓ Saved';
  });
  footer.appendChild(saveBtn);

  card.appendChild(footer);
  return card;
}



// ══════════════════════════════════════════════════════════════════
// NAV / PANELS
// ══════════════════════════════════════════════════════════════════

function switchToPanel(panelId) {
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.nav-item[data-panel="${panelId}"]`)?.classList.add('active');
  document.getElementById(`panel-${panelId}`)?.classList.add('active');
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.dataset.panel;
      switchToPanel(panelId);
      if ((panelId === 'create' || panelId === 'library') && !categoriesLoaded) {
        categoriesLoaded = true;
        loadCategoryLibrary();
        loadConnections();
      }
      if (panelId === 'trivia-questions' || panelId === 'trivia-builder') {
        loadTriviaData();
      }
      if (panelId === 'trivia-published') {
        loadTriviaPublished();
      }
    });
  });
}

function switchToSubTab(name) {
  document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.sub-tab[data-subtab="${name}"]`)?.classList.add('active');
  document.getElementById(`sub-${name}`)?.classList.add('active');
}

function bindSubTabs() {
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => switchToSubTab(tab.dataset.subtab));
  });
}

// ── Util ───────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════
// TRIVIA ADMIN
// ══════════════════════════════════════════════════════════════════

let triviaQuestions = [];
let triviaLoaded    = false;
let triviaSearch    = '';
let triviaCatFilter = '';
let triviaDiffFilter = '';

function bindTriviaEvents() {
  // Add form toggle
  document.getElementById('btn-trivia-toggle-add').addEventListener('click', () => {
    document.getElementById('trivia-add-form').classList.toggle('open');
  });
  document.getElementById('btn-trivia-cancel-add').addEventListener('click', () => {
    document.getElementById('trivia-add-form').classList.remove('open');
    clearTriviaAddForm();
  });
  document.getElementById('btn-trivia-save-new').addEventListener('click', saveNewTriviaQuestion);

  // Filters
  document.getElementById('trivia-search').addEventListener('input', e => {
    triviaSearch = e.target.value.toLowerCase();
    renderTriviaBank();
  });
  document.getElementById('trivia-cat-filter').addEventListener('change', e => {
    triviaCatFilter = e.target.value;
    renderTriviaBank();
  });

  // (Schedule lazy-load removed — schedule is no longer shown)
}

async function loadTriviaData() {
  if (triviaLoaded) return;
  const res = await fetch('/admin/trivia/questions');
  triviaQuestions = await res.json();
  triviaLoaded = true;
  renderTriviaStats();
  renderTriviaCategoryFilter();
  renderTriviaBank();
  renderTriviaBankForBuilder();
}

function renderTriviaStats() {
  const active = triviaQuestions.filter(q => q.active !== false).length;
  const cats   = new Set(triviaQuestions.map(q => q.category)).size;
  document.getElementById('tstat-total').textContent  = triviaQuestions.length;
  document.getElementById('tstat-active').textContent = active;
  document.getElementById('tstat-cats').textContent   = cats;
}

function renderTriviaTodayPreview() {
  const $box = document.getElementById('trivia-today-preview');
  // Compute today's 3 questions using same deterministic algorithm as server
  const today = new Date().toISOString().slice(0, 10);
  const qs = getDailyTriviaJS(triviaQuestions, today, 3);
  if (!qs.length) { $box.innerHTML = '<div class="loading-state">No active questions.</div>'; return; }
  $box.innerHTML = qs.map((q, i) => `
    <div class="trivia-preview-q">
      <div class="trivia-preview-q__num">${i + 1}</div>
      <div class="trivia-preview-q__body">
        <div class="trivia-preview-q__cat">${escHtml(q.category)}</div>
        <div class="trivia-preview-q__text">${escHtml(q.question)}</div>
        <div class="trivia-preview-q__answer">Answer: <strong>${escHtml(q.answer)}</strong></div>
      </div>
    </div>
  `).join('');
}

async function renderTriviaSchedule() {
  const $body = document.getElementById('trivia-schedule-body');
  $body.innerHTML = '<tr><td colspan="4" style="padding:12px;text-align:center;opacity:0.5;">Loading…</td></tr>';
  const res = await fetch('/admin/trivia/schedule');
  const schedule = await res.json();
  const todayStr = new Date().toISOString().slice(0, 10);
  $body.innerHTML = schedule.map(day => {
    const isToday = day.date === todayStr;
    const label = isToday ? `<strong>${day.date}</strong> <span style="font-size:10px;font-weight:700;color:#7B61FF;background:#F0EDFF;padding:1px 5px;border-radius:10px;margin-left:4px;">TODAY</span>` : day.date;
    const qCells = day.questions.map(q => `
      <div class="sched-q">
        <div class="sched-q__cat">${escHtml(q.category)}</div>
        <div class="sched-q__text" title="${escHtml(q.question)}">${escHtml(truncate(q.question, 45))}</div>
      </div>
    `).join('');
    const tdCells = day.questions.map(q => `<td>${
      '<div class="sched-q"><div class="sched-q__cat">' + escHtml(q.category) + '</div><div class="sched-q__text" title="' + escHtml(q.question) + '">' + escHtml(truncate(q.question, 40)) + '</div></div>'
    }</td>`).join('');
    return `<tr class="${isToday ? 'today-row' : ''}"><td>${label}</td>${tdCells}</tr>`;
  }).join('');
}

function renderTriviaCategoryFilter() {
  const cats = [...new Set(triviaQuestions.map(q => q.category))].sort();
  const $sel = document.getElementById('trivia-cat-filter');
  $sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

function renderTriviaBank() {
  const $list = document.getElementById('trivia-q-list');
  let filtered = triviaQuestions.filter(q => {
    if (triviaSearch && !q.question.toLowerCase().includes(triviaSearch) &&
        !q.answer.toLowerCase().includes(triviaSearch) &&
        !q.category.toLowerCase().includes(triviaSearch)) return false;
    if (triviaCatFilter && q.category !== triviaCatFilter) return false;
    return true;
  });

  document.getElementById('trivia-shown-count').textContent =
    filtered.length === triviaQuestions.length ? `${filtered.length} questions` : `${filtered.length} of ${triviaQuestions.length}`;

  if (!filtered.length) {
    $list.innerHTML = '<div class="loading-state">No questions match your filters.</div>';
    return;
  }

  $list.innerHTML = filtered.map(q => `
    <div class="trivia-q-row ${q.active === false ? 'trivia-q-row--inactive' : ''}" id="trow-${q.id}">
      <div class="trivia-q-row__main" onclick="toggleTriviaEdit(${q.id})">
        <div class="trivia-q-row__id">#${q.id}</div>
        <div class="trivia-q-row__body">
          <div class="trivia-q-row__cat">${escHtml(q.category)}</div>
          <div class="trivia-q-row__q">${escHtml(q.question)}</div>
          <div class="trivia-q-row__a">Answer: <strong>${escHtml(q.answer)}</strong></div>
        </div>
        <div class="trivia-q-row__actions" onclick="event.stopPropagation()">
          <button class="btn btn--sm" style="font-size:11px;padding:3px 8px;"
            onclick="sendTriviaQuestionToBuilder(${q.id})">→ Builder</button>
          <button class="btn btn--ghost btn--sm" style="font-size:11px;"
            onclick="toggleTriviaActive(${q.id}, ${q.active !== false})">${q.active === false ? 'Enable' : 'Disable'}</button>
          <button class="btn btn--ghost btn--sm" style="font-size:11px;color:#cc2200;border-color:#cc2200;"
            onclick="deleteTriviaQuestion(${q.id})">Delete</button>
        </div>
      </div>
      <div class="trivia-q-edit" id="tedit-${q.id}">
        <label>Question</label>
        <textarea id="tedit-q-${q.id}">${escHtml(q.question)}</textarea>
        <label>Answer</label>
        <input type="text" id="tedit-a-${q.id}" value="${escHtml(q.answer)}">
        <div style="margin-top:10px;">
          <label>Category</label>
          <input type="text" id="tedit-cat-${q.id}" value="${escHtml(q.category)}" style="text-transform:uppercase;">
        </div>
        <div class="trivia-q-edit__footer">
          <button class="btn btn--primary btn--sm" onclick="saveTriviaEdit(${q.id})">Save</button>
          <button class="btn btn--ghost btn--sm" onclick="toggleTriviaEdit(${q.id})">Cancel</button>
          <span id="tedit-msg-${q.id}" style="font-size:12px;font-weight:700;"></span>
        </div>
      </div>
    </div>
  `).join('');
}

function diffPips(d) {
  const clamped = Math.min(d, 3);
  return Array.from({length: 3}, (_, i) =>
    `<div class="tdiff-pip ${i < clamped ? 'tdiff-pip--on' : ''}"></div>`
  ).join('');
}

function toggleTriviaEdit(id) {
  const el = document.getElementById(`tedit-${id}`);
  el.classList.toggle('open');
}

function sendTriviaQuestionToBuilder(id) {
  const q = triviaQuestions.find(q => q.id === id);
  if (!q) return;
  assignTriviaSlot(q);
  switchToPanel('trivia-builder');
}

async function saveTriviaEdit(id) {
  const $msg = document.getElementById(`tedit-msg-${id}`);
  const payload = {
    question:   document.getElementById(`tedit-q-${id}`).value.trim(),
    answer:     document.getElementById(`tedit-a-${id}`).value.trim(),
    category:   document.getElementById(`tedit-cat-${id}`).value.trim().toUpperCase(),
  };
  if (!payload.question || !payload.answer) {
    $msg.style.color = '#cc2200';
    $msg.textContent = 'Question and answer are required.';
    return;
  }
  const res  = await fetch(`/admin/trivia/questions/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.ok) {
    const idx = triviaQuestions.findIndex(q => q.id === id);
    if (idx !== -1) Object.assign(triviaQuestions[idx], payload);
    $msg.style.color = '#1a7a1a';
    $msg.textContent = 'Saved!';
    setTimeout(() => { renderTriviaBank(); renderTriviaBankForBuilder(); }, 600);
  } else {
    $msg.style.color = '#cc2200';
    $msg.textContent = data.error || 'Error saving.';
  }
}

async function toggleTriviaActive(id, currentlyActive) {
  const res  = await fetch(`/admin/trivia/questions/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({active: !currentlyActive}) });
  const data = await res.json();
  if (data.ok) {
    const q = triviaQuestions.find(q => q.id === id);
    if (q) q.active = !currentlyActive;
    renderTriviaStats();
    renderTriviaBank();
    renderTriviaBankForBuilder();
  }
}

async function deleteTriviaQuestion(id) {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  const res  = await fetch(`/admin/trivia/questions/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    triviaQuestions = triviaQuestions.filter(q => q.id !== id);
    renderTriviaStats();
    renderTriviaBank();
    renderTriviaBankForBuilder();
  }
}

async function saveNewTriviaQuestion() {
  const $msg = document.getElementById('trivia-add-msg');
  const payload = {
    question:   document.getElementById('tadd-question').value.trim(),
    answer:     document.getElementById('tadd-answer').value.trim(),
    category:   document.getElementById('tadd-category').value.trim().toUpperCase() || 'GENERAL',
  };
  if (!payload.question || !payload.answer) {
    $msg.style.color = '#cc2200';
    $msg.textContent = 'Question and answer are required.';
    return;
  }
  const res  = await fetch('/admin/trivia/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.ok) {
    triviaQuestions.push(data.question);
    $msg.style.color = '#1a7a1a';
    $msg.textContent = 'Question added!';
    clearTriviaAddForm();
    renderTriviaStats();
    renderTriviaCategoryFilter();
    renderTriviaBank();
    renderTriviaBankForBuilder();
    setTimeout(() => { $msg.textContent = ''; }, 2000);
  } else {
    $msg.style.color = '#cc2200';
    $msg.textContent = data.error || 'Error.';
  }
}

function clearTriviaAddForm() {
  ['tadd-question','tadd-answer','tadd-category'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('trivia-add-msg').textContent = '';
}

// Deterministic daily selection — mirrors Python logic
function getDailyTriviaJS(questions, dateStr, count) {
  const active   = questions.filter(q => q.active !== false);
  const SEED_KEY = 'spiker-trivia-v1';

  // Simple deterministic hash (mirrors hashlib.md5 ordering closely enough for display)
  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  const shuffled = [...active].sort((a, b) =>
    simpleHash(SEED_KEY + a.id).localeCompare(simpleHash(SEED_KEY + b.id))
  );
  const epoch      = new Date('2026-01-01T00:00:00');
  const today      = new Date(dateStr + 'T00:00:00');
  const dayOffset  = Math.round((today - epoch) / 86400000);
  const n          = shuffled.length;
  if (!n) return [];
  return Array.from({length: count}, (_, i) => shuffled[(dayOffset * count + i) % n]);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ══════════════════════════════════════════════════════════════════
// TRIVIA PUZZLE BUILDER
// ══════════════════════════════════════════════════════════════════

function renderTriviaBankForBuilder() {
  const $list = document.getElementById('trivia-bank-list');
  if (!$list) return;

  const assignedIds = new Set(triviaBuilderSlots.filter(Boolean).map(q => q.id));
  const q = triviaBankQuery.toLowerCase();

  let filtered = triviaQuestions.filter(qu => qu.active !== false);
  if (q) {
    filtered = filtered.filter(qu =>
      qu.question.toLowerCase().includes(q) ||
      qu.answer.toLowerCase().includes(q) ||
      qu.category.toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    $list.innerHTML = '<div style="padding:14px;text-align:center;opacity:0.5;font-size:13px;">No matches</div>';
    return;
  }

  $list.innerHTML = '';
  filtered.forEach(qu => {
    const row = document.createElement('div');
    row.className = 'trivia-bank-row' + (assignedIds.has(qu.id) ? ' dimmed' : '');
    row.innerHTML = `
      <span class="trivia-bank-row__cat">${escHtml(qu.category)}</span>
      <span class="trivia-bank-row__text">${escHtml(qu.question)}</span>`;
    if (!assignedIds.has(qu.id)) {
      row.addEventListener('click', () => assignTriviaSlot(qu));
    }
    $list.appendChild(row);
  });
}

function assignTriviaSlot(question) {
  // Find first empty slot
  const emptyIdx = triviaBuilderSlots.findIndex(s => s === null);
  if (emptyIdx === -1) {
    // All filled — replace last or show no-op
    return;
  }
  triviaBuilderSlots[emptyIdx] = question;
  renderTriviaBuilderSlots();
  renderTriviaBankForBuilder();
  updateTriviaPubBtn();
}

function removeTriviaSlot(idx) {
  triviaBuilderSlots[idx] = null;
  renderTriviaBuilderSlots();
  renderTriviaBankForBuilder();
  updateTriviaPubBtn();
}

function renderTriviaBuilderSlots() {
  for (let i = 0; i < 3; i++) {
    const slot = triviaBuilderSlots[i];
    const el   = document.getElementById(`trivia-slot-${i}`);
    if (!el) continue;

    if (slot) {
      el.className = 'trivia-slot trivia-slot--filled';
      el.innerHTML = `
        <div class="trivia-slot__num">${i + 1}</div>
        <div class="trivia-slot__body">
          <div class="trivia-slot__cat">${escHtml(slot.category)}</div>
          <div class="trivia-slot__q">${escHtml(slot.question)}</div>
          <div class="trivia-slot__a">Answer: <strong>${escHtml(slot.answer)}</strong></div>
        </div>
        <button class="trivia-slot__remove" data-slot="${i}" title="Remove">×</button>`;
      el.querySelector('.trivia-slot__remove').addEventListener('click', () => removeTriviaSlot(i));
    } else {
      el.className = 'trivia-slot';
      el.innerHTML = `
        <div class="trivia-slot__num">${i + 1}</div>
        <div class="trivia-slot__body">
          <div class="trivia-slot__placeholder">Click a question from the bank →</div>
        </div>`;
    }
  }
}

function updateTriviaPubBtn() {
  const btn = document.getElementById('btn-trivia-publish');
  if (!btn) return;
  const allFilled = triviaBuilderSlots.every(s => s !== null);
  const dateVal   = document.getElementById('trivia-pub-date')?.value;
  btn.disabled = !(allFilled && dateVal);
}

function bindTriviaPuzzleBuilderEvents() {
  const searchEl = document.getElementById('trivia-bank-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      triviaBankQuery = e.target.value;
      renderTriviaBankForBuilder();
    });
  }

  const dateEl = document.getElementById('trivia-pub-date');
  if (dateEl) {
    dateEl.addEventListener('change', updateTriviaPubBtn);
  }

  const pubBtn = document.getElementById('btn-trivia-publish');
  if (pubBtn) {
    pubBtn.addEventListener('click', async () => {
      const dateVal = document.getElementById('trivia-pub-date').value;
      const ids     = triviaBuilderSlots.map(s => s?.id).filter(Boolean);
      if (ids.length !== 3 || !dateVal) return;

      pubBtn.disabled = true;
      const $msg = document.getElementById('trivia-pub-msg');
      $msg.textContent = '';

      try {
        const res  = await fetch('/admin/trivia/puzzles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: dateVal, questions: ids }),
        });
        const data = await res.json();
        if (data.ok) {
          $msg.style.color = '#1a7a1a';
          $msg.textContent = `✓ Published for ${dateVal}!`;
          triviaBuilderSlots = [null, null, null];
          renderTriviaBuilderSlots();
          renderTriviaBankForBuilder();
          // Reset published cache so it reloads
          triviaPublishedLoaded = false;
        } else {
          $msg.style.color = '#cc2200';
          $msg.textContent = data.error || 'Error publishing.';
        }
      } catch {
        $msg.style.color = '#cc2200';
        $msg.textContent = 'Network error.';
      }
      pubBtn.disabled = false;
      updateTriviaPubBtn();
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// TRIVIA PUBLISHED PUZZLES
// ══════════════════════════════════════════════════════════════════

async function loadTriviaPublished() {
  if (triviaPublishedLoaded) return;
  const $list = document.getElementById('trivia-published-list');
  if (!$list) return;
  $list.innerHTML = '<div class="loading-state">Loading…</div>';
  try {
    const res     = await fetch('/admin/trivia/puzzles');
    const puzzles = await res.json();
    triviaPublishedLoaded = true;
    renderTriviaPublished(puzzles);
  } catch {
    $list.innerHTML = '<div class="loading-state">Failed to load.</div>';
  }
}

function renderTriviaPublished(puzzles) {
  const $list = document.getElementById('trivia-published-list');
  if (!$list) return;
  if (!puzzles.length) {
    $list.innerHTML = '<p style="opacity:0.5;font-size:13px;">No trivia puzzles published yet.</p>';
    return;
  }
  $list.innerHTML = '';
  puzzles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'trivia-pub-row';
    row.dataset.date = p.date;

    const cats = (p.questions || []).map(q =>
      `<span class="trivia-pub-cat-badge">${escHtml(q.category)}</span>`
    ).join('');

    row.innerHTML = `
      <div class="trivia-pub-row__summary">
        <div class="trivia-pub-row__date">${escHtml(p.date)}</div>
        <div class="trivia-pub-row__cats">${cats}</div>
        <a href="/trivia/${escHtml(p.date)}" target="_blank"
           class="btn btn--ghost btn--sm" style="font-size:11px;" onclick="event.stopPropagation()">Play ↗</a>
        <button class="btn btn--ghost btn--sm trivia-pub-del-btn" data-date="${escHtml(p.date)}"
                style="font-size:11px;color:#cc2200;border-color:#cc2200;" onclick="event.stopPropagation()">Delete</button>
        <span class="trivia-pub-row__expand">▶ Expand</span>
      </div>
      <div class="trivia-pub-row__detail" id="trivia-pub-detail-${escHtml(p.date)}"></div>`;

    // Expand/collapse
    row.querySelector('.trivia-pub-row__summary').addEventListener('click', () => {
      const detail  = row.querySelector('.trivia-pub-row__detail');
      const icon    = row.querySelector('.trivia-pub-row__expand');
      const isOpen  = detail.classList.contains('open');
      if (isOpen) {
        detail.classList.remove('open');
        icon.textContent = '▶ Expand';
      } else {
        detail.classList.add('open');
        icon.textContent = '▼ Collapse';
        if (!detail.dataset.loaded) {
          detail.dataset.loaded = '1';
          renderTriviaPuzzleDetail(detail, p.questions || []);
        }
      }
    });

    // Delete
    row.querySelector('.trivia-pub-del-btn').addEventListener('click', async () => {
      if (!confirm(`Delete trivia puzzle for ${p.date}? This cannot be undone.`)) return;
      const res = await fetch(`/admin/trivia/puzzles/${p.date}`, { method: 'DELETE' });
      if (res.ok) {
        row.remove();
        triviaPublishedLoaded = false;
      } else {
        alert('Delete failed.');
      }
    });

    $list.appendChild(row);
  });
}

function renderTriviaPuzzleDetail(container, questions) {
  container.innerHTML = '';
  questions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'trivia-pub-q';
    div.innerHTML = `
      <div class="trivia-pub-q__cat">${escHtml(q.category)}</div>
      <div class="trivia-pub-q__text">${escHtml(q.question)}</div>
      <div class="trivia-pub-q__answer">Answer: <strong>${escHtml(q.answer)}</strong></div>`;
    container.appendChild(div);
  });
}

function bindTriviaPublishedEvents() {
  const refreshBtn = document.getElementById('btn-trivia-pub-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      triviaPublishedLoaded = false;
      loadTriviaPublished();
    });
  }
}

// ── Start ──────────────────────────────────────────────────────────
init();
