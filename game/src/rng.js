// Seeded randomness for KURA OPS.
//
// A match is driven by one mulberry32 stream per round. Fix the seed and
// the round plays out the same way every time — that is what makes the
// ?shot= captures repeatable and the dossier deterministic. Only the
// simulation draws from the stream; rendering never does, so a replay stays
// a replay no matter how the frame rate wobbles.
//
// The helpers below are the only number-shaping the rest of the game needs:
// clamp a value into a range, blend between two values, pick one item from
// a list, draw a number inside a range.

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
