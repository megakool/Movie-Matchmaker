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
let catBrowseSelected = [];   // [{id, title, year}] — max 4
let savedCategories   = [];
let catLibraryQuery   = '';

// ── Connections State ──────────────────────────────────────────────
let connectionsData      = [];   // raw from /admin/connections
let connectionsType      = 'director';
let connectionsQuery     = '';
let selectedConnection   = null; // {name, type, movies:[]}
let connectionsLoaded    = false;

// ── Published Tab State ────────────────────────────────────────────
const publishedDetailCache = {};

// ── Tab Load Flags ─────────────────────────────────────────────────
let submissionsLoaded = false;
let categoriesLoaded  = false;
let aiLoaded          = false;

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
async function init() {
  document.getElementById('pub-date').value = new Date().toISOString().slice(0, 10);
  bindTabs();
  bindBuilderEvents();
  bindDatasetEvents();
  bindAIEvents();
  bindCategoriesEvents();
  bindSubTabs();
  bindRandomDiscoveryEvents();
  bindSubmissionsEvents();
  bindPublishedEvents();
  await initDataset();
  await loadMovies();
  pickRandomMovies();
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
  switchToTab('builder');
  renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
}

/* ── Library list ── */
function renderCategoryLibrary() {
  const $list = document.getElementById('category-library-list');
  const q     = catLibraryQuery.toLowerCase();
  const shown = q
    ? savedCategories.filter(c => c.title.toLowerCase().includes(q))
    : savedCategories;

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
      if (cat) { loadCategoryIntoSlot(cat, activeSlot); switchToTab('builder'); }
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

function updateRandomActions() {
  const count = randomPickSelected.size;
  document.getElementById('random-sel-count').textContent = `${count}/4 selected`;
  const ready = count === 4;
  document.getElementById('btn-random-save').disabled = !ready;
  document.getElementById('btn-random-load').disabled = !ready;
}

function bindRandomDiscoveryEvents() {
  document.getElementById('btn-random-refresh').addEventListener('click', pickRandomMovies);

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
    switchToTab('builder');
    renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  });
}

// ══════════════════════════════════════════════════════════════════
// SUBMISSIONS TAB
// ══════════════════════════════════════════════════════════════════

async function loadSubmissions() {
  const $wrap = document.getElementById('subs-table-wrap');
  $wrap.innerHTML = '<div style="opacity:0.5;font-size:13px;">Loading…</div>';
  const res  = await fetch('/admin/submissions');
  const subs = await res.json();

  if (!subs.length) {
    $wrap.innerHTML = '<p style="opacity:0.5;font-size:13px;">No submissions yet.</p>';
    return;
  }

  const sorted = [
    ...subs.filter(s => s.status === 'pending'),
    ...subs.filter(s => s.status !== 'pending'),
  ];

  const table = document.createElement('table');
  table.className = 'sub-table';
  table.innerHTML = `<thead><tr>
    <th>Date</th><th>Category</th><th>Movies</th><th>Status</th><th>Actions</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  sorted.forEach(sub => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;font-size:12px;">${sub.submitted_at.slice(0, 10)}</td>
      <td><strong>${escHtml(sub.category_name)}</strong></td>
      <td style="font-size:12px;">${(sub.movie_titles || []).map(t => escHtml(t)).join('<br>')}</td>
      <td><span class="sub-badge sub-badge--${sub.status}">${sub.status}</span></td>
      <td>
        <div class="sub-actions" id="sub-actions-${sub.id}">
          ${sub.status === 'pending' ? `
            <button class="btn btn--sm"        data-sub="${sub.id}" data-action="use">Use</button>
            <button class="btn btn--ghost btn--sm" data-sub="${sub.id}" data-action="save-lib">★ Library</button>
            <button class="btn btn--ghost btn--sm" data-sub="${sub.id}" data-action="dismiss">Dismiss</button>
          ` : ''}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  $wrap.innerHTML = '';
  $wrap.appendChild(table);

  $wrap.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.sub;
      const action = btn.dataset.action;
      const sub    = subs.find(s => s.id === id);
      btn.disabled = true;

      if (action === 'save-lib') {
        if (!sub) return;
        const res2 = await fetch('/admin/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title:        sub.category_name,
            movie_ids:    sub.movie_ids,
            movie_titles: sub.movie_titles || [],
            source:       'submission',
          }),
        });
        if (res2.ok) {
          const data2 = await res2.json();
          savedCategories.unshift(data2.category);
          btn.textContent = '✓ Saved';
        } else {
          btn.disabled = false;
        }
        return;
      }

      await fetch(`/admin/submissions/${id}/${action}`, { method: 'POST' });
      await loadSubmissions();
    });
  });
}

function bindSubmissionsEvents() {
  document.getElementById('btn-reload-subs').addEventListener('click', loadSubmissions);
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
    switchToTab('builder');
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
  document.getElementById('btn-ai-puzzle').addEventListener('click', onAIPuzzle);
  document.getElementById('ai-puzzle-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onAIPuzzle();
  });
  document.getElementById('btn-ai-suggest').addEventListener('click', onAISuggest);
  document.getElementById('ai-theme-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onAISuggest();
  });
  document.getElementById('btn-ai-discover').addEventListener('click', onAIDiscover);
}

function getExcludeIds() {
  return slots.flatMap(s => s.movies.map(m => m.id));
}

async function onAISuggest() {
  const theme = document.getElementById('ai-theme-input').value.trim();
  if (!theme) return;
  const $results = document.getElementById('ai-suggest-results');
  $results.innerHTML = '<div class="ai-spinner">✦ Thinking…</div>';
  try {
    const res  = await fetch('/admin/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, exclude_ids: getExcludeIds() }),
    });
    const data = await res.json();
    if (data.error) {
      $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Error: ${escHtml(data.error)}</div>`;
      return;
    }
    $results.innerHTML = '';
    $results.appendChild(renderAICard(data));
  } catch (e) {
    $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Request failed.</div>`;
  }
}


async function onAIDiscover() {
  const btn      = document.getElementById('btn-ai-discover');
  const $results = document.getElementById('ai-discover-results');
  btn.disabled   = true;
  $results.innerHTML = '<div class="ai-spinner">✦ Discovering connections…</div>';
  try {
    const res  = await fetch('/admin/ai/discover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exclude_ids: getExcludeIds(), count: 5 }),
    });
    const data = await res.json();
    if (data.error) {
      $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Error: ${escHtml(data.error)}</div>`;
      return;
    }
    $results.innerHTML = '';
    (data.categories || []).forEach(cat => $results.appendChild(renderAICard(cat)));
  } catch (e) {
    $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Request failed.</div>`;
  } finally {
    btn.disabled = false;
  }
}


async function onAIPuzzle() {
  const theme    = document.getElementById('ai-puzzle-input').value.trim();
  const btn      = document.getElementById('btn-ai-puzzle');
  const $results = document.getElementById('ai-puzzle-results');
  btn.disabled   = true;
  $results.innerHTML = '<div class="ai-spinner">✦ Building your puzzle… this may take a moment.</div>';
  try {
    const res  = await fetch('/admin/ai/puzzle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, exclude_ids: getExcludeIds() }),
    });
    const data = await res.json();
    if (data.error) {
      $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Error: ${escHtml(data.error)}</div>`;
      return;
    }
    $results.innerHTML = '';
    $results.appendChild(renderAIPuzzleResult(data.puzzle || []));
  } catch (e) {
    $results.innerHTML = `<div style="color:#cc2200;font-size:13px;">Request failed.</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderAIPuzzleResult(cats) {
  const $results = document.getElementById('ai-puzzle-results');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'border:1.5px solid #ddd;border-radius:10px;padding:14px;background:#faf7f4;margin-top:4px;';

  // Track which categories are checked
  const checked = cats.map(() => true);

  cats.forEach((cat, i) => {
    const color = COLOR_ORDER[i] || 'yellow';
    const hex   = COLOR_HEX[color];
    const text  = COLOR_TEXT[color];

    const card = document.createElement('div');
    card.style.cssText = `position:relative;background:${hex};color:${text};border-radius:8px;padding:10px 12px 10px 38px;margin-bottom:8px;transition:opacity 0.15s;`;

    // Checkbox in top-left
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = true;
    cb.style.cssText = 'position:absolute;left:10px;top:12px;width:16px;height:16px;cursor:pointer;accent-color:#111;';
    cb.addEventListener('change', () => {
      checked[i] = cb.checked;
      card.style.opacity = cb.checked ? '1' : '0.45';
    });
    card.appendChild(cb);

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:3px;">${escHtml(cat.title)}</div>
      <div style="font-size:12px;opacity:0.8;line-height:1.5;">${(cat.movie_titles || []).map(t => escHtml(t)).join(' · ')}</div>
      ${cat.connection_type ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:4px;opacity:0.6;">${escHtml(cat.connection_type)}</div>` : ''}`;
    card.appendChild(body);
    wrap.appendChild(card);
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center;';

  const loadBtn = document.createElement('button');
  loadBtn.className   = 'btn btn--primary';
  loadBtn.textContent = '→ Load Selected into Builder';
  loadBtn.addEventListener('click', () => {
    const selected = cats.filter((_, i) => checked[i]);
    let slotIdx = 0;
    selected.forEach(cat => {
      if (slotIdx >= slots.length) return;
      slots[slotIdx].title  = cat.title;
      slots[slotIdx].movies = (cat.movie_ids || []).map((id, j) => ({
        id, title: cat.movie_titles?.[j] || String(id), year: '',
      }));
      slotIdx++;
    });
    activeSlot = 0;
    switchToTab('builder');
    renderSlotSelector(); renderSlots(); renderPool(); renderPreview();
  });
  footer.appendChild(loadBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'btn btn--ghost';
  saveBtn.textContent = '★ Save Selected to Library';
  saveBtn.addEventListener('click', async () => {
    const selected = cats.filter((_, i) => checked[i]);
    if (!selected.length) return;
    saveBtn.disabled = true;
    for (const cat of selected) {
      await fetch('/admin/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:        cat.title,
          movie_ids:    cat.movie_ids,
          movie_titles: cat.movie_titles,
          source:       'ai',
        }),
      });
    }
    saveBtn.textContent = `✓ Saved ${selected.length}`;
  });
  footer.appendChild(saveBtn);

  const discardBtn = document.createElement('button');
  discardBtn.className   = 'btn btn--ghost';
  discardBtn.style.cssText = 'margin-left:auto;color:#cc2200;border-color:#cc2200;';
  discardBtn.textContent = '✕ Discard';
  discardBtn.addEventListener('click', () => { $results.innerHTML = ''; });
  footer.appendChild(discardBtn);

  wrap.appendChild(footer);
  return wrap;
}


function renderAICard(cat) {
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

  const footer = document.createElement('div');
  footer.className = 'ai-result-card__footer';

  if (cat.connection_type) {
    const badge = document.createElement('span');
    badge.className   = 'ai-conn-type';
    badge.textContent = cat.connection_type;
    footer.appendChild(badge);
  }

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
// TABS
// ══════════════════════════════════════════════════════════════════

function switchToTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  document.getElementById(`panel-${tabId}`)?.classList.add('active');
}

function bindTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      switchToTab(tabId);
      if (tabId === 'submissions' && !submissionsLoaded) {
        submissionsLoaded = true; loadSubmissions();
      }
      if (tabId === 'create' && !categoriesLoaded) {
        categoriesLoaded = true;
        loadCategoryLibrary();
        loadConnections();
      }
      if (tabId === 'library' && !categoriesLoaded) {
        categoriesLoaded = true;
        loadCategoryLibrary();
        loadConnections();
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

// ── Start ──────────────────────────────────────────────────────────
init();
