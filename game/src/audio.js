// Every sound in the game is synthesized with WebAudio — no audio files,
// no network. A short noise burst through a filter is a gunshot, a sine
// sliding down is a hurt thud, a low boom is the pod going off. The audio
// context is created lazily on the first user gesture (pointer lock), so a
// headless screenshot capture stays silent instead of failing.

export function createAudio() {
  let context = null;
  let noiseBuffer = null;

  // Build the context (and one shared white-noise buffer) on first use.
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

  // One oscillator blip: frequency, length, wave shape, loudness, optional
  // slide down to another frequency.
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

  // One burst of the shared white noise through a filter.
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

  // A second note a beat later, for the two-note jingles.
  function later(ms, fn) {
    setTimeout(fn, ms);
  }

  // A little arpeggio, one note per step.
  function arpeggio(freqs, stepMs, dur, gain) {
    freqs.forEach((f, i) => later(i * stepMs, () => tone(f, dur, 'sine', gain)));
  }

  return {
    unlock() { ensure(); },

    shot(kind) {
      if (kind === 'dmr') {
        noise(0.22, 900, 0.5);
        tone(160, 0.18, 'square', 0.16, 50);
      } else if (kind === 'smg') {
        noise(0.09, 1800, 0.32);
      } else if (kind === 'pistol') {
        noise(0.12, 1400, 0.4);
      } else {
        noise(0.16, 1100, 0.45);
        tone(120, 0.1, 'square', 0.1, 60);
      }
    },

    distantShot() { noise(0.12, 500, 0.12); },
    dry() { tone(900, 0.05, 'square', 0.12); },

    reload() {
      tone(500, 0.06, 'square', 0.1);
      later(180, () => tone(700, 0.06, 'square', 0.1));
    },

    hit() { tone(1200, 0.05, 'sine', 0.18); },

    kill() {
      tone(880, 0.07, 'sine', 0.2);
      later(70, () => tone(1320, 0.09, 'sine', 0.2));
    },

    hurt() { tone(220, 0.15, 'sawtooth', 0.16, 110); },
    plantTick() { tone(1000, 0.05, 'sine', 0.15); },
    defuseTick() { tone(700, 0.05, 'sine', 0.15); },

    planted() {
      tone(660, 0.12, 'sine', 0.2);
      later(130, () => tone(990, 0.18, 'sine', 0.2));
    },

    explosion() {
      noise(0.9, 220, 0.7);
      tone(70, 0.8, 'sine', 0.5, 30);
    },

    roundWin() { arpeggio([523, 659, 784], 110, 0.16, 0.18); },
    roundLose() { arpeggio([392, 330, 262], 120, 0.18, 0.16); },

    buy() {
      tone(740, 0.06, 'sine', 0.15);
      later(60, () => tone(988, 0.08, 'sine', 0.15));
    },

    // Perisai Tempurung: a bright two-note chime on pickup, and a dull
    // thunk when the shell breaks on the hit it absorbs.
    shield() {
      tone(1046, 0.08, 'sine', 0.18);
      later(70, () => tone(1568, 0.12, 'sine', 0.18));
    },
    shieldBreak() {
      noise(0.15, 700, 0.4);
      tone(180, 0.18, 'square', 0.14, 90);
    },

    click() { tone(600, 0.04, 'square', 0.08); },

    // Ketapel Biji: a soft elastic thwip on release, a dull pop when the
    // seed bursts, and a bright two-note chime when a Kantong Biji is picked up.
    seed(kind) {
      if (kind === 'seed-shoot') {
        noise(0.08, 2400, 0.25, 'highpass');
        tone(520, 0.09, 'sine', 0.12, 180);
      } else if (kind === 'seed-splash') {
        noise(0.14, 800, 0.35);
        tone(140, 0.12, 'sine', 0.14, 60);
      } else if (kind === 'seed-pickup') {
        tone(880, 0.07, 'sine', 0.16);
        later(70, () => tone(1174, 0.1, 'sine', 0.16));
      } else {
        tone(660, 0.05, 'square', 0.08);
      }
    },
  };
}
