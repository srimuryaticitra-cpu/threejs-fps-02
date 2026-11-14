// Keyboard and mouse for one FPS player. Pointer lock owns the mouse:
// movement deltas pile up in takeLook() and are consumed once per frame, so
// a frame never reads the same delta twice. Firing is held down for auto
// weapons (state.firing) or edge-triggered for semi-auto ones through
// takeFired() — the caller decides which flavour its gun wants.

export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    fired: false, // one queued semi-auto trigger pull
    locked: false,
    lookX: 0,
    lookY: 0,
  };

  const onKeyDown = (event) => {
    if (event.repeat) return;
    state.keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  };
  const onKeyUp = (event) => {
    state.keys.delete(event.code);
  };
  const onMouseMove = (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  };
  const onMouseDown = (event) => {
    if (!state.locked) return;
    if (event.button === 0) {
      state.firing = true;
      state.fired = true;
    }
  };
  const onMouseUp = (event) => {
    if (event.button === 0) state.firing = false;
  };
  const onLock = () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    onLockChange(state.locked);
  };
  const onBlur = () => {
    state.keys.clear();
    state.firing = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state,

    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },

    takeFired() {
      const out = state.fired;
      state.fired = false;
      return out;
    },

    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {
        // Pointer lock unavailable: the game still renders.
      }
    },

    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
}
