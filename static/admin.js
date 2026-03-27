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
let allMovies      = [];
let builderQuery   = '';   // legacy — kept for category search compatibility
let activeSlot     = 0;
let currentDraftId = null;

// ── Builder Library State ──────────────────────────────────────────
let builderLibQuery    = '';
let builderLibSource   = 'all';   // 'all' | 'manual' | 'ai' | 'submission'
let builderLibHideUsed = true;
let builderLibSort     = 'az';
let _draggingCatId     = null;
let editingCatId       = null;   // id of card in edit mode, or null
let _editDraft         = null;   // shallow copy of cat being edited; movie_ids/titles mutated live

// ── Published Calendar State ───────────────────────────────────────
let pubCalYear        = new Date().getFullYear();
let pubCalMonth       = new Date().getMonth();
let pubExpandedDate   = null;
let pubPuzzleDates    = {};   // { "2025-03-15": { num: 42, future: false } }
let pubCalInitialized = false;

const slots = COLOR_ORDER.map((color, i) => ({
  color, difficulty: i + 1, title: '', movies: [],
}));

// ── Categories Tab State ───────────────────────────────────────────
let catBrowseSelected    = [];   // [{id, title, year}] — max 4
let savedCategories      = [];
let catLibraryQuery      = '';
let catLibraryHideUsed   = true;
let catLibrarySort       = 'az';
let catLibraryFilterDiff = null;   // null = all; 1–4 = specific tier
let catLibraryFilterType = '';     // '' = all; string = connection_type value

// ── Tier Filter State ──────────────────────────────────────────────
let randomTiers = [1];   // tiers included in random generator pool
let aiTiers     = [1];   // tiers included in AI feature pool

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
let triviaSlotEditing    = [false, false, false];

// ── Trivia Published State ─────────────────────────────────────────
let triviaPublishedLoaded = false;

// ── Trivia Question Bank State ─────────────────────────────────────
let triviaUsedIds        = new Set();  // question IDs used in published puzzles
let triviaQBankHideUsed  = true;

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
  bindAIEvents();
  bindCategoriesEvents();
  _bindModalEvents();
  bindCatSearchEvents();
  bindSubTabs();
  bindRandomDiscoveryEvents();
  bindPublishedEvents();
  bindSettingsEvents();
  bindTriviaEvents();
  bindTriviaPuzzleBuilderEvents();
  bindTriviaPublishedEvents();
  await loadSettings();
  await loadMovies();
  pickRandomMovies();
  renderSlots();
  renderPreview();
  // Eagerly load category library so builder left pane is ready
  loadCategoryLibrary();
}

function switchToGame(game) {
  activeGame = game;
  const navMarquee = document.getElementById('nav-marquee');
  const navTrivia  = document.getElementById('nav-trivia');
  const pillMarquee = document.getElementById('pill-marquee');
  const pillTrivia  = document.getElementById('pill-trivia');
  if (game === 'marquee') {
    navMarquee.style.display = '';
    navTrivia.style.display  = 'none';
    pillMarquee.classList.remove('game-pill--inactive');
    pillTrivia.classList.add('game-pill--inactive');
    switchToPanel('builder');
  } else {
    navMarquee.style.display = 'none';
    navTrivia.style.display  = '';
    pillTrivia.classList.remove('game-pill--inactive');
    pillMarquee.classList.add('game-pill--inactive');
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
    div.className = `cat-slot cat-slot--${slot.color}` + (isActive ? ' active-target' : '');
    div.dataset.slotIndex = si;

    const movieChips = slot.movies.map((m, mi) => `
      <div class="cat-movie-chip">
        ${escHtml(m.title)}
        <button class="cat-movie-chip__remove" data-slot="${si}" data-movie="${mi}" title="Remove">×</button>
      </div>`).join('');

    const moviesContent = slot.movies.length === 0
      ? '<span class="cat-slot__placeholder-empty">Drag a category here</span>'
      : movieChips + (slot.movies.length < 4
          ? `<span style="font-size:12px;opacity:0.4;align-self:center;">${slot.movies.length}/4</span>`
          : '');

    div.innerHTML = `
      <div class="cat-slot__header" data-slot="${si}">
        <span class="slot-drag-handle" draggable="true" data-slot="${si}" title="Drag to reorder">⠿</span>
        <div class="cat-dot" style="background:${COLOR_HEX[slot.color]};border:2.5px solid #333;"></div>
        <input class="cat-slot__title" type="text" maxlength="80"
               placeholder="Category name…" value="${escHtml(slot.title)}" data-slot="${si}">
        <span class="cat-difficulty">${DIFF_LABELS[si]}</span>
        <div class="cat-slot__actions">
          <button class="slot-clear-btn" data-slot="${si}"
                  ${!slot.title && slot.movies.length === 0 ? 'disabled' : ''}
                  title="Clear slot">✕</button>
        </div>
      </div>
      <div class="cat-slot__movies">${moviesContent}</div>`;

    // Click header → activate slot
    div.querySelector('.cat-slot__header').addEventListener('click', e => {
      if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      activeSlot = si;
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
    });
  });

  // Remove chips
  $area.querySelectorAll('.cat-movie-chip__remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      slots[+e.target.dataset.slot].movies.splice(+e.target.dataset.movie, 1);
      renderSlots(); renderBuilderLibrary(); renderPreview();
    });
  });

  // Clear slot
  $area.querySelectorAll('.slot-clear-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const si = +e.target.dataset.slot;
      slots[si].title  = '';
      slots[si].movies = [];
      renderSlots(); renderBuilderLibrary(); renderPreview();
    });
  });

  // Bind library→slot drag-and-drop and init SortableJS slot reorder
  bindBuilderDragAndDrop();
  initSortableSlots();
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

/* ── Builder Library Pane ── */
function renderBuilderLibrary() {
  const $list = document.getElementById('builder-lib-list');
  if (!$list) return;

  const usedTitles = new Set(slots.filter(s => s.title).map(s => s.title));
  const q = builderLibQuery.toLowerCase();

  let filtered = savedCategories;
  if (q) filtered = filtered.filter(c =>
    c.title.toLowerCase().includes(q) ||
    (c.movie_titles || []).some(t => t.toLowerCase().includes(q))
  );
  if (builderLibSource !== 'all') filtered = filtered.filter(c => (c.source || 'manual') === builderLibSource);
  if (builderLibHideUsed) filtered = filtered.filter(c => !usedTitles.has(c.title));

  if (builderLibSort === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title));
  else if (builderLibSort === 'recent') filtered.sort((a, b) => (b.id > a.id ? 1 : -1));
  else if (builderLibSort === 'used') filtered.sort((a, b) => (b.times_used || 0) - (a.times_used || 0));

  const countEl = document.getElementById('builder-lib-count');
  if (countEl) countEl.textContent = `${filtered.length}`;
  $list.innerHTML = '';

  if (!filtered.length) {
    $list.innerHTML = savedCategories.length
      ? '<div class="loading-state">No categories match.</div>'
      : '<div class="loading-state">No categories yet. Create some in the Category Library.</div>';
    bindBuilderDragAndDrop();
    return;
  }

  filtered.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'blib-card';
    div.draggable = true;
    div.dataset.catId = cat.id;
    if (usedTitles.has(cat.title)) div.classList.add('used');
    div.innerHTML = `
      <div class="blib-card__title">${escHtml(cat.title)}</div>
      <div class="blib-card__movies">${(cat.movie_titles || []).slice(0, 4).map(t => escHtml(t)).join(' · ')}</div>
      <div class="blib-card__footer">
        <span class="source-badge source-badge--${cat.source || 'manual'}">${cat.source || 'manual'}</span>
      </div>`;
    div.addEventListener('dragstart', e => {
      _draggingCatId = cat.id;
      div.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    div.addEventListener('dragend', () => {
      _draggingCatId = null;
      div.classList.remove('dragging');
    });
    div.addEventListener('click', () => assignCategoryToActiveSlot(cat));
    $list.appendChild(div);
  });

  bindBuilderDragAndDrop();
}

function assignCategoryToActiveSlot(cat) {
  loadCategoryIntoSlot(cat, activeSlot);
  // Auto-advance activeSlot to next empty slot
  const next = slots.findIndex((s, i) => i > activeSlot && !s.title && s.movies.length === 0);
  if (next !== -1) activeSlot = next;
}

function bindBuilderDragAndDrop() {
  document.querySelectorAll('.cat-slot').forEach(el => {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (_draggingCatId === null) return;
      const cat = savedCategories.find(c => c.id === _draggingCatId);
      if (!cat) return;
      const slotIdx = parseInt(el.dataset.slotIndex);
      loadCategoryIntoSlot(cat, slotIdx);
    });
  });
}

function initSortableSlots() {
  if (window._slotSortable) window._slotSortable.destroy();
  window._slotSortable = Sortable.create(
    document.getElementById('categories-area'),
    {
      handle: '.slot-drag-handle',
      animation: 150,
      onEnd(evt) {
        const { oldIndex, newIndex } = evt;
        if (oldIndex === newIndex) return;
        [slots[oldIndex].title,  slots[newIndex].title]  =
          [slots[newIndex].title,  slots[oldIndex].title];
        [slots[oldIndex].movies, slots[newIndex].movies] =
          [slots[newIndex].movies, slots[oldIndex].movies];
        if      (activeSlot === oldIndex) activeSlot = newIndex;
        else if (activeSlot === newIndex) activeSlot = oldIndex;
        renderSlots(); renderBuilderLibrary(); renderPreview();
      }
    }
  );
}

function loadCategoryIntoSlot(cat, slotIdx) {
  slots[slotIdx].title  = cat.title;
  slots[slotIdx].movies = (cat.movie_ids || []).map((id, j) => ({
    id, title: cat.movie_titles?.[j] || String(id), year: '',
  }));
  renderSlots(); renderBuilderLibrary(); renderPreview();
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
  const allMovieEntries = slots.flatMap(s => s.movies.map(m => ({ id: m.id, title: m.title })));
  const seen = new Set(), dups = new Map();
  allMovieEntries.forEach(({ id, title }) => {
    if (seen.has(id)) dups.set(id, title);
    seen.add(id);
  });
  if (dups.size) {
    errors.push(`Duplicate movies: ${[...dups.values()].join(', ')}`);
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
  renderSlots(); renderBuilderLibrary(); renderPreview();
  const $msg = document.getElementById('publish-msg');
  $msg.textContent = `Loaded: ${draft.name}`; $msg.className = 'publish-msg ok';
}

function onClearBuilder() {
  if (!confirm('Clear all category slots?')) return;
  currentDraftId = null;
  slots.forEach(s => { s.title = ''; s.movies = []; });
  document.getElementById('pub-note').value = '';
  activeSlot = 0;
  renderSlots(); renderBuilderLibrary(); renderPreview();
  clearValidation();
  document.getElementById('publish-msg').textContent = '';
}

/* ── Builder events ── */
function bindBuilderEvents() {
  document.getElementById('btn-publish').addEventListener('click', onPublish);
  document.getElementById('btn-save-draft').addEventListener('click', onSaveDraft);
  document.getElementById('btn-load-draft').addEventListener('click', onLoadDraft);
  document.getElementById('btn-clear-builder').addEventListener('click', onClearBuilder);

  // Library pane: search
  document.getElementById('builder-lib-search').addEventListener('input', e => {
    builderLibQuery = e.target.value;
    renderBuilderLibrary();
  });

  // Library pane: source filter pills
  document.querySelectorAll('.source-pill[data-source]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.source-pill[data-source]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      builderLibSource = pill.dataset.source;
      renderBuilderLibrary();
    });
  });

  // Library pane: hide-used toggle
  const hideUsedBtn = document.getElementById('builder-lib-hide-used-btn');
  hideUsedBtn.addEventListener('click', function() {
    builderLibHideUsed        = !builderLibHideUsed;
    this.textContent          = builderLibHideUsed ? 'Show All' : 'Hide Used';
    this.style.background     = builderLibHideUsed ? '#2a2a2a' : '';
    this.style.color          = builderLibHideUsed ? '#fff' : '';
    renderBuilderLibrary();
  });

  // Library pane: sort select
  document.getElementById('builder-lib-sort').addEventListener('change', e => {
    builderLibSort = e.target.value;
    renderBuilderLibrary();
  });
}

// ══════════════════════════════════════════════════════════════════
// CATEGORIES TAB
// ══════════════════════════════════════════════════════════════════

async function loadCategoryLibrary() {
  const res   = await fetch('/admin/categories');
  savedCategories = await res.json();
  renderCategoryLibrary();
  renderBuilderLibrary();
}

/* ── Connections Index ── */
async function loadConnections() {
  document.getElementById('conn-list').innerHTML = '<div class="conn-empty">Loading…</div>';
  const res  = await fetch('/admin/connections');
  connectionsData = await res.json();
  renderConnectionsIndex();
}

function renderConnectionsIndex() {
  if (connectionsType === 'keywords') { renderKeywordsBrowser(connectionsQuery); return; }
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
    const isTier1    = (m.tier ?? 1) === 1;
    const row        = document.createElement('div');
    row.className    = 'conn-movie-row' + (inUse ? ' in-use' : '') + (isTier1 ? ' conn-movie-row--tier1' : '');
    row.innerHTML    = `
      <input type="checkbox" data-id="${m.id}" ${alreadySel ? 'checked' : ''} ${inUse ? 'disabled' : ''}>
      <span class="conn-movie-title" style="flex:1;">${escHtml(m.title)}</span>
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
  document.getElementById('btn-save-to-lib').disabled = !(n === 4 && name);
}

async function onSaveToLibrary() {
  const title = document.getElementById('cat-lib-name').value.trim();
  if (!title || catBrowseSelected.length !== 4) return;

  const res  = await fetch('/admin/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      movie_ids:       catBrowseSelected.map(m => m.id),
      movie_titles:    catBrowseSelected.map(m => m.title),
      source:          'manual',
      connection_type: (document.getElementById('browse-conn-type')?.value || '').trim(),
    }),
  });
  const data = await res.json();
  if (data.ok) {
    savedCategories.unshift(data.category);
    renderCategoryLibrary();
    catBrowseSelected = [];
    document.getElementById('cat-lib-name').value = '';
    const ctEl = document.getElementById('browse-conn-type');
    if (ctEl) ctEl.value = '';
    updateBrowseActions();
    renderConnectionMovies();
    const btn = document.getElementById('btn-save-to-lib');
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; }, 2000);
  }
}


/* ── Library list ── */
function renderCategoryLibrary() {
  const $list = document.getElementById('category-library-list');
  const q     = catLibraryQuery.toLowerCase();

  // Filter
  let shown = q ? savedCategories.filter(c => c.title.toLowerCase().includes(q)) : [...savedCategories];
  if (catLibraryHideUsed)       shown = shown.filter(c => !c.times_used || c.times_used === 0);
  if (catLibraryFilterDiff !== null) shown = shown.filter(c => c.difficulty === catLibraryFilterDiff);
  if (catLibraryFilterType)     shown = shown.filter(c => (c.connection_type || '') === catLibraryFilterType);

  // Sort
  if (catLibrarySort === 'recent') {
    shown.sort((a, b) => (b.created_at || '') > (a.created_at || '') ? 1 : -1);
  } else if (catLibrarySort === 'used') {
    shown.sort((a, b) => (b.times_used || 0) - (a.times_used || 0));
  } else if (catLibrarySort === 'least') {
    shown.sort((a, b) => (a.times_used || 0) - (b.times_used || 0));
  } else if (catLibrarySort === 'diff') {
    shown.sort((a, b) => (a.difficulty || 5) - (b.difficulty || 5));
  } else {
    shown.sort((a, b) => a.title.localeCompare(b.title));
  }

  document.getElementById('lib-count').textContent = `${shown.length} saved`;

  // Refresh connection type filter options
  const $typeFilter = document.getElementById('lib-filter-type');
  if ($typeFilter) {
    const typeSet = new Set(savedCategories.map(c => c.connection_type).filter(Boolean));
    const currentVal = $typeFilter.value;
    $typeFilter.innerHTML = '<option value="">All types</option>' +
      [...typeSet].sort().map(t =>
        `<option value="${escHtml(t)}"${t === currentVal ? ' selected' : ''}>${escHtml(t)}</option>`
      ).join('');
  }

  $list.innerHTML = '';

  if (!shown.length) {
    $list.innerHTML = '<p style="opacity:0.5;font-size:13px;">No categories match the current filters.</p>';
    return;
  }

  shown.forEach(cat => {
    const div = document.createElement('div');

    // ── View mode ──
    const diffIdx   = (cat.difficulty || 0) - 1;
    const diffColor = diffIdx >= 0 ? COLOR_ORDER[diffIdx] : null;
    div.className = 'cat-library-card';
    div.innerHTML = `
      <div class="cat-card__header">
        <div class="cat-library-card__title">${escHtml(cat.title)}</div>
        ${diffColor ? `<span class="diff-badge diff-badge--${diffColor}">
          <span class="pick-dot" style="background:${COLOR_HEX[diffColor]};border:1px solid rgba(0,0,0,.15);"></span>
          ${DIFF_LABELS[diffIdx]}
        </span>` : ''}
      </div>
      ${cat.connection_type ? `<div class="cat-connection-tag">${escHtml(cat.connection_type)}</div>` : ''}
      <div class="cat-library-card__movies">${(cat.movie_titles||[]).map(t=>escHtml(t)).join(' · ')}</div>
      <div class="cat-card__footer">
        <div class="cat-card__meta">
          <span class="source-badge source-badge--${cat.source||'manual'}">${cat.source||'manual'}</span>
          ${cat.times_used > 0 ? `<span class="cat-used-count">used ${cat.times_used}×</span>` : ''}
        </div>
        <div class="cat-card__actions">
          <button class="send-to-builder-btn" data-cat="${cat.id}" aria-label="Send to Builder">→ Builder</button>
          <button class="cat-edit-btn" data-cat="${cat.id}" aria-label="Edit category">Edit</button>
        </div>
      </div>`;

    // Send to builder — next empty slot
    div.querySelector('.send-to-builder-btn').addEventListener('click', e => {
      e.stopPropagation();
      const c        = savedCategories.find(c => c.id === cat.id);
      if (!c) return;
      const emptyIdx = slots.findIndex(s => !s.title && s.movies.length === 0);
      if (emptyIdx === -1) {
        const btn  = e.currentTarget;
        const orig = btn.textContent;
        btn.textContent = 'No empty slots';
        btn.disabled    = true;
        btn.style.color = '#cc2200';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; btn.style.color = ''; }, 1800);
        return;
      }
      loadCategoryIntoSlot(c, emptyIdx);
      // Advance activeSlot to next empty after the one we just filled
      const next = slots.findIndex((s, i) => i > emptyIdx && !s.title && s.movies.length === 0);
      activeSlot = next !== -1 ? next : emptyIdx;
      switchToPanel('builder');
    });

    // Edit — opens the modal
    div.querySelector('.cat-edit-btn').addEventListener('click', e => {
      e.stopPropagation();
      openCatEditModal(cat);
    });

    $list.appendChild(div);
  });
}

async function suggestAndApplyDifficulty($btn, title, movieTitles, onResult) {
  const orig = $btn.textContent;
  $btn.textContent = '…';
  $btn.disabled    = true;
  try {
    const res  = await fetch('/admin/ai/suggest-difficulty', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, movie_titles: movieTitles }),
    });
    const data = await res.json();
    if (data.difficulty) {
      onResult(data.difficulty);
      $btn.textContent = '✓';
      setTimeout(() => { $btn.textContent = orig; $btn.disabled = false; }, 1200);
    } else {
      $btn.textContent = '—';
      setTimeout(() => { $btn.textContent = orig; $btn.disabled = false; }, 1500);
    }
  } catch {
    $btn.textContent = '—';
    setTimeout(() => { $btn.textContent = orig; $btn.disabled = false; }, 1500);
  }
}

// ── Edit Category Modal ────────────────────────────────────────────

function openCatEditModal(cat) {
  editingCatId = cat.id;
  _editDraft = { ...cat, movie_ids: [...cat.movie_ids], movie_titles: [...(cat.movie_titles||[])] };

  // Title
  document.getElementById('modal-cat-title').value = _editDraft.title;

  // Connection type (select — try to match existing value, else leave blank)
  const ctypeEl = document.getElementById('modal-cat-ctype');
  ctypeEl.value = _editDraft.connection_type || '';
  // If value not in select options, add it temporarily
  if (_editDraft.connection_type && !ctypeEl.value) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = _editDraft.connection_type;
    opt.dataset.custom = '1';
    ctypeEl.insertBefore(opt, ctypeEl.options[1]);
    ctypeEl.value = _editDraft.connection_type;
  }

  // Source toggle
  document.querySelectorAll('#modal-cat-source .source-toggle__btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === (_editDraft.source || 'manual'));
  });

  // Difficulty pills
  _renderModalDiffPills();

  // Movie chips + search
  _renderModalChips();

  document.getElementById('cat-edit-modal-overlay').style.display = 'flex';
  document.getElementById('modal-cat-title').focus();
}

function closeCatEditModal() {
  editingCatId = null;
  _editDraft   = null;
  document.getElementById('cat-edit-modal-overlay').style.display = 'none';
  // Remove any custom options added temporarily
  document.querySelectorAll('#modal-cat-ctype option[data-custom]').forEach(o => o.remove());
}

function _renderModalDiffPills() {
  const $diff  = document.getElementById('modal-cat-diff');
  const diffVal = _editDraft.difficulty || null;
  $diff.innerHTML = COLOR_ORDER.map((c, i) => `
    <button class="diff-pill diff-pill--${c}${diffVal === i + 1 ? ' selected' : ''}" data-diff="${i + 1}"
            aria-label="${DIFF_LABELS[i]}" title="${DIFF_LABELS[i]}">
      <span class="pick-dot" style="background:${COLOR_HEX[c]};border:1.5px solid rgba(0,0,0,.2);"></span>
      ${DIFF_LABELS[i]}
    </button>`).join('') +
    '<button class="diff-suggest-btn" id="modal-diff-suggest" aria-label="AI-suggest difficulty">Suggest</button>';

  $diff.querySelectorAll('.diff-pill').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      $diff.querySelectorAll('.diff-pill').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _editDraft.difficulty = +btn.dataset.diff;
    });
  });

  document.getElementById('modal-diff-suggest').addEventListener('click', async e => {
    e.stopPropagation();
    const title = document.getElementById('modal-cat-title').value.trim() || _editDraft.title;
    if (!title || _editDraft.movie_titles.length < 4) return;
    await suggestAndApplyDifficulty(
      document.getElementById('modal-diff-suggest'),
      title,
      _editDraft.movie_titles,
      diff => {
        _editDraft.difficulty = diff;
        $diff.querySelectorAll('.diff-pill').forEach(b =>
          b.classList.toggle('selected', +b.dataset.diff === diff)
        );
      }
    );
  });
}

function _renderModalChips() {
  const $chips = document.getElementById('modal-cat-chips');
  $chips.innerHTML = _editDraft.movie_titles.map((t, mi) => `
    <span class="cat-edit-chip">
      <span>${escHtml(t)}</span>
      <button class="cat-edit-chip__remove" data-mi="${mi}" aria-label="Remove ${escHtml(t)}">×</button>
    </span>`).join('');
  $chips.querySelectorAll('.cat-edit-chip__remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const mi = +btn.dataset.mi;
      _editDraft.movie_ids.splice(mi, 1);
      _editDraft.movie_titles.splice(mi, 1);
      _renderModalChips();
      _renderModalMovieSearch();
    });
  });
  _renderModalMovieSearch();
}

function _renderModalMovieSearch() {
  const wrap = document.getElementById('modal-movie-search-wrap');
  const $msearch  = document.getElementById('modal-cat-msearch');
  const $mresults = document.getElementById('modal-cat-mresults');
  if (!wrap) return;
  wrap.style.display = _editDraft.movie_ids.length < 4 ? 'block' : 'none';
  if ($msearch) {
    // Re-attach input listener (clone to remove old listeners)
    const fresh = $msearch.cloneNode(true);
    $msearch.replaceWith(fresh);
    fresh.value = '';
    fresh.addEventListener('input', () => {
      const q2 = fresh.value.toLowerCase().trim();
      if (!q2) { $mresults.style.display = 'none'; return; }
      const usedIds = new Set(_editDraft.movie_ids);
      const matches = allMovies.filter(m =>
        !usedIds.has(m.id) && m.title.toLowerCase().includes(q2)
      ).slice(0, 8);
      if (!matches.length) { $mresults.style.display = 'none'; return; }
      $mresults.innerHTML = matches.map(m =>
        `<div class="cat-movie-search-item" data-id="${m.id}" data-title="${escHtml(m.title)}">${escHtml(m.title)} <span style="opacity:.4;font-size:11px;">${m.year||''}</span></div>`
      ).join('');
      $mresults.style.display = 'block';
      $mresults.querySelectorAll('.cat-movie-search-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          _editDraft.movie_ids.push(item.dataset.id);
          _editDraft.movie_titles.push(item.dataset.title);
          _renderModalChips();
        });
      });
    });
    fresh.addEventListener('blur', () => setTimeout(() => { $mresults.style.display = 'none'; }, 150));
  }
}

function _bindModalEvents() {
  const overlay = document.getElementById('cat-edit-modal-overlay');
  if (!overlay) return; // modal HTML not present (cache mismatch) — safe no-op

  // Close on overlay click (outside modal)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCatEditModal(); });

  // Cancel
  document.getElementById('modal-cat-cancel').addEventListener('click', () => closeCatEditModal());

  // Source toggle
  document.querySelectorAll('#modal-cat-source .source-toggle__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-cat-source .source-toggle__btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (_editDraft) _editDraft.source = btn.dataset.val;
    });
  });

  // Save
  document.getElementById('modal-cat-save').addEventListener('click', async () => {
    if (!_editDraft) return;
    const titleEl   = document.getElementById('modal-cat-title');
    const ctypeEl   = document.getElementById('modal-cat-ctype');
    const activeBtn = document.querySelector('#modal-cat-source .source-toggle__btn.active');
    const payload   = {
      title:           (titleEl?.value || _editDraft.title).trim(),
      movie_ids:       _editDraft.movie_ids,
      movie_titles:    _editDraft.movie_titles,
      source:          activeBtn?.dataset.val || _editDraft.source || 'manual',
      connection_type: (ctypeEl?.value || '').trim(),
      difficulty:      _editDraft.difficulty || null,
    };
    if (!payload.title || payload.movie_ids.length !== 4) return;
    const saveBtn = document.getElementById('modal-cat-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const res  = await fetch(`/admin/categories/${editingCatId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    saveBtn.disabled = false; saveBtn.textContent = 'Save';
    if (data.ok) {
      const idx = savedCategories.findIndex(c => c.id === editingCatId);
      if (idx !== -1) savedCategories[idx] = data.category;
      closeCatEditModal();
      renderCategoryLibrary();
    }
  });

  // Delete
  document.getElementById('modal-cat-delete').addEventListener('click', async () => {
    if (!_editDraft) return;
    if (!confirm('Delete this category?')) return;
    await fetch(`/admin/categories/${editingCatId}`, { method: 'DELETE' });
    savedCategories = savedCategories.filter(c => c.id !== editingCatId);
    closeCatEditModal();
    renderCategoryLibrary();
  });
}

function bindCategoriesEvents() {
  document.querySelectorAll('[data-conntype]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-conntype]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      connectionsType  = btn.dataset.conntype;
      connectionsQuery = '';
      const $connSearch = document.getElementById('conn-search');
      $connSearch.value = '';
      $connSearch.placeholder = connectionsType === 'keywords' ? 'Filter keywords…' : 'Filter…';
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

  // Sort select
  document.getElementById('lib-sort').addEventListener('change', e => {
    catLibrarySort = e.target.value;
    renderCategoryLibrary();
  });

  // Difficulty filter pills
  document.querySelectorAll('.lib-diff-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.lib-diff-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      catLibraryFilterDiff = pill.dataset.diff ? +pill.dataset.diff : null;
      renderCategoryLibrary();
    });
  });

  // Connection type filter
  document.getElementById('lib-filter-type').addEventListener('change', e => {
    catLibraryFilterType = e.target.value;
    renderCategoryLibrary();
  });
}

async function deletePuzzle(puzzleDate) {
  if (!confirm(`Delete puzzle for ${puzzleDate}? This cannot be undone.`)) return;
  const res = await fetch(`/admin/puzzles/${puzzleDate}`, { method: 'DELETE' });
  if (res.ok) {
    delete pubPuzzleDates[puzzleDate];
    delete publishedDetailCache[puzzleDate];
    if (pubExpandedDate === puzzleDate) {
      pubExpandedDate = null;
      const $detail = document.getElementById('pub-detail-area');
      if ($detail) $detail.innerHTML = '';
    }
    renderPublishedCalendar();
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
// SLOT PICKERS (shared across Browse, Search, Random panels)
// ══════════════════════════════════════════════════════════════════


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
    const isTier1    = (m.tier ?? 1) === 1;
    const row = document.createElement('div');
    row.className = 'conn-movie-row' + (alreadySel ? ' in-use' : '') + (isTier1 ? ' conn-movie-row--tier1' : '');
    row.innerHTML = `
      <input type="checkbox" data-id="${m.id}" ${alreadySel ? 'checked disabled' : ''}>
      <span class="conn-movie-title" style="flex:1;">${escHtml(m.title)}</span>
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
  document.getElementById('btn-cat-search-save').disabled = count !== 4;
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
        title:           name,
        movie_ids:       catSearchSelected.map(m => m.id),
        movie_titles:    catSearchSelected.map(m => m.title),
        source:          'manual',
        connection_type: (document.getElementById('search-conn-type')?.value || '').trim(),
      }),
    });
    await loadCategoryLibrary();
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; btn.disabled = false; }, 2000);
    catSearchSelected = [];
    document.getElementById('cat-search-name').value = '';
    const ctEl = document.getElementById('search-conn-type');
    if (ctEl) ctEl.value = '';
    document.getElementById('cat-movie-search').value = '';
    renderCatMovieSearch('');
    renderCatSearchSelected();
    updateCatSearchActions();
  });

}

// ══════════════════════════════════════════════════════════════════
// RANDOM DISCOVERY
// ══════════════════════════════════════════════════════════════════

let randomPickMovies  = [];   // current 8 movies shown
let randomPickSelected = new Set();  // selected movie ids

function pickRandomMovies() {
  if (!allMovies.length) return;
  const pool = allMovies.filter(m => randomTiers.includes(m.tier ?? 1));
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
  const pool = allMovies.filter(m => randomTiers.includes(m.tier ?? 1) && !selectedIds.has(m.id));
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
        title:           name,
        movie_ids:       selectedMovies.map(m => m.id),
        movie_titles:    selectedMovies.map(m => m.title),
        source:          'manual',
        connection_type: (document.getElementById('random-conn-type')?.value || '').trim(),
      }),
    });
    await loadCategoryLibrary();
    btn.textContent = '✓ Saved!';
    setTimeout(() => { btn.textContent = '★ Save'; btn.disabled = false; }, 2000);
    document.getElementById('random-cat-name').value = '';
    const rcEl = document.getElementById('random-conn-type');
    if (rcEl) rcEl.value = '';
    randomPickSelected = new Set();
    renderRandomPick();
    updateRandomActions();
  });

}

// ══════════════════════════════════════════════════════════════════
// KEYWORDS BROWSER
// ══════════════════════════════════════════════════════════════════


function getKeywordMap() {
  const map = {};
  allMovies.forEach(m => {
    if (!m.tier && m.tier !== undefined) return; // skip non-tier-1 when tier present
    if (m.tier !== undefined && m.tier !== 1) return;
    const kws = Array.isArray(m.keywords) ? m.keywords : [];
    kws.forEach(kw => {
      if (!map[kw]) map[kw] = [];
      map[kw].push(m);
    });
  });
  return map;
}

function renderKeywordsBrowser(query) {
  const $list = document.getElementById('conn-list');
  if (!$list) return;
  const map = getKeywordMap();
  // filter to ≥4 movies, sort by count descending
  let keywords = Object.keys(map)
    .filter(k => map[k].length >= 4)
    .sort((a, b) => map[b].length - map[a].length);
  if (query && query.trim()) {
    const q = query.toLowerCase();
    keywords = keywords.filter(k => k.toLowerCase().includes(q));
  }
  if (!keywords.length) {
    $list.innerHTML = '<div class="conn-empty">No keywords found</div>';
    return;
  }
  $list.innerHTML = '';
  keywords.forEach(kw => {
    const isActive = selectedConnection && selectedConnection.type === 'keywords' && selectedConnection.name === kw;
    const row = document.createElement('div');
    row.className = 'conn-item' + (isActive ? ' active' : '');
    row.innerHTML = `<span class="conn-item__name">${escHtml(kw)}</span>
      <span class="conn-item__count enough">${map[kw].length}</span>`;
    row.addEventListener('click', () => onConnectionClick({ type: 'keywords', name: kw, movies: map[kw] }));
    $list.appendChild(row);
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

  document.querySelectorAll('.random-tier-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      randomTiers = Array.from(document.querySelectorAll('.random-tier-cb:checked')).map(c => +c.value);
      if (!randomTiers.length) { randomTiers = [1]; applyTierFilterUI(); }
      pickRandomMovies();
      saveTierFilters();
    });
  });

  document.querySelectorAll('.ai-tier-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      aiTiers = Array.from(document.querySelectorAll('.ai-tier-cb:checked')).map(c => +c.value);
      if (!aiTiers.length) { aiTiers = [1]; applyTierFilterUI(); }
      saveTierFilters();
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// PUBLISHED TAB
// ══════════════════════════════════════════════════════════════════

function bindPublishedEvents() {
  // Calendar is initialized on first nav to 'published' panel (see bindNav)
  // Nothing to bind here at page load for the old row-based UI
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
    renderSlots(); renderBuilderLibrary(); renderPreview();
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
// SETTINGS / TIER FILTERS
// ══════════════════════════════════════════════════════════════════

async function loadSettings() {
  const res  = await fetch('/admin/settings');
  const data = await res.json();
  randomTiers = data.random_tiers || [1];
  aiTiers     = data.ai_tiers     || [1];
  applyTierFilterUI();
}

function applyTierFilterUI() {
  document.querySelectorAll('.random-tier-cb').forEach(cb => {
    cb.checked = randomTiers.includes(+cb.value);
  });
  document.querySelectorAll('.ai-tier-cb').forEach(cb => {
    cb.checked = aiTiers.includes(+cb.value);
  });
}

async function saveTierFilters() {
  const status = document.getElementById('tier-filter-status');
  if (status) status.textContent = 'Saving…';
  const res  = await fetch('/admin/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ random_tiers: randomTiers, ai_tiers: aiTiers }),
  });
  const data = await res.json();
  if (status) status.textContent = data.ok ? 'Saved.' : 'Error saving.';
  setTimeout(() => { if (status) status.textContent = ''; }, 2000);
}

// ══════════════════════════════════════════════════════════════════
// AI ASSISTANT
// ══════════════════════════════════════════════════════════════════

// ── Movie Suggest state ───────────────────────────────────────────
let suggestPicks    = [];   // all picks returned by AI [{id,title,year,directors,reasoning,strength}]
let suggestSelected = new Set(); // ids user has clicked

function bindAIEvents() {
  document.getElementById('btn-ai-suggest').addEventListener('click', onAISuggest);
  document.getElementById('suggest-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter') onAISuggest();
  });

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


// ── Mode 2: Movie Suggest ─────────────────────────────────────────

async function onAISuggest() {
  const prompt   = document.getElementById('suggest-prompt').value.trim();
  const $results = document.getElementById('suggest-results');
  const btn      = document.getElementById('btn-ai-suggest');
  if (!prompt) return;

  suggestPicks    = [];
  suggestSelected = new Set();
  btn.disabled    = true;
  $results.innerHTML = '<div class="ai-spinner">✦ Searching movies… this may take a moment.</div>';

  try {
    const res  = await fetch('/admin/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, exclude_ids: getExcludeIds(), ai_tiers: aiTiers }),
    });
    const data = await res.json();
    if (data.error) {
      $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Error: ${escHtml(data.error)}</div>`;
      return;
    }
    suggestPicks = data.picks || [];
    if (!suggestPicks.length) {
      $results.innerHTML = '<div style="font-size:13px;opacity:0.5;">No matches found — try a different description.</div>';
      return;
    }
    renderSuggestResults();
  } catch (e) {
    $results.innerHTML = '<div style="color:#cc2200;font-size:13px;">Request failed.</div>';
  } finally {
    btn.disabled = false;
  }
}

function renderSuggestResults() {
  const $results = document.getElementById('suggest-results');
  $results.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'suggest-picks';
  suggestPicks.forEach(pick => list.appendChild(renderSuggestCard(pick)));
  $results.appendChild(list);

  // Footer: count + action buttons
  const footer = document.createElement('div');
  footer.className = 'suggest-footer';
  footer.id = 'suggest-footer';
  renderSuggestFooter(footer);
  $results.appendChild(footer);
}

function renderSuggestCard(pick) {
  const card = document.createElement('div');
  card.className = `suggest-card${pick.strength === 'strong' ? ' strong' : ''}`;
  if (suggestSelected.has(pick.id)) card.classList.add('selected');
  card.dataset.id = pick.id;

  // Header row
  const hd = document.createElement('div');
  hd.className = 'suggest-card__hd';

  const title = document.createElement('div');
  title.className   = 'suggest-card__title';
  title.textContent = pick.title;
  hd.appendChild(title);

  const year = document.createElement('div');
  year.className   = 'suggest-card__year';
  year.textContent = pick.year;
  hd.appendChild(year);

  const badge = document.createElement('span');
  badge.className   = `strength-badge strength-badge--${pick.strength === 'strong' ? 'strong' : 'good'}`;
  badge.textContent = pick.strength === 'strong' ? '★ Strong' : 'Good';
  hd.appendChild(badge);

  card.appendChild(hd);

  // Directors
  if (pick.directors && pick.directors.length) {
    const dir = document.createElement('div');
    dir.className   = 'suggest-card__dir';
    dir.textContent = 'Dir. ' + pick.directors.join(', ');
    card.appendChild(dir);
  }

  // Reasoning
  if (pick.reasoning) {
    const reason = document.createElement('div');
    reason.className   = 'suggest-card__reasoning';
    reason.textContent = pick.reasoning;
    card.appendChild(reason);
  }

  // Toggle selection on click
  card.addEventListener('click', () => {
    if (suggestSelected.has(pick.id)) {
      suggestSelected.delete(pick.id);
      card.classList.remove('selected');
    } else {
      if (suggestSelected.size >= 4) return;
      suggestSelected.add(pick.id);
      card.classList.add('selected');
    }
    const footer = document.getElementById('suggest-footer');
    if (footer) renderSuggestFooter(footer);
  });

  return card;
}

function renderSuggestFooter(footer) {
  footer.innerHTML = '';
  const n = suggestSelected.size;

  const count = document.createElement('span');
  count.className   = 'suggest-count';
  count.textContent = n === 0 ? 'Click movies to select (pick 4)'
                    : n < 4  ? `${n}/4 selected — pick ${4 - n} more`
                    :          '4 selected ✓';
  footer.appendChild(count);

  if (n === 4) {
    // Save to library
    const saveBtn = document.createElement('button');
    saveBtn.className   = 'btn btn--ghost btn--sm';
    saveBtn.textContent = '+ Library';
    saveBtn.addEventListener('click', async () => {
      const prompt    = document.getElementById('suggest-prompt').value.trim();
      const selected  = suggestPicks.filter(p => suggestSelected.has(p.id));
      const movieIds  = selected.map(p => p.id);
      const titles    = selected.map(p => p.title);
      saveBtn.disabled = true;
      await fetch('/admin/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: prompt, movie_ids: movieIds, movie_titles: titles, source: 'ai' }),
      });
      saveBtn.textContent = '✓ Saved';
      loadCategoryLibrary();
    });
    footer.appendChild(saveBtn);
  }
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
      body: JSON.stringify({ connection_types: types, exclude_ids: getExcludeIds(), ai_tiers: aiTiers }),
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
      if (panelId === 'builder') {
        renderBuilderLibrary();
      }
      if (panelId === 'published') {
        initPublishedCalendar();
      }
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
    tab.addEventListener('click', () => {
      switchToSubTab(tab.dataset.subtab);
    });
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
  const [qRes, pRes] = await Promise.all([
    fetch('/admin/trivia/questions'),
    fetch('/admin/trivia/puzzles'),
  ]);
  triviaQuestions = await qRes.json();
  const published = await pRes.json();
  triviaUsedIds = new Set(published.flatMap(p => (p.questions || []).map(q => q.id)));
  triviaLoaded = true;
  renderTriviaStats();
  renderTriviaCategoryFilter();
  renderTriviaBank();
  renderTriviaBankForBuilder();
  bindTriviaHideUsedToggle();
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

function bindTriviaHideUsedToggle() {
  const btn = document.getElementById('btn-trivia-hide-used');
  if (!btn) return;
  // Reflect initial state
  btn.textContent      = triviaQBankHideUsed ? 'Show All' : 'Hide Used';
  btn.style.background = triviaQBankHideUsed ? '#2a2a2a' : '';
  btn.style.color      = triviaQBankHideUsed ? '#fff' : '';
  btn.addEventListener('click', function() {
    triviaQBankHideUsed       = !triviaQBankHideUsed;
    this.textContent          = triviaQBankHideUsed ? 'Show All' : 'Hide Used';
    this.style.background     = triviaQBankHideUsed ? '#2a2a2a' : '';
    this.style.color          = triviaQBankHideUsed ? '#fff' : '';
    renderTriviaBank();
  });
}

function renderTriviaBank() {
  const $list = document.getElementById('trivia-q-list');
  let filtered = triviaQuestions.filter(q => {
    if (triviaQBankHideUsed && triviaUsedIds.has(q.id)) return false;
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
  triviaSlotEditing[idx] = false;
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
      if (triviaSlotEditing[i]) {
        el.className = 'trivia-slot trivia-slot--filled trivia-slot--editing';
        el.innerHTML = `
          <div class="trivia-slot__num">${i + 1}</div>
          <div class="trivia-slot__edit-form">
            <label class="tslot-label">Category</label>
            <input class="tslot-input" id="tslot-cat-${i}" value="${escHtml(slot.category)}" style="text-transform:uppercase;">
            <label class="tslot-label">Question</label>
            <textarea class="tslot-textarea" id="tslot-q-${i}">${escHtml(slot.question)}</textarea>
            <label class="tslot-label">Answer</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input class="tslot-input" id="tslot-a-${i}" value="${escHtml(slot.answer)}" style="flex:1;">
              <button class="btn btn--ghost btn--sm tslot-preview-btn" data-slot="${i}" style="font-size:11px;white-space:nowrap;">Accepted Answers</button>
            </div>
            <div class="tslot-edit-footer">
              <button class="btn btn--primary btn--sm tslot-save-btn" data-slot="${i}">Save</button>
              <button class="btn btn--ghost btn--sm tslot-cancel-btn" data-slot="${i}">Cancel</button>
            </div>
          </div>`;
        el.querySelector('.tslot-save-btn').addEventListener('click', () => saveSlotEdit(i));
        el.querySelector('.tslot-cancel-btn').addEventListener('click', () => { triviaSlotEditing[i] = false; renderTriviaBuilderSlots(); });
        el.querySelector('.tslot-preview-btn').addEventListener('click', () => {
          const ans = document.getElementById(`tslot-a-${i}`).value.trim() || slot.answer;
          showAcceptedAnswers(ans);
        });
      } else {
        el.className = 'trivia-slot trivia-slot--filled';
        el.innerHTML = `
          <div class="trivia-slot__num">${i + 1}</div>
          <div class="trivia-slot__body">
            <div class="trivia-slot__cat">${escHtml(slot.category)}</div>
            <div class="trivia-slot__q">${escHtml(slot.question)}</div>
            <div class="trivia-slot__a">
              Answer: <strong>${escHtml(slot.answer)}</strong>
              <button class="btn btn--ghost btn--sm tslot-preview-btn" data-slot="${i}" style="font-size:10px;padding:1px 7px;margin-left:6px;">Accepted Answers</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button class="trivia-slot__edit-btn" data-slot="${i}" title="Edit">✎</button>
            <button class="trivia-slot__remove" data-slot="${i}" title="Remove">×</button>
          </div>`;
        el.querySelector('.trivia-slot__remove').addEventListener('click', () => removeTriviaSlot(i));
        el.querySelector('.trivia-slot__edit-btn').addEventListener('click', () => { triviaSlotEditing[i] = true; renderTriviaBuilderSlots(); });
        el.querySelector('.tslot-preview-btn').addEventListener('click', () => showAcceptedAnswers(slot.answer));
      }
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
          triviaSlotEditing  = [false, false, false];
          renderTriviaBuilderSlots();
          // Update used IDs immediately with the newly published questions
          ids.forEach(id => triviaUsedIds.add(id));
          renderTriviaBankForBuilder();
          renderTriviaBank();
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
  const todayStr = new Date().toISOString().slice(0, 10);
  puzzles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'trivia-pub-row';
    row.dataset.date = p.date;

    const isUpcoming = p.date > todayStr;
    const cats = (p.questions || []).map(q =>
      `<span class="trivia-pub-cat-badge">${escHtml(q.category)}</span>`
    ).join('');
    const scheduledBadge = isUpcoming
      ? `<span style="font-size:10px;font-weight:700;color:#7B61FF;background:#F0EDFF;padding:2px 6px;border-radius:20px;flex-shrink:0;">SCHEDULED</span>`
      : '';
    const editBtn = isUpcoming
      ? `<button class="btn btn--ghost btn--sm trivia-pub-edit-btn" data-date="${escHtml(p.date)}"
               style="font-size:11px;" onclick="event.stopPropagation()">Edit</button>`
      : '';

    row.innerHTML = `
      <div class="trivia-pub-row__summary">
        <div class="trivia-pub-row__date">${escHtml(p.date)}</div>
        ${scheduledBadge}
        <div class="trivia-pub-row__cats">${cats}</div>
        <a href="/trivia/${escHtml(p.date)}" target="_blank"
           class="btn btn--ghost btn--sm" style="font-size:11px;" onclick="event.stopPropagation()">Play ↗</a>
        ${editBtn}
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

    // Edit (upcoming only)
    const editBtnEl = row.querySelector('.trivia-pub-edit-btn');
    if (editBtnEl) {
      editBtnEl.addEventListener('click', () => {
        editTriviaPublishedPuzzle(p.date, p.questions || []);
      });
    }

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

// ── Slot inline edit ───────────────────────────────────────────────
async function saveSlotEdit(i) {
  const cat = document.getElementById(`tslot-cat-${i}`)?.value.trim().toUpperCase();
  const q   = document.getElementById(`tslot-q-${i}`)?.value.trim();
  const a   = document.getElementById(`tslot-a-${i}`)?.value.trim();
  if (!q || !a) return;
  const slot = triviaBuilderSlots[i];
  if (!slot) return;

  const saveBtn = document.querySelector(`.tslot-save-btn[data-slot="${i}"]`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const payload = { category: cat || slot.category, question: q, answer: a };

  try {
    const res  = await fetch(`/admin/trivia/questions/${slot.id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');
  } catch (err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    alert(`Could not save: ${err.message}`);
    return;
  }

  // Update in-memory state — slot and triviaQuestions[idx] may share the same reference,
  // but we update both explicitly so they're always in sync regardless.
  Object.assign(slot, payload);
  const tqIdx = triviaQuestions.findIndex(tq => tq.id === slot.id);
  if (tqIdx !== -1) Object.assign(triviaQuestions[tqIdx], payload);

  triviaSlotEditing[i] = false;
  renderTriviaBuilderSlots();
  renderTriviaBank();
}

// ── Fuzzy match helpers (mirrors trivia.js) ────────────────────────
function _adminLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
function _adminNorm(s) {
  return s.toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function _adminSim(a, b) {
  if (!a || !b) return 0;
  return 1 - _adminLevenshtein(a, b) / Math.max(a.length, b.length);
}
function _adminFuzzy(userAnswer, correctAnswer) {
  const ua = _adminNorm(userAnswer);
  if (!ua || ua.length < 1) return false;
  const ca = _adminNorm(correctAnswer);
  if (ua === ca) return true;
  if (ua.length >= 3 && ca.includes(ua)) return true;
  if (ca.length >= 3 && ua.includes(ca)) return true;
  if (_adminSim(ua, ca) >= 0.72) return true;
  const parts = correctAnswer.replace(/\([^)]*\)/g, '')
    .split(/\s+(?:and|or|&)\s+|[,\/]/).map(p => _adminNorm(p)).filter(p => p.length >= 2);
  if (parts.length > 1) {
    for (const part of parts) {
      if (part.length >= 3 && ua.includes(part)) return true;
      if (part.length >= 3 && part.includes(ua) && ua.length >= 3) return true;
      if (_adminSim(ua, part) >= 0.72) return true;
    }
  }
  const keyWords = ca.split(' ').filter(w => w.length >= 4);
  if (keyWords.length >= 2) {
    const hits = keyWords.filter(w => ua.includes(w)).length;
    if (hits / keyWords.length >= 0.6) return true;
  }
  return false;
}

// ── Accepted Answers popup ─────────────────────────────────────────
function showAcceptedAnswers(correctAnswer) {
  // Build derived variants the fuzzy matcher will definitely accept
  const norm = _adminNorm(correctAnswer);

  // Parts split by "and / or / & / , / /"
  const rawParts = correctAnswer.replace(/\([^)]*\)/g, '')
    .split(/\s+(?:and|or|&)\s+|[,\/]/).map(p => p.trim()).filter(Boolean);

  // Strip parentheticals
  const noParens = correctAnswer.replace(/\([^)]*\)/g, '').trim();

  const variantSet = new Set();
  variantSet.add(correctAnswer.trim());
  if (noParens && noParens !== correctAnswer.trim()) variantSet.add(noParens);
  if (norm)       variantSet.add(norm);
  rawParts.forEach(p => { if (p) variantSet.add(p); });

  const variants = [...variantSet].filter(v => v.length >= 1);

  // Build or reuse popup
  let modal = document.getElementById('accepted-answers-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'accepted-answers-modal';
    modal.className = 'accepted-modal-overlay';
    modal.innerHTML = `
      <div class="accepted-modal">
        <div class="accepted-modal__hd">
          <span class="accepted-modal__title">Accepted Answers</span>
          <button class="accepted-modal__close" id="accepted-modal-close">×</button>
        </div>
        <div class="accepted-modal__answer" id="accepted-modal-answer"></div>
        <div class="accepted-modal__section-label">Always accepted</div>
        <div id="accepted-modal-variants"></div>
        <div class="accepted-modal__section-label" style="margin-top:14px;">Test an answer</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="accepted-modal__test-input" id="accepted-modal-test" placeholder="Type to test…" autocomplete="off">
          <span class="accepted-modal__verdict" id="accepted-modal-verdict"></span>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('accepted-modal-close').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  }

  document.getElementById('accepted-modal-answer').textContent = `Correct answer: "${correctAnswer}"`;
  document.getElementById('accepted-modal-variants').innerHTML = variants.map(v =>
    `<div class="accepted-variant"><span class="accepted-variant__check">✓</span>${escHtml(v)}</div>`
  ).join('');

  const testInput = document.getElementById('accepted-modal-test');
  const verdict   = document.getElementById('accepted-modal-verdict');
  testInput.value = '';
  verdict.textContent = '';
  testInput.oninput = () => {
    const val = testInput.value.trim();
    if (!val) { verdict.textContent = ''; return; }
    const ok = _adminFuzzy(val, correctAnswer);
    verdict.textContent  = ok ? '✓ Accepted' : '✗ Rejected';
    verdict.style.color  = ok ? '#1a7a1a' : '#cc2200';
  };

  modal.style.display = 'flex';
  setTimeout(() => testInput.focus(), 50);
}

// ── Edit upcoming trivia puzzle ────────────────────────────────────
async function editTriviaPublishedPuzzle(date, questions) {
  // Ensure trivia data is loaded so we can find full question objects
  if (!triviaLoaded) await loadTriviaData();

  // Clear builder slots and fill with the published questions
  triviaBuilderSlots = [null, null, null];
  questions.forEach((q, i) => {
    if (i >= 3) return;
    const full = triviaQuestions.find(tq => tq.id === q.id) || q;
    triviaBuilderSlots[i] = full;
  });

  // Pre-fill date
  const dateEl = document.getElementById('trivia-pub-date');
  if (dateEl) dateEl.value = date;

  renderTriviaBuilderSlots();
  renderTriviaBankForBuilder();
  updateTriviaPubBtn();
  switchToPanel('trivia-builder');
}

// ── Edit upcoming marquee puzzle ───────────────────────────────────
async function editUpcomingMarqueePuzzle(date) {
  const res  = await fetch(`/admin/published-detail/${date}`);
  const data = await res.json();
  if (data.error) { alert('Could not load puzzle.'); return; }

  // Load into builder slots
  data.categories.forEach((cat, i) => {
    if (i >= slots.length) return;
    slots[i].title  = cat.title;
    slots[i].movies = cat.movies.map(m => ({ id: m.id, title: m.title, year: '' }));
  });

  // Pre-fill publish date
  const dateEl = document.getElementById('pub-date');
  if (dateEl) dateEl.value = date;

  switchToPanel('builder');
  renderSlots(); renderBuilderLibrary(); renderPreview();
}

// ══════════════════════════════════════════════════════════════════
// PUBLISHED CALENDAR
// ══════════════════════════════════════════════════════════════════

function initPublishedCalendar() {
  if (pubCalInitialized) {
    renderPublishedCalendar();
    return;
  }

  // Read data from hidden data-source divs
  pubPuzzleDates = {};
  document.querySelectorAll('#pub-data-source [data-date]').forEach(el => {
    const d = el.dataset.date;
    pubPuzzleDates[d] = {
      num:    parseInt(el.dataset.num, 10),
      future: el.dataset.future === 'true',
    };
  });

  // Detect gaps and show warning
  const gaps = detectPublishedGaps();
  if (gaps.length) {
    const $warning = document.getElementById('pub-gap-warning');
    const $text    = document.getElementById('pub-gap-text');
    if ($warning && $text) {
      $text.textContent = `${gaps.length} gap${gaps.length > 1 ? 's' : ''} detected: ${gaps.slice(0, 3).join(', ')}${gaps.length > 3 ? ` +${gaps.length - 3} more` : ''}`;
      $warning.style.display = '';
    }
  }

  // Default month: most recent published date (non-future)
  const publishedDates = Object.keys(pubPuzzleDates)
    .filter(d => !pubPuzzleDates[d].future)
    .sort();
  if (publishedDates.length) {
    const latest = publishedDates[publishedDates.length - 1];
    const d = new Date(latest + 'T00:00:00');
    pubCalYear  = d.getFullYear();
    pubCalMonth = d.getMonth();
  }

  // Bind prev/next buttons
  document.getElementById('btn-pub-prev-month')?.addEventListener('click', () => {
    pubCalMonth--;
    if (pubCalMonth < 0) { pubCalMonth = 11; pubCalYear--; }
    renderPublishedCalendar();
  });
  document.getElementById('btn-pub-next-month')?.addEventListener('click', () => {
    pubCalMonth++;
    if (pubCalMonth > 11) { pubCalMonth = 0; pubCalYear++; }
    renderPublishedCalendar();
  });

  pubCalInitialized = true;
  renderPublishedCalendar();
}

function renderPublishedCalendar() {
  const $cal = document.getElementById('pub-calendar');
  if (!$cal) return;

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const labelEl = document.getElementById('pub-cal-month-label');
  if (labelEl) labelEl.textContent = `${MONTHS[pubCalMonth]} ${pubCalYear}`;

  $cal.innerHTML = '';

  // Day-of-week headers
  DAYS.forEach(d => {
    const hd = document.createElement('div');
    hd.className = 'pub-cal__dow';
    hd.textContent = d;
    $cal.appendChild(hd);
  });

  const todayStr     = new Date().toISOString().slice(0, 10);
  const firstDay     = new Date(pubCalYear, pubCalMonth, 1);
  const startPad     = firstDay.getDay();   // 0=Sun
  const daysInMonth  = new Date(pubCalYear, pubCalMonth + 1, 0).getDate();

  // Padding cells
  for (let i = 0; i < startPad; i++) {
    const cell = document.createElement('div');
    cell.className = 'pub-cal__day pub-cal__day--empty-month';
    $cal.appendChild(cell);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const mm  = String(pubCalMonth + 1).padStart(2, '0');
    const dd  = String(day).padStart(2, '0');
    const dateStr = `${pubCalYear}-${mm}-${dd}`;
    const info    = pubPuzzleDates[dateStr];
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === pubExpandedDate;

    const cell = document.createElement('div');
    cell.className = 'pub-cal__day';

    if (info) {
      if (info.future) {
        cell.classList.add('pub-cal__day--scheduled');
      } else {
        cell.classList.add('pub-cal__day--published');
      }
      if (isSelected) cell.classList.add('selected');
      if (isToday) cell.classList.add('pub-cal__day--today');

      cell.innerHTML = `<div class="pub-cal__day-num">${day}</div>`;

      // Puzzle number badge
      const badge = document.createElement('div');
      badge.className = 'pub-cal__num-badge';
      badge.textContent = `#${info.num}`;
      cell.appendChild(badge);

      // Colored dots
      const dots = document.createElement('div');
      dots.className = 'pub-cal__dots';
      COLOR_ORDER.forEach(color => {
        const dot = document.createElement('div');
        dot.className = 'pub-cal__dot';
        dot.style.background = COLOR_HEX[color];
        dots.appendChild(dot);
      });
      cell.appendChild(dots);

      cell.addEventListener('click', () => {
        // Deselect if already expanded
        if (pubExpandedDate === dateStr) {
          pubExpandedDate = null;
          renderPublishedCalendar();
          const $detail = document.getElementById('pub-detail-area');
          if ($detail) $detail.innerHTML = '';
        } else {
          pubExpandedDate = dateStr;
          renderPublishedCalendar();
          renderExpandedPubDetail(dateStr);
        }
      });
    } else {
      // Check if it's a gap day (past date, no puzzle)
      if (dateStr < todayStr && Object.keys(pubPuzzleDates).length > 0) {
        // Only mark as gap if there are puzzles before and after
        const allDates = Object.keys(pubPuzzleDates).sort();
        const earliest = allDates[0];
        if (dateStr >= earliest) {
          cell.classList.add('pub-cal__day--gap');
        } else {
          cell.classList.add('pub-cal__day--empty');
        }
      } else {
        cell.classList.add('pub-cal__day--empty');
      }
      if (isToday) cell.classList.add('pub-cal__day--today');
      cell.innerHTML = `<div class="pub-cal__day-num">${day}</div>`;
    }

    $cal.appendChild(cell);
  }

  // Remove any old empty-state message
  const oldMsg = document.getElementById('pub-cal-empty-msg');
  if (oldMsg) oldMsg.remove();

  if (!Object.keys(pubPuzzleDates).length) {
    const msg = document.createElement('p');
    msg.id = 'pub-cal-empty-msg';
    msg.style.cssText = 'font-size:13px;opacity:0.45;text-align:center;margin-top:18px;';
    msg.textContent = 'No published puzzles yet. Use the Puzzle Builder to publish your first.';
    document.getElementById('pub-calendar').after(msg);
  }
}

async function renderExpandedPubDetail(date) {
  const $area = document.getElementById('pub-detail-area');
  if (!$area) return;

  $area.innerHTML = '<div class="loading-state">Loading…</div>';

  let data = publishedDetailCache[date];
  if (!data) {
    const res = await fetch(`/admin/published-detail/${date}`);
    data = await res.json();
    publishedDetailCache[date] = data;
  }

  const card = document.createElement('div');
  card.className = 'pub-detail-card';

  const info = pubPuzzleDates[date];
  card.innerHTML = `<div class="pub-detail-card__date">${date}${info ? ` — Puzzle #${info.num}` : ''}</div>`;

  // Category detail blocks
  renderPublishedDetail(card, data);

  // Action buttons row
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;';

  if (info?.future) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn--ghost btn--sm';
    editBtn.textContent = 'Edit in Builder';
    editBtn.addEventListener('click', () => editUpcomingMarqueePuzzle(date));
    actions.appendChild(editBtn);
  }

  const playLink = document.createElement('a');
  playLink.className = 'btn btn--ghost btn--sm';
  playLink.textContent = 'Play ↗';
  playLink.href = `/marquee/${date}`;
  playLink.target = '_blank';
  actions.appendChild(playLink);

  const redateBtn = document.createElement('button');
  redateBtn.className = 'btn btn--ghost btn--sm';
  redateBtn.textContent = 'Change Date';
  redateBtn.addEventListener('click', () => redatePuzzle(date));
  actions.appendChild(redateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn--ghost btn--sm';
  deleteBtn.style.cssText = 'color:#cc2200;border-color:#cc2200;';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => deletePuzzle(date));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  $area.innerHTML = '';
  $area.appendChild(card);
}

function detectPublishedGaps() {
  const dates    = Object.keys(pubPuzzleDates).sort();
  if (!dates.length) return [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const start    = dates[0];
  const end      = todayStr < dates[dates.length - 1] ? todayStr : dates[dates.length - 1];
  const set      = new Set(dates);
  const gaps     = [];

  let cur = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cur <= endDate) {
    const ds = cur.toISOString().slice(0, 10);
    if (!set.has(ds)) gaps.push(ds);
    cur.setDate(cur.getDate() + 1);
  }
  return gaps;
}

// ── Start ──────────────────────────────────────────────────────────
init();
