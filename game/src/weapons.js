// The armoury. Original names, one job each: the free sidearm, the all-round
// rifle, the close-quarters SMG and the long-range DMR, plus a leaf grenade.
// Damage is per body hit; the head multiplies it by 3, so stopping to aim pays.
// Spread grows while moving and with every shot in a burst, and recoil kicks the
// view up — the numbers below are the whole gunfeel.
export const WEAPONS = {
  kura9: {
    id: 'kura9', name: 'Kura-9', kind: 'pistol', price: 0,
    damage: 26, headMult: 3, magSize: 12, reserveMax: 48,
    fireInterval: 0.16, reloadTime: 1.1, auto: false,
    spreadBase: 0.006, spreadMove: 0.02, spreadBloom: 0.004, spreadMax: 0.05,
    recoil: 0.011, range: 40, falloffAt: 25, falloffMult: 0.8,
  },
  tempurung: {
    id: 'tempurung', name: 'Tempurung AR', kind: 'rifle', price: 1200,
    damage: 34, headMult: 3, magSize: 25, reserveMax: 100,
    fireInterval: 0.11, reloadTime: 1.6, auto: true,
    spreadBase: 0.004, spreadMove: 0.026, spreadBloom: 0.005, spreadMax: 0.06,
    recoil: 0.014, range: 60, falloffAt: 30, falloffMult: 0.75,
  },
  kilap: {
    id: 'kilap', name: 'Kilap SMG', kind: 'smg', price: 900,
    damage: 22, headMult: 3, magSize: 30, reserveMax: 120,
    fireInterval: 0.075, reloadTime: 1.4, auto: true,
    spreadBase: 0.009, spreadMove: 0.018, spreadBloom: 0.004, spreadMax: 0.07,
    recoil: 0.008, range: 35, falloffAt: 18, falloffMult: 0.7,
  },
  teropong: {
    id: 'teropong', name: 'Teropong DMR', kind: 'dmr', price: 2200,
    damage: 80, headMult: 3, magSize: 8, reserveMax: 32,
    fireInterval: 0.55, reloadTime: 2.2, auto: false,
    spreadBase: 0.001, spreadMove: 0.045, spreadBloom: 0.012, spreadMax: 0.09,
    recoil: 0.035, range: 80, falloffAt: 40, falloffMult: 0.9,
  },
};

export const GRENADE = { id: 'granat', name: 'Granat Daun', price: 300, fuse: 1.4, radius: 6.5, damageMax: 90, damageMin: 20 };

export const BUY_MENU = [
  { key: '1', weapon: 'tempurung' },
  { key: '2', weapon: 'kilap' },
  { key: '3', weapon: 'teropong' },
  { key: '4', weapon: 'granat' },
];

// One live weapon instance: mag, reserve, timers and bloom. No allocation per
// shot — the caller passes in scratch values and reads the result.
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
