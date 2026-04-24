/**
 * Alternative oscillator engines for OSC 3.
 *
 * Each engine exports a factory: create(ctx, frequency, destNode) -> voiceObj
 * voiceObj has: { stop(), disconnect(), nodes[] }
 *
 * Engines:
 *   STRING  - Karplus-Strong plucked string
 *   FM      - 2-operator FM synthesis
 *   FORMANT - Parallel formant (vowel) synthesis
 */

export const ALT_MODES = ['string', 'fm', 'formant'];

/* ============================================================
 * STRING - Karplus-Strong
 *
 * Burst of noise -> short delay line with feedback + LP filter.
 * Delay length = 1/freq.  Feedback + filter = tone decay.
 * Params: color (0-1, LP filter cutoff), damping (0-1, feedback)
 * ============================================================ */

export function createStringVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  const delaySec = 1 / frequency;

  // Noise burst (excitation)
  const burstLen = Math.max(0.002, delaySec * 2);
  const burstSamples = Math.ceil(burstLen * ctx.sampleRate);
  const noiseBuffer = ctx.createBuffer(1, burstSamples, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < burstSamples; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  // Delay line
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySec;

  // Feedback LP filter (controls brightness / "color")
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const color = params.color !== undefined ? params.color : 0.5;
  lp.frequency.value = 800 + color * 9200; // 800-10000 Hz
  lp.Q.value = 0.5;

  // Feedback gain (controls sustain / "damping")
  const fb = ctx.createGain();
  const damping = params.damping !== undefined ? params.damping : 0.5;
  fb.gain.value = 0.9 + (1 - damping) * 0.099; // 0.9-0.999

  // Output gain
  const outGain = ctx.createGain();
  outGain.gain.value = 1;

  // Wiring: noise -> delay -> LP -> fb -> delay (loop)
  //                  delay -> outGain -> dest
  noiseSrc.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  delay.connect(outGain);
  outGain.connect(dest);

  noiseSrc.start(now);
  noiseSrc.stop(now + burstLen);

  return {
    nodes: [noiseSrc, delay, lp, fb, outGain],
    outGain,
    lp,
    fb,
    stop(when) {
      outGain.gain.setTargetAtTime(0, when || ctx.currentTime, 0.02);
    },
    disconnect() {
      [noiseSrc, delay, lp, fb, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setColor(v) {
      lp.frequency.setTargetAtTime(800 + v * 9200, ctx.currentTime, 0.02);
    },
    setDamping(v) {
      fb.gain.setTargetAtTime(0.9 + (1 - v) * 0.099, ctx.currentTime, 0.02);
    }
  };
}


/* ============================================================
 * FM - 2-operator frequency modulation
 *
 * Modulator osc -> mod gain (index) -> carrier frequency param.
 * Params: ratio (mod:carrier freq ratio), index (mod depth)
 * ============================================================ */

export function createFMVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  const ratio = params.ratio !== undefined ? params.ratio : 2;
  const index = params.index !== undefined ? params.index : 3;

  // Carrier
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(frequency, now);

  // Modulator
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  modulator.frequency.setValueAtTime(frequency * ratio, now);

  // Mod depth: index * mod_freq = peak deviation in Hz
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(index * frequency * ratio, now);

  // Output gain
  const outGain = ctx.createGain();
  outGain.gain.value = 1;

  // Wiring: modulator -> modGain -> carrier.frequency
  //         carrier -> outGain -> dest
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(outGain);
  outGain.connect(dest);

  carrier.start(now);
  modulator.start(now);

  return {
    nodes: [carrier, modulator, modGain, outGain],
    outGain,
    carrier,
    modulator,
    modGain,
    _freq: frequency,
    stop(when) {
      const t = when || ctx.currentTime;
      carrier.stop(t + 0.05);
      modulator.stop(t + 0.05);
    },
    disconnect() {
      [carrier, modulator, modGain, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setRatio(r) {
      modulator.frequency.setTargetAtTime(this._freq * r, ctx.currentTime, 0.02);
      modGain.gain.setTargetAtTime(r * this._freq * (modGain.gain.value / (modulator.frequency.value || 1)), ctx.currentTime, 0.02);
    },
    setIndex(idx) {
      modGain.gain.setTargetAtTime(idx * modulator.frequency.value, ctx.currentTime, 0.02);
    }
  };
}


/* ============================================================
 * FORMANT - Vowel / vocal synthesis
 *
 * Sawtooth source -> parallel bandpass filters at formant freqs
 * -> sum.  Morph param blends between vowel shapes (A/E/I/O/U).
 * Params: morph (0-1, vowel blend), vibrato (0-1)
 * ============================================================ */

// Formant frequencies for 5 vowels [F1, F2, F3]
const VOWELS = {
  A: [800,  1200, 2800],
  E: [400,  2200, 2800],
  I: [350,  2700, 3200],
  O: [500,  800,  2800],
  U: [350,  600,  2700],
};
const VOWEL_ORDER = ['A', 'E', 'I', 'O', 'U'];

function lerpFormants(morph) {
  // morph 0-1 maps across 5 vowels
  const pos = morph * (VOWEL_ORDER.length - 1);
  const idx = Math.min(Math.floor(pos), VOWEL_ORDER.length - 2);
  const t = pos - idx;
  const a = VOWELS[VOWEL_ORDER[idx]];
  const b = VOWELS[VOWEL_ORDER[idx + 1]];
  return a.map((v, i) => v + (b[i] - v) * t);
}

export function createFormantVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  const morph = params.morph !== undefined ? params.morph : 0;
  const vibratoAmt = params.vibrato !== undefined ? params.vibrato : 0.3;

  // Source: sawtooth (rich harmonics for formant filtering)
  const source = ctx.createOscillator();
  source.type = 'sawtooth';
  source.frequency.setValueAtTime(frequency, now);

  // Vibrato LFO
  const vibLFO = ctx.createOscillator();
  vibLFO.type = 'sine';
  vibLFO.frequency.value = 5;
  const vibGain = ctx.createGain();
  vibGain.gain.value = vibratoAmt * frequency * 0.01; // subtle pitch wobble
  vibLFO.connect(vibGain);
  vibGain.connect(source.frequency);
  vibLFO.start(now);

  // 3 formant bandpass filters in parallel
  const formantFreqs = lerpFormants(morph);
  const filters = [];
  const filterGains = [];
  const sumGain = ctx.createGain();
  sumGain.gain.value = 0.5;

  for (let i = 0; i < 3; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = formantFreqs[i];
    bp.Q.value = 8 + i * 4; // higher Q for higher formants
    const g = ctx.createGain();
    g.gain.value = 1 / (i + 1); // roll off higher formants
    source.connect(bp);
    bp.connect(g);
    g.connect(sumGain);
    filters.push(bp);
    filterGains.push(g);
  }

  // Output
  const outGain = ctx.createGain();
  outGain.gain.value = 1;
  sumGain.connect(outGain);
  outGain.connect(dest);

  source.start(now);

  return {
    nodes: [source, vibLFO, vibGain, ...filters, ...filterGains, sumGain, outGain],
    outGain,
    filters,
    source,
    vibGain,
    stop(when) {
      const t = when || ctx.currentTime;
      source.stop(t + 0.05);
      vibLFO.stop(t + 0.05);
    },
    disconnect() {
      [source, vibLFO, vibGain, ...filters, ...filterGains, sumGain, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setMorph(m) {
      const freqs = lerpFormants(Math.max(0, Math.min(1, m)));
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        filters[i].frequency.setTargetAtTime(freqs[i], t, 0.03);
      }
    },
    setVibrato(v) {
      vibGain.gain.setTargetAtTime(v * source.frequency.value * 0.01, ctx.currentTime, 0.02);
    }
  };
}
