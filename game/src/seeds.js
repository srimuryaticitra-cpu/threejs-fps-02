// ============================================================
// seeds.js — Ketapel Biji (Seed Slingshot)
// ------------------------------------------------------------
// Senjata khas kura-kura: ketapel kayu tempurung yang melontarkan
// biji. Biji terbang mengikuti lintasan parabola (gravitasi),
// lalu meletup kecil saat mendarat dan memberi splash damage
// di sekitar titik jatuhnya. Amunisi biji tidak dibeli dengan
// uang: diisi ulang dengan memungut "Kantong Biji" yang tumbuh
// tersebar di sudut-sudut map. Bot juga bisa memungut kantong
// dan menembakkan biji, jadi senjata ini hidup di kedua sisi.
// Modul ini mandiri: semua sentuhan ke dunia game lewat `env`
// yang disuntik saat createSeedArsenal(env) dipanggil, sehingga
// modul tidak perlu tahu struktur internal game.
// ============================================================

export const KETAPEL_BIJI_ID = 'ketapel-biji';
export const KANTONG_BIJI_ID = 'kantong-biji';
export const SEED_PROJECTILE_KIND = 'biji-lob';

// ------------------------------------------------------------
// Konfigurasi ketapel: angka-angka penyeimbang senjata.
// ------------------------------------------------------------
export const KETAPEL_CONFIG = {
  displayName: 'Ketapel Biji',
  shortName: 'Ketapel',
  priceCredits: 250,
  damageDirect: 34,
  damageSplash: 22,
  splashRadius: 2.6,
  splashFalloffStart: 1.1,
  lobSpeed: 21,
  lobUpBias: 0.42,
  lobHorizontalSpeed: 13,
  lobMinFlightMs: 350,
  lobMaxFlightMs: 2200,
  gravityPull: 12.5,
  fireIntervalMs: 780,
  reloadMs: 0,
  maxBiji: 12,
  startBiji: 6,
  pouchBiji: 6,
  pouchMaxOnMap: 5,
  pouchRespawnMs: 14000,
  pouchPickupRadius: 1.7,
  pouchBobAmplitude: 0.22,
  pouchSpinSpeed: 1.4,
  seedRadius: 0.14,
  seedTrailLength: 9,
  botPreferRangeMin: 6,
  botPreferRangeMax: 26,
  botAimWobble: 0.05,
};

// Warna-warna khas biji dan kantong, supaya mudah dikenali.
export const SEED_PALETTE = {
  bijiCore: 0x7a4a21,
  bijiShell: 0x4d2f14,
  bijiGlow: 0xc9a227,
  kantongCloth: 0x8a6d3b,
  kantongTie: 0x5b4636,
  kantongGlow: 0xffd34d,
  percikCore: 0xffe08a,
  percikRing: 0x9be15d,
};

// ------------------------------------------------------------
// State internal arsenal biji. Satu instance per pertandingan.
// ------------------------------------------------------------
export function createSeedArsenalState() {
  return {
    projectiles: [],
    pouches: [],
    nextSeedId: 1,
    nextPouchId: 1,
    pouchRespawnAt: 0,
    firedTotal: 0,
    splashedTotal: 0,
    pouchesTakenTotal: 0,
    botFiredTotal: 0,
    lastFireAtByOwner: new Map(),
  };
}

// ------------------------------------------------------------
// Util kecil: jarak 3D, clamp, dan acak deterministik ringan.
// ------------------------------------------------------------
function seedDistance3(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function seedClampNumber(value, low, high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

function seedLerpNumber(from, to, t) {
  return from + (to - from) * t;
}

// Menghitung kecepatan awal lob supaya biji mendarat di target:
// waktu terbang dari jarak datar, lalu vy dipecahkan dari persamaan
// gerak parabola (naik, lalu jatuh tepat di titik target).
export function computeSeedLobVelocity(origin, target, config) {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dy = (target.y || 0) - (origin.y || 0);
  const flat = Math.sqrt(dx * dx + dz * dz) || 1;
  const flyMs = seedClampNumber(
    (flat / config.lobHorizontalSpeed) * 1000,
    config.lobMinFlightMs,
    config.lobMaxFlightMs,
  );
  const flySeconds = flyMs / 1000;
  const horizontalSpeed = flat / flySeconds;
  const upSpeed = (dy + 0.5 * config.gravityPull * flySeconds * flySeconds) / flySeconds;
  return {
    x: (dx / flat) * horizontalSpeed,
    y: upSpeed,
    z: (dz / flat) * horizontalSpeed,
  };
}

// ------------------------------------------------------------
// Proyektil biji: dibuat saat ketapel ditembakkan.
// ------------------------------------------------------------
export function spawnSeedProjectile(state, env, owner, origin, velocity) {
  const seed = {
    id: state.nextSeedId++,
    kind: SEED_PROJECTILE_KIND,
    ownerId: owner ? owner.id : 'unknown',
    ownerIsBot: !!(owner && owner.isBot),
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    ageMs: 0,
    alive: true,
    trail: [],
    mesh: null,
  };
  if (env && typeof env.buildSeedMesh === 'function') {
    seed.mesh = env.buildSeedMesh(seed);
    if (seed.mesh && env.scene && typeof env.scene.add === 'function') {
      env.scene.add(seed.mesh);
    }
  }
  state.projectiles.push(seed);
  return seed;
}

// Satu langkah simulasi proyektil: gravitasi, gerak, tabrakan.
export function stepSeedProjectile(state, env, seed, dtSeconds, actors) {
  if (!seed.alive) return 'dead';
  seed.ageMs += dtSeconds * 1000;
  seed.vy -= KETAPEL_CONFIG.gravityPull * dtSeconds;
  seed.x += seed.vx * dtSeconds;
  seed.y += seed.vy * dtSeconds;
  seed.z += seed.vz * dtSeconds;
  seed.trail.push({ x: seed.x, y: seed.y, z: seed.z });
  if (seed.trail.length > KETAPEL_CONFIG.seedTrailLength) seed.trail.shift();
  if (seed.mesh) {
    seed.mesh.position.set(seed.x, seed.y, seed.z);
    seed.mesh.rotation.x += dtSeconds * 9;
    seed.mesh.rotation.z += dtSeconds * 7;
  }
  const groundY = env && typeof env.groundHeightAt === 'function'
    ? env.groundHeightAt(seed.x, seed.z)
    : 0;
  if (seed.y <= groundY + KETAPEL_CONFIG.seedRadius) {
    seed.y = groundY + KETAPEL_CONFIG.seedRadius;
    return detonateSeedProjectile(state, env, seed, actors, 'ground');
  }
  if (env && typeof env.isBlockedAt === 'function' && env.isBlockedAt(seed.x, seed.y, seed.z)) {
    return detonateSeedProjectile(state, env, seed, actors, 'wall');
  }
  if (actors) {
    for (const actor of actors) {
      if (!actor || actor.id === seed.ownerId) continue;
      if (actor.health !== undefined && actor.health <= 0) continue;
      const d = seedDistance3(seed.x, seed.y, seed.z, actor.x, actor.y, actor.z);
      if (d < 0.85) {
        return detonateSeedProjectile(state, env, seed, actors, 'actor');
      }
    }
  }
  if (seed.ageMs > 6000) {
    return detonateSeedProjectile(state, env, seed, actors, 'timeout');
  }
  return 'flying';
}

// Ledakan kecil biji: damage langsung ke yang kena + splash.
export function detonateSeedProjectile(state, env, seed, actors, cause) {
  if (!seed.alive) return 'dead';
  seed.alive = false;
  state.splashedTotal += 1;
  if (seed.mesh && env && env.scene && typeof env.scene.remove === 'function') {
    env.scene.remove(seed.mesh);
  }
  const hits = [];
  if (actors) {
    for (const actor of actors) {
      if (!actor || actor.id === seed.ownerId) continue;
      if (actor.health !== undefined && actor.health <= 0) continue;
      const d = seedDistance3(seed.x, seed.y, seed.z, actor.x, actor.y, actor.z);
      if (cause === 'actor' && d < 0.85) {
        hits.push({ actor, amount: KETAPEL_CONFIG.damageDirect, kind: 'direct' });
      } else if (d <= KETAPEL_CONFIG.splashRadius) {
        const falloff = seedClampNumber(
          1 - (d - KETAPEL_CONFIG.splashFalloffStart) /
            (KETAPEL_CONFIG.splashRadius - KETAPEL_CONFIG.splashFalloffStart),
          0.25,
          1,
        );
        hits.push({ actor, amount: Math.round(KETAPEL_CONFIG.damageSplash * falloff), kind: 'splash' });
      }
    }
  }
  if (env && typeof env.applySeedDamage === 'function') {
    for (const hit of hits) env.applySeedDamage(hit.actor, hit.amount, seed.ownerId, hit.kind);
  }
  if (env && typeof env.spawnSeedBurst === 'function') {
    env.spawnSeedBurst(seed.x, seed.y, seed.z, cause);
  }
  if (env && typeof env.playSeedSound === 'function') {
    env.playSeedSound('seed-splash', seed.x, seed.y, seed.z);
  }
  return 'detonated';
}

// Membersihkan proyektil yang sudah meledak dari daftar aktif.
export function pruneSeedProjectiles(state) {
  state.projectiles = state.projectiles.filter((seed) => seed.alive);
}

// ------------------------------------------------------------
// Kantong Biji: pickup amunisi yang muncul di map.
// ------------------------------------------------------------
export function spawnKantongBiji(state, env, spot) {
  const pouch = {
    id: state.nextPouchId++,
    kind: KANTONG_BIJI_ID,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    baseY: spot.y,
    amount: KETAPEL_CONFIG.pouchBiji,
    bobPhase: (state.nextPouchId * 1.7) % (Math.PI * 2),
    spinPhase: (state.nextPouchId * 2.3) % (Math.PI * 2),
    mesh: null,
    taken: false,
  };
  if (env && typeof env.buildKantongMesh === 'function') {
    pouch.mesh = env.buildKantongMesh(pouch);
    if (pouch.mesh && env.scene && typeof env.scene.add === 'function') {
      env.scene.add(pouch.mesh);
    }
  }
  state.pouches.push(pouch);
  return pouch;
}

// Memilih titik spawn kantong dari daftar spot yang disediakan env.
// Deterministik (round-robin dari id kantong berikutnya) supaya hasil
// tangkapan layar ?shot tetap sama di setiap proses headless.
export function pickKantongSpot(env, state) {
  if (!env || typeof env.kantongSpots !== 'function') return null;
  const spots = env.kantongSpots();
  if (!spots || spots.length === 0) return null;
  const used = new Set(state.pouches.map((pouch) => `${pouch.x},${pouch.z}`));
  const startAt = (state.nextPouchId - 1) % spots.length;
  for (let step = 0; step < spots.length; step += 1) {
    const spot = spots[(startAt + step) % spots.length];
    if (!used.has(`${spot.x},${spot.z}`)) return spot;
  }
  return null;
}

// Menjaga jumlah kantong di map: isi ulang sampai batas, dengan jeda.
export function maintainKantongBiji(state, env, nowMs) {
  const alive = state.pouches.filter((pouch) => !pouch.taken);
  if (alive.length >= KETAPEL_CONFIG.pouchMaxOnMap) return;
  if (nowMs < state.pouchRespawnAt) return;
  const spot = pickKantongSpot(env, state);
  if (!spot) return;
  spawnKantongBiji(state, env, spot);
  state.pouchRespawnAt = nowMs + KETAPEL_CONFIG.pouchRespawnMs;
}

// Animasi kantong: melayang naik-turun dan berputar pelan.
export function stepKantongBiji(state, dtSeconds, nowMs) {
  for (const pouch of state.pouches) {
    if (pouch.taken || !pouch.mesh) continue;
    const t = nowMs / 1000 + pouch.bobPhase;
    pouch.mesh.position.y = pouch.baseY + Math.sin(t * 1.6) * KETAPEL_CONFIG.pouchBobAmplitude;
    pouch.mesh.rotation.y += dtSeconds * KETAPEL_CONFIG.pouchSpinSpeed;
  }
}

// Cek apakah ada aktor yang cukup dekat untuk memungut kantong.
export function tryCollectKantong(state, env, actors) {
  const collected = [];
  for (const pouch of state.pouches) {
    if (pouch.taken) continue;
    for (const actor of actors || []) {
      if (!actor) continue;
      if (actor.health !== undefined && actor.health <= 0) continue;
      const d = seedDistance3(pouch.x, pouch.y, pouch.z, actor.x, actor.y, actor.z);
      if (d <= KETAPEL_CONFIG.pouchPickupRadius) {
        pouch.taken = true;
        state.pouchesTakenTotal += 1;
        if (pouch.mesh && env && env.scene && typeof env.scene.remove === 'function') {
          env.scene.remove(pouch.mesh);
        }
        const gained = addBijiAmmo(actor, pouch.amount);
        collected.push({ pouch, actor, gained });
        if (env && typeof env.playSeedSound === 'function') {
          env.playSeedSound('seed-pickup', pouch.x, pouch.y, pouch.z);
        }
        if (env && typeof env.onKantongTaken === 'function') {
          env.onKantongTaken(actor, pouch, gained);
        }
        break;
      }
    }
  }
  state.pouches = state.pouches.filter((pouch) => !pouch.taken);
  return collected;
}

// Kantong terdekat dari sebuah posisi — dipakai bot berburu amunisi.
export function nearestKantongBiji(state, x, y, z) {
  let best = null;
  let bestD = Infinity;
  for (const pouch of state.pouches) {
    if (pouch.taken) continue;
    const d = seedDistance3(pouch.x, pouch.y, pouch.z, x, y, z);
    if (d < bestD) {
      bestD = d;
      best = pouch;
    }
  }
  return best ? { pouch: best, distance: bestD } : null;
}

// ------------------------------------------------------------
// Menembak ketapel: cek cooldown + amunisi, lalu luncurkan biji.
// ------------------------------------------------------------
export function ketapelReadyAt(state, ownerId) {
  return state.lastFireAtByOwner.get(ownerId) || 0;
}

export function canFireKetapel(state, owner, nowMs) {
  if (!owner) return { ok: false, reason: 'no-owner' };
  if (owner.health !== undefined && owner.health <= 0) return { ok: false, reason: 'owner-down' };
  const ammo = owner.seedAmmo === undefined ? KETAPEL_CONFIG.startBiji : owner.seedAmmo;
  if (ammo <= 0) return { ok: false, reason: 'no-biji' };
  const last = ketapelReadyAt(state, owner.id);
  if (nowMs - last < KETAPEL_CONFIG.fireIntervalMs) return { ok: false, reason: 'cooling' };
  return { ok: true, reason: 'ready', ammo };
}

export function fireKetapel(state, env, owner, origin, target, nowMs) {
  const check = canFireKetapel(state, owner, nowMs);
  if (!check.ok) return { ok: false, reason: check.reason };
  owner.seedAmmo = (owner.seedAmmo === undefined ? KETAPEL_CONFIG.startBiji : owner.seedAmmo) - 1;
  state.lastFireAtByOwner.set(owner.id, nowMs);
  state.firedTotal += 1;
  if (owner.isBot) state.botFiredTotal += 1;
  const velocity = computeSeedLobVelocity(origin, target, KETAPEL_CONFIG);
  const seed = spawnSeedProjectile(state, env, owner, origin, velocity);
  if (env && typeof env.playSeedSound === 'function') {
    env.playSeedSound('seed-shoot', origin.x, origin.y, origin.z);
  }
  if (env && typeof env.onSeedFired === 'function') {
    env.onSeedFired(owner, seed);
  }
  return { ok: true, reason: 'fired', seed, ammoLeft: owner.seedAmmo };
}

// Tambah amunisi biji, tidak melebihi batas tas.
export function addBijiAmmo(actor, amount) {
  const before = actor.seedAmmo === undefined ? KETAPEL_CONFIG.startBiji : actor.seedAmmo;
  const after = Math.min(KETAPEL_CONFIG.maxBiji, before + amount);
  actor.seedAmmo = after;
  return after - before;
}

// Pastikan aktor punya kantong amunisi biji saat pertandingan mulai.
export function initSeedAmmo(actor) {
  if (actor.seedAmmo === undefined) actor.seedAmmo = KETAPEL_CONFIG.startBiji;
  if (actor.hasKetapel === undefined) actor.hasKetapel = false;
  return actor.seedAmmo;
}

// Teks amunisi untuk HUD: "BIJI 7/12".
export function ketapelAmmoText(actor) {
  const ammo = actor.seedAmmo === undefined ? KETAPEL_CONFIG.startBiji : actor.seedAmmo;
  return `BIJI ${ammo}/${KETAPEL_CONFIG.maxBiji}`;
}

// Apakah aktor sedang memegang ketapel sebagai senjata aktif?
export function isHoldingKetapel(actor) {
  return !!(actor && actor.activeWeaponId === KETAPEL_BIJI_ID);
}

// ------------------------------------------------------------
// Bot: berburu kantong saat kehabisan biji, menembak saat musuh
// berada di jarak lob yang nyaman.
// ------------------------------------------------------------
export function botSeedThink(state, env, bot, enemies, nowMs) {
  if (!bot || bot.health <= 0) return { action: 'idle' };
  initSeedAmmo(bot);
  if (bot.seedWobbleSeed === undefined) {
    let wobbleHash = 0;
    for (const ch of String(bot.name || 'biji')) wobbleHash = (wobbleHash * 31 + ch.charCodeAt(0)) % 997;
    bot.seedWobbleSeed = wobbleHash;
  }
  const ammo = bot.seedAmmo;
  if (ammo <= 0) {
    const found = nearestKantongBiji(state, bot.x, bot.y, bot.z);
    if (found) {
      return { action: 'fetch-pouch', pouch: found.pouch, distance: found.distance };
    }
    return { action: 'idle', reason: 'no-pouch' };
  }
  const target = nearestSeedTarget(bot, enemies);
  if (!target) return { action: 'idle', reason: 'no-target' };
  if (target.distance < KETAPEL_CONFIG.botPreferRangeMin) {
    return { action: 'too-close', target: target.enemy, distance: target.distance };
  }
  if (target.distance > KETAPEL_CONFIG.botPreferRangeMax) {
    return { action: 'too-far', target: target.enemy, distance: target.distance };
  }
  const wobble = Math.sin(state.firedTotal * 12.9898 + bot.seedWobbleSeed) * KETAPEL_CONFIG.botAimWobble;
  const aimPoint = {
    x: target.enemy.x + wobble * target.distance,
    y: target.enemy.y + 0.4,
    z: target.enemy.z + wobble * target.distance,
  };
  const origin = { x: bot.x, y: bot.y + 1.4, z: bot.z };
  const result = fireKetapel(state, env, bot, origin, aimPoint, nowMs);
  if (result.ok) return { action: 'fired-seed', target: target.enemy, ammoLeft: result.ammoLeft };
  return { action: 'wait', reason: result.reason };
}

// Musuh hidup terdekat dari bot.
export function nearestSeedTarget(bot, enemies) {
  let best = null;
  let bestD = Infinity;
  for (const enemy of enemies || []) {
    if (!enemy || enemy.id === bot.id) continue;
    if (enemy.health !== undefined && enemy.health <= 0) continue;
    const d = seedDistance3(bot.x, bot.y, bot.z, enemy.x, enemy.y, enemy.z);
    if (d < bestD) {
      bestD = d;
      best = enemy;
    }
  }
  return best ? { enemy: best, distance: bestD } : null;
}

// Bot yang kehabisan biji sebaiknya bergerak menuju kantong.
// Mengembalikan arah (dx, dz) ternormalisasi atau null.
export function botSeedFetchDirection(state, bot) {
  const found = nearestKantongBiji(state, bot.x, bot.y, bot.z);
  if (!found) return null;
  const dx = found.pouch.x - bot.x;
  const dz = found.pouch.z - bot.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return { dx: dx / len, dz: dz / len, distance: found.distance };
}

// ------------------------------------------------------------
// Visual: mesh biji dan mesh kantong, dibuat dari THREE lewat env.
// ------------------------------------------------------------
export function buildSeedMeshDefault(THREE, seed) {
  const group = new THREE.Group();
  const coreGeo = new THREE.SphereGeometry(KETAPEL_CONFIG.seedRadius, 10, 8);
  const coreMat = new THREE.MeshStandardMaterial({ color: SEED_PALETTE.bijiCore, roughness: 0.7 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);
  const capGeo = new THREE.SphereGeometry(KETAPEL_CONFIG.seedRadius * 0.55, 8, 6);
  const capMat = new THREE.MeshStandardMaterial({ color: SEED_PALETTE.bijiGlow, roughness: 0.4 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(0, KETAPEL_CONFIG.seedRadius * 0.7, 0);
  group.add(cap);
  group.position.set(seed.x, seed.y, seed.z);
  group.userData.seedId = seed.id;
  return group;
}

export function buildKantongMeshDefault(THREE, pouch) {
  const group = new THREE.Group();
  const sackGeo = new THREE.SphereGeometry(0.42, 12, 10);
  const sackMat = new THREE.MeshStandardMaterial({ color: SEED_PALETTE.kantongCloth, roughness: 0.9 });
  const sack = new THREE.Mesh(sackGeo, sackMat);
  sack.scale.set(1, 0.85, 1);
  group.add(sack);
  const tieGeo = new THREE.TorusGeometry(0.2, 0.06, 8, 14);
  const tieMat = new THREE.MeshStandardMaterial({ color: SEED_PALETTE.kantongTie, roughness: 0.8 });
  const tie = new THREE.Mesh(tieGeo, tieMat);
  tie.position.set(0, 0.38, 0);
  tie.rotation.x = Math.PI / 2;
  group.add(tie);
  const glowGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const glowMat = new THREE.MeshStandardMaterial({
    color: SEED_PALETTE.kantongGlow,
    emissive: SEED_PALETTE.kantongGlow,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0, 0.55, 0);
  group.add(glow);
  group.position.set(pouch.x, pouch.y, pouch.z);
  group.userData.pouchId = pouch.id;
  return group;
}

// ------------------------------------------------------------
// Suara: nama event suara yang diteruskan ke audio game.
// ------------------------------------------------------------
export const SEED_SOUND_EVENTS = {
  shoot: 'seed-shoot',
  splash: 'seed-splash',
  pickup: 'seed-pickup',
  empty: 'seed-empty',
  bounce: 'seed-bounce',
};

export function seedSoundFor(eventName) {
  return SEED_SOUND_EVENTS[eventName] || 'seed-shoot';
}

// ------------------------------------------------------------
// Update utama: dipanggil tiap frame dari loop game.
// ------------------------------------------------------------
export function updateSeedArsenal(state, env, dtSeconds, nowMs, actors) {
  maintainKantongBiji(state, env, nowMs);
  stepKantongBiji(state, dtSeconds, nowMs);
  tryCollectKantong(state, env, actors);
  for (const seed of [...state.projectiles]) {
    stepSeedProjectile(state, env, seed, dtSeconds, actors);
  }
  pruneSeedProjectiles(state);
}

// Ringkasan statistik arsenal untuk layar akhir / dossier.
export function seedArsenalSummary(state) {
  return {
    firedTotal: state.firedTotal,
    splashedTotal: state.splashedTotal,
    pouchesTakenTotal: state.pouchesTakenTotal,
    botFiredTotal: state.botFiredTotal,
    projectilesActive: state.projectiles.filter((seed) => seed.alive).length,
    pouchesOnMap: state.pouches.filter((pouch) => !pouch.taken).length,
  };
}

// ------------------------------------------------------------
// Factory: merakit arsenal lengkap dengan env game.
// ------------------------------------------------------------
export function createSeedArsenal(env) {
  const state = createSeedArsenalState();
  const safeEnv = env || {};
  return {
    state,
    env: safeEnv,
    config: KETAPEL_CONFIG,
    update(dtSeconds, nowMs, actors) {
      updateSeedArsenal(state, safeEnv, dtSeconds, nowMs, actors);
    },
    fire(owner, origin, target, nowMs) {
      return fireKetapel(state, safeEnv, owner, origin, target, nowMs);
    },
    canFire(owner, nowMs) {
      return canFireKetapel(state, owner, nowMs);
    },
    botThink(bot, enemies, nowMs) {
      return botSeedThink(state, safeEnv, bot, enemies, nowMs);
    },
    summary() {
      return seedArsenalSummary(state);
    },
    ammoText(actor) {
      return ketapelAmmoText(actor);
    },
  };
}
