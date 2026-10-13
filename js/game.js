/*
 * SokoBalagan — game rules (no rendering, no DOM).
 *
 * Rules with height:
 *   - The player can step up or down at most one level, and never into a pit.
 *   - The player can push a box only while standing level with part of it.
 *   - A box slides flat or falls down a ledge; it can never be pushed uphill,
 *     and you can't push two boxes at once.
 *   - A box pushed into a pit drops in and "sinks": it becomes floor.
 *   - The level is solved when every target has a box on it.
 */
(function () {
  'use strict';
  const SB = (window.SokoBalagan = window.SokoBalagan || {});

  const MAX_STEP = 1;

  class Game {
    constructor(def) {
      this.def = def;
      this.restart();
    }

    restart() {
      this.level = SB.parseLevel(this.def);
      this.moves = 0;
      this.pushes = 0;
      this.won = false;
      this.history = [];
    }

    get player() {
      return this.level.objects.find((o) => o.kind === 'player');
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.level.width && y < this.level.depth;
    }

    /** Height you'd stand on at (x, y): ground plus any sunk boxes. */
    surface(x, y) {
      let s = this.level.heights[y][x];
      for (const o of this.level.objects) {
        if (o.sunk && o.x === x && o.y === y) s = Math.max(s, o.z + o.h);
      }
      return s;
    }

    /** The solid object (player or box, not a sunk box) occupying (x, y). */
    blocker(x, y) {
      return this.level.objects.find((o) => !o.sunk && o.x === x && o.y === y) || null;
    }

    snapshot() {
      return {
        objects: this.level.objects.map((o) => ({ ...o })),
        moves: this.moves,
        pushes: this.pushes,
        won: this.won,
      };
    }

    /**
     * Try to move the player one cell in world direction (dx, dy).
     * Returns { moved, pushed, moves: [{ obj, from }] }. The player turns to
     * face the direction even when blocked.
     */
    tryMove(dx, dy) {
      const result = { moved: false, pushed: false, sunk: false, moves: [] };
      if (this.won) return result;

      const before = this.snapshot();
      const p = this.player;
      p.facing = [dx, dy];

      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!this.inBounds(nx, ny)) return result;

      const box = this.blocker(nx, ny);
      if (box) {
        // Must be standing level with some part of the box.
        if (p.z < box.z || p.z >= box.z + box.h) return result;
        const bx = nx + dx;
        const by = ny + dy;
        if (!this.inBounds(bx, by) || this.blocker(bx, by)) return result;
        const landing = this.surface(bx, by);
        if (landing > box.z) return result; // can't push uphill

        // The player will step into the cell the box leaves.
        const stepTo = this.surface(nx, ny);
        if (Math.abs(stepTo - p.z) > MAX_STEP) return result;

        result.moves.push({ obj: box, from: { x: box.x, y: box.y, z: box.z } });
        box.x = bx;
        box.y = by;
        box.z = landing;
        if (this.level.heights[by][bx] === 0 && landing === 0) {
          box.sunk = true;
          result.sunk = true;
        }
        result.pushed = true;
      }

      const stepTo = this.surface(nx, ny);
      if (stepTo === 0 || Math.abs(stepTo - p.z) > MAX_STEP) return result;

      result.moves.push({ obj: p, from: { x: p.x, y: p.y, z: p.z } });
      p.x = nx;
      p.y = ny;
      p.z = stepTo;

      this.moves++;
      if (result.pushed) this.pushes++;
      this.history.push(before);
      this.won = this.checkWin();
      result.moved = true;
      return result;
    }

    checkWin() {
      for (let y = 0; y < this.level.depth; y++) {
        for (let x = 0; x < this.level.width; x++) {
          if (!this.level.isTarget(x, y)) continue;
          const b = this.blocker(x, y);
          if (!b || b.kind === 'player') return false;
        }
      }
      return true;
    }

    undo() {
      const snap = this.history.pop();
      if (!snap) return false;
      this.level.objects = snap.objects;
      this.moves = snap.moves;
      this.pushes = snap.pushes;
      this.won = snap.won;
      return true;
    }
  }

  SB.Game = Game;
})();
