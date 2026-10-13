/*
 * SokoBalagan — isometric voxel renderer (Canvas 2D, no dependencies).
 *
 * Everything in the world is made of unit voxels. Each voxel is drawn with
 * the painter's algorithm, sorted by (x + y + z): in a 2:1 isometric view,
 * two unit cubes with the same sum never overlap on screen, and a cube can
 * only be hidden by one with a larger sum.
 *
 * Faces are painted in their own (u, v) space: the canvas transform maps the
 * unit square onto the face's parallelogram, so details (planks, eyes,
 * rings) are drawn once and come out correctly skewed for free.
 */
(function () {
  'use strict';
  const SB = (window.SokoBalagan = window.SokoBalagan || {});

  const TILE_W = 64;
  const TILE_H = 32;
  const TILE_Z = 38;

  // Light comes from the upper-left of the screen.
  const LIGHT = { top: 1.0, left: 0.8, right: 0.62 };

  const COLORS = {
    grass: ['#7cc576', '#a3cf68', '#d2cc63', '#e8b35f', '#e88d5a'], // by elevation 1..5
    dirt: ['#8a6a4f', '#7a5c44'],
    crate: '#dc9d50',
    crateDark: '#8a5622',
    heavy: '#8d7be6',
    heavyDark: '#41348f',
    player: '#ff5c8a',
    playerDark: '#9e1f4a',
    target: '255, 208, 80',
    outline: 'rgba(22, 14, 38, 0.42)',
    pit: '#0b0818',
  };

  const BLEED = 0.006; // tiny overdraw that hides anti-aliasing seams between faces

  // ---------------------------------------------------------------- helpers

  function project(x, y, z) {
    return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 - z * TILE_Z };
  }

  function tone(hex, f, alpha = 1) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    if (f <= 1) {
      r *= f;
      g *= f;
      b *= f;
    } else {
      const k = Math.min(1, f - 1);
      r += (255 - r) * k;
      g += (255 - g) * k;
      b += (255 - b) * k;
    }
    return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
  }

  function hash(a, b, c, d) {
    let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263) ^ Math.imul(c + 13, 1274126177) ^ Math.imul(d + 29, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Rotate a world cell by `rot` quarter turns. Grid is W×D before rotating. */
  function rotateCell(x, y, W, D, rot) {
    for (let i = 0; i < rot; i++) {
      [x, y] = [D - 1 - y, x];
      [W, D] = [D, W];
    }
    return [x, y];
  }

  function rotateDir(dx, dy, rot) {
    for (let i = 0; i < rot; i++) [dx, dy] = [-dy, dx];
    return [dx, dy];
  }

  const key = (x, y, z) => x + ',' + y + ',' + z;

  function pointInQuad(px, py, q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cross !== 0) {
        const s = cross > 0 ? 1 : -1;
        if (sign && s !== sign) return false;
        sign = s;
      }
    }
    return true;
  }

  // ------------------------------------------------------------ scene build

  function buildScene(level, rot) {
    const W = level.width;
    const D = level.depth;
    const RW = rot % 2 ? D : W;
    const RD = rot % 2 ? W : D;
    const solid = new Set();
    const items = [];
    const columns = new Map();
    let maxTop = 0;

    for (let y = 0; y < D; y++) {
      for (let x = 0; x < W; x++) {
        const [rx, ry] = rotateCell(x, y, W, D, rot);
        const ground = level.heights[y][x];
        const col = { x, y, rx, ry, ground, top: ground, target: level.isTarget(x, y), object: null };
        columns.set(x + ',' + y, col);
        for (let z = 0; z < ground; z++) {
          items.push({ kind: 'ground', rx, ry, z, i: 0, h: 1, col });
          solid.add(key(rx, ry, z));
        }
      }
    }

    for (const obj of level.objects) {
      const col = columns.get(obj.x + ',' + obj.y);
      const z0 = col.ground;
      col.object = obj;
      col.top = z0 + obj.h;
      const facing = obj.facing ? rotateDir(obj.facing[0], obj.facing[1], rot) : null;
      for (let i = 0; i < obj.h; i++) {
        items.push({ kind: obj.kind, rx: col.rx, ry: col.ry, z: z0 + i, i, h: obj.h, z0, obj, col, facing });
        solid.add(key(col.rx, col.ry, z0 + i));
      }
    }

    for (const col of columns.values()) {
      maxTop = Math.max(maxTop, col.top);
      if (col.target && !col.object && col.ground > 0) {
        items.push({ kind: 'glow', rx: col.rx, ry: col.ry, z: col.ground, i: 0, h: 1, col });
      }
    }

    items.sort((a, b) => a.rx + a.ry + a.z - (b.rx + b.ry + b.z) || a.z - b.z);

    const corners = [];
    for (const [cx, cy] of [[0, 0], [RW, 0], [RW, RD], [0, RD]]) {
      corners.push(project(cx, cy, 0), project(cx, cy, maxTop));
    }
    const bounds = {
      minX: Math.min(...corners.map((p) => p.x)),
      maxX: Math.max(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxY: Math.max(...corners.map((p) => p.y)),
    };

    return { items, columns, RW, RD, rot, bounds, isSolid: (x, y, z) => solid.has(key(x, y, z)) };
  }

  // --------------------------------------------------------------- painters
  // Each painter draws in face (u, v) space: u ∈ [0,1] left→right on screen,
  // v ∈ [0,1] top→bottom (for top faces: v runs along +y).

  function outline(ctx, lw = 0.025) {
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = lw;
    ctx.strokeRect(0, 0, 1, 1);
  }

  function base(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(-BLEED, -BLEED, 1 + 2 * BLEED, 1 + 2 * BLEED);
  }

  function grassColor(col) {
    return COLORS.grass[Math.min(Math.max(col.ground, 1), COLORS.grass.length) - 1];
  }

  const PAINTERS = {
    ground(ctx, { it, side, f, scene, opts, t }) {
      const { rx, ry, z, col } = it;
      if (side === 'top') {
        base(ctx, tone(grassColor(col), (col.x + col.y) % 2 ? 0.95 : 1.0));

        // Ambient occlusion where taller neighbours stand behind this tile.
        const ao = (x0, y0, x1, y1, w, h) => {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, 'rgba(20,10,40,0.30)');
          g.addColorStop(1, 'rgba(20,10,40,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        };
        if (scene.isSolid(rx - 1, ry, z + 1)) ao(0, 0, 0.38, 0, 0.38, 1);
        if (scene.isSolid(rx, ry - 1, z + 1)) ao(0, 0, 0, 0.38, 1, 0.38);

        if (opts.grid) {
          ctx.strokeStyle = 'rgba(30,40,20,0.22)';
          ctx.lineWidth = 0.02;
          ctx.strokeRect(0, 0, 1, 1);
        }

        if (col.target) paintTargetMarker(ctx, t);
        return;
      }

      // Side of a ground cube: alternating strata so you can count the height.
      base(ctx, tone(COLORS.dirt[z % 2], f));
      for (let k = 0; k < 4; k++) {
        const r = hash(rx, ry, z, k + (side === 'left' ? 0 : 10));
        const s = hash(ry, rx, k, z);
        ctx.fillStyle = tone(COLORS.dirt[(z + 1) % 2], f * 0.85);
        ctx.fillRect(0.1 + r * 0.75, 0.3 + s * 0.6, 0.08, 0.05);
      }
      if (z === col.ground - 1) {
        ctx.fillStyle = tone(grassColor(col), f);
        ctx.fillRect(-BLEED, -BLEED, 1 + 2 * BLEED, 0.2);
        ctx.fillStyle = tone(grassColor(col), f * 0.75);
        ctx.fillRect(0, 0.2, 1, 0.035);
      }
      outline(ctx);
    },

    crate(ctx, { f }) {
      base(ctx, tone(COLORS.crate, f));
      ctx.strokeStyle = tone(COLORS.crateDark, f);
      ctx.lineWidth = 0.07;
      ctx.strokeRect(0.1, 0.1, 0.8, 0.8);
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(0.13, 0.87);
      ctx.lineTo(0.87, 0.13);
      ctx.stroke();
      ctx.strokeStyle = tone(COLORS.crate, f * 1.18);
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0.14, 0.38);
      ctx.lineTo(0.38, 0.14);
      ctx.moveTo(0.62, 0.86);
      ctx.lineTo(0.86, 0.62);
      ctx.stroke();
      outline(ctx, 0.03);
    },

    heavy(ctx, { side, f }) {
      base(ctx, tone(COLORS.heavy, f));
      const dark = tone(COLORS.heavyDark, f);
      ctx.strokeStyle = dark;
      ctx.fillStyle = dark;
      const rivet = (u, v, ru, rv) => {
        ctx.beginPath();
        ctx.ellipse(u, v, ru, rv, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      if (side === 'top') {
        ctx.lineWidth = 0.06;
        ctx.strokeRect(0.1, 0.1, 0.8, 0.8);
        ctx.fillStyle = tone(COLORS.heavy, 1.12);
        ctx.fillRect(0.28, 0.28, 0.44, 0.44);
        ctx.fillStyle = dark;
        for (const [u, v] of [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82], [0.82, 0.82]]) rivet(u, v, 0.035, 0.035);
      } else {
        // Face spans 2 units tall, so v-space is squashed by 2.
        ctx.lineWidth = 0.05;
        ctx.strokeRect(0.09, 0.045, 0.82, 0.91);
        ctx.fillRect(0, 0.475, 1, 0.05);
        ctx.fillStyle = tone(COLORS.heavy, f * 1.1);
        ctx.fillRect(0.2, 0.1, 0.6, 0.06);
        ctx.fillRect(0.2, 0.58, 0.6, 0.06);
        ctx.fillStyle = dark;
        for (const v of [0.1, 0.42, 0.58, 0.9]) {
          rivet(0.16, v, 0.035, 0.018);
          rivet(0.84, v, 0.035, 0.018);
        }
      }
      outline(ctx, 0.03);
    },

    player(ctx, { it, side, f }) {
      base(ctx, tone(COLORS.player, f));
      if (side === 'top') {
        ctx.fillStyle = tone(COLORS.player, 1.18);
        ctx.fillRect(0.16, 0.16, 0.68, 0.68);
        ctx.fillStyle = tone(COLORS.player, 1.35);
        ctx.fillRect(0.22, 0.22, 0.2, 0.2);
        outline(ctx, 0.03);
        return;
      }
      // Scarf band on every side.
      ctx.fillStyle = tone(COLORS.playerDark, f);
      ctx.fillRect(0, 0.78, 1, 0.1);

      const normal = side === 'right' ? [1, 0] : [0, 1];
      const facingThis = it.facing && it.facing[0] === normal[0] && it.facing[1] === normal[1];
      if (facingThis) {
        for (const u of [0.32, 0.68]) {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.ellipse(u, 0.4, 0.12, 0.15, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1c1030';
          ctx.beginPath();
          ctx.ellipse(u + 0.02, 0.43, 0.06, 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,200,215,0.55)';
        for (const u of [0.17, 0.83]) {
          ctx.beginPath();
          ctx.ellipse(u, 0.6, 0.07, 0.04, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#1c1030';
        ctx.lineWidth = 0.045;
        ctx.beginPath();
        ctx.arc(0.5, 0.56, 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
      outline(ctx, 0.03);
    },
  };

  function paintTargetMarker(ctx, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 380);
    ctx.save();
    ctx.shadowColor = `rgba(${COLORS.target},0.9)`;
    ctx.shadowBlur = 6 + 10 * pulse;
    ctx.fillStyle = `rgba(${COLORS.target},${0.18 + 0.12 * pulse})`;
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${COLORS.target},1)`;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${COLORS.target},1)`;
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --------------------------------------------------------------- renderer

  class IsoRenderer {
    constructor(canvas, level) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.level = level;
      this.rot = 0;
      this.zoomMul = 1;
      this.pan = { x: 0, y: 0 };
      this.opts = { grid: true, heights: false };
      this.hover = null;
      this.faces = [];
      this.build();
      this.resize();
    }

    build() {
      this.scene = buildScene(this.level, this.rot);
    }

    rotate(dir) {
      this.rot = (this.rot + dir + 4) % 4;
      this.pan = { x: 0, y: 0 };
      this.hover = null;
      this.build();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = dpr;
      this.cssW = rect.width;
      this.cssH = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
    }

    view() {
      const B = this.scene.bounds;
      const fit = Math.min((this.cssW * 0.84) / (B.maxX - B.minX), (this.cssH * 0.74) / (B.maxY - B.minY));
      const scale = fit * this.zoomMul;
      const cx = (B.minX + B.maxX) / 2;
      const cy = (B.minY + B.maxY) / 2;
      return {
        scale,
        cx,
        cy,
        ox: this.cssW / 2 - cx * scale + this.pan.x,
        oy: this.cssH / 2 - cy * scale + this.pan.y,
      };
    }

    /** Zoom by `factor`, keeping the point under (mx, my) fixed on screen. */
    zoomAt(factor, mx, my) {
      const v = this.view();
      const next = Math.min(4, Math.max(0.4, this.zoomMul * factor));
      if (next === this.zoomMul) return;
      const wx = (mx - v.ox) / v.scale;
      const wy = (my - v.oy) / v.scale;
      this.zoomMul = next;
      const s = this.view().scale;
      this.pan.x = mx - wx * s - this.cssW / 2 + v.cx * s;
      this.pan.y = my - wy * s - this.cssH / 2 + v.cy * s;
    }

    resetCamera() {
      this.zoomMul = 1;
      this.pan = { x: 0, y: 0 };
    }

    /** Returns the world column under a CSS-pixel position, or null. */
    pick(mx, my) {
      const v = this.view();
      const wx = (mx - v.ox) / v.scale;
      const wy = (my - v.oy) / v.scale;
      for (let i = this.faces.length - 1; i >= 0; i--) {
        if (pointInQuad(wx, wy, this.faces[i].quad)) return this.faces[i].it.col;
      }
      return null;
    }

    render(t) {
      const { ctx, dpr } = this;
      const v = this.view();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
      this.faces = [];

      this.drawFootprint(v.scale);
      for (const it of this.scene.items) {
        if (it.kind === 'glow') this.drawGlow(it, t);
        else this.drawVoxel(it, t);
      }
      this.drawHover(v.scale, t);
    }

    drawFootprint(scale) {
      const { ctx, dpr } = this;
      const { RW, RD } = this.scene;
      const pts = [project(0, 0, 0), project(RW, 0, 0), project(RW, RD, 0), project(0, RD, 0)];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 50 * dpr * scale;
      ctx.shadowOffsetY = 34 * dpr * scale;
      ctx.fillStyle = COLORS.pit;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawVoxel(it, t) {
      const S = this.scene;
      const { rx, ry, z } = it;
      const multi = it.h > 1;
      const zb = multi ? it.z0 : z;
      const zt = multi ? it.z0 + it.h : z + 1;
      // Slice of the full object face that belongs to this voxel (v runs top→bottom).
      const v0 = (it.h - 1 - it.i) / it.h;
      const v1 = (it.h - it.i) / it.h;
      const slice = multi ? [v0, v1] : null;

      if (!S.isSolid(rx, ry + 1, z)) {
        this.face(it, 'left', [rx, ry + 1, zt], [rx + 1, ry + 1, zt], [rx, ry + 1, zb], slice, LIGHT.left, t);
      }
      if (!S.isSolid(rx + 1, ry, z)) {
        this.face(it, 'right', [rx + 1, ry + 1, zt], [rx + 1, ry, zt], [rx + 1, ry + 1, zb], slice, LIGHT.right, t);
      }
      if (!S.isSolid(rx, ry, z + 1)) {
        this.face(it, 'top', [rx, ry, z + 1], [rx + 1, ry, z + 1], [rx, ry + 1, z + 1], null, LIGHT.top, t);
        if (it.kind === 'ground' && this.opts.heights) this.drawHeightLabel(it);
      }
    }

    face(it, side, P0, P1, P3, slice, f, t) {
      const ctx = this.ctx;
      const a = project(...P0);
      const b = project(...P1);
      const c = project(...P3);
      const ux = b.x - a.x, uy = b.y - a.y;
      const vx = c.x - a.x, vy = c.y - a.y;

      ctx.save();
      ctx.transform(ux, uy, vx, vy, a.x, a.y);
      if (slice) {
        // Slightly overlap neighbouring slices so tall objects show no seam.
        ctx.beginPath();
        ctx.rect(-0.02, slice[0] - 0.01, 1.04, slice[1] - slice[0] + 0.02);
        ctx.clip();
      }
      PAINTERS[it.kind](ctx, { it, side, f, t, scene: this.scene, opts: this.opts });
      ctx.restore();

      const [s0, s1] = slice || [0, 1];
      const at = (u, v) => ({ x: a.x + u * ux + v * vx, y: a.y + u * uy + v * vy });
      this.faces.push({ it, quad: [at(0, s0), at(1, s0), at(1, s1), at(0, s1)] });
    }

    drawHeightLabel(it) {
      const ctx = this.ctx;
      const p = project(it.rx + 0.5, it.ry + 0.5, it.z + 1);
      ctx.save();
      ctx.font = '700 13px ui-rounded, "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,14,40,0.7)';
      ctx.strokeText(String(it.col.ground), p.x, p.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(it.col.ground), p.x, p.y);
      ctx.restore();
    }

    /** Translucent column of light above an empty target tile. */
    drawGlow(it, t) {
      const ctx = this.ctx;
      const { rx, ry, z } = it;
      const pulse = 0.5 + 0.5 * Math.sin(t / 380);
      const zt = z + 1;
      const faces = [
        [[rx, ry + 1, zt], [rx, ry, zt], [rx, ry + 1, z]], // back -x
        [[rx, ry, zt], [rx + 1, ry, zt], [rx, ry, z]], // back -y
        [[rx, ry + 1, zt], [rx + 1, ry + 1, zt], [rx, ry + 1, z]], // front +y
        [[rx + 1, ry + 1, zt], [rx + 1, ry, zt], [rx + 1, ry + 1, z]], // front +x
      ];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [P0, P1, P3] of faces) {
        const a = project(...P0);
        const b = project(...P1);
        const c = project(...P3);
        ctx.save();
        ctx.transform(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y, a.x, a.y);
        const g = ctx.createLinearGradient(0, 0, 0, 1);
        g.addColorStop(0, `rgba(${COLORS.target},0)`);
        g.addColorStop(1, `rgba(${COLORS.target},${0.12 + 0.14 * pulse})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1, 1);
        ctx.restore();
      }
      ctx.restore();
    }

    drawHover(scale, t) {
      const col = this.hover;
      if (!col) return;
      const ctx = this.ctx;
      const { rx, ry, top } = col;
      const pts = [project(rx, ry, top), project(rx + 1, ry, top), project(rx + 1, ry + 1, top), project(rx, ry + 1, top)];
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.lineDashOffset = -t / 60 / scale;
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
    }
  }

  SB.IsoRenderer = IsoRenderer;
  SB.RENDER = { TILE_W, TILE_H, TILE_Z, COLORS };
})();
