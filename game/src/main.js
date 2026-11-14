// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate, exactly like the simulation in game.js expects. The renderer,
// the camera and the input live here; everything about the match lives in
// game.js. ?shot=lobby|fight|plant|win with &seed=N sets up a deterministic
// frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createGame } from './game.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const MENU_COPY = 'Operasi Tempurung: kamu kura-kura, mereka kelinci. Tanam Benih di Site A (Kebun) atau B (Kolam), atau habisi semua Kelinci. Pelan-pelan asal selamat — yang berhenti membidik yang menang.';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const game = createGame(scene, camera, random, shot);
const input = createInput(renderer.domElement, onLockChange);
const G = game.G;

// Debug hook for headless verification (not used by the game itself).
window.__scene = scene;
window.__dbg = () => ({
  phase: G.phase,
  round: G.round,
  score: [G.scoreKura, G.scoreKelinci],
  hp: Math.ceil(G.player.health),
  ammo: [G.weapon.mag, G.weapon.reserve],
  weapon: G.weapon.def.name,
  money: G.money,
  planted: G.planted,
  botsAlive: G.bots.filter((b) => b.alive).length,
  kills: G.kills,
  shield: G.playerAgent.shield,
  shieldAvailable: G.shieldAvailable,
  hareBoost: G.hareBoost,
  seedAmmo: G.playerAgent.seedAmmo,
  seeds: G.seedArsenal ? G.seedArsenal.summary() : null,
});

game.G.hud.onPlay(() => {
  const action = game.onPlayClick();
  if (action === 'lock' && !shot) input.requestLock();
});
game.G.hud.onBuyClick((item) => game.buy(item));

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    game.G.audio.unlock();
    game.G.hud.hideOverlay();
  } else if (G.phase === 'live' || G.phase === 'buy') {
    game.G.hud.showOverlay('Jeda', 'Klik untuk lanjut main.', 'Lanjut Main');
  } else if (G.phase === 'menu') {
    game.G.hud.showOverlay('KURA OPS', MENU_COPY, 'Mulai Misi');
  }
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  // A slow renderer used to starve the match clock: at ~5 fps under
  // SwiftShader the 0.1 s dt clamp plus the 5-step cap advanced the game only
  // ~0.42 s per wall second, so the 12 s buy phase lasted ~33 s wall. Ten
  // steps of cheap simulation per frame track wall time down to ~6 fps; at
  // 60 fps this changes nothing (one step per frame as before).
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 10) {
      game.gameStep(FIXED_STEP, input);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 10) accumulator = 0;
  }
  renderer.render(scene, camera);
}

// For a capture: paint two frames so shadows and the HUD settle, then freeze
// the simulation and signal readiness to the screenshot driver.
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  game.shotSetup(shot);
  game.G.hud.hideOverlay();
  paintTwiceThenReady();
} else {
  game.G.hud.showOverlay('KURA OPS', MENU_COPY, 'Mulai Misi');
  requestAnimationFrame(frame);
}
