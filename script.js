(() => {
  const setupScreen    = document.getElementById('setup-screen');
  const writeScreen     = document.getElementById('write-screen');
  const endScreen       = document.getElementById('end-screen');
  const durationSelect  = document.getElementById('duration-select');
  const startBtn        = document.getElementById('start-btn');
  const restartBtn      = document.getElementById('restart-btn');
  const editor          = document.getElementById('editor');
  const dangerOverlay   = document.getElementById('danger-overlay');
  const erasedFlash     = document.getElementById('erased-flash');
  const timeUpBanner    = document.getElementById('time-up-banner');
  const startAnotherBtn = document.getElementById('start-another-btn');
  const sessionTimerEl  = document.getElementById('session-timer');
  const downloadBtn     = document.getElementById('download-btn');
  const endDownloadBtn  = document.getElementById('end-download-btn');
  const endStats        = document.getElementById('end-stats');

  // ---- Config ----
  const IDLE_FADE_START_MS = 3000; // begin a subtle light-red overlay
  const IDLE_DARKEN_MS     = 5000; // overlay reaches its darker red tone
  const IDLE_ERASE_MS      = 6000; // wipe text if still idle

  const DANGER_LIGHT = [230, 57, 70];  // light red, used at the 3s mark
  const DANGER_DARK  = [120, 10, 20];  // dark red, reached by the 5s mark

  // ---- State ----
  let sessionTotalSeconds = 0;
  let sessionSecondsLeft  = 0;
  let sessionIntervalId   = null;
  let lastActivity        = Date.now();
  let idleRafId           = null;
  let scrollRafId         = null;
  let mirrorDiv           = null;
  let sessionRunning      = false;
  let isTimerFinished      = false;
  let savedSprints        = []; // text committed from completed rounds, never touched by idle erase

  // ---------- Session lifecycle ----------
  function startSession() {
    sessionTotalSeconds = parseInt(durationSelect.value, 10) * 60;
    savedSprints = []; // brand-new multi-session document

    setupScreen.style.display = 'none';
    endScreen.classList.remove('active');
    writeScreen.classList.add('active');

    editor.value = '';
    editor.disabled = false;

    beginRound();
  }

  // Starts (or restarts) the countdown/idle-erase mechanic for one round,
  // without touching savedSprints or the duration setting.
  function beginRound() {
    sessionSecondsLeft = sessionTotalSeconds;
    sessionRunning = true;
    isTimerFinished = false;

    timeUpBanner.classList.remove('visible');
    startAnotherBtn.hidden = true;
    sessionTimerEl.classList.remove('done');
    updateSessionTimerDisplay();

    sessionIntervalId = setInterval(() => {
      sessionSecondsLeft--;
      updateSessionTimerDisplay();
      if (sessionSecondsLeft <= 0) onTimerExpired();
    }, 1000);

    lastActivity = Date.now();
    idleRafId = requestAnimationFrame(idleLoop);

    editor.focus();
  }

  // The countdown reaching zero never disables the editor or hides the
  // download button. The idle erasure timer is fully stopped so typing
  // after the session ends can never trigger an erase.
  function onTimerExpired() {
    isTimerFinished = true;
    clearInterval(sessionIntervalId);
    if (idleRafId) { cancelAnimationFrame(idleRafId); idleRafId = null; }
    dangerOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    sessionSecondsLeft = 0;
    updateSessionTimerDisplay();
    sessionTimerEl.classList.add('done');
    timeUpBanner.classList.add('visible');
    startAnotherBtn.hidden = false;
    editor.focus();
  }

  // Freezes the current round's text into the saved-sprints buffer, clears
  // the active typing area, and begins a fresh round with the same duration.
  function startAnotherSession() {
    if (editor.value.trim().length > 0) {
      savedSprints.push(editor.value);
    }
    editor.value = '';
    beginRound();
  }

  function resetToSetup() {
    sessionRunning = false;
    isTimerFinished = false;
    savedSprints = [];
    if (idleRafId) cancelAnimationFrame(idleRafId);
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    dangerOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';

    endScreen.classList.remove('active');
    writeScreen.classList.remove('active');
    startAnotherBtn.hidden = true;
    setupScreen.style.display = 'flex';
    sessionTimerEl.textContent = '--:--';
    sessionTimerEl.classList.remove('low', 'done');
  }

  function updateSessionTimerDisplay() {
    const m = Math.floor(sessionSecondsLeft / 60).toString().padStart(2, '0');
    const s = (sessionSecondsLeft % 60).toString().padStart(2, '0');
    sessionTimerEl.textContent = `${m}:${s}`;
    sessionTimerEl.classList.toggle('low', sessionSecondsLeft > 0 && sessionSecondsLeft <= 10);
  }

  // ---------- Inactivity fade + erase ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpColor(c1, c2, t) {
    return [0, 1, 2].map(i => Math.round(lerp(c1[i], c2[i], t)));
  }

  function idleLoop() {
    // Once the session timer finishes, the idle erasure timer is disabled
    // entirely — this loop stops running (see onTimerExpired).
    if (!sessionRunning || isTimerFinished) return;
    const idleMs = Date.now() - lastActivity;

    if (idleMs < IDLE_FADE_START_MS) {
      // 0s -> 3s: clear/default, no overlay
      dangerOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    } else if (idleMs < IDLE_DARKEN_MS) {
      // 3s -> 5s: fade in, light red smoothly deepening toward dark red
      const t = (idleMs - IDLE_FADE_START_MS) / (IDLE_DARKEN_MS - IDLE_FADE_START_MS);
      const [r, g, b] = lerpColor(DANGER_LIGHT, DANGER_DARK, t);
      const alpha = lerp(0.12, 0.55, t);
      dangerOverlay.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else if (idleMs < IDLE_ERASE_MS) {
      // 5s -> 6s: darken further, intensifying toward the erase point
      const t = (idleMs - IDLE_DARKEN_MS) / (IDLE_ERASE_MS - IDLE_DARKEN_MS);
      const [r, g, b] = DANGER_DARK;
      const alpha = lerp(0.55, 0.9, t);
      dangerOverlay.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } else if (!isTimerFinished) {
      // Only erase while the session timer is still active
      eraseText();
    }

    idleRafId = requestAnimationFrame(idleLoop);
  }

  function eraseText() {
    editor.value = '';
    lastActivity = Date.now(); // resets the idle/fade timer back to zero
    dangerOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    erasedFlash.style.opacity = 1;
    setTimeout(() => { erasedFlash.style.opacity = 0; }, 900);
  }

  editor.addEventListener('input', () => {
    lastActivity = Date.now();
    scheduleScrollCheck();
  });
  editor.addEventListener('keydown', () => { lastActivity = Date.now(); });
  editor.addEventListener('click', () => { scheduleScrollCheck(); });

  // ---------- Smooth auto-scroll to caret ----------
  function scheduleScrollCheck() {
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(scrollToCaret);
  }

  function ensureMirror() {
    if (mirrorDiv) return mirrorDiv;
    mirrorDiv = document.createElement('div');
    mirrorDiv.style.position = 'absolute';
    mirrorDiv.style.visibility = 'hidden';
    mirrorDiv.style.top = '0';
    mirrorDiv.style.left = '-9999px';
    mirrorDiv.style.whiteSpace = 'pre-wrap';
    mirrorDiv.style.wordWrap = 'break-word';
    document.body.appendChild(mirrorDiv);
    return mirrorDiv;
  }

  function syncMirrorStyle() {
    const cs = window.getComputedStyle(editor);
    const props = [
      'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight'
    ];
    props.forEach(p => { mirrorDiv.style[p] = cs[p]; });
  }

  function scrollToCaret() {
    const mirror = ensureMirror();
    syncMirrorStyle();

    const pos = editor.selectionStart;
    const value = editor.value;

    mirror.textContent = value.substring(0, pos);
    const span = document.createElement('span');
    span.textContent = value.substring(pos) || '.';
    mirror.appendChild(span);

    const caretTop = span.offsetTop;
    const caretHeight = span.offsetHeight;
    mirror.removeChild(span);
    mirror.textContent = '';

    const buffer = 24;
    const visibleTop = editor.scrollTop;
    const visibleBottom = editor.scrollTop + editor.clientHeight;

    let target = null;
    if (caretTop + caretHeight > visibleBottom - buffer) {
      target = caretTop + caretHeight - editor.clientHeight + buffer;
    } else if (caretTop < visibleTop + buffer) {
      target = Math.max(0, caretTop - buffer);
    }

    if (target !== null) smoothScrollTo(target, 180);
  }

  let scrollAnimId = null;
  function smoothScrollTo(target, duration) {
    if (scrollAnimId) cancelAnimationFrame(scrollAnimId);
    const start = editor.scrollTop;
    const distance = target - start;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      editor.scrollTop = start + distance * eased;
      if (t < 1) {
        scrollAnimId = requestAnimationFrame(step);
      } else {
        scrollAnimId = null;
      }
    }
    scrollAnimId = requestAnimationFrame(step);
  }

  // ---------- Download ----------
  // Combines every completed round with the currently active text so the
  // download always reflects the whole multi-session document.
  function getCombinedText() {
    const rounds = savedSprints.slice();
    if (editor.value.length > 0) rounds.push(editor.value);
    return rounds.join('\n\n');
  }

  function downloadText() {
    const text = getCombinedText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `focus-write-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  downloadBtn.addEventListener('click', downloadText);
  endDownloadBtn.addEventListener('click', downloadText);
  startBtn.addEventListener('click', startSession);
  restartBtn.addEventListener('click', resetToSetup);
  startAnotherBtn.addEventListener('click', startAnotherSession);

  window.addEventListener('resize', () => { if (sessionRunning) scheduleScrollCheck(); });
})();
