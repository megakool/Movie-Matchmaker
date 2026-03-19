/* ── Trivia Game Logic ─────────────────────────────────────────────────────── */

const STORAGE_KEY = 'trivia_history';
const SCORE_MSGS  = ['Keep at it!', 'Not bad!', 'Sharp!', 'Perfect!'];

// ── State ─────────────────────────────────────────────────────────────────────
let currentIdx      = 0;   // 0–2
let results         = [];  // [{id, correct, userAnswer, correctAnswer, question, skipped?}]
let currentParts    = [];  // answer parts for current question (1 = single, 2+ = multi)
let _justSubmitted  = false; // guard: prevent same Enter from submitting AND advancing

// ── Static DOM refs ────────────────────────────────────────────────────────────
const $date             = document.getElementById('trivia-date');
const $progress         = document.getElementById('trivia-progress');
const $progressTxt      = document.getElementById('progress-text');
const $card             = document.getElementById('trivia-card');
const $catLabel         = document.getElementById('cat-label');
const $question         = document.getElementById('card-question');
const $inputsContainer  = document.getElementById('answer-inputs-container');
const $skipBtn          = document.getElementById('skip-btn');
const $reveal           = document.getElementById('reveal-panel');
const $verdictIcon      = document.getElementById('verdict-icon');
const $verdictText      = document.getElementById('verdict-text');
const $revealAns        = document.getElementById('reveal-answer');
const $nextBtn          = document.getElementById('next-btn');
const $nextLabel        = document.getElementById('next-label');
const $doneBanner       = document.getElementById('done-banner');
const $summary          = document.getElementById('summary-card');
const $summaryScore     = document.getElementById('summary-score');
const $summaryMsg       = document.getElementById('summary-msg');
const $barFill          = document.getElementById('summary-bar-fill');
const $summaryRev       = document.getElementById('summary-review');
const $summaryFoot      = document.getElementById('summary-comeback');

// $submitBtn is reassigned each time inputs are rendered (since it lives inside the container)
let $submitBtn = null;

// ── Fuzzy Matching ────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function normalizeStr(s) {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Full fuzzy match (used for single-answer questions — handles compound answers internally)
function fuzzyMatch(userAnswer, correctAnswer) {
  const ua = normalizeStr(userAnswer);
  if (!ua || ua.length < 1) return false;
  const ca = normalizeStr(correctAnswer);
  if (ua === ca) return true;
  if (ua.length >= 3 && ca.includes(ua)) return true;
  if (ca.length >= 3 && ua.includes(ca)) return true;
  if (similarity(ua, ca) >= 0.72) return true;
  const parts = correctAnswer
    .replace(/\([^)]*\)/g, '')
    .split(/\s+(?:and|or|&)\s+|[,\/]/)
    .map(p => normalizeStr(p))
    .filter(p => p.length >= 2);
  if (parts.length > 1) {
    for (const part of parts) {
      if (part.length >= 3 && ua.includes(part)) return true;
      if (part.length >= 3 && part.includes(ua) && ua.length >= 3) return true;
      if (similarity(ua, part) >= 0.72) return true;
    }
  }
  const keyWords = ca.split(' ').filter(w => w.length >= 4);
  if (keyWords.length >= 2) {
    const hits = keyWords.filter(w => ua.includes(w)).length;
    if (hits / keyWords.length >= 0.6) return true;
  }
  return false;
}

// Single-part fuzzy match (used when checking one user input against one answer part)
function fuzzyMatchPart(userAnswer, part) {
  const ua = normalizeStr(userAnswer);
  if (!ua || ua.length < 1) return false;
  const ca = normalizeStr(part);
  if (ua === ca) return true;
  if (ua.length >= 3 && ca.includes(ua)) return true;
  if (ca.length >= 3 && ua.includes(ca)) return true;
  if (similarity(ua, ca) >= 0.72) return true;
  const keyWords = ca.split(' ').filter(w => w.length >= 4);
  if (keyWords.length >= 2) {
    const hits = keyWords.filter(w => ua.includes(w)).length;
    if (hits / keyWords.length >= 0.6) return true;
  }
  return false;
}

// ── Answer Part Parsing ───────────────────────────────────────────────────────

function parseAnswerParts(answer) {
  const stripped = answer.replace(/\([^)]*\)/g, '');
  const parts = stripped
    .split(/\s+(?:and|or|&)\s+|,\s+/)
    .map(p => p.trim())
    .filter(p => normalizeStr(p).length >= 3);
  // Only treat as multi-part if each part is meaningfully distinct
  return parts.length >= 2 ? parts : [answer.trim()];
}

// ── Dynamic Input Rendering ───────────────────────────────────────────────────

function renderInputs(parts) {
  if (parts.length === 1) {
    $inputsContainer.innerHTML = `
      <div class="trivia-input-row">
        <input type="text" class="trivia-input trivia-answer-input" id="answer-input"
          placeholder="Your answer…" autocomplete="off" spellcheck="false" aria-label="Your answer">
        <button class="trivia-submit" id="submit-btn" disabled aria-label="Submit answer">Submit</button>
      </div>`;
  } else {
    $inputsContainer.innerHTML =
      parts.map((_, i) => `
        <div class="trivia-multi-input-row">
          <input type="text" class="trivia-input trivia-answer-input" id="answer-input-${i}"
            placeholder="Answer ${i + 1}…" autocomplete="off" spellcheck="false"
            aria-label="Answer ${i + 1}">
        </div>`).join('') +
      `<button class="trivia-submit trivia-submit--block" id="submit-btn" disabled>Submit</button>`;
  }
  $submitBtn = document.getElementById('submit-btn');
  _bindInputEvents();
}

function _bindInputEvents() {
  getInputEls().forEach(inp => {
    inp.addEventListener('input', _updateSubmitBtn);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && $submitBtn && !$submitBtn.disabled) handleSubmit();
    });
  });
  $submitBtn.addEventListener('click', handleSubmit);
}

function getInputEls() {
  return Array.from($inputsContainer.querySelectorAll('.trivia-answer-input'));
}

function _updateSubmitBtn() {
  if (!$submitBtn) return;
  $submitBtn.disabled = !getInputEls().every(inp => inp.value.trim().length > 0);
}

function disableInputs() {
  getInputEls().forEach(inp => { inp.disabled = true; });
  if ($submitBtn) $submitBtn.disabled = true;
}

function focusFirstInput() {
  const inputs = getInputEls();
  if (inputs.length > 0) inputs[0].focus();
}

// ── LocalStorage ──────────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function getTodayRecord() {
  return loadHistory().find(r => r.date === TODAY) || null;
}

function saveTodayRecord(resultsArr) {
  const history = loadHistory().filter(r => r.date !== TODAY);
  history.push({ date: TODAY, results: resultsArr });
  history.sort((a, b) => a.date.localeCompare(b.date));
  saveHistory(history.slice(-60));
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m-1]} ${d}, ${y}`;
}

function updateProgressDots(idx, resultsArr) {
  for (let i = 0; i < 3; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.className = 'progress-dot';
    if (i < resultsArr.length) {
      dot.classList.add(resultsArr[i].correct ? 'progress-dot--correct' : 'progress-dot--wrong');
    } else if (i === idx) {
      dot.classList.add('progress-dot--active');
    }
  }
}

function loadQuestion(idx) {
  const q = QUESTIONS[idx];
  $card.className = 'trivia-card';
  $catLabel.textContent = q.category;
  $question.textContent = q.question;

  currentParts = parseAnswerParts(q.answer);
  renderInputs(currentParts);

  $skipBtn.style.display = '';
  $reveal.classList.remove('is-visible');
  $progressTxt.textContent = `Question ${idx + 1} of ${QUESTIONS.length}`;
  updateProgressDots(idx, results);
  focusFirstInput();
}

function showReveal(isCorrect, userAns, correctAns, skipped) {
  disableInputs();
  $skipBtn.style.display = 'none';

  $card.className = 'trivia-card ' + (isCorrect ? 'trivia-card--correct' : 'trivia-card--wrong');
  $verdictIcon.className = 'reveal-verdict__icon ' +
    (isCorrect ? 'reveal-verdict__icon--correct' : 'reveal-verdict__icon--wrong');
  $verdictIcon.textContent = isCorrect ? '✓' : '✗';

  if (isCorrect) {
    $verdictText.innerHTML = '<strong>Correct!</strong>';
  } else if (skipped) {
    $verdictText.innerHTML = '<strong>Skipped</strong>';
  } else {
    $verdictText.innerHTML = `Not quite — <span>you said: <em>${escHtml(userAns || '(blank)')}</em></span>`;
  }

  $revealAns.textContent = correctAns;
  $reveal.classList.add('is-visible');

  const isLast = currentIdx === QUESTIONS.length - 1;
  $nextLabel.textContent = isLast ? 'See Results' : 'Next Question';
}

function showSummary(resultsArr) {
  $card.style.display = 'none';
  $progress.style.display = 'none';
  $summary.classList.add('is-visible');

  const correct = resultsArr.filter(r => r.correct).length;
  const total   = resultsArr.length;

  $summaryScore.textContent = `${correct} / ${total}`;
  $summaryMsg.textContent   = SCORE_MSGS[correct] || SCORE_MSGS[0];
  setTimeout(() => { $barFill.style.width = `${(correct / total) * 100}%`; }, 80);

  $summaryRev.innerHTML = resultsArr.map(r => {
    let yourAnswerLine = '';
    if (!r.correct) {
      if (r.skipped) {
        yourAnswerLine = `<div class="review-item__your-answer">Skipped</div>`;
      } else if (r.userAnswer) {
        yourAnswerLine = `<div class="review-item__your-answer">You said: ${escHtml(r.userAnswer)}</div>`;
      }
    }
    return `
    <div class="review-item">
      <div class="review-item__icon ${r.correct ? 'review-item__icon--correct' : 'review-item__icon--wrong'}">
        ${r.correct ? '✓' : '✗'}
      </div>
      <div class="review-item__content">
        <div class="review-item__question">${escHtml(r.question)}</div>
        <div class="review-item__answer">${escHtml(r.correctAnswer)}</div>
        ${yourAnswerLine}
      </div>
    </div>`;
  }).join('');

  renderCountdown();
  setInterval(renderCountdown, 30000);
}

function renderCountdown() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const diff = Math.max(0, next - now);
  const h    = Math.floor(diff / 3600000);
  const m    = Math.floor((diff % 3600000) / 60000);
  $summaryFoot.textContent = `New questions in ${h}h ${m}m`;
}

function showCompletedState(record) {
  $doneBanner.classList.add('is-visible');
  $progress.style.display = 'none';
  $card.style.display = 'none';
  results = record.results;
  showSummary(record.results);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Events ────────────────────────────────────────────────────────────────────

$skipBtn.addEventListener('click', handleSkip);

$nextBtn.addEventListener('click', () => {
  currentIdx++;
  if (currentIdx >= QUESTIONS.length) {
    saveTodayRecord(results);
    showSummary(results);
  } else {
    loadQuestion(currentIdx);
  }
});

// Global Enter: submit when inputs are ready, or advance when reveal is showing.
// _justSubmitted guards against the same keypress triggering both submit and next.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;

  if (_justSubmitted) {
    // This is the same Enter that triggered handleSubmit — skip it, but clear the flag
    // so the NEXT Enter press can advance.
    _justSubmitted = false;
    return;
  }

  if ($reveal.classList.contains('is-visible')) {
    $nextBtn.click();
  }
});

function handleSubmit() {
  const inputs = getInputEls();
  const userAnswers = inputs.map(inp => inp.value.trim());
  if (userAnswers.some(a => !a)) return;

  _justSubmitted = true;

  const q = QUESTIONS[currentIdx];
  let isCorrect;

  if (currentParts.length <= 1) {
    isCorrect = fuzzyMatch(userAnswers[0], q.answer);
  } else {
    // Every answer part must be covered by at least one user input
    isCorrect = currentParts.every(part => userAnswers.some(ua => fuzzyMatchPart(ua, part)));
  }

  results.push({
    id:            q.id,
    correct:       isCorrect,
    userAnswer:    userAnswers.join(' / '),
    correctAnswer: q.answer,
    question:      q.question,
  });

  updateProgressDots(currentIdx, results);
  saveTodayRecord(results);
  showReveal(isCorrect, userAnswers.join(' / '), q.answer, false);
}

function handleSkip() {
  const q = QUESTIONS[currentIdx];
  results.push({
    id:            q.id,
    correct:       false,
    userAnswer:    '',
    correctAnswer: q.answer,
    question:      q.question,
    skipped:       true,
  });
  updateProgressDots(currentIdx, results);
  saveTodayRecord(results);
  showReveal(false, '', q.answer, true);
}

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  $date.textContent = formatDate(TODAY);

  const record = getTodayRecord();
  if (record && record.results && record.results.length === QUESTIONS.length) {
    showCompletedState(record);
    return;
  }

  if (record && record.results && record.results.length > 0) {
    results    = record.results;
    currentIdx = results.length;
    if (currentIdx >= QUESTIONS.length) {
      showSummary(results);
      return;
    }
    updateProgressDots(currentIdx, results);
    loadQuestion(currentIdx);
    return;
  }

  loadQuestion(0);
})();
