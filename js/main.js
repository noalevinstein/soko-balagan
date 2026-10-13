/*
 * SokoBalagan — Phase 1 bootstrap: renders a static level and wires up the
 * camera (rotate / zoom / pan) and a hover inspector. No game logic yet.
 */
(function () {
  'use strict';
  const SB = window.SokoBalagan;

  const canvas = document.getElementById('stage');
  const tooltip = document.getElementById('tooltip');
  const level = SB.parseLevel(SB.LEVELS[0]);
  const renderer = new SB.IsoRenderer(canvas, level);

  // ------------------------------------------------------------ render loop
  function frame(t) {
    renderer.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => renderer.resize());

  // ----------------------------------------------------------------- camera
  const actions = {
    'rotate-left': () => renderer.rotate(-1),
    'rotate-right': () => renderer.rotate(1),
    'zoom-in': () => renderer.zoomAt(1.2, renderer.cssW / 2, renderer.cssH / 2),
    'zoom-out': () => renderer.zoomAt(1 / 1.2, renderer.cssW / 2, renderer.cssH / 2),
    reset: () => renderer.resetCamera(),
    grid: (btn) => toggle(btn, 'grid'),
    heights: (btn) => toggle(btn, 'heights'),
  };

  function toggle(btn, opt) {
    renderer.opts[opt] = !renderer.opts[opt];
    btn.setAttribute('aria-pressed', String(renderer.opts[opt]));
  }

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      actions[btn.dataset.action](btn);
      hideTooltip();
    });
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, px: renderer.pan.x, py: renderer.pan.y };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    hideTooltip();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      renderer.pan.x = drag.px + e.clientX - drag.x;
      renderer.pan.y = drag.py + e.clientY - drag.y;
      return;
    }
    inspect(e);
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!drag) hideTooltip();
  });

  // -------------------------------------------------------------- inspector
  const NAMES = { player: 'Player · 1×1×1', crate: 'Box · 1×1×1', heavy: 'Tall box · 1×1×2' };

  function inspect(e) {
    const r = canvas.getBoundingClientRect();
    const col = renderer.pick(e.clientX - r.left, e.clientY - r.top);
    renderer.hover = col;
    if (!col) return hideTooltip();

    const lines = [`<strong>Tile (${col.x}, ${col.y})</strong>`];
    lines.push(col.ground ? `Ground height: ${col.ground}` : 'Pit');
    if (col.object) lines.push(`${NAMES[col.object.kind]} — top at ${col.top}`);
    if (col.target) lines.push('<span class="gold">★ Target tile</span>');
    tooltip.innerHTML = lines.join('<br>');
    tooltip.hidden = false;

    const x = Math.min(e.clientX + 16, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(e.clientY + 16, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }

  function hideTooltip() {
    renderer.hover = null;
    tooltip.hidden = true;
  }
})();
