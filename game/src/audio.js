// All sound is synthesized with WebAudio: no audio files, no network. A short
// noise burst through a filter is a gunshot, a sine drop is a reload click's
// cousin, a low boom is the pod. The context is created lazily on the first user
// gesture (pointer lock), so a headless capture stays silent instead of failing.
export function createAudio() {
  let context = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return context;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      context = new AC();
      const length = Math.floor(context.sampleRate * 0.25);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      context = null;
    }
    return context;
  }

  function tone(freq, dur, type, gain, slideTo) {
    const ctx = ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    const ctx = ensure();
    if (!ctx || !noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'dmr') { noise(0.22, 900, 0.5); tone(160, 0.18, 'square', 0.16, 50); }
      else if (kind === 'smg') { noise(0.09, 1800, 0.32); }
      else if (kind === 'pistol') { noise(0.12, 1400, 0.4); }
      else { noise(0.16, 1100, 0.45); tone(120, 0.1, 'square', 0.1, 60); }
    },
    distantShot() { noise(0.12, 500, 0.12); },
    dry() { tone(900, 0.05, 'square', 0.12); },
    reload() { tone(500, 0.06, 'square', 0.1); setTimeout(() => tone(700, 0.06, 'square', 0.1), 180); },
    hit() { tone(1200, 0.05, 'sine', 0.18); },
    kill() { tone(880, 0.07, 'sine', 0.2); setTimeout(() => tone(1320, 0.09, 'sine', 0.2), 70); },
    hurt() { tone(220, 0.15, 'sawtooth', 0.16, 110); },
    plantTick() { tone(1000, 0.05, 'sine', 0.15); },
    defuseTick() { tone(700, 0.05, 'sine', 0.15); },
    planted() { tone(660, 0.12, 'sine', 0.2); setTimeout(() => tone(990, 0.18, 'sine', 0.2), 130); },
    explosion() { noise(0.9, 220, 0.7); tone(70, 0.8, 'sine', 0.5, 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.18), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sine', 0.16), i * 120)); },
    buy() { tone(740, 0.06, 'sine', 0.15); setTimeout(() => tone(988, 0.08, 'sine', 0.15), 60); },
    // Perisai Tempurung: a bright two-note pickup chime, and a dull thunk
    // when the shell breaks on the hit it absorbs.
    shield() { tone(1046, 0.08, 'sine', 0.18); setTimeout(() => tone(1568, 0.12, 'sine', 0.18), 70); },
    shieldBreak() { noise(0.15, 700, 0.4); tone(180, 0.18, 'square', 0.14, 90); },
    click() { tone(600, 0.04, 'square', 0.08); },
  };
}
