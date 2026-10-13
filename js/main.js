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
    winMap: document.getElementById('win-map'),
    log: document.getElementById('input-log'),
  };
  const game = new SB.Game(SB.LEVELS[0]);
  const renderer = new SB.IsoRenderer(canvas, game.level);

  function updateHud() {
    hud.moves.textContent = game.moves;
    hud.pushes.textContent = game.pushes;
    hud.win.hidden = !game.won;
    if (game.won) {
      hud.winStats.textContent = `${game.moves} moves · ${game.pushes} pushes`;
      hud.winMap.textContent = SB.DIRECTION_KEYS.map((k) => `${GLYPH[k]} was ${GLYPH[game.controls[k]]}`).join('   ');
    }
  }

  // ------------------------------------------------------------- input log
  // Shows only which key was physically pressed and what happened — never
  // the direction it mapped to. Working that out is the game.
  const GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };
  const KEY_LABEL = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
  const OUTCOME = {
    move: 'moved',
    fall: 'dropped',
    push: 'pushed',
    jump: 'jumped',
    blocked: 'bumped',
    iron: 'CLUNK! iron box',
    dropped: 'too fast — ignored',
    queued: '…',
  };
  const LOG_SIZE = 8;
  let pressCount = 0;

  function logNote(text) {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = text;
    hud.log.prepend(li);
    trimLog();
  }

  function logPress(key) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n">#${++pressCount}</span><kbd>${GLYPH[key]}</kbd><span class="k">${KEY_LABEL[key]}</span><span class="out"></span>`;
    hud.log.prepend(li);
    trimLog();
    return li;
  }

  function setOutcome(li, outcome) {
    const el = li.querySelector('.out');
    el.textContent = OUTCOME[outcome];
    el.dataset.outcome = outcome;
  }

  function trimLog() {
    while (hud.log.children.length > LOG_SIZE) hud.log.lastElementChild.remove();
  }

  function resetLog() {
    hud.log.textContent = '';
    pressCount = 0;
    logNote('Controls scrambled! Find out what each arrow does.');
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

  /** A physical direction key was pressed: log it, then play its action. */
  function pressKey(key) {
    if (state === State.WON) return;
    const entry = logPress(key);
    if (state === State.ANIMATING) {
      if (queue.length < MAX_QUEUE) {
        queue.push({ key, entry });
        setOutcome(entry, 'queued');
      } else {
        setOutcome(entry, 'dropped');
      }
      return;
    }
    requestMove(key, entry);
  }

  function requestMove(key, entry) {
    // Chaos: the key's meaning comes from this level's shuffled mapping.
    const action = game.controls[key];
    // Directions are camera-relative: 'up' moves up-right on screen, 'right'
    // moves down-right, etc. Convert from rotated view space to world space.
    const screenDir = ACTION_DIRS[action];
    const [dx, dy] = SB.rotateDir(screenDir[0], screenDir[1], (4 - renderer.rot) % 4);
    const res = game.tryMove(dx, dy);
    if (!res.moved) {
      if (res.revealed === 'iron') {
        setOutcome(entry, 'iron');
        renderer.build();
        renderer.shakeObject(ironAt(dx, dy));
        return;
      }
      setOutcome(entry, 'blocked');
      renderer.build(); // the player may have turned to face the obstacle
      return;
    }
    setOutcome(entry, res.action);
    renderer.hallucinate(); // floor colours shift on every step
    if (res.reshuffled) logNote('⚡ Chaos tile! Controls reshuffled.');
    // Longer drops take longer to fall.
    const drop = Math.max(0, ...res.moves.map((m) => m.from.z - m.obj.z));
    enter(State.ANIMATING);
    renderer.animate(res.moves, DURATION[res.action] + 70 * drop, onMoveDone);
  }

  function ironAt(dx, dy) {
    const p = game.player;
    return game.objectsAt(p.x + dx, p.y + dy).find((o) => o.kind === 'iron');
  }

  function onMoveDone() {
    enter(game.won ? State.WON : State.IDLE);
    if (state !== State.IDLE) queue = [];
    // Blocked moves don't animate, so keep draining until one does.
    while (state === State.IDLE && queue.length) {
      const { key, entry } = queue.shift();
      requestMove(key, entry);
    }
    for (const { entry } of queue.splice(0)) setOutcome(entry, 'dropped');
  }

  function clearQueue() {
    for (const { entry } of queue) setOutcome(entry, 'dropped');
    queue = [];
  }

  function undo() {
    clearQueue();
    renderer.cancelAnimation();
    game.undo();
    renderer.build();
    enter(game.won ? State.WON : State.IDLE);
  }

  function restart() {
    clearQueue();
    game.restart(); // reshuffles the controls
    renderer.setLevel(game.level);
    resetLog();
    enter(State.IDLE);
  }

  // Physical keys → logical direction keys. WASD shares the arrows'
  // scrambled mapping so it can't be used to dodge the chaos.
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };
  const ACTION_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  resetLog();
  enter(State.IDLE);

  window.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      return undo();
    }
    if (e.ctrlKey || e.metaKey) return;

    if (KEYS[e.code]) {
      e.preventDefault();
      hideTooltip();
      return pressKey(KEYS[e.code]);
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
  // Schrödinger boxes deliberately read as plain boxes until revealed.
  const NAMES = {
    player: 'Player · 1×1×1',
    crate: 'Box · 1×1×1',
    quantum: 'Box · 1×1×1',
    iron: 'Heavy iron box · immovable',
    heavy: 'Tall box · 1×1×2',
  };
  const SUNK = { crate: 'Sunk box (floor)', quantum: 'Sunk box (floor)', iron: 'Sunk iron box (floor)', heavy: 'Sunk tall box (floor)' };

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
    if (col.chaos) lines.push('<span class="chaos">⚡ Chaos tile — reshuffles controls</span>');
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
