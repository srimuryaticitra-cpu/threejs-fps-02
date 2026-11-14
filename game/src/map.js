// Taman Senja, the one original map: a dusk garden courtyard, 44 by 32
// metres, with a fountain at mid, the Kebun garden (Site A, west) and the
// Kolam pond (Site B, east). Two lanes plus mid, crates and hedges for cover,
// long sightlines down each lane and short corners around the sites. Built
// from boxes, cylinders and discs in the palette — no imported art, no
// copied layout.
//
// The simulation and the picture agree by construction: the colliders below
// are the same boxes the renderer draws, and the minimap reads this same list.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Axis-aligned colliders: { x0, z0, x1, z1 }. Movement resolves in XZ only;
// every collider blocks the full height, so a jump never vaults a crate.
const COLLIDERS = [
  // Perimeter (the garden wall).
  { x0: -22, z0: -16, x1: 22, z1: -15.2 },
  { x0: -22, z0: 15.2, x1: 22, z1: 16 },
  { x0: -22, z0: -16, x1: -21.2, z1: 16 },
  { x0: 21.2, z0: -16, x1: 22, z1: 16 },
  // Mid fountain.
  { x0: -2.2, z0: -2.2, x1: 2.2, z1: 2.2 },
  // Mid planters, left and right of the fountain lane.
  { x0: -9, z0: -1.2, x1: -6.5, z1: 1.2 },
  { x0: 6.5, z0: -1.2, x1: 9, z1: 1.2 },
  // West lane wall with a gap at mid-west.
  { x0: -14, z0: -6, x1: -13.2, z1: -0.5 },
  { x0: -14, z0: 3.5, x1: -13.2, z1: 8 },
  // East lane wall with a gap at mid-east.
  { x0: 13.2, z0: -8, x1: 14, z1: -3.5 },
  { x0: 13.2, z0: 0.5, x1: 14, z1: 6 },
  // Site A hedges (Kebun).
  { x0: -19.5, z0: -11, x1: -16.5, z1: -10.2 },
  { x0: -19.5, z0: -4.5, x1: -18.7, z1: -1 },
  { x0: -16.5, z0: -11, x1: -15.7, z1: -8 },
  // Site B rocks (Kolam).
  { x0: 15.5, z0: 4, x1: 19.5, z1: 4.8 },
  { x0: 15.5, z0: 10.5, x1: 16.3, z1: 13.5 },
  // Crates as cover, scattered on the lanes.
  { x0: -6, z0: 6.5, x1: -4, z1: 8.5 },
  { x0: 4, z0: -8.5, x1: 6, z1: -6.5 },
  { x0: -10, z0: -9.5, x1: -8, z1: -7.5 },
  { x0: 8, z0: 7.5, x1: 10, z1: 9.5 },
  { x0: -2.5, z0: -11.5, x1: -0.5, z1: -9.5 },
  { x0: 0.5, z0: 9.5, x1: 2.5, z1: 11.5 },
];

// Named waypoints. A route is a list of waypoint names; bots walk them in order.
export const WAYPOINTS = {
  spawnKura: [0, 12.5],
  spawnKelinci: [0, -12.5],
  midSouth: [0, 6],
  midNorth: [0, -6],
  westMid: [-11, 1.5],
  eastMid: [11, -1.5],
  westLow: [-10, 10],
  eastLow: [10, -10],
  siteA: [-17.5, -7.5],
  siteAEntry: [-12, -7],
  siteAHold1: [-18.5, -5.5],
  siteAHold2: [-15.5, -10],
  siteB: [17.5, 7.5],
  siteBEntry: [12, 7],
  siteBHold1: [18.5, 10.5],
  siteBHold2: [15.5, 5.5],
  gardenWest: [-18, 2],
  pondEast: [18, -2],
};

export const ROUTES = {
  toA: ['westLow', 'westMid', 'siteAEntry', 'siteA'],
  toB: ['eastLow', 'eastMid', 'siteBEntry', 'siteB'],
  toMid: ['midSouth', 'midNorth'],
  toAFromNorth: ['siteAEntry', 'siteA'],
  toBFromNorth: ['siteBEntry', 'siteB'],
};

export const SITES = [
  { id: 'A', name: 'Kebun', label: 'SITE A — KEBUN', center: [-17.5, -7.5], radius: 4.2 },
  { id: 'B', name: 'Kolam', label: 'SITE B — KOLAM', center: [17.5, 7.5], radius: 4.2 },
];

export const SPAWNS = {
  kura: [[-2, 12.5], [0, 13], [2, 12.5], [-1, 11]],
  kelinci: [[-2, -12.5], [0, -13], [2, -12.5], [1, -11]],
};

// Perisai Tempurung: one shield pickup per round, on open ground just south
// of the mid fountain, on the Kura push route to mid (waypoint midSouth is [0, 6]).
export const SHIELD_SPAWN = [0, 4.5];

// Circle-vs-AABB slide: returns the corrected [x, z] after pushing a circle
// of radius r out of every collider it overlaps. Pure math, no allocations.
export function resolveCircle(x, z, r) {
  for (let i = 0; i < COLLIDERS.length; i += 1) {
    const c = COLLIDERS[i];
    const cx = x < c.x0 ? c.x0 : x > c.x1 ? c.x1 : x;
    const cz = z < c.z0 ? c.z0 : z > c.z1 ? c.z1 : z;
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = x - c.x0;
      const pr = c.x1 - x;
      const pt = z - c.z0;
      const pb = c.z1 - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.x0 - r;
      else if (m === pr) x = c.x1 + r;
      else if (m === pt) z = c.z0 - r;
      else z = c.z1 + r;
    }
  }
  return [x, z];
}

// 2D segment vs AABB test, used for line of sight: true when a wall blocks
// the segment. The slab method, no allocations.
export function segmentBlocked(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  for (let i = 0; i < COLLIDERS.length; i += 1) {
    const c = COLLIDERS[i];
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (ax < c.x0 || ax > c.x1) continue;
    } else {
      let t1 = (c.x0 - ax) / dx;
      let t2 = (c.x1 - ax) / dx;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < c.z0 || az > c.z1) continue;
    } else {
      let t1 = (c.z0 - az) / dz;
      let t2 = (c.z1 - az) / dz;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

export function createMap(scene) {
  const group = new THREE.Group();
  const wallMeshes = [];
  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.9 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: PALETTE.stoneDark, roughness: 0.95 }),
    leaf: new THREE.MeshStandardMaterial({ color: PALETTE.leaf, roughness: 1 }),
    amber: new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.4, emissive: PALETTE.amber, emissiveIntensity: 0.55 }),
    pond: new THREE.MeshStandardMaterial({ color: PALETTE.pond, roughness: 0.25, metalness: 0.1 }),
    shell: new THREE.MeshStandardMaterial({ color: PALETTE.shell, roughness: 0.7 }),
  };

  // One box from a collider rect, standing on the ground unless y0 says otherwise.
  function box(x0, z0, x1, z1, height, mat, y0 = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, height, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, y0 + height / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wall = true;
    group.add(mesh);
    wallMeshes.push(mesh);
    return mesh;
  }

  function buildFloor() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 32), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);
    // A subtle checker of darker garden tiles, so the floor reads at a glance.
    const tileGeo = new THREE.PlaneGeometry(2, 2);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0x35422f, roughness: 1 });
    for (let ix = -10; ix <= 10; ix += 2) {
      for (let iz = -7; iz <= 7; iz += 2) {
        if ((ix + iz) % 4 !== 0) continue;
        const tile = new THREE.Mesh(tileGeo, tileMat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(ix, 0.01, iz);
        tile.receiveShadow = true;
        group.add(tile);
      }
    }
  }

  function buildWallsAndCover() {
    // Perimeter walls, taller than the interior cover.
    box(-22, -16, 22, -15.2, 4, mats.stoneDark);
    box(-22, 15.2, 22, 16, 4, mats.stoneDark);
    box(-22, -16, -21.2, 16, 4, mats.stoneDark);
    box(21.2, -16, 22, 16, 4, mats.stoneDark);
    // Interior walls, hedges and crates, matching COLLIDERS in order.
    box(-14, -6, -13.2, -0.5, 2.6, mats.stone);
    box(-14, 3.5, -13.2, 8, 2.6, mats.stone);
    box(13.2, -8, 14, -3.5, 2.6, mats.stone);
    box(13.2, 0.5, 14, 6, 2.6, mats.stone);
    box(-19.5, -11, -16.5, -10.2, 1.4, mats.leaf);
    box(-19.5, -4.5, -18.7, -1, 1.4, mats.leaf);
    box(-16.5, -11, -15.7, -8, 1.4, mats.leaf);
    box(15.5, 4, 19.5, 4.8, 1.1, mats.stone);
    box(15.5, 10.5, 16.3, 13.5, 1.1, mats.stone);
    box(-6, 6.5, -4, 8.5, 1.2, mats.stone);
    box(4, -8.5, 6, -6.5, 1.2, mats.stone);
    box(-10, -9.5, -8, -7.5, 1.2, mats.stone);
    box(8, 7.5, 10, 9.5, 1.2, mats.stone);
    box(-2.5, -11.5, -0.5, -9.5, 1.2, mats.stone);
    box(0.5, 9.5, 2.5, 11.5, 1.2, mats.stone);
    // Mid planters (low, leafy).
    box(-9, -1.2, -6.5, 1.2, 0.9, mats.leaf);
    box(6.5, -1.2, 9, 1.2, 0.9, mats.leaf);
  }

  function buildFountain() {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.9, 24), mats.stone);
    ring.position.set(0, 0.45, 0);
    ring.castShadow = true;
    ring.receiveShadow = true;
    ring.userData.wall = true;
    group.add(ring);
    wallMeshes.push(ring);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.1, 24), mats.pond);
    water.position.set(0, 0.82, 0);
    group.add(water);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 12), mats.stoneDark);
    spout.position.set(0, 1.2, 0);
    spout.castShadow = true;
    group.add(spout);
  }

  function buildSites() {
    // Site A garden beds: low soil rows with sprouting leaves.
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
    for (let i = 0; i < 3; i += 1) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 0.8), soilMat);
      bed.position.set(-17.5, 0.18, -9.6 + i * 1.4);
      bed.receiveShadow = true;
      group.add(bed);
      for (let j = 0; j < 3; j += 1) {
        const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 6), mats.leaf);
        sprout.position.set(-18.4 + j * 0.9, 0.6, -9.6 + i * 1.4);
        group.add(sprout);
      }
    }
    // Site B pond: a still blue disc ringed with stones.
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 24), mats.pond);
    pond.position.set(17.5, 0.08, 7.5);
    pond.receiveShadow = true;
    group.add(pond);

    // Amber beacons mark the two sites, at each site's far corner so the
    // pillar never stands between the player and the pod planted at the centre.
    for (const site of SITES) {
      const bx = site.center[0] - 2.6;
      const bz = site.center[1] - 2.6;
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.8, 8), mats.amber);
      beacon.position.set(bx, 1.4, bz);
      group.add(beacon);
      const ringDisc = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.35, site.radius, 40), mats.amber);
      ringDisc.rotation.x = -Math.PI / 2;
      ringDisc.position.set(site.center[0], 0.03, site.center[1]);
      group.add(ringDisc);
      // A floating site letter, built from a canvas texture (no font files).
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f0a830';
      ctx.font = 'bold 92px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site.id, 64, 70);
      const tex = new THREE.CanvasTexture(canvas);
      const letter = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.6),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
      );
      letter.position.set(bx, 3.4, bz);
      group.add(letter);
      site.letterMesh = letter;
    }
  }

  function buildSky() {
    // Dusk lighting: a low warm sun plus cool ambient sky.
    const hemi = new THREE.HemisphereLight(0x8fb4c7, 0x2e3a26, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffc98a, 1.6);
    sun.position.set(-14, 18, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 60;
    scene.add(sun);
    scene.fog = new THREE.Fog(PALETTE.sky, 26, 60);

    // A pale moon and a scatter of stars above the garden wall, so the top
    // of the frame is never empty. Deterministic positions, no textures.
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(240 * 3);
    let starSeed = 1234567;
    const starRand = () => {
      starSeed = (starSeed * 1103515245 + 12345) & 0x7fffffff;
      return starSeed / 0x7fffffff;
    };
    for (let i = 0; i < 240; i += 1) {
      const a = starRand() * Math.PI * 2;
      const e = 0.25 + starRand() * 1.2;
      const r = 58;
      starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      starPos[i * 3 + 1] = Math.sin(e) * r;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ee, size: 0.35, sizeAttenuation: false }));
    scene.add(stars);
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xf2ead2, fog: false }),
    );
    moon.position.set(-30, 26, -42);
    moon.lookAt(0, 0, 0);
    scene.add(moon);
    return sun;
  }

  buildFloor();
  buildWallsAndCover();
  buildFountain();
  buildSites();
  const sun = buildSky();

  scene.add(group);
  return { group, wallMeshes, sun };
}
