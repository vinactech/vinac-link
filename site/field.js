// The "sound field" behind the hero: a grid of dots rippling with waves from two points, like two
// computers pairing by sound. Plain canvas, no libraries. It pauses off screen and in background
// tabs, caps itself at 30 frames a second, and draws one still frame for people who prefer less motion.
(() => {
  const canvas = document.querySelector('canvas.field');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const GAP = 18;            // CSS pixels between dots
  const BUCKETS = 10;        // brightness steps, drawn as one path each
  let w = 0, h = 0, dpr = 1, dots = [], visible = true, raf = 0, last = 0, t0 = performance.now();
  let color = [123, 140, 255], color2 = [138, 79, 224], base = 0.10, gain = 0.85;

  function readColors() {
    const s = getComputedStyle(canvas);
    const parse = (name, fallback) => { const v = (s.getPropertyValue(name).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number); return v.length === 3 ? v : fallback; };
    color = parse('--field-a', color);
    color2 = parse('--field-b', color2);
    base = Number(s.getPropertyValue('--field-base')) || base;
    gain = Number(s.getPropertyValue('--field-gain')) || gain;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    dots = [];
    const cols = Math.ceil(w / GAP) + 1, rows = Math.ceil(h / GAP) + 1;
    const ox = (w - (cols - 1) * GAP) / 2, oy = (h - (rows - 1) * GAP) / 2;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) dots.push(ox + i * GAP, oy + j * GAP);
    readColors();
    if (still.matches) draw(2.2);
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // the two "devices": either side of the headline, drifting very slowly
    const ax = w * (0.1 + 0.025 * Math.sin(t * 0.13)), ay = h * (0.3 + 0.03 * Math.cos(t * 0.09));
    const bx = w * (0.9 + 0.025 * Math.cos(t * 0.11)), by = h * (0.3 + 0.03 * Math.sin(t * 0.07));
    const k = 0.05, speed = 2.6, reach = Math.max(w * 0.62, 520);
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    const half = Array.from({ length: BUCKETS }, () => new Path2D());
    for (let n = 0; n < dots.length; n += 2) {
      const x = dots[n], y = dots[n + 1];
      const da = Math.hypot(x - ax, y - ay), db = Math.hypot(x - bx, y - by);
      const fa = Math.max(0, 1 - da / reach), fb = Math.max(0, 1 - db / reach);
      const wave = Math.sin(da * k - t * speed) * fa + Math.sin(db * k - t * speed) * fb; // -2..2
      const v = Math.min(1, Math.max(0, (wave + 0.15) / 1.5));
      const lift = wave * 3;
      const r = 0.55 + v * 1.9;
      const b = Math.min(BUCKETS - 1, Math.floor(v * BUCKETS));
      (x < w / 2 ? paths : half)[b].moveTo(x + r, y - lift);
      (x < w / 2 ? paths : half)[b].arc(x, y - lift, r, 0, Math.PI * 2);
    }
    for (let b = 0; b < BUCKETS; b++) {
      const a = base + gain * (b / (BUCKETS - 1)) ** 1.6;
      ctx.fillStyle = `rgba(${color.join(',')},${a.toFixed(3)})`; ctx.fill(paths[b]);
      ctx.fillStyle = `rgba(${color2.join(',')},${a.toFixed(3)})`; ctx.fill(half[b]);
    }
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || still.matches) return;
    if (now - last >= 33) { last = now; draw((now - t0) / 1000); }
    raf = requestAnimationFrame(frame);
  }
  const play = () => { if (!raf && visible && !document.hidden && !still.matches) raf = requestAnimationFrame(frame); };

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; play(); }).observe(canvas);
  document.addEventListener('visibilitychange', play);
  still.addEventListener?.('change', () => (still.matches ? draw(2.2) : play()));
  new MutationObserver(() => { readColors(); if (still.matches) draw(2.2); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  resize();
  play();
})();
