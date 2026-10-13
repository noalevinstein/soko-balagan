/*
 * SokoBalagan — procedural level generator ("Reverse Play" / random pull).
 *
 *   1. Pick target tiles and put a box ON each one — a solved state.
 *   2. Random-walk a virtual agent backwards through time: each step either
 *      walks the agent back one tile, or walks it back while PULLING the box
 *      in front of it (the exact reverse of a push, including boxes that had
 *      fallen off a ledge being lifted back up).
 *   3. After N pulls, the positions of the boxes and the agent become the
 *      level's starting state.
 *
 * Why it's guaranteed solvable: every reverse step is *verified* by running
 * the real forward engine (Game.tryMove) from the proposed earlier state and
 * checking it reproduces the later state exactly. So each step is the true
 * inverse of a legal move, and replaying the recorded directions backwards
 * is a valid solution — returned as `solution` (world directions).
 *
 * Schrödinger boxes are added only as decoys and are never pulled, so no
 * solution depends on a coin flip. Everything is driven by a seeded RNG, so
 * a seed always rebuilds the same level.
 */
(function () {
  'use strict';
  const SB = (window.SokoBalagan = window.SokoBalagan || {});

  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  /** Small, fast, seedable PRNG. */
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  function sample(rng, arr, n) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  const clone = (objects) => objects.map((o) => ({ ...o }));
  const samePositions = (a, b) => a.every((o, i) => o.x === b[i].x && o.y === b[i].y && o.z === b[i].z);

  /**
   * Is `next` exactly what a legal forward move in direction d produces
   * from `prev`? `sim` is a scratch Game used as the physics oracle.
   */
  function isForwardMove(sim, prev, next, d) {
    // The earlier state must be physically settled.
    sim.level.objects = clone(prev);
    sim.applyGravity();
    if (!samePositions(sim.level.objects, prev)) return false;

    sim.level.objects = clone(prev);
    sim.won = false;
    sim.history.length = 0;
    const res = sim.tryMove(d[0], d[1]);
    return res.moved && samePositions(sim.level.objects, next);
  }

  /** All verified ways the agent could have arrived at `state` one move ago. */
  function reverseMoves(sim, state) {
    const out = [];
    const p = state.find((o) => o.kind === 'player');
    for (const d of DIRS) {
      // The agent came from the tile behind it…
      const bx = p.x - d[0];
      const by = p.y - d[1];
      if (!sim.inBounds(bx, by)) continue;

      // a) …by simply walking (or jumping / dropping) forward.
      {
        const prev = clone(state);
        const pl = prev.find((o) => o.kind === 'player');
        sim.level.objects = prev;
        pl.x = bx;
        pl.y = by;
        pl.z = sim.surface(bx, by, pl);
        // Never step back onto a box: the only way onto a pushable box is a
        // jump, which the forward engine turns into a push, so the walk would
        // be stuck there with no further reverse moves.
        const onObject = pl.z !== sim.ground(bx, by);
        if (!onObject && isForwardMove(sim, prev, state, d)) out.push({ prev, d, pull: false });
      }

      // b) …or by pushing the box that is now in front of it. Reversed, that
      //    is a pull: the box comes back to the agent's tile at the agent's
      //    height, and the agent steps back.
      const fx = p.x + d[0];
      const fy = p.y + d[1];
      if (!sim.inBounds(fx, fy)) continue;
      const column = state.filter((o) => o.x === fx && o.y === fy && o.kind !== 'player');
      if (!column.length) continue;
      const box = column.reduce((a, b) => (b.z > a.z ? b : a)); // only the top box can have been pushed
      if (box.kind === 'quantum' || box.kind === 'iron' || box.z > p.z) continue;

      const prev = clone(state);
      const pl = prev.find((o) => o.kind === 'player');
      const pb = prev.find((o) => o.id === box.id);
      pb.x = p.x;
      pb.y = p.y;
      pb.z = p.z;
      sim.level.objects = prev;
      pl.x = bx;
      pl.y = by;
      pl.z = sim.surface(bx, by, pl);
      if (pl.z === p.z && pl.z === sim.ground(bx, by) && isForwardMove(sim, prev, state, d)) {
        out.push({ prev, d, pull: true });
      }
    }
    return out;
  }

  function parseHeights(terrain) {
    return terrain.map((row) => [...row].map((ch) => (ch === '.' ? 0 : parseInt(ch, 10) || 0)));
  }

  function attempt(rng, cfg) {
    const heights = parseHeights(cfg.terrain);
    const cells = [];
    heights.forEach((row, y) => row.forEach((h, x) => h > 0 && cells.push({ x, y })));
    const picked = sample(rng, cells, cfg.boxes + cfg.chaos + 2);
    const targets = picked.slice(0, cfg.boxes);
    const chaos = picked.slice(cfg.boxes, cfg.boxes + cfg.chaos);
    const playerCell = picked[cfg.boxes + cfg.chaos];
    const decoyCell = picked[cfg.boxes + cfg.chaos + 1];

    const tallIndex = rng() < cfg.tallChance ? Math.floor(rng() * cfg.boxes) : -1;
    const boxes = targets.map((t, i) => ({ x: t.x, y: t.y, h: i === tallIndex ? 2 : 1 }));
    if (cfg.decoys) boxes.push({ x: decoyCell.x, y: decoyCell.y, h: 1, quantum: true });

    const solvedDef = {
      name: 'generator',
      terrain: cfg.terrain,
      targets,
      chaos,
      player: { x: playerCell.x, y: playerCell.y, facing: 'S' },
      boxes,
    };

    // A scratch game is the physics oracle. Its own RNG only matters for
    // Schrödinger boxes, which a verified move can never push anyway.
    const sim = new SB.Game(solvedDef, { rng: mulberry32(1) });
    let state = clone(sim.level.objects);
    const reverseDirs = [];
    let pulls = 0;

    for (let step = 0; pulls < cfg.pulls && step < cfg.pulls * 25; step++) {
      const moves = reverseMoves(sim, state);
      if (!moves.length) break;
      const pullMoves = moves.filter((m) => m.pull);
      const move = pullMoves.length && rng() < cfg.pullBias ? pick(rng, pullMoves) : pick(rng, moves);
      state = move.prev;
      reverseDirs.push(move.d);
      if (move.pull) pulls++;
    }

    // Score: how scrambled is it? Every target uncovered is worth most.
    const covered = (t) => state.some((o) => o.kind !== 'player' && o.x === t.x && o.y === t.y && o.z === heights[t.y][t.x]);
    const uncovered = targets.filter((t) => !covered(t)).length;
    if (!uncovered) return null; // still solved — useless
    let spread = 0;
    targets.forEach((t, i) => {
      const b = state[i + 1];
      spread += Math.abs(b.x - t.x) + Math.abs(b.y - t.y);
    });

    const pl = state[0];
    const def = {
      name: 'Random',
      terrain: cfg.terrain,
      targets,
      chaos,
      player: { x: pl.x, y: pl.y, z: pl.z, facing: 'S' },
      boxes: state.slice(1).map((o) => ({ x: o.x, y: o.y, z: o.z, h: o.h, quantum: o.kind === 'quantum' || undefined })),
    };
    return {
      def,
      solution: reverseDirs.reverse(),
      pulls,
      score: uncovered * 1000 + spread * 10 + pulls,
    };
  }

  /**
   * Generate a solvable level. Options: seed, terrain, boxes (targets),
   * pulls (N), attempts, chaos (tile count), decoys (Schrödinger boxes).
   * Returns { def, solution, seed, pulls }.
   */
  function generateLevel(opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    const rng = mulberry32(seed);
    const cfg = {
      terrain: opts.terrain || SB.LEVELS[0].terrain,
      boxes: opts.boxes || 3,
      pulls: opts.pulls || 30,
      attempts: opts.attempts || 5,
      chaos: opts.chaos !== undefined ? opts.chaos : 2,
      decoys: opts.decoys !== undefined ? opts.decoys : 1,
      tallChance: 0.35,
      pullBias: 0.6,
    };

    let best = null;
    for (let i = 0; i < cfg.attempts; i++) {
      const result = attempt(rng, cfg);
      if (result && (!best || result.score > best.score)) best = result;
    }
    if (!best) throw new Error(`Could not generate a level from seed ${seed}`);
    best.seed = seed;
    best.def.name = `Random #${seed}`;
    return best;
  }

  SB.generateLevel = generateLevel;
  SB.mulberry32 = mulberry32;
})();
