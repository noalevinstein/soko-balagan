/*
 * SokoBalagan — level data.
 *
 * Coordinate system (world space):
 *   x → columns (east), y → rows (south), z → up.
 *
 * `terrain` rows are strings; each character is the height of that ground
 * column in unit cubes ('1'..'9'). A '.' is a pit (no ground at all).
 * Objects sit on top of whatever ground column they are placed on.
 * Boxes with `quantum: true` are Schrödinger boxes. `chaos` lists Chaos
 * Tiles, which reshuffle the controls when the player steps on them.
 */
(function () {
  'use strict';
  const SB = (window.SokoBalagan = window.SokoBalagan || {});

  SB.LEVELS = [
    {
      name: 'Showcase',
      terrain: [
        '4433322222',
        '4211111122',
        '3211111112',
        '3111221111',
        '21112..111',
        '2111111111',
        '1111111111',
        '1111111111',
      ],
      targets: [{ x: 7, y: 4 }],
      chaos: [
        { x: 5, y: 5 },
        { x: 6, y: 1 },
      ],
      player: { x: 2, y: 5, facing: 'S' },
      boxes: [
        { x: 4, y: 2, h: 1 },
        { x: 4, y: 3, h: 1 }, // sits on the raised plateau
        { x: 8, y: 3, h: 2 },
        { x: 2, y: 2, h: 2 },
        { x: 7, y: 6, h: 1, quantum: true }, // two pushes from the target... if it cooperates
      ],
    },
  ];

  const FACING = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

  /** Turn a level definition into the structure the renderer consumes. */
  SB.parseLevel = function parseLevel(def) {
    const depth = def.terrain.length;
    const width = Math.max(...def.terrain.map((row) => row.length));
    const heights = def.terrain.map((row) =>
      Array.from({ length: width }, (_, x) => {
        const ch = row[x];
        return ch && ch !== '.' ? parseInt(ch, 10) || 0 : 0;
      })
    );
    const targets = new Set(def.targets.map((t) => t.x + ',' + t.y));
    const chaos = new Set((def.chaos || []).map((t) => t.x + ',' + t.y));

    const objects = [
      {
        kind: 'player',
        x: def.player.x,
        y: def.player.y,
        h: 1,
        z: def.player.z,
        facing: FACING[def.player.facing || 'S'],
      },
      ...def.boxes.map((b) => ({
        kind: b.quantum ? 'quantum' : b.h > 1 ? 'heavy' : 'crate',
        x: b.x,
        y: b.y,
        h: b.h || 1,
        z: b.z,
      })),
    ];
    objects.forEach((o, i) => (o.id = i));

    for (const o of objects) {
      if (o.x < 0 || o.y < 0 || o.x >= width || o.y >= depth) {
        throw new Error(`Level "${def.name}": ${o.kind} at (${o.x},${o.y}) is off the map`);
      }
      // An explicit z (used by generated levels, where objects can be stacked)
      // wins; otherwise objects start resting on the ground.
      if (o.z === undefined) {
        if (!heights[o.y][o.x]) {
          throw new Error(`Level "${def.name}": ${o.kind} at (${o.x},${o.y}) has no ground under it`);
        }
        o.z = heights[o.y][o.x];
      }
    }

    return {
      name: def.name,
      width,
      depth,
      heights,
      objects,
      isTarget: (x, y) => targets.has(x + ',' + y),
      isChaos: (x, y) => chaos.has(x + ',' + y),
    };
  };
})();
