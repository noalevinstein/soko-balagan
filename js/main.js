/*
 * SokoBalagan — bootstrap: wires the game rules to the renderer, keyboard
 * input, the camera (rotate / zoom / pan), the HUD and a hover inspector.
 */
(function () {
  'use strict';
  const SB = window.SokoBalagan;

  const canvas = document.getElementById('stage');
  const tooltip = document.getElementById('tooltip');
  const hud = {
    moves: document.getElementById('moves'),
    pushes: document.getElementById('pushes'),
    win: document.getElementById('win'),
    winStats: document.getElementById('win-stats'),
  };
  const game = new SB.Game(SB.LEVELS[0]);
  const renderer = new SB.IsoRenderer(canvas, game.level);

  function updateHud() {
    hud.moves.textContent = game.moves;
    hud.pushes.textContent = game.pushes;
    hud.win.hidden = !game.won;
    if (game.won) hud.winStats.textContent = `${game.moves} moves · ${game.pushes} pushes`;
  }

  // --------------------------------------------------------- state machine
  //   IDLE ──move──▶ ANIMATING ──tween done──▶ IDLE | WON
  //   Keypresses made while ANIMATING are buffered (up to MAX_QUEUE) and
  //   played in order, so quick taps aren't lost. Undo / restart work in
  //   every state and clear the buffer.
  const State = { IDLE: 'idle', ANIMATING: 'animating', WON: 'won' };
  const MAX_QUEUE = 3;
  let state = State.IDLE;
  let queue = [];

  const DURATION = { move: 140, push: 160, jump: 170, fall: 150 };

  function enter(next) {
    state = next;
    document.body.dataset.state = next;
    updateHud();
  }

  function requestMove(screenDir) {
    if (state === State.WON) return;
    if (state === State.ANIMATING) {
      if (queue.length < MAX_QUEUE) queue.push(screenDir);
      return;
    }
    // Arrow keys are camera-relative: Up moves up-right on screen, Right
    // moves down-right, etc. Convert from rotated view space to world space.
    const [dx, dy] = SB.rotateDir(screenDir[0], screenDir[1], (4 - renderer.rot) % 4);
    const res = game.tryMove(dx, dy);
    if (!res.moved) {
      renderer.build(); // the player may have turned to face the obstacle
      return;
    }
    // Longer drops take longer to fall.
    const drop = Math.max(0, ...res.moves.map((m) => m.from.z - m.obj.z));
    enter(State.ANIMATING);
    renderer.animate(res.moves, DURATION[res.action] + 70 * drop, onMoveDone);
  }

  function onMoveDone() {
    enter(game.won ? State.WON : State.IDLE);
    if (state !== State.IDLE) queue = [];
    // Blocked moves don't animate, so keep draining until one does.
    while (state === State.IDLE && queue.length) requestMove(queue.shift());
  }

  function undo() {
    queue = [];
    renderer.cancelAnimation();
    game.undo();
    renderer.build();
    enter(game.won ? State.WON : State.IDLE);
  }

  function restart() {
    queue = [];
    game.restart();
    renderer.setLevel(game.level);
    enter(State.IDLE);
  }

  const SCREEN_DIRS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  enter(State.IDLE);

  window.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      return undo();
    }
    if (e.ctrlKey || e.metaKey) return;

    if (SCREEN_DIRS[e.code]) {
      e.preventDefault();
      hideTooltip();
      return requestMove(SCREEN_DIRS[e.code]);
    }
    switch (e.code) {
      case 'KeyZ':
      case 'Backspace':
        e.preventDefault();
        return undo();
      case 'KeyR':
        return restart();
      case 'KeyQ':
        return renderer.rotate(-1);
      case 'KeyE':
        return renderer.rotate(1);
    }
  });

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
    undo: () => undo(),
    restart: () => restart(),
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
      btn.blur(); // keep Space/Enter from re-triggering the last clicked button
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
  const SUNK = { crate: 'Sunk box (floor)', heavy: 'Sunk tall box (floor)' };

  function inspect(e) {
    const r = canvas.getBoundingClientRect();
    const col = renderer.pick(e.clientX - r.left, e.clientY - r.top);
    renderer.hover = col;
    if (!col) return hideTooltip();

    const lines = [`<strong>Tile (${col.x}, ${col.y})</strong>`];
    lines.push(col.ground ? `Ground height: ${col.ground}` : 'Pit');
    for (const o of col.objects) {
      lines.push(o.sunk ? `${SUNK[o.kind]} — surface at ${o.z + o.h}` : `${NAMES[o.kind]} — top at ${o.z + o.h}`);
    }
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
