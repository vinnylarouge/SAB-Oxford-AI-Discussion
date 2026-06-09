// site.js — scroll-free, control-driven replay of a frozen Loom discussion.
//
// ONE consistent model: a single `currentIndex` into the activity feed drives the
// graph + feed. It is changed only by explicit controls —
//   desktop : ◀ / ▶ step buttons, play/pause, click+drag the scrubber, arrow keys
//   mobile  : swipe the bottom feed sheet (snaps entry-by-entry), or drag the scrubber
// Nothing hijacks page or wheel scroll, so the graph keeps its own zoom/pan.
(function () {
  const S = window.FROZEN;
  if (!S) return;
  document.getElementById('sessionTitle').textContent = (S.session && S.session.title) || 'Live Discussion';

  // ---- data ----
  const anchors = S.themes.filter((t) => t.kind === 'anchor');
  const emergent = S.themes.filter((t) => t.kind !== 'anchor');
  const notes = [...S.notes].filter((n) => n.ts);
  const bridges = [...S.bridges].filter((b) => b.ts);
  const frames = [...(S.frames || [])].filter((f) => f.ts);
  const feed = [...(S.feed || [])].filter((f) => f.ts).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const noteTs = new Map(S.notes.map((n) => [n.id, n.ts]));
  const themeTs = new Map();
  for (const t of emergent) {
    let m = null;
    for (const nid of t.noteIds) { const ts = noteTs.get(nid); if (ts && (m === null || ts < m)) m = ts; }
    themeTs.set(t.id, m);
  }
  function graphAt(T) {
    const revNotes = notes.filter((n) => n.ts <= T);
    const revNoteIds = new Set(revNotes.map((n) => n.id));
    const revThemes = [...anchors, ...emergent.filter((t) => themeTs.get(t.id) && themeTs.get(t.id) <= T)]
      .map((t) => ({ ...t, noteIds: t.noteIds.filter((id) => revNoteIds.has(id)) }));
    const revThemeIds = new Set(revThemes.map((t) => t.id));
    const present = (id) => revNoteIds.has(id) || revThemeIds.has(id);
    const revBridges = bridges.filter((b) => b.ts <= T && present(b.source) && present(b.target));
    const revFrames = frames.filter((f) => f.ts <= T).map((f) => ({ ...f, themeIds: (f.themeIds || []).filter((id) => revThemeIds.has(id)) }));
    return { session: S.session, paused: false, themes: revThemes, notes: revNotes, bridges: revBridges, frames: revFrames, feed: [] };
  }

  // ---- feed rendering ----
  const FEED_ICON = { theme: '✦', bridge: '↔', refine: '✎', heuristic: '◆', factcheck: '✓', boundary: '⟂', principle: '↳', merge: '∪', abstract: '❖', elaborate: '＋', paper: '⎙' };
  const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function itemHTML(it) {
    const slug = it.head ? it.head.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';
    const head = it.head ? `<span class="fi-head fh-${slug}">${esc(it.head)}</span>` : '';
    const detail = it.detail && it.type !== 'paper' ? `<div class="fi-detail">${esc(it.detail)}</div>` : '';
    return `<div class="feed-item fi-${it.type}"><span class="fi-icon">${FEED_ICON[it.type] || '·'}</span>` +
      `<div class="fi-main"><div class="fi-text">${head}${esc(it.text)}</div>${detail}</div></div>`;
  }
  const feedList = document.getElementById('feedList');
  const mfScroll = document.getElementById('mf-scroll');
  mfScroll.innerHTML = feed.map(itemHTML).join('');                 // all cards (mobile sheet), once
  const mfCards = [...mfScroll.querySelectorAll('.feed-item')];
  function renderDesktopFeed(index) { feedList.innerHTML = feed.slice(0, index + 1).reverse().map(itemHTML).join(''); feedList.scrollTop = 0; }
  function markMobile(index) { for (let i = 0; i < mfCards.length; i++) mfCards[i].classList.toggle('mf-current', i === index); }

  // ---- device mode ----
  const mq = window.matchMedia('(max-width: 760px)');
  const isMobile = () => mq.matches;

  // ---- the single source of truth ----
  const fill = document.getElementById('tl-fill');
  const knob = document.getElementById('tl-knob');
  const label = document.getElementById('tl-label');
  const hintEl = document.getElementById('hint');
  let currentIndex = 0, lastRendered = -1;
  const clamp = (i) => Math.max(0, Math.min(feed.length - 1, i));
  function reveal(index) {
    if (index === lastRendered) return;
    lastRendered = index;
    LoomGraph.update(graphAt(feed[index].ts));
    const p = feed.length <= 1 ? 1 : index / (feed.length - 1);
    fill.style.width = (p * 100) + '%';
    knob.style.left = (p * 100) + '%';
    label.textContent = `${index + 1} / ${feed.length}`;
    if (isMobile()) markMobile(index); else renderDesktopFeed(index);
  }
  function setIndex(index) { currentIndex = clamp(index); reveal(currentIndex); hideHint(); }
  function hideHint() { if (hintEl) hintEl.style.opacity = 0; const mh = document.getElementById('mf-hint'); if (mh) mh.style.opacity = 0; }

  // ---- mobile: swipe the feed sheet ----
  function centeredIndex() {
    const r = mfScroll.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < mfCards.length; i++) {
      const cr = mfCards[i].getBoundingClientRect();
      const d = Math.abs((cr.top + cr.bottom) / 2 - cy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function mfScrollToIndex(index) { const c = mfCards[index]; if (c) c.scrollIntoView({ block: 'center' }); }
  let rafM = null;
  mfScroll.addEventListener('scroll', () => {
    if (rafM) return;
    rafM = requestAnimationFrame(() => { rafM = null; currentIndex = centeredIndex(); reveal(currentIndex); hideHint(); });
  }, { passive: true });

  // ---- the scrubber (both modes) ----
  const track = document.getElementById('tl-track');
  function scrubToClientX(clientX) {
    const r = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const idx = Math.round(p * (feed.length - 1));
    if (isMobile()) mfScrollToIndex(idx); else setIndex(idx);
  }
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { stopPlay(); dragging = true; try { track.setPointerCapture(e.pointerId); } catch {} scrubToClientX(e.clientX); });
  track.addEventListener('pointermove', (e) => { if (dragging) scrubToClientX(e.clientX); });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ---- desktop transport: ◀ ▶ + play + arrow keys ----
  const prevBtn = document.getElementById('tl-prev');
  const nextBtn = document.getElementById('tl-next');
  const playBtn = document.getElementById('tl-play');
  prevBtn.addEventListener('click', () => { stopPlay(); setIndex(currentIndex - 1); });
  nextBtn.addEventListener('click', () => { stopPlay(); setIndex(currentIndex + 1); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { stopPlay(); setIndex(currentIndex + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { stopPlay(); setIndex(currentIndex - 1); e.preventDefault(); }
    else if (e.key === 'Home') { stopPlay(); setIndex(0); e.preventDefault(); }
    else if (e.key === 'End') { stopPlay(); setIndex(feed.length - 1); e.preventDefault(); }
    else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
  });
  let playTimer = null;
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; playBtn.textContent = '▶'; } }
  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (currentIndex >= feed.length - 1) setIndex(0);
    playBtn.textContent = '⏸';
    playTimer = setInterval(() => {
      if (currentIndex >= feed.length - 1) { stopPlay(); return; }
      setIndex(currentIndex + 1);
    }, 480);
  }
  playBtn.addEventListener('click', togglePlay);

  // ---- hint text per device ----
  function updateHint() { if (hintEl) hintEl.innerHTML = isMobile() ? 'swipe the feed to replay&nbsp;↕' : 'press ▶, step ◀ ▶, or drag the timeline'; }

  mq.addEventListener('change', () => {
    stopPlay(); updateHint(); lastRendered = -1; reveal(currentIndex);
    if (isMobile()) mfScrollToIndex(currentIndex);
  });

  // ---- init ----
  function init() {
    if (LoomGraph.resize) LoomGraph.resize();
    updateHint();
    reveal(0);
    if (isMobile()) { mfScrollToIndex(0); markMobile(0); }
  }
  setTimeout(init, 120);
})();
