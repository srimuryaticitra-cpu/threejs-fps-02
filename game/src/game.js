// KURA OPS — the match itself. One state object (G) holds everything: the
// phase, the round, the score, the money, the pod, the noise the bots hear,
// the shield pickup at mid and the hare difficulty ramp. The fixed step in
// main.js calls gameStep(dt, input) and nothing else mutates the match.
//
// Phases: menu -> buy -> live -> roundEnd -> buy ... -> matchEnd. First to 5
// round wins takes the match, at most 9 rounds. The player carries the Benih
// (the seed pod): plant it at Site A or B, or wipe the Kelinci team; if the
// pod blows, Kura wins the round; if it is defused or time runs out, Kelinci
// does.
//
// New in this entry (threejs-fps-02):
// - Perisai Tempurung: one shield pickup spawns at mid every round. Whoever
//   picks it up — the player or a bot — blocks the next hit entirely, once.
//   If the holder dies while holding it, the shield is lost for the round.
// - Hare difficulty ramp: the further Kura leads, and the deeper the match,
//   the faster hares react and the straighter they shoot (hareBoost 0..1).
// - HUD polish: a shield chip by the health bar and a planted-pod label under
//   the timer, plus the shield pickup and the planted pod drawn on the minimap.
import * as THREE from 'three';
import { createMap, SITES, SPAWNS, SHIELD_SPAWN, resolveCircle, segmentBlocked } from './map.js';
import { createPlayerState, playerStep, playerLook, playerApplyRecoil } from './player.js';
import { WEAPONS, GRENADE, createWeaponState, weaponSpread, weaponCanFire, weaponStep } from './weapons.js';
import { createEffects, shootRay, createGrenade, grenadeStep, explode, effectsStep } from './combat.js';
import { makeBots, resetBot, assignRoundRoles, botStep } from './bots.js';
import { createHud, drawMinimap } from './hud.js';
import { createAudio } from './audio.js';
import { clamp } from './rng.js';

// Match tuning: phase lengths, win conditions, economy.
const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const POD_SECONDS = 35;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const START_MONEY = 800;
const WIN_MONEY = 1000;
const LOSE_MONEY = 600;
const KILL_MONEY = 300;
const PLANT_MONEY = 300;
const SHIELD_PICKUP_RADIUS = 1.3;

// Scratch vectors so the hot loop never allocates.
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

// The pod: a glowing amber seed, hidden until planted.
function buildPod(scene) {
  const podGroup = new THREE.Group();
  const podMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0xf0a830, emissiveIntensity: 1.4, roughness: 0.3 }),
  );
  podMesh.position.y = 0.55;
  podGroup.add(podMesh);
  const podLight = new THREE.PointLight(0xf0a830, 3, 9, 1.8);
  podLight.position.y = 1.2;
  podGroup.add(podLight);
  podGroup.visible = false;
  scene.add(podGroup);
  return podGroup;
}

// Perisai Tempurung: a small green shell dome on a stone plinth at mid,
// ringed in amber so it reads from across the garden. One per round.
function buildShield(scene) {
  const shieldGroup = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.55, emissive: 0x1e3a18, emissiveIntensity: 0.5 }),
  );
  shell.scale.set(1, 0.62, 0.8);
  shell.position.y = 0.62;
  shieldGroup.add(shell);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 32),
    new THREE.MeshBasicMaterial({ color: 0xf0a830, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  shieldGroup.add(ring);
  const light = new THREE.PointLight(0x6fae5e, 2.2, 7, 1.8);
  light.position.y = 1.1;
  shieldGroup.add(light);
  shieldGroup.position.set(SHIELD_SPAWN[0], 0, SHIELD_SPAWN[1]);
  scene.add(shieldGroup);
  return shieldGroup;
}

// The player's hit proxy: two invisible meshes the bots' raycasts can hit.
// Opacity 0, depthWrite off: the raycaster still tests them, the renderer
// draws nothing. Returns the group and both meshes.
function buildPlayerProxy(scene, playerAgent) {
  const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const proxyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 8), proxyMat);
  proxyBody.position.y = 0.85;
  const proxyHead = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 6), proxyMat);
  proxyHead.position.y = 1.52;
  const proxyGroup = new THREE.Group();
  proxyGroup.add(proxyBody);
  proxyGroup.add(proxyHead);
  proxyBody.userData.agent = playerAgent;
  proxyBody.userData.part = 'body';
  proxyHead.userData.agent = playerAgent;
  proxyHead.userData.part = 'head';
  scene.add(proxyGroup);
  return { proxyGroup, proxyBody, proxyHead };
}

// The viewmodel: a chunky tortoise-shell rifle that bobs and kicks. The
// muzzle flash is a small plane at the barrel tip, lit for one frame per shot.
function buildViewmodel(camera) {
  const viewmodel = new THREE.Group();
  const vmMat = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.55 });
  const vmDark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5 });
  const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.42), vmMat);
  viewmodel.add(vmBody);
  const vmBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8), vmDark);
  vmBarrel.rotation.x = Math.PI / 2;
  vmBarrel.position.set(0, 0.015, -0.32);
  viewmodel.add(vmBarrel);
  const vmSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.08), vmDark);
  vmSight.position.set(0, 0.075, -0.08);
  viewmodel.add(vmSight);
  const vmFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.09),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  vmFlash.position.set(0, 0.015, -0.5);
  viewmodel.add(vmFlash);
  viewmodel.position.set(0.26, -0.23, -0.48);
  viewmodel.scale.setScalar(0.85);
  camera.add(viewmodel);
  return { viewmodel, vmFlash };
}

export function createGame(scene, camera, random, shotMode) {
  const map = createMap(scene);
  const fx = createEffects(scene);
  const hud = createHud();
  const audio = createAudio();

  const player = createPlayerState(0, 12.5);
  const playerAgent = { kind: 'player', team: 'kura', name: 'Kamu', x: 0, z: 0, shield: false };
  const { proxyGroup, proxyBody, proxyHead } = buildPlayerProxy(scene, playerAgent);
  const podGroup = buildPod(scene);
  const shieldGroup = buildShield(scene);
  const { viewmodel, vmFlash } = buildViewmodel(camera);
  const bots = makeBots(scene, random);

  const G = {
    scene, camera, random, shotMode,
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    now: 0,
    round: 0,
    scoreKura: 0,
    scoreKelinci: 0,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    weapon: createWeaponState(WEAPONS.kura9),
    grenades: 0,
    buyTimer: BUY_SECONDS,
    roundTimer: ROUND_SECONDS,
    podTimer: POD_SECONDS,
    planted: false,
    plantedSite: null,
    targetSite: SITES[0],
    plantProgress: 0,
    plantBy: null,
    defuseProgress: 0,
    defuseBy: null,
    roundEndTimer: 0,
    roundEndReason: '',
    matchWinner: null,
    shake: 0,
    noise: [],
    grenadesLive: [],
    spotted: new Set(),
    carrier: null, // the agent carrying the Benih (player, or an ally bot)
    started: false,
    player, playerAgent, bots, hud, audio, fx, map, podGroup,
    viewKick: 0,
    flashTimer: 0,
    walkCycle: 0,
    prevKeys: new Set(),
    beepTimer: 0,
    // Shield pickup state: one per round, at mid. holder is the agent that
    // picked it up, or null while it waits on the ground.
    shieldAvailable: true,
    shieldHolder: null,
    shieldGroup,
    // Hare difficulty ramp, 0..1: grows with the round number and with how
    // far Kura leads, so a runaway match tightens instead of snowballing.
    hareBoost: 0,
  };

  // ---- small world helpers ----

  function pushNoise(x, z) {
    G.noise.push({ x, z, at: G.now });
    if (G.noise.length > 10) G.noise.shift();
  }

  // All living bot hit meshes except one (the shooter, so it never hits itself).
  function botHitMeshes(except) {
    const list = [];
    for (const b of bots) {
      if (!b.alive || b === except) continue;
      list.push(b.bodyMesh, b.headMesh);
    }
    return list;
  }

  // ---- damage: the single funnel for every hit, including grenades ----
  // The shield blocks exactly one damage instance, then breaks.
  function damageAgent(agent, dmg, attacker, weaponName, part) {
    if (agent.shield) {
      agent.shield = false;
      G.shieldHolder = null;
      if (agent === playerAgent) {
        hud.setShield(false);
        audio.shieldBreak();
        hud.banner('PERISAI PECAH!', 'Tempurungmu menahan satu tembakan penuh.', 2.2);
      } else if (attacker === playerAgent) {
        hud.feed(`Perisai <b class="${agent.team}">${agent.name}</b> pecah — tembakanmu ditahan tempurung!`);
      }
      return;
    }
    if (agent.kind === 'player') {
      if (!player.alive) return;
      player.health = Math.max(0, player.health - dmg);
      audio.hurt();
      G.shake = Math.min(0.6, G.shake + 0.25);
      if (player.health <= 0) {
        player.alive = false;
        G.deaths += 1;
        // Dying mid-plant used to freeze the plant bar on screen: planting
        // only advances while the player is alive, so the progress never
        // reset and the bot plant/defuse bar (which waits for
        // plantProgress === 0) never showed for the rest of the round.
        // Clear it here, at the moment of death.
        if (G.plantProgress > 0) {
          G.plantProgress = 0;
          hud.hidePlant();
        }
        hud.banner('KAMU GUGUR', 'Tim Kura masih berjuang — tonton sampai ronde berakhir.', 3);
        if (G.carrier === playerAgent) passCarrier();
        checkRoundEnd();
      }
      return;
    }
    if (!agent.alive) return;
    agent.health -= dmg;
    if (agent.health > 0) return;
    agent.alive = false;
    agent.health = 0;
    if (attacker === playerAgent) {
      G.kills += 1;
      G.money += KILL_MONEY;
      audio.kill();
      hud.feed(`<b class="kura">Kamu</b> ▸ <b class="kelinci">${agent.name}</b> · ${weaponName}${part === 'head' ? ' · HEADSHOT' : ''}`);
    } else if (attacker) {
      hud.feed(`<b class="${attacker.team}">${attacker.name}</b> ▸ <b class="${agent.team}">${agent.name}</b> · ${weaponName}`);
    }
    if (agent.isCarrier) passCarrier();
    checkRoundEnd();
  }

  // The Benih passes to the first living ally when its carrier dies.
  function passCarrier() {
    const alive = bots.filter((b) => b.team === 'kura' && b.alive);
    const next = alive[0] || null;
    for (const b of bots) b.isCarrier = false;
    if (next) {
      next.isCarrier = true;
      G.carrier = next;
      hud.banner('BENIH PINDAH', `${next.name} sekarang membawa Benih. Lindungi dia!`, 2.5);
    } else {
      G.carrier = null;
    }
  }

  // ---- the shield pickup ----

  // Whoever walks over the shield at mid picks it up: player first, then
  // bots. Only while buy or live, and only once per round.
  function checkShieldPickup() {
    if (!G.shieldAvailable) return;
    if (player.alive && Math.hypot(SHIELD_SPAWN[0] - player.x, SHIELD_SPAWN[1] - player.z) < SHIELD_PICKUP_RADIUS) {
      takeShield(playerAgent, 'Kamu');
      return;
    }
    for (const b of bots) {
      if (!b.alive || b.shield) continue;
      if (Math.hypot(SHIELD_SPAWN[0] - b.x, SHIELD_SPAWN[1] - b.z) < SHIELD_PICKUP_RADIUS) {
        takeShield(b, b.name);
        return;
      }
    }
  }

  function takeShield(agent, label) {
    G.shieldAvailable = false;
    G.shieldHolder = agent;
    agent.shield = true;
    shieldGroup.visible = false;
    audio.shield();
    if (agent === playerAgent) {
      hud.setShield(true);
      hud.banner('PERISAI TEMPURUNG!', 'Satu tembakan berikutnya ditahan tempurungmu.', 2.2);
      hud.feed('<b class="kura">Kamu</b> mengambil Perisai Tempurung di mid');
    } else {
      hud.feed(`<b class="${agent.team}">${label}</b> mengambil Perisai Tempurung di mid`);
    }
  }

  // ---- shooting ----

  // The player's eye position and aim direction, shared by shooting and grenades.
  function playerEyeAndAim() {
    const eyeY = player.y + player.eye;
    _eye.set(player.x, eyeY, player.z);
    const cp = Math.cos(player.pitch);
    _dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp).normalize();
  }

  function playerShoot() {
    const def = G.weapon.def;
    playerEyeAndAim();
    const spread = weaponSpread(G.weapon, player.speed2d, player.crouched);
    // Matrices must be fresh: a scripted shot before the first render would
    // otherwise raycast against stale (spawn-time) transforms.
    scene.updateMatrixWorld(true);
    const res = shootRay(fx, _eye, _dir, spread, random, botHitMeshes(null), map.wallMeshes, def);
    G.weapon.mag -= 1;
    G.weapon.cooldown = def.fireInterval;
    G.weapon.bloom = Math.min(def.spreadMax, G.weapon.bloom + def.spreadBloom);
    playerApplyRecoil(player, def.recoil * (0.8 + random() * 0.4), (random() * 2 - 1) * def.recoil * 0.5);
    G.viewKick = 1;
    G.flashTimer = 0.05;
    audio.shot(def.kind);
    pushNoise(player.x, player.z);
    if (res.hit === 'agent') {
      damageAgent(res.agent, res.damage, playerAgent, def.name, res.part);
      hud.hitMarker(res.agent.health <= 0);
      audio.hit();
    }
  }

  function botShoot(bot) {
    const target = bot.target;
    if (!target) return;
    const eyeY = 1.45;
    _eye.set(bot.x, eyeY, bot.z);
    const targetY = target.kind === 'player' ? target.y + target.eye : 1.3;
    const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    const errBase = 0.015 + dist * 0.0011;
    // Hares spray wide by nature (x1.7), but the ramp straightens them out:
    // at full boost they spray only x1.1. Kura allies are steady already.
    const hareMult = bot.team === 'kelinci' ? 1.7 - 0.6 * G.hareBoost : 1.0;
    const targetSpeed = target.kind === 'player' ? player.speed2d : target.moveSpeed;
    const err = errBase * hareMult + Math.min(0.03, targetSpeed * 0.004);
    _aim.set(target.x - bot.x, targetY - eyeY, target.z - bot.z).normalize();
    const def = bot.weapon.def;
    const targets = bot.team === 'kelinci'
      ? [proxyBody, proxyHead].concat(botHitMeshes(bot).filter((m) => m.userData.agent.team === 'kura'))
      : botHitMeshes(bot).filter((m) => m.userData.agent.team === 'kelinci');
    scene.updateMatrixWorld(true);
    const res = shootRay(fx, _eye, _aim, err, random, targets, map.wallMeshes, def);
    bot.weapon.mag -= 1;
    bot.weapon.cooldown = def.fireInterval;
    if (dist < 25) audio.shot(def.kind);
    else audio.distantShot();
    pushNoise(bot.x, bot.z);
    if (res.hit === 'agent') damageAgent(res.agent, res.damage, bot, def.name, res.part);
  }

  // ---- grenades ----

  function throwGrenade() {
    if (G.grenades <= 0) return;
    G.grenades -= 1;
    playerEyeAndAim();
    const g = createGrenade(scene, _eye, _dir, random);
    G.grenadesLive.push(g);
    audio.click();
  }

  function grenadeDamageAt(at, x, z) {
    const d = Math.hypot(x - at.x, z - at.z);
    if (d >= GRENADE.radius) return 0;
    return Math.round(GRENADE.damageMax - (GRENADE.damageMax - GRENADE.damageMin) * (d / GRENADE.radius));
  }

  function explodeGrenade(g) {
    const at = g.mesh.position;
    explode(fx, at);
    audio.explosion();
    pushNoise(at.x, at.z);
    if (player.alive && player.y + 1 < 4) {
      const dmg = grenadeDamageAt(at, player.x, player.z);
      if (dmg > 0) {
        damageAgent(playerAgent, dmg, null, GRENADE.name, 'body');
        G.shake = Math.min(1, G.shake + 0.5);
      }
    }
    for (const b of bots) {
      if (!b.alive) continue;
      const dmg = grenadeDamageAt(at, b.x, b.z);
      if (dmg > 0) damageAgent(b, dmg, playerAgent, GRENADE.name, 'body');
    }
    scene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mesh.material.dispose();
  }

  // ---- the pod and the round ----

  function plantPod(by) {
    G.planted = true;
    G.plantedSite = G.targetSite;
    G.podTimer = POD_SECONDS;
    G.plantProgress = 0;
    G.plantBy = by;
    podGroup.position.set(G.targetSite.center[0], 0, G.targetSite.center[1]);
    podGroup.visible = true;
    audio.planted();
    if (by === playerAgent) G.money += PLANT_MONEY;
    hud.banner('BENIH DITANAM!', `Site ${G.targetSite.id} — ${G.targetSite.name}. Bertahan ${POD_SECONDS} detik!`, 3);
    hud.feed(`<b class="kura">${by === playerAgent ? 'Kamu' : by.name}</b> menanam Benih di Site ${G.targetSite.id}`);
    hud.setPod(true, G.targetSite.id);
  }

  function endRound(winner, reason) {
    if (G.phase !== 'live') return;
    G.phase = 'roundEnd';
    G.roundEndTimer = 4.5;
    G.roundEndReason = reason;
    if (winner === 'kura') {
      G.scoreKura += 1;
      G.money += WIN_MONEY;
      audio.roundWin();
      hud.banner('RONDE DIMENANGKAN', reason, 4);
    } else {
      G.scoreKelinci += 1;
      G.money += LOSE_MONEY;
      audio.roundLose();
      hud.banner('RONDE KALAH', reason, 4);
    }
    hud.feed(`Ronde ${G.round}: <b>${winner === 'kura' ? 'KURA' : 'KELINCI'}</b> menang — ${reason}`);
    if (G.scoreKura >= WIN_ROUNDS || G.scoreKelinci >= WIN_ROUNDS || G.round >= MAX_ROUNDS) {
      G.matchWinner = G.scoreKura > G.scoreKelinci ? 'kura' : G.scoreKelinci > G.scoreKura ? 'kelinci' : 'seri';
    }
  }

  function checkRoundEnd() {
    if (G.phase !== 'live') return;
    const kuraAlive = (player.alive ? 1 : 0) + bots.filter((b) => b.team === 'kura' && b.alive).length;
    const kelinciAlive = bots.filter((b) => b.team === 'kelinci' && b.alive).length;
    if (kelinciAlive === 0) {
      endRound('kura', 'Tim Kelinci habis — Taman Senja milik Kura!');
      return;
    }
    if (kuraAlive === 0 && !G.planted) endRound('kelinci', 'Tim Kura habis.');
  }

  // ---- round setup ----

  function startRound() {
    G.round += 1;
    G.phase = 'buy';
    G.buyTimer = BUY_SECONDS;
    G.planted = false;
    G.plantedSite = null;
    G.plantProgress = 0;
    G.defuseProgress = 0;
    G.roundTimer = ROUND_SECONDS;
    G.podTimer = POD_SECONDS;
    podGroup.visible = false;
    hud.setPod(false);
    G.targetSite = SITES[Math.floor(random() * SITES.length)];
    // The shield respawns at mid every round; nobody starts holding one.
    G.shieldAvailable = true;
    G.shieldHolder = null;
    shieldGroup.visible = true;
    shieldGroup.position.set(SHIELD_SPAWN[0], 0, SHIELD_SPAWN[1]);
    playerAgent.shield = false;
    hud.setShield(false);
    // Difficulty ramp: +0.15 per round played, +0.25 per round Kura leads.
    // A 3–0 lead in round 4 already puts the hares at 0.75 — they react in
    // ~0.3 s and spray barely wider than a tortoise.
    G.hareBoost = clamp(0.15 * (G.round - 1) + 0.25 * Math.max(0, G.scoreKura - G.scoreKelinci), 0, 1);
    // Respawn everyone at their spawn, weapons kept if the player survived.
    player.x = SPAWNS.kura[0][0];
    player.z = SPAWNS.kura[0][1];
    player.y = 0;
    player.vx = 0;
    player.vz = 0;
    player.vy = 0;
    player.yaw = 0;
    player.pitch = 0;
    player.health = 100;
    player.alive = true;
    player.recoilPitch = 0;
    player.recoilYaw = 0;
    if (G.round === 1) {
      G.weapon = createWeaponState(WEAPONS.kura9);
      G.grenades = 0;
    }
    bots.forEach((bot, i) => {
      const spawn = bot.team === 'kura' ? SPAWNS.kura[i % 3] : SPAWNS.kelinci[i % 4];
      resetBot(bot, spawn[0], spawn[1], random);
    });
    const site = assignRoundRoles(bots, random, G.hareBoost);
    // The allies' route site must match the round's target site.
    G.targetSite = SITES.find((s) => s.id === site);
    G.carrier = playerAgent;
    bots.forEach((b) => { b.isCarrier = false; });
    hud.setScore(G.scoreKura, G.scoreKelinci, G.round);
    hud.setMoney(G.money);
    hud.setHealth(100);
    hud.setAmmo(G.weapon.mag, G.weapon.reserve, G.weapon.def.name);
    hud.showBuy(G.money);
    hud.markBuyAffordable(G.money);
    hud.banner(`RONDE ${G.round} — FASE BELI`, `Tanam Benih di Site ${G.targetSite.id} (${G.targetSite.name}). Beli senjata, lalu maju!`, 3.5);
    if (G.hareBoost >= 0.5) {
      hud.feed(`Kelinci tertinggal ${G.scoreKura}–${G.scoreKelinci} — mereka membidik lebih cepat sekarang!`);
    }
  }

  function startMatch() {
    G.round = 0;
    G.scoreKura = 0;
    G.scoreKelinci = 0;
    G.money = START_MONEY;
    G.kills = 0;
    G.deaths = 0;
    G.matchWinner = null;
    G.started = true;
    startRound();
  }

  function beginLive() {
    G.phase = 'live';
    G.roundTimer = ROUND_SECONDS;
    hud.hideBuy();
    hud.banner(`RONDE ${G.round}`, `Site ${G.targetSite.id} — tanam Benih atau habisi Kelinci!`, 2.2);
  }

  // ---- the buy menu ----

  function buy(item) {
    if (G.phase !== 'buy') return;
    if (item === 'granat') {
      if (G.grenades >= 2) return;
      if (G.money < GRENADE.price) {
        audio.dry();
        return;
      }
      G.money -= GRENADE.price;
      G.grenades += 1;
      audio.buy();
    } else {
      const def = WEAPONS[item];
      if (!def || G.money < def.price) {
        audio.dry();
        return;
      }
      G.money -= def.price;
      G.weapon = createWeaponState(def);
      audio.buy();
    }
    hud.setMoney(G.money);
    hud.markBuyAffordable(G.money);
    hud.setAmmo(G.weapon.mag, G.weapon.reserve, G.weapon.def.name);
  }

  function endMatch() {
    G.phase = 'matchEnd';
    const w = G.matchWinner;
    const title = w === 'kura' ? 'KURA MENANG!' : w === 'kelinci' ? 'KELINCI MENANG' : 'SERI — SAMA KUAT';
    const copy = `Skor akhir ${G.scoreKura} – ${G.scoreKelinci} · Kamu: ${G.kills} kill, ${G.deaths} gugur, $${G.money} di kantong. ` +
      (w === 'kura' ? 'Pelan-pelan asal selamat: kura-kura menang juga.'
        : w === 'kelinci' ? 'Kelinci lari duluan kali ini. Pelan-pelan, ronde berikutnya milikmu.'
        : 'Tidak ada yang kalah — main lagi?');
    hud.showOverlay(title, copy, 'Main Lagi');
    if (w === 'kura') audio.roundWin();
    else audio.roundLose();
  }

  // ---- the fixed step ----

  // Buy-phase keys: 1–4 buy, B hides/shows the menu, the timer starts live.
  function stepBuyPhase(dt, keys, pressed) {
    G.buyTimer -= dt;
    if (pressed('Digit1')) buy('tempurung');
    if (pressed('Digit2')) buy('kilap');
    if (pressed('Digit3')) buy('teropong');
    if (pressed('Digit4')) buy('granat');
    if (pressed('KeyB')) {
      if (hud.els.buy.classList.contains('hidden')) hud.showBuy(G.money);
      else hud.hideBuy();
    }
    if (G.buyTimer <= 0) beginLive();
  }

  // Live-phase clocks: the round timer, the pod's countdown and its beep,
  // and the timeout that hands the round to Kelinci.
  function stepLiveClocks(dt) {
    G.roundTimer -= dt;
    if (G.planted) {
      G.podTimer -= dt;
      G.beepTimer -= dt;
      if (G.beepTimer <= 0) {
        G.beepTimer = 1;
        audio.plantTick();
      }
      if (G.podTimer <= 0) {
        explode(fx, podGroup.position);
        audio.explosion();
        pushNoise(podGroup.position.x, podGroup.position.z);
        G.shake = 1;
        endRound('kura', 'Benih meledak di Site ' + G.plantedSite.id + ' — Taman Senja mekar!');
        G.planted = false;
        podGroup.visible = false;
        hud.setPod(false);
      }
    } else if (G.roundTimer <= 0) {
      endRound('kelinci', 'Waktu habis — Benih tidak pernah ditanam.');
    }
    // A team wiped out before live (buy-phase grenade, or a kill whose
    // check ran while the phase was still 'buy') ends the round as soon as
    // live starts, instead of leaving a round with nobody left to fight.
    checkRoundEnd();
  }

  // Movement, shooting, reload, grenade and planting — only while live and alive.
  function stepPlayer(dt, input, keys, pressed) {
    const look = input.takeLook();
    playerLook(player, look.x, look.y);
    playerStep(player, keys, dt);
    weaponStep(G.weapon, dt);
    const def = G.weapon.def;
    const wantFire = def.auto ? input.state.firing : input.takeFired();
    if (wantFire && weaponCanFire(G.weapon)) playerShoot();
    else if (wantFire && G.weapon.mag === 0 && G.weapon.reloadTimer <= 0) audio.dry();
    if (pressed('KeyR') && G.weapon.reserve > 0 && G.weapon.mag < def.magSize && G.weapon.reloadTimer <= 0) {
      G.weapon.reloadTimer = def.reloadTime;
      audio.reload();
    }
    if (pressed('KeyG')) throwGrenade();
    stepPlanting(dt, keys);
  }

  // Planting: hold E inside the target site while carrying the Benih, standing
  // almost still. The bar shows the player's progress; a bot's progress is
  // shown separately in stepBots.
  function stepPlanting(dt, keys) {
    const carrying = G.carrier === playerAgent && !G.planted && keys.has('KeyE');
    if (!carrying) {
      if (G.plantProgress > 0) {
        G.plantProgress = 0;
        hud.hidePlant();
      }
      return;
    }
    const d = Math.hypot(G.targetSite.center[0] - player.x, G.targetSite.center[1] - player.z);
    if (d >= G.targetSite.radius || player.speed2d >= 1.5) {
      G.plantProgress = 0;
      hud.hidePlant();
      return;
    }
    G.plantProgress += dt;
    hud.showPlant(`MENANAM BENIH — SITE ${G.targetSite.id}`, G.plantProgress / PLANT_SECONDS);
    if (Math.floor(G.plantProgress * 2) !== Math.floor((G.plantProgress - dt) * 2)) audio.plantTick();
    if (G.plantProgress >= PLANT_SECONDS) {
      hud.hidePlant();
      plantPod(playerAgent);
    }
  }

  // Bots run in buy (they walk to holds) and live; they freeze in roundEnd.
  function stepBots(dt) {
    const ctx = {
      now: G.now, random, player, playerAgent, bots, noise: G.noise,
      phase: G.phase,
      targetSite: G.targetSite, plantedSite: G.plantedSite, planted: G.planted,
      hareBoost: G.hareBoost,
      onBotShoot: (bot) => botShoot(bot),
      onPlantProgress: (bot) => { if (bot.planting >= PLANT_SECONDS) plantPod(bot); },
      onDefuseProgress: (bot) => {
        G.defuseProgress = bot.defusing;
        if (bot.defusing >= DEFUSE_SECONDS) {
          G.planted = false;
          podGroup.visible = false;
          hud.setPod(false);
          endRound('kelinci', `${bot.name} menjinakkan Benih di Site ${G.plantedSite.id}!`);
        }
      },
    };
    for (const bot of bots) botStep(bot, dt, ctx);
    // If the player died and the carrier bot just planted, passCarrier already ran.
    // Show a bot's plant/defuse progress on the bar, so the player sees the
    // pod race instead of only hearing about it afterwards. The player's own
    // bar (set above while holding E) always wins over a bot's.
    if (G.plantProgress === 0) {
      const planter = bots.find((b) => b.alive && b.planting > 0);
      const defuser = bots.find((b) => b.alive && b.defusing > 0);
      if (planter) {
        hud.showPlant(`${planter.name.toUpperCase()} MENANAM BENIH — SITE ${G.targetSite.id}`, planter.planting / PLANT_SECONDS);
      } else if (defuser && G.plantedSite) {
        hud.showPlant(`${defuser.name.toUpperCase()} MENJINAKKAN BENIH — SITE ${G.plantedSite.id}`, defuser.defusing / DEFUSE_SECONDS);
      } else {
        hud.hidePlant();
      }
    }
  }

  // Spotted enemies for the minimap: in the player's view cone, in range, no wall.
  function updateSpotted() {
    G.spotted.clear();
    if (!player.alive) return;
    for (const b of bots) {
      if (b.team !== 'kelinci' || !b.alive) continue;
      const dx = b.x - player.x;
      const dz = b.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 32) continue;
      const want = Math.atan2(-dx, -dz);
      let diff = want - player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.1) continue;
      if (segmentBlocked(player.x, player.z, b.x, b.z)) continue;
      G.spotted.add(b);
    }
  }

  // Sync the player agent, the hit proxy, the camera and the viewmodel.
  function syncView(dt) {
    playerAgent.x = player.x;
    playerAgent.z = player.z;
    playerAgent.y = player.y;
    playerAgent.eye = player.eye;
    proxyGroup.position.set(player.x, player.y, player.z);
    proxyGroup.visible = player.alive;
    const shakeAmp = G.shake * 0.03;
    G.shake = Math.max(0, G.shake - dt * 1.4);
    // Camera shake only draws from the round's seeded stream while the
    // screen is actually shaking: drawing two numbers every frame even
    // with shake at zero made the stream's state after N steps depend on
    // how many frames had rendered instead of on the simulation alone.
    const shakeX = G.shake > 0 ? (random() * 2 - 1) * shakeAmp : 0;
    const shakeY = G.shake > 0 ? (random() * 2 - 1) * shakeAmp : 0;
    camera.position.set(player.x, player.y + player.eye, player.z);
    camera.rotation.set(
      player.pitch + player.recoilPitch + shakeX,
      player.yaw + player.recoilYaw + shakeY,
      0,
      'YXZ',
    );
    G.walkCycle += player.speed2d * dt * 1.6;
    const bob = player.grounded ? Math.sin(G.walkCycle * 2) * 0.008 * Math.min(1, player.speed2d / 5) : 0;
    G.viewKick = Math.max(0, G.viewKick - dt * 6);
    viewmodel.position.set(0.26, -0.23 + bob, -0.48 + G.viewKick * 0.09);
    if (G.flashTimer > 0) {
      G.flashTimer -= dt;
      vmFlash.material.opacity = G.flashTimer > 0 ? 0.9 : 0;
    } else {
      vmFlash.material.opacity = 0;
    }
  }

  // HUD sync (cheap: setters skip unchanged values).
  function syncHud() {
    hud.setHealth(Math.ceil(player.health));
    hud.setMoney(G.money);
    hud.setAmmo(G.weapon.mag, G.weapon.reserve, G.weapon.def.name);
    hud.setScore(G.scoreKura, G.scoreKelinci, Math.max(1, G.round));
    if (G.phase === 'buy') hud.setTimer(G.buyTimer, false);
    else if (G.planted) hud.setTimer(G.podTimer, true);
    else hud.setTimer(G.roundTimer, false);
    hud.setSpread(6 + weaponSpread(G.weapon, player.speed2d, player.crouched) * 900);
    drawMinimap(hud.els.minimap, player, bots, G.spotted, {
      shield: G.shieldAvailable ? { x: SHIELD_SPAWN[0], z: SHIELD_SPAWN[1] } : null,
      pod: G.planted && G.plantedSite ? { x: G.plantedSite.center[0], z: G.plantedSite.center[1] } : null,
    });
  }

  function gameStep(dt, input) {
    G.now += dt;
    effectsStep(fx, dt);
    hud.step(dt);
    const keys = input.state.keys;
    const pressed = (code) => keys.has(code) && !G.prevKeys.has(code);

    if (G.phase === 'buy') stepBuyPhase(dt, keys, pressed);
    if (G.phase === 'live') stepLiveClocks(dt);
    if (G.phase === 'roundEnd') {
      G.roundEndTimer -= dt;
      if (G.roundEndTimer <= 0) {
        if (G.matchWinner) endMatch();
        else startRound();
      }
    }

    if (G.phase === 'live' && player.alive) stepPlayer(dt, input, keys, pressed);

    // The shield waits at mid through buy and live; anyone walking over it
    // picks it up. It never spawns during roundEnd or the menu.
    if (G.phase === 'buy' || G.phase === 'live') checkShieldPickup();

    // Grenades fly in every phase (they may finish a round).
    for (let i = G.grenadesLive.length - 1; i >= 0; i -= 1) {
      const g = G.grenadesLive[i];
      if (grenadeStep(g, dt, resolveCircle)) {
        explodeGrenade(g);
        G.grenadesLive.splice(i, 1);
      }
    }

    if (G.phase === 'buy' || G.phase === 'live') stepBots(dt);

    updateSpotted();
    syncView(dt);
    syncHud();

    G.prevKeys = new Set(keys);
  }

  // ---- deterministic captures: ?shot=lobby|fight|plant|win&seed=N ----

  function aimPlayerAt(x, y, z) {
    const dx = x - player.x;
    const dy = y - (player.y + player.eye);
    const dz = z - player.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.asin(clamp(dy / len, -1, 1));
  }

  // A stub input for the settle steps: no keys, no look, no trigger.
  function stubInput() {
    return {
      state: { keys: new Set(), firing: false, fired: false },
      takeLook: () => ({ x: 0, y: 0 }),
      takeFired: () => false,
    };
  }

  function placeBot(bot, x, z, yaw) {
    bot.x = x;
    bot.z = z;
    if (yaw !== undefined) bot.yaw = yaw;
    bot.group.position.set(x, 0, z);
  }

  function shotSetup(name) {
    const stub = stubInput();
    startMatch();
    const foes = bots.filter((b) => b.team === 'kelinci');
    const allies = bots.filter((b) => b.team === 'kura');

    if (name === 'lobby') {
      // Buy phase at the Kura spawn, Tempurung bought, menu open.
      G.money = 2000;
      buy('tempurung'); // leaves the honest $800 remainder
      player.x = 0;
      player.z = 12.5;
      player.yaw = 0;
      player.pitch = 0.02;
      hud.showBuy(G.money);
      hud.markBuyAffordable(G.money);
    } else if (name === 'fight') {
      G.round = 2;
      G.scoreKura = 1;
      G.scoreKelinci = 1;
      beginLive();
      G.weapon = createWeaponState(WEAPONS.tempurung); // bought last round, kept alive
      player.x = 0;
      player.z = 6;
      player.yaw = 0;
      player.pitch = 0;
      // The player grabbed the Perisai Tempurung on the way through mid:
      // shield chip visible in the HUD, shield mesh gone from the garden.
      playerAgent.shield = true;
      G.shieldAvailable = false;
      G.shieldHolder = playerAgent;
      shieldGroup.visible = false;
      hud.setShield(true);
      placeBot(foes[0], -1.5, -6, Math.PI);
      placeBot(foes[1], 2.2, -8.5, Math.PI);
      placeBot(foes[2], -6, -9.5, Math.PI);
      placeBot(foes[3], 9, 7.5, Math.PI);
      placeBot(allies[0], -2, 4);
      // Scripted exchange: the player drops the hare at mid with three aimed rounds.
      aimPlayerAt(-1.5, 1.2, -6);
      for (let i = 0; i < 3; i += 1) {
        G.weapon.cooldown = 0;
        playerShoot();
        gameStep(1 / 60, stub);
      }
      // One hare shoots at the ally holding mid and misses wide, so its
      // tracer crosses the frame — at the player, the shot would land and
      // the Perisai would break before the capture, hiding the shield chip
      // this still is meant to show.
      foes[1].target = allies[0];
      foes[1].reactAt = 0;
      botShoot(foes[1]);
      gameStep(1 / 60, stub);
      aimPlayerAt(-1.5, 1.2, -6);
      // Let the muzzle flash fade so the capture shows the fight, not the flash.
      gameStep(1 / 60, stub);
      gameStep(1 / 60, stub);
      gameStep(1 / 60, stub);
      // Frame the capture at full health: the scripted exchange already proved
      // the bots shoot back (the feed shows the kill); the still is the moment
      // after the kill, not the wound.
      player.health = 100;
    } else if (name === 'plant') {
      G.round = 3;
      G.scoreKura = 2;
      G.scoreKelinci = 1;
      beginLive();
      G.targetSite = SITES[0];
      // Inside Site A, looking west across the garden beds: the beacon is close
      // but off-centre, the beds and the holding hare are in frame.
      player.x = -14.6;
      player.z = -6.4;
      aimPlayerAt(-18, 0.9, -8);
      G.plantProgress = 1.8; // 60% planted, bar visible
      placeBot(foes[0], -18.5, -5.5, Math.PI / 2);
      placeBot(allies[0], -15.5, -9.2);
      hud.showPlant('MENANAM BENIH — SITE A', 0.6);
    } else if (name === 'win') {
      G.round = 3;
      G.scoreKura = 2;
      G.scoreKelinci = 1;
      G.targetSite = SITES[0];
      G.planted = true;
      G.plantedSite = SITES[0];
      podGroup.position.set(SITES[0].center[0], 0, SITES[0].center[1]);
      podGroup.visible = true;
      hud.setPod(true, 'A');
      G.phase = 'roundEnd';
      G.roundEndTimer = 4.5;
      G.roundEndReason = 'Benih meledak di Site A — Taman Senja mekar!';
      G.scoreKura = 3;
      hud.hideBuy();
      // At the site entry lane, looking into the garden: the glowing pod, the
      // beds and the fallen hares are all in frame, no wall hugging the lens.
      player.x = -12.5;
      player.z = -7.8;
      aimPlayerAt(-17.5, 0.7, -7.2);
      const fallenSpots = [[-16.5, -8.5], [-18, -6.5], [-16, -6], [-18.5, -9]];
      foes.forEach((b, i) => {
        b.alive = false;
        b.health = 0;
        b.fallT = 1;
        b.group.position.set(fallenSpots[i][0], 0, fallenSpots[i][1]);
        b.group.rotation.x = -Math.PI / 2;
      });
      hud.banner('RONDE DIMENANGKAN', G.roundEndReason, 30);
    }

    // One settle step so the HUD, the minimap and the camera agree.
    gameStep(1 / 60, stub);
    // The settle step resets the plant bar (no E held in a capture), so the
    // plant capture re-applies its 60% progress after settling.
    if (name === 'plant') {
      G.plantProgress = 1.8;
      hud.showPlant('MENANAM BENIH — SITE A', 0.6);
    }
  }

  return {
    G, gameStep, startMatch, beginLive, buy, endMatch, shotSetup, aimPlayerAt,
    onPlayClick: () => {
      if (G.phase === 'menu') {
        startMatch();
        return 'lock';
      }
      if (G.phase === 'matchEnd') {
        startMatch();
        return 'lock';
      }
      return 'lock';
    },
  };
}
