// The armoury: four guns and one leaf grenade, all original names.
// Damage is per body hit and a headshot triples it, so stopping to aim pays.
// Spread grows while moving and with every shot in a burst; recoil kicks the
// view up a little each round. The numbers below are the whole gunfeel —
// the Kura-9 is free and honest, the Tempurung AR is the workhorse, the
// Kilap SMG sprays up close, the Teropong DMR punishes anyone who stands
// still long enough to line it up.

function gun(id, name, kind, price, damage, magSize, reserveMax, fireInterval, reloadTime, auto, spreadBase, spreadMove, spreadBloom, spreadMax, recoil, range, falloffAt, falloffMult) {
  return {
    id, name, kind, price,
    damage, headMult: 3, magSize, reserveMax,
    fireInterval, reloadTime, auto,
    spreadBase, spreadMove, spreadBloom, spreadMax,
    recoil, range, falloffAt, falloffMult,
  };
}

export const WEAPONS = {
  kura9: gun('kura9', 'Kura-9', 'pistol', 0, 26, 12, 48, 0.16, 1.1, false, 0.006, 0.02, 0.004, 0.05, 0.011, 40, 25, 0.8),
  tempurung: gun('tempurung', 'Tempurung AR', 'rifle', 1200, 34, 25, 100, 0.11, 1.6, true, 0.004, 0.026, 0.005, 0.06, 0.014, 60, 30, 0.75),
  kilap: gun('kilap', 'Kilap SMG', 'smg', 900, 22, 30, 120, 0.075, 1.4, true, 0.009, 0.018, 0.004, 0.07, 0.008, 35, 18, 0.7),
  teropong: gun('teropong', 'Teropong DMR', 'dmr', 2200, 80, 8, 32, 0.55, 2.2, false, 0.001, 0.045, 0.012, 0.09, 0.035, 80, 40, 0.9),
};

export const GRENADE = {
  id: 'granat',
  name: 'Granat Daun',
  price: 300,
  fuse: 1.4,
  radius: 6.5,
  damageMax: 90,
  damageMin: 20,
};

// Buy menu rows in the order the HUD shows them: key 1–4.
export const BUY_MENU = [
  { key: '1', weapon: 'tempurung' },
  { key: '2', weapon: 'kilap' },
  { key: '3', weapon: 'teropong' },
  { key: '4', weapon: 'granat' },
];

// One live weapon: a definition plus its magazine, reserve, timers and bloom.
// The caller steps it once per fixed tick and reads weaponCanFire before
// every shot; nothing here allocates per shot.
export function createWeaponState(def) {
  return {
    def,
    mag: def.magSize,
    reserve: def.reserveMax,
    cooldown: 0,
    reloadTimer: 0,
    bloom: 0,
  };
}

// Current spread in radians: base + movement + bloom, crouched tightens it
// to 60%. Capped at the gun's spreadMax so a long burst stays usable.
export function weaponSpread(state, moveSpeed, crouched) {
  const def = state.def;
  let spread = def.spreadBase + def.spreadMove * Math.min(1, moveSpeed / 5.5) + state.bloom;
  if (crouched) spread *= 0.6;
  return Math.min(spread, def.spreadMax);
}

export function weaponCanFire(state) {
  return state.reloadTimer <= 0 && state.cooldown <= 0 && state.mag > 0;
}

export function weaponStep(state, dt) {
  if (state.cooldown > 0) state.cooldown -= dt;
  if (state.reloadTimer > 0) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      const need = state.def.magSize - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
  // Bloom decays fast when the trigger is released, slower while firing.
  state.bloom = Math.max(0, state.bloom - dt * 0.045);
}
