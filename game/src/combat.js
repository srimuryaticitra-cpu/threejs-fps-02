// Hitscan combat, shared by the player and the bots: one ray from the muzzle
// through the aim direction (plus spread), against wall meshes and body meshes.
// A head mesh hit multiplies damage; a wall hit stops the ray. Tracers and impact
// sparks are pooled meshes — nothing is allocated per shot in the hot loop.
import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

export function createEffects(scene) {
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc95e, transparent: true });
  for (let i = 0; i < 16; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0 });
  }
  // The pod's explosion flash: one reusable point light.
  const flash = new THREE.PointLight(0xff9a3c, 0, 18, 1.6);
  scene.add(flash);
  return { tracers, sparks, flash, tracerIndex: 0, sparkIndex: 0 };
}

function fireTracer(fx, from, to, life = 0.09) {
  const t = fx.tracers[fx.tracerIndex];
  fx.tracerIndex = (fx.tracerIndex + 1) % fx.tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.9;
  t.life = life;
}

function fireSpark(fx, at) {
  const s = fx.sparks[fx.sparkIndex];
  fx.sparkIndex = (fx.sparkIndex + 1) % fx.sparks.length;
  s.mesh.position.copy(at);
  s.mesh.visible = true;
  s.mesh.scale.setScalar(1);
  s.mesh.material.opacity = 1;
  s.life = 0.18;
}

export function effectsStep(fx, dt) {
  for (const t of fx.tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) t.line.visible = false;
    else t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
  }
  for (const s of fx.sparks) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) s.mesh.visible = false;
    else { s.mesh.scale.setScalar(1 + (0.18 - s.life) * 6); s.mesh.material.opacity = s.life / 0.18; }
  }
  if (fx.flash.intensity > 0) fx.flash.intensity = Math.max(0, fx.flash.intensity - dt * 22);
}

// Fire one hitscan round.
//   origin: Vector3 eye position; dir: normalized aim direction (mutated by spread)
//   spread: radians of random cone; random: the round's seeded stream
//   targets: array of meshes with userData.agent + userData.part ('head'|'body')
//   blockers: wall meshes that stop the ray
//   damage: base body damage; headMult; range; falloffAt/falloffMult
// Returns { hit: 'agent'|'wall'|null, agent, part, point, distance, damage }.
// The caller applies damage; this function only decides what the ray met.
export function shootRay(fx, origin, dir, spread, random, targets, blockers, def) {
  _dir.copy(dir);
  if (spread > 0) {
    _dir.x += (random() * 2 - 1) * spread;
    _dir.y += (random() * 2 - 1) * spread;
    _dir.z += (random() * 2 - 1) * spread;
    _dir.normalize();
  }
  _origin.copy(origin);
  _raycaster.set(_origin, _dir);
  _raycaster.far = def.range;
  const hits = _raycaster.intersectObjects(targets.concat(blockers), false);
  const end = _hitPoint.copy(_dir).multiplyScalar(def.range).add(_origin);
  fireTracer(fx, _origin, end);
  if (hits.length === 0) return { hit: null, agent: null, part: null, point: end, distance: def.range, damage: 0 };
  const first = hits[0];
  fireTracer(fx, _origin, first.point);
  if (first.object.userData.agent) {
    const part = first.object.userData.part || 'body';
    let damage = def.damage * (part === 'head' ? def.headMult : 1);
    if (first.distance > def.falloffAt) damage *= def.falloffMult;
    // No impact spark on the player: the hit point sits centimetres from the
    // camera, and a spark there would fill the whole view. The hurt sound, the
    // shake and the health bar already say the player was hit.
    if (first.object.userData.agent.kind !== 'player') fireSpark(fx, first.point);
    return { hit: 'agent', agent: first.object.userData.agent, part, point: first.point, distance: first.distance, damage: Math.round(damage) };
  }
  fireSpark(fx, first.point);
  return { hit: 'wall', agent: null, part: null, point: first.point, distance: first.distance, damage: 0 };
}

// A thrown leaf grenade: a small green sphere with a simple arc, one wall bounce
// in XZ and a ground bounce, then a fuse pop. One object per live grenade.
export function createGrenade(scene, from, dir, random) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x6fae5e, roughness: 0.6, emissive: 0x2a4a22, emissiveIntensity: 0.6 }),
  );
  mesh.position.copy(from);
  scene.add(mesh);
  return {
    mesh,
    vx: dir.x * 13 + (random() * 0.4 - 0.2),
    vy: dir.y * 13 + 4.5,
    vz: dir.z * 13 + (random() * 0.4 - 0.2),
    fuse: 1.4,
    alive: true,
  };
}

export function grenadeStep(g, dt, resolveCircleFn) {
  if (!g.alive) return false; // false: still flying
  g.vy -= 12 * dt;
  g.mesh.position.x += g.vx * dt;
  g.mesh.position.y += g.vy * dt;
  g.mesh.position.z += g.vz * dt;
  const p = g.mesh.position;
  if (p.y <= 0.14) { p.y = 0.14; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
  const fixed = resolveCircleFn(p.x, p.z, 0.14);
  if (fixed[0] !== p.x) { p.x = fixed[0]; g.vx = -g.vx * 0.4; }
  if (fixed[1] !== p.z) { p.z = fixed[1]; g.vz = -g.vz * 0.4; }
  g.fuse -= dt;
  return g.fuse <= 0; // true: time to explode
}

export function explode(fx, at) {
  fx.flash.position.copy(at);
  fx.flash.position.y = Math.max(1, at.y + 0.5);
  fx.flash.intensity = 26;
}
