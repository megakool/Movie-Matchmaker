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
let catBrowseFilter   = 'all';
let catBrowseQuery    = '';
let catBrowseSelected = [];   // [{id, title, year}] — max 4
let savedCategories   = [];
let catLibraryQuery   = '';

// ── Published Tab State ────────────────────────────────────────────
const publishedDetailCache = {};

// ── Tab Load Flags ─────────────────────────────────────────────────
let submissionsLoaded = false;
let categoriesLoaded  = false;

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
async function init() {
  document.getElementById('pub-date').value = new Date().toISOString().slice(0, 10);
  bindTabs();
  bindBuilderEvents();
  bindCategoriesEvents();
  bindSubmissionsEvents();
  bindPublishedEvents();
  await loadMovies();
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
        (m.actors    || []).some(a => a.toLowerCase().includes(q))
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
  if (allMovies.length) renderBrowsePanel();
}

/* ── Browse panel ── */
function renderBrowsePanel() {
  const $list = document.getElementById('browse-list');
  const q     = catBrowseQuery.toLowerCase();
  let filtered = allMovies;

  if (catBrowseFilter === 'actor' && q) {
    filtered = allMovies.filter(m => (m.actors || []).some(a => a.toLowerCase().includes(q)));
  } else if (catBrowseFilter === 'director' && q) {
    filtered = allMovies.filter(m => (m.directors || []).some(d => d.toLowerCase().includes(q)));
  } else if (catBrowseFilter === 'oscar') {
    filtered = allMovies.filter(m => {
      if (!(m.oscar_wins > 0) && !(m.oscar_categories || []).length) return false;
      return !q || (m.oscar_categories || []).some(c => c.toLowerCase().includes(q));
    });
  } else if (q) {
    filtered = allMovies.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.actors    || []).some(a => a.toLowerCase().includes(q)) ||
      (m.directors || []).some(d => d.toLowerCase().includes(q))
    );
  }

  $list.innerHTML = '';
  if (!filtered.length) {
    $list.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.5;font-size:13px;">No matches</div>';
    return;
  }

  filtered.slice(0, 120).forEach(m => {
    const alreadySel = catBrowseSelected.some(s => s.id === m.id);
    const row = document.createElement('div');
    row.className = 'browse-movie-row';
    row.innerHTML = `
      <input type="checkbox" data-id="${m.id}" ${alreadySel ? 'checked' : ''}>
      <span style="flex:1;">${escHtml(m.title)}</span>
      <span style="font-size:11px;opacity:0.45;">${m.year || ''}</span>`;
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
    renderBrowsePanel();
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
    $list.innerHTML = '<p style="opacity:0.5;font-size:13px;">No categories yet. Browse movies and save a group, or approve community submissions.</p>';
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
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      catBrowseFilter = btn.dataset.filter;
      catBrowseQuery  = '';
      document.getElementById('browse-search').value = '';
      renderBrowsePanel();
    });
  });
  document.getElementById('browse-search').addEventListener('input', e => {
    catBrowseQuery = e.target.value; renderBrowsePanel();
  });
  document.getElementById('cat-lib-name').addEventListener('input', updateBrowseActions);
  document.getElementById('btn-save-to-lib').addEventListener('click', onSaveToLibrary);
  document.getElementById('btn-load-to-builder').addEventListener('click', onLoadBrowseToBuilder);
  document.getElementById('lib-search').addEventListener('input', e => {
    catLibraryQuery = e.target.value; renderCategoryLibrary();
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
      if (tabId === 'categories' && !categoriesLoaded) {
        categoriesLoaded = true;
        loadCategoryLibrary();
        if (allMovies.length) renderBrowsePanel();
      }
    });
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
