/*
 * SokoBalagan — game physics and rules (no rendering, no DOM).
 *
 * The world is a grid of columns. Each column has terrain of some height
 * (0 = pit) and may hold a stack of objects. A column's *surface* is the top
 * of whatever is highest in it. The player is 1 unit tall and stands at z.
 *
 * Moving one tile in a direction resolves in this order:
 *   1. Free move  — target surface ≤ player z: step across, then fall
 *                   (instant gravity) to whatever is below.
 *   2. Push       — a box whose base is exactly at the player's z sits in the
 *                   target tile, nothing is stacked on it, and the whole
 *                   volume it would move into (footprint × height) is empty.
 *                   The box slides, then falls with gravity; the player
 *                   steps into the freed tile.
 *   3. Jump       — target surface is exactly player z + 1 (terrain or the
 *                   top of an object): climb on top of it.
 *   4. Otherwise blocked (walls, tall stacks, two boxes in a row, ...).
 * The level is solved when every target tile has a box resting on it.
 */
(function () {
  'use strict';
  const SB = (window.SokoBalagan = window.SokoBalagan || {});

  const JUMP_HEIGHT = 1;

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

    ground(x, y) {
      return this.level.heights[y][x];
    }

    objectsAt(x, y, except = null) {
      return this.level.objects.filter((o) => o !== except && o.x === x && o.y === y);
    }

    /** Top of the highest thing in column (x, y), ignoring `except`. */
    surface(x, y, except = null) {
      let s = this.ground(x, y);
      for (const o of this.objectsAt(x, y, except)) s = Math.max(s, o.z + o.h);
      return s;
    }

    /** Is the unit cell (x, y, z) filled by terrain or an object? */
    occupied(x, y, z, except = null) {
      if (!this.inBounds(x, y)) return true;
      if (z < this.ground(x, y)) return true;
      return this.objectsAt(x, y, except).some((o) => z >= o.z && z < o.z + o.h);
    }

    /** Every unit cell `obj` would fill if moved by (dx, dy). */
    volumeAfterMove(obj, dx, dy) {
      const cells = [];
      const w = obj.w || 1; // footprint, for future multi-tile boxes
      const l = obj.l || 1;
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < l; j++) {
          for (let k = 0; k < obj.h; k++) cells.push([obj.x + i + dx, obj.y + j + dy, obj.z + k]);
        }
      }
      return cells;
    }

    /** Drop every object onto whatever is under it. */
    applyGravity() {
      const sorted = [...this.level.objects].sort((a, b) => a.z - b.z);
      for (const o of sorted) {
        let support = this.ground(o.x, o.y);
        for (const other of this.objectsAt(o.x, o.y, o)) {
          const top = other.z + other.h;
          if (top <= o.z) support = Math.max(support, top);
        }
        o.z = support;
        // A box resting on the bottom of a pit has filled it.
        o.sunk = o.kind !== 'player' && this.ground(o.x, o.y) === 0 && o.z === 0;
      }
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
     * Try to move the player one tile in world direction (dx, dy).
     * Returns { moved, action: 'move' | 'fall' | 'push' | 'jump' | null,
     * moves: [{ obj, from }] } — `moves` lists every object that changed
     * position, with where it started, for animation.
     */
    tryMove(dx, dy) {
      const result = { moved: false, action: null, moves: [] };
      if (this.won) return result;

      const before = this.snapshot();
      const startPos = new Map(this.level.objects.map((o) => [o, { x: o.x, y: o.y, z: o.z }]));
      const p = this.player;
      p.facing = [dx, dy]; // turn even if the move turns out to be blocked

      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!this.inBounds(nx, ny)) return result;
      const target = this.surface(nx, ny);

      if (target <= p.z) {
        // 1. Free move, then fall.
        p.x = nx;
        p.y = ny;
        result.action = target < p.z ? 'fall' : 'move';
      } else if (this.canPush(nx, ny, dx, dy, p.z)) {
        // 2. Push.
        const box = this.objectsAt(nx, ny).find((o) => o.z === p.z);
        box.x += dx;
        box.y += dy;
        p.x = nx;
        p.y = ny;
        result.action = 'push';
        this.pushes++;
      } else if (target - p.z === JUMP_HEIGHT) {
        // 3. Jump up onto terrain or an object.
        p.x = nx;
        p.y = ny;
        p.z = target;
        result.action = 'jump';
      } else {
        return result; // 4. Blocked.
      }

      this.applyGravity();
      for (const o of this.level.objects) {
        const from = startPos.get(o);
        if (from.x !== o.x || from.y !== o.y || from.z !== o.z) result.moves.push({ obj: o, from });
      }

      this.moves++;
      this.history.push(before);
      this.won = this.checkWin();
      result.moved = true;
      return result;
    }

    /** Can the player, standing at height z, push the box in (bx, by)? */
    canPush(bx, by, dx, dy, z) {
      const box = this.objectsAt(bx, by).find((o) => o.kind !== 'player' && o.z === z);
      if (!box) return false;
      // Nothing may ride on top of the box.
      if (this.objectsAt(bx, by, box).some((o) => o.z >= box.z + box.h)) return false;
      // The whole space it moves into must be empty.
      return this.volumeAfterMove(box, dx, dy).every(([x, y, k]) => !this.occupied(x, y, k, box));
    }

    checkWin() {
      for (let y = 0; y < this.level.depth; y++) {
        for (let x = 0; x < this.level.width; x++) {
          if (!this.level.isTarget(x, y)) continue;
          const g = this.ground(x, y);
          if (!this.objectsAt(x, y).some((o) => o.kind !== 'player' && o.z === g)) return false;
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
