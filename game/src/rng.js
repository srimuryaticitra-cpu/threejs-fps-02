// Deterministic randomness for KURA OPS.
//
// The whole match runs off one mulberry32 stream per round: the seed fixes
// the round, so a ?shot=...&seed=N capture and a fresh round with the same
// seed play out identically. Rendering never touches this stream — only the
// simulation draws from it — which is what keeps replays repeatable.
//
// The small helpers here are the only math the rest of the game needs:
// clamp a value into a band, blend between two numbers, pick from a list,
// draw a number in a range.

export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function mulberry32(seed) {
  let state = seed | 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}
