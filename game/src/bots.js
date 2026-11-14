// The bots: three tortoise allies (Kura) against four hares (Kelinci). Hares
// run faster but spray wider — fast and reckless; tortoises are slow and
// steady and aim better, which is the whole joke and the whole tactic. Each
// bot is a small state machine over a waypoint route: hold, patrol, engage,
// investigate noise, plant (the carrier) or defuse. Vision is a range plus a
// cone plus a 2D wall test, so a bot never sees through a hedge; hearing is a
// radius around gunfire and blasts.
//
// New in this entry (threejs-fps-02): the hare difficulty ramp. ctx.hareBoost
// (0..1, set by game.js from the round number and how far Kura leads)
// shortens hare reaction time by up to 35% — a hare that is losing stops
// hesitating. Their aim straightens out the same way in game.js (botShoot).
// Kura allies never get the boost: slow and steady is their whole identity.
import * as THREE from 'three';
import { WAYPOINTS, ROUTES, resolveCircle, segmentBlocked } from './map.js';
import { createWeaponState, WEAPONS, weaponCanFire, weaponStep } from './weapons.js';
import { range, clamp } from './rng.js';

const BOT_RADIUS = 0.42;
const VISION_RANGE = 38;
const VISION_HALF_CONE = 1.05; // ~120 degree vision cone
const HEAR_RANGE = 18;
const THINK_INTERVAL = 0.15;

const ALLY_NAMES = ['Tama', 'Momo', 'Kiko'];
const ENEMY_NAMES = ['Lari', 'Lompat', 'Kilat', 'Kabur'];

function buildBotMesh(team) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: team === 'kura' ? 0x6fae5e : 0xd97b2f, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.95, 12), bodyMat);
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), bodyMat);
  head.position.y = 1.52;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), darkMat);
  visor.position.set(0, 1.55, 0.24);
  group.add(visor);

  if (team === 'kura') {
    // The shell: a flattened dome on the back. Slow, steady, armoured.
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.9 }),
    );
    shell.scale.set(1, 0.62, 0.8);
    shell.position.set(0, 1.05, -0.3);
    shell.castShadow = true;
    group.add(shell);
  } else {
    // The ears: two long boxes. Fast, tall, easy to spot — and to headshot.
    const earGeo = new THREE.BoxGeometry(0.09, 0.55, 0.05);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, bodyMat);
      ear.position.set(side * 0.14, 1.95, 0);
      ear.rotation.z = side * -0.12;
      ear.castShadow = true;
      group.add(ear);
    }
  }

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.75), darkMat);
  gun.position.set(0.22, 1.05, 0.35);
  group.add(gun);
  return group;
}

export function createBot(scene, team, name, x, z, random) {
  const group = buildBotMesh(team);
  group.position.set(x, 0, z);
  scene.add(group);
  const body = group.children[0];
  const head = group.children[1];
  const def = team === 'kura' ? WEAPONS.tempurung : WEAPONS.kilap;
  const bot = {
    kind: 'bot',
    team,
    name,
    group,
    bodyMesh: body,
    headMesh: head,
    x, z, yaw: team === 'kura' ? 0 : Math.PI,
    health: 100,
    alive: true,
    weapon: createWeaponState(def),
    speed: team === 'kura' ? 4.2 : 5.0,
    // Perisai Tempurung: true while the bot holds the mid shield, which
    // blocks the next hit entirely. Set by game.js on pickup, cleared on use.
    shield: false,
    // AI state
    role: team === 'kura' ? 'attacker' : 'defender',
    route: [],
    routeIndex: 0,
    destX: x, destZ: z,
    holdX: x, holdZ: z,
    scanYaw: 0,
    target: null, // the agent currently engaged, or null
    lastSeenX: 0, lastSeenZ: 0, lastSeenAt: -99,
    hearX: 0, hearZ: 0, hearAt: -99,
    reactAt: 0, // time when the bot may open fire after spotting
    burstLeft: 0,
    burstTimer: 0,
    thinkTimer: random() * 0.15,
    strafeDir: 1,
    strafeTimer: 0,
    planting: 0,
    defusing: 0,
    isCarrier: false,
    fallT: 0,
    moveSpeed: 0,
  };
  body.userData.agent = bot;
  body.userData.part = 'body';
  head.userData.agent = bot;
  head.userData.part = 'head';
  return bot;
}

export function resetBot(bot, x, z, random) {
  bot.x = x;
  bot.z = z;
  bot.yaw = bot.team === 'kura' ? 0 : Math.PI;
  bot.health = 100;
  bot.alive = true;
  bot.group.position.set(x, 0, z);
  bot.group.rotation.set(0, bot.yaw, 0);
  bot.group.visible = true;
  bot.weapon = createWeaponState(bot.team === 'kura' ? WEAPONS.tempurung : WEAPONS.kilap);
  bot.route = [];
  bot.routeIndex = 0;
  bot.target = null;
  bot.lastSeenAt = -99;
  bot.hearAt = -99;
  bot.planting = 0;
  bot.defusing = 0;
  bot.isCarrier = false;
  bot.fallT = 0;
  bot.shield = false;
  bot.thinkTimer = random() * 0.15;
}

// Assign routes for a fresh round: allies push a site, defenders hold theirs.
// Roles reset every round (a hare that contested mid last round goes back to
// holding its site unless the ramp calls it forward again).
// When the hares are ramped up (hareBoost >= 0.5, i.e. they are losing), the
// fourth hare — Kabur — stops holding Site B and pushes mid instead: the
// shield at mid is worth fighting over, and a losing team that never leaves
// its sites never comes back.
export function assignRoundRoles(bots, random, hareBoost = 0) {
  const allies = bots.filter((b) => b.team === 'kura' && b.alive);
  const enemies = bots.filter((b) => b.team === 'kelinci' && b.alive);
  const site = random() < 0.5 ? 'A' : 'B';

  allies.forEach((bot, i) => {
    bot.role = 'attacker';
    bot.route = i === 2 ? ROUTES.toMid.slice() : (site === 'A' ? ROUTES.toA.slice() : ROUTES.toB.slice());
    bot.routeIndex = 0;
  });

  enemies.forEach((bot, i) => {
    bot.role = 'defender';
    const hold = i < 2 ? (i === 0 ? WAYPOINTS.siteAHold1 : WAYPOINTS.siteAHold2)
      : (i === 2 ? WAYPOINTS.siteBHold1 : WAYPOINTS.siteBHold2);
    bot.holdX = hold[0];
    bot.holdZ = hold[1];
    bot.destX = bot.holdX;
    bot.destZ = bot.holdZ;
  });

  if (hareBoost >= 0.5 && enemies[3]) {
    // Kabur contests mid for the shield. As an attacker he walks the mid
    // route and scans there; he never plants (only Kura carries the Benih)
    // and he leaves one fewer defender on the sites — the trade a losing
    // team makes to get back in the match.
    enemies[3].role = 'attacker';
    enemies[3].route = ROUTES.toMid.slice();
    enemies[3].routeIndex = 0;
  }
  return site;
}

function angleTo(bot, x, z) {
  return Math.atan2(-(x - bot.x), -(z - bot.z));
}

function angleDiff(a, b) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function turnToward(yaw, want, maxStep) {
  const diff = angleDiff(yaw, want);
  if (Math.abs(diff) <= maxStep) return want;
  return yaw + Math.sign(diff) * maxStep;
}

function canSee(bot, target) {
  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > VISION_RANGE) return false;
  const want = Math.atan2(-dx, -dz);
  if (Math.abs(angleDiff(bot.yaw, want)) > VISION_HALF_CONE) return false;
  if (segmentBlocked(bot.x, bot.z, target.x, target.z)) return false;
  return true;
}

function atSite(bot, site) {
  return Math.hypot(site.center[0] - bot.x, site.center[1] - bot.z) < site.radius;
}

// Walk toward a point at the bot's speed, sliding along colliders. Returns
// true when the bot actually moved (far enough to bother).
function moveToward(bot, x, z, dt) {
  const d = Math.hypot(x - bot.x, z - bot.z);
  if (d < 0.001) return false;
  bot.yaw = turnToward(bot.yaw, angleTo(bot, x, z), dt * 5);
  moveBot(bot, (x - bot.x) / d, (z - bot.z) / d, dt);
  return true;
}

function moveBot(bot, dx, dz, dt) {
  const len = Math.hypot(dx, dz) || 1;
  bot.x += (dx / len) * bot.speed * dt;
  bot.z += (dz / len) * bot.speed * dt;
  const fixed = resolveCircle(bot.x, bot.z, BOT_RADIUS);
  bot.x = fixed[0];
  bot.z = fixed[1];
  bot.x = clamp(bot.x, -21.2 + BOT_RADIUS, 21.2 - BOT_RADIUS);
  bot.z = clamp(bot.z, -15.2 + BOT_RADIUS, 15.2 - BOT_RADIUS);
}

// Perception, staggered every THINK_INTERVAL seconds. Only while live:
// during the buy phase bots walk to their holds and must not spot, engage
// or shoot — a round must not be decided before it starts.
function perceive(bot, ctx) {
  const foes = bot.team === 'kura'
    ? ctx.bots.filter((b) => b.team === 'kelinci' && b.alive)
    : ctx.bots.filter((b) => b.team === 'kura' && b.alive).concat(ctx.player.alive ? [ctx.playerAgent] : []);
  // Nearest visible foe wins.
  let best = null;
  let bestDist = Infinity;
  for (const foe of foes) {
    if (foe === bot) continue;
    const d = Math.hypot(foe.x - bot.x, foe.z - bot.z);
    if (d < bestDist && canSee(bot, foe)) {
      best = foe;
      bestDist = d;
    }
  }
  if (best) {
    // Difficulty ramp: a trailing hare reacts faster. Base 0.25–0.55 s;
    // at full boost a hare is on the trigger in 0.16–0.36 s. Kura allies
    // keep the base window — they win by aiming, not by twitching.
    if (!bot.target) {
      const reactScale = bot.team === 'kelinci' ? 1 - 0.35 * (ctx.hareBoost ?? 0) : 1;
      bot.reactAt = ctx.now + range(ctx.random, 0.25, 0.55) * reactScale;
    }
    bot.target = best;
    bot.lastSeenX = best.x;
    bot.lastSeenZ = best.z;
    bot.lastSeenAt = ctx.now;
  } else if (bot.target && ctx.now - bot.lastSeenAt > 1.2) {
    bot.target = null;
  }
  // Hearing: the freshest loud noise inside HEAR_RANGE metres.
  for (const n of ctx.noise) {
    if (ctx.now - n.at > 2) continue;
    const d = Math.hypot(n.x - bot.x, n.z - bot.z);
    if (d < HEAR_RANGE) {
      bot.hearX = n.x;
      bot.hearZ = n.z;
      bot.hearAt = ctx.now;
    }
  }
}

// Face the target, strafe sideways, fire in bursts once reacted. Returns
// true when the bot moved this tick.
function engage(bot, dt, ctx) {
  const want = angleTo(bot, bot.target.x, bot.target.z);
  bot.yaw = turnToward(bot.yaw, want, dt * 7);
  bot.strafeTimer -= dt;
  if (bot.strafeTimer <= 0) {
    bot.strafeTimer = range(ctx.random, 0.5, 1.1);
    bot.strafeDir = ctx.random() < 0.5 ? -1 : 1;
  }
  const sd = bot.strafeDir;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const dist = Math.hypot(bot.target.x - bot.x, bot.target.z - bot.z);
  const approach = dist > 14 ? 1 : dist < 6 ? -0.6 : 0;
  const mx = fx * approach + (-fz) * sd * 0.7;
  const mz = fz * approach + fx * sd * 0.7;
  moveBot(bot, mx, mz, dt);
  if (ctx.now >= bot.reactAt) {
    if (bot.burstLeft <= 0) {
      // A ramped-up hare holds the trigger a little longer: 2–5 rounds
      // become 3–6 at full boost.
      const bonus = bot.team === 'kelinci' ? Math.round(ctx.hareBoost ?? 0) : 0;
      bot.burstLeft = 2 + bonus + Math.floor(ctx.random() * 4);
      bot.burstTimer = range(ctx.random, 0.25, 0.6);
    }
    bot.burstTimer -= dt;
    if (bot.burstTimer <= 0 && bot.burstLeft > 0 && weaponCanFire(bot.weapon)) {
      bot.burstTimer = 0.12;
      bot.burstLeft -= 1;
      ctx.onBotShoot(bot);
    }
  }
  return true;
}

// Attacker behaviour: plant when the carrier stands on the target site,
// otherwise walk the route, then hold near a planted pod. Returns true when
// the bot moved this tick.
function actAttacker(bot, dt, ctx) {
  if (bot.isCarrier && ctx.phase === 'live' && ctx.targetSite && atSite(bot, ctx.targetSite) && !ctx.planted) {
    // Carrier on site with nobody in sight: plant the Benih.
    bot.planting += dt;
    ctx.onPlantProgress(bot, dt);
    return false;
  }
  bot.planting = 0;
  if (bot.routeIndex < bot.route.length) {
    const wp = WAYPOINTS[bot.route[bot.routeIndex]];
    const d = Math.hypot(wp[0] - bot.x, wp[1] - bot.z);
    if (d < 0.9) {
      bot.routeIndex += 1;
      return false;
    }
    return moveToward(bot, wp[0], wp[1], dt);
  }
  if (ctx.planted && ctx.plantedSite) {
    // Pod is down: attackers hold near it.
    const pod = ctx.plantedSite;
    const d = Math.hypot(pod.center[0] - bot.x, pod.center[1] - bot.z);
    if (d > 3) return moveToward(bot, pod.center[0], pod.center[1], dt);
    bot.yaw += dt * 0.8; // slow scan while holding
    return false;
  }
  bot.yaw += dt * 0.5; // arrived, scan the site
  return false;
}

// Defender behaviour: converge on a planted pod and defuse, investigate
// fresh noise, otherwise walk to the hold point and scan. Returns true when
// the bot moved this tick.
function actDefender(bot, dt, ctx) {
  if (ctx.planted && ctx.plantedSite) {
    const pod = ctx.plantedSite;
    const d = Math.hypot(pod.center[0] - bot.x, pod.center[1] - bot.z);
    if (d < 1.6) {
      bot.defusing += dt;
      ctx.onDefuseProgress(bot, dt);
      return false;
    }
    bot.defusing = 0;
    return moveToward(bot, pod.center[0], pod.center[1], dt);
  }
  if (ctx.now - bot.hearAt < 1.5) {
    bot.defusing = 0;
    const d = Math.hypot(bot.hearX - bot.x, bot.hearZ - bot.z);
    if (d > 1) return moveToward(bot, bot.hearX, bot.hearZ, dt);
    return false;
  }
  bot.defusing = 0;
  const d = Math.hypot(bot.holdX - bot.x, bot.holdZ - bot.z);
  if (d > 1) return moveToward(bot, bot.holdX, bot.holdZ, dt);
  bot.scanYaw += dt * 0.9;
  bot.yaw = bot.scanYaw;
  return false;
}

// One fixed-step tick for one bot. ctx carries the world: { now, random,
// player, playerAgent, bots, planted, plantedSite, targetSite, phase,
// hareBoost, noise: [{x,z,at}], onBotShoot, onPlantProgress,
// onDefuseProgress }. The bot never touches the DOM or the renderer
// directly; it only moves, aims and asks ctx to resolve its shots.
export function botStep(bot, dt, ctx) {
  if (!bot.alive) {
    if (bot.fallT < 1) {
      bot.fallT = Math.min(1, bot.fallT + dt * 3);
      bot.group.rotation.x = -bot.fallT * Math.PI * 0.5;
    }
    return;
  }
  weaponStep(bot.weapon, dt);
  bot.thinkTimer -= dt;

  if (bot.thinkTimer <= 0 && ctx.phase === 'live') {
    bot.thinkTimer = THINK_INTERVAL;
    perceive(bot, ctx);
  }

  const engaged = bot.target && ctx.phase === 'live' && ctx.now - bot.lastSeenAt < 1.2;
  let moving = false;
  if (engaged) moving = engage(bot, dt, ctx);
  else if (bot.role === 'attacker') moving = actAttacker(bot, dt, ctx);
  else moving = actDefender(bot, dt, ctx);

  bot.moveSpeed = moving ? bot.speed : 0;
  bot.group.position.set(bot.x, 0, bot.z);
  bot.group.rotation.y = bot.yaw;
}

export function makeBots(scene, random) {
  const bots = [];
  ALLY_NAMES.forEach((name, i) => {
    const spawn = [[-2, 12.5], [0, 13], [2, 12.5]][i];
    bots.push(createBot(scene, 'kura', name, spawn[0], spawn[1], random));
  });
  ENEMY_NAMES.forEach((name, i) => {
    const spawn = [[-2, -12.5], [0, -13], [2, -12.5], [1, -11]][i];
    bots.push(createBot(scene, 'kelinci', name, spawn[0], spawn[1], random));
  });
  return bots;
}
