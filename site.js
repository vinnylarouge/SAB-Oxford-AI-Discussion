// site.js — scroll-driven replay of a frozen Loom discussion (static, no server).
// Scroll position (or dragging the timeline) maps to an index into the activity
// feed; the graph and feed are revealed up to that point in timestamp order.
(function () {
  const S = window.FROZEN;
  if (!S) return;
  document.getElementById('sessionTitle').textContent = (S.session && S.session.title) || 'Live Discussion';

  // ---- data prep ----
  const anchors = S.themes.filter((t) => t.kind === 'anchor');
  const emergent = S.themes.filter((t) => t.kind !== 'anchor');
  const notes = [...S.notes].filter((n) => n.ts);
  const bridges = [...S.bridges].filter((b) => b.ts);
  const frames = [...(S.frames || [])].filter((f) => f.ts);
  const feed = [...(S.feed || [])].filter((f) => f.ts).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const noteTs = new Map(S.notes.map((n) => [n.id, n.ts]));
  const themeTs = new Map(); // a theme "appears" with its earliest member note
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
  const mobileFeed = document.getElementById('mobileFeed');
  function renderFeed(index) {
    feedList.innerHTML = feed.slice(0, index + 1).reverse().map(itemHTML).join('');
    feedList.scrollTop = 0;
    mobileFeed.innerHTML = itemHTML(feed[index]); // single current entry on mobile
  }

  // ---- reveal at a feed index ----
  let lastIndex = -1;
  const fill = document.getElementById('tl-fill');
  const knob = document.getElementById('tl-knob');
  const label = document.getElementById('tl-label');
  function reveal(index) {
    index = Math.max(0, Math.min(feed.length - 1, index));
    if (index === lastIndex) return;
    lastIndex = index;
    LoomGraph.update(graphAt(feed[index].ts));
    renderFeed(index);
    const p = feed.length <= 1 ? 1 : index / (feed.length - 1);
    fill.style.width = (p * 100) + '%';
    knob.style.left = (p * 100) + '%';
    label.textContent = `${index + 1} / ${feed.length}`;
  }

  // ---- scroll wiring ----
  const scroller = document.getElementById('scroller');
  const PER_ENTRY_PX = 16;
  function setHeight() { scroller.style.height = Math.round(window.innerHeight + feed.length * PER_ENTRY_PX) + 'px'; }
  setHeight();
  window.addEventListener('resize', () => { setHeight(); if (LoomGraph.resize) LoomGraph.resize(); });

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    reveal(Math.round(p * (feed.length - 1)));
    if (window.scrollY > 24) { const h = document.getElementById('hint'); if (h) h.style.opacity = 0; }
  }
  let raf = null;
  window.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; onScroll(); }); }, { passive: true });

  // ---- timeline drag-to-scrub ----
  const track = document.getElementById('tl-track');
  function scrubTo(clientX) {
    const r = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: p * max });
  }
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; try { track.setPointerCapture(e.pointerId); } catch {} scrubTo(e.clientX); });
  track.addEventListener('pointermove', (e) => { if (dragging) scrubTo(e.clientX); });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ---- init ----
  function init() {
    if (LoomGraph.resize) LoomGraph.resize();
    reveal(0);
    onScroll();
  }
  setTimeout(init, 120);
})();
