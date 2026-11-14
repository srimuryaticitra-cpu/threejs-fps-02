// The player controller: acceleration-based movement with friction, crouch
// and jump, resolved against the map's AABB colliders. Stopping to aim pays
// because spread (weapons.js) reads ground speed, and crouching tightens it
// again. One state object, one job: where the player is and how fast they move.
import { resolveCircle } from './map.js';
import { clamp } from './rng.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;
const RADIUS = 0.42;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 11;
const JUMP_SPEED = 5.2;
const GRAVITY = 14;

export function createPlayerState(x, z) {
  return {
    x, z, y: 0, vx: 0, vz: 0, vy: 0,
    yaw: 0, // facing -Z, toward the Kelinci spawn to the north
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    grounded: true,
    health: 100,
    alive: true,
    recoilPitch: 0,
    recoilYaw: 0,
    speed2d: 0,
  };
}

export function playerLook(state, dx, dy) {
  state.yaw -= dx * 0.0021;
  state.pitch = clamp(state.pitch - dy * 0.0021, -1.45, 1.45);
}

export function playerApplyRecoil(state, pitchKick, yawKick) {
  state.recoilPitch += pitchKick;
  state.recoilYaw += yawKick;
}

// Read WASD into a unit vector in local space (forward is -Z).
function readMoveInput(keys) {
  let fx = 0;
  let fz = 0;
  if (keys.has('KeyW')) fz -= 1;
  if (keys.has('KeyS')) fz += 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz);
  if (len > 0) {
    fx /= len;
    fz /= len;
  }
  return { fx, fz, active: len > 0 };
}

// Rotate the local input vector into world space by the player's yaw.
function toWorld(fx, fz, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: fx * cos - fz * sin, z: fx * sin + fz * cos };
}

// Friction pulls the velocity toward the input direction's cap, never past
// it, so letting go of the keys stops the tortoise quickly but not instantly.
function applyFriction(state, cap, dt) {
  const sp = Math.hypot(state.vx, state.vz);
  if (sp <= cap) return;
  const dec = Math.max(cap, sp - FRICTION * sp * dt);
  state.vx = (state.vx / sp) * dec;
  state.vz = (state.vz / sp) * dec;
}

function stepVertical(state, keys, dt) {
  if (keys.has('Space') && state.grounded) {
    state.vy = JUMP_SPEED;
    state.grounded = false;
  }
  if (!state.grounded) {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) {
      state.y = 0;
      state.vy = 0;
      state.grounded = true;
    }
  }
}

// keys: a Set of KeyboardEvent.code. dt is the fixed step.
export function playerStep(state, keys, dt) {
  if (!state.alive) return;

  const crouched = keys.has('ControlLeft') || keys.has('KeyC');
  state.crouched = crouched;
  const targetEye = crouched ? EYE_CROUCH : EYE_STAND;
  state.eye += (targetEye - state.eye) * Math.min(1, dt * 10);

  const input = readMoveInput(keys);
  const world = toWorld(input.fx, input.fz, state.yaw);
  const speed = crouched ? CROUCH_SPEED : WALK_SPEED;
  state.vx += world.x * ACCEL * dt;
  state.vz += world.z * ACCEL * dt;
  applyFriction(state, input.active ? speed : 0, dt);

  state.x += state.vx * dt;
  state.z += state.vz * dt;
  const fixed = resolveCircle(state.x, state.z, RADIUS);
  state.x = fixed[0];
  state.z = fixed[1];
  // Clamp inside the garden walls.
  state.x = clamp(state.x, -21.2 + RADIUS, 21.2 - RADIUS);
  state.z = clamp(state.z, -15.2 + RADIUS, 15.2 - RADIUS);

  stepVertical(state, keys, dt);

  state.speed2d = Math.hypot(state.vx, state.vz);
  // Recoil recovers toward zero; the view kick is applied on top in main.js.
  state.recoilPitch += (0 - state.recoilPitch) * Math.min(1, dt * 7);
  state.recoilYaw += (0 - state.recoilYaw) * Math.min(1, dt * 7);
}
