/**
 * Alternative oscillator engines for the PLAITS section.
 *
 * Modeled after Mutable Instruments Plaits engine concepts.
 * Each factory returns a voice object with stop(), disconnect(), and param setters.
 *
 * Engines:
 *   STRING  - Extended Karplus-Strong with dispersion allpass and shaped excitation
 *   FM      - 2-op FM with carrier saturation (feedback-like) and proper index scaling
 *   FORMANT - 5-band parallel formant synthesis with linguistic vowel data
 */

export const ALT_MODES = ['string', 'fm', 'formant'];

/* ============================================================
 * STRING - Extended Karplus-Strong with dispersion
 *
 * Windowed noise burst (excitation) -> bandpass pre-filter ->
 * delay line (pitch) -> loop filter (LP) -> dispersion allpass ->
 * feedback gain -> delay (loop).
 *
 * Color  = excitation brightness + dispersion amount
 * Damping = loop filter cutoff + feedback (decay time)
 * ============================================================ */

export function createStringVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  const delaySec = 1 / frequency;

  const color = params.color !== undefined ? params.color : 0.5;
  const damping = params.damping !== undefined ? params.damping : 0.5;

  // --- Excitation: Hann-windowed noise burst ---
  const burstLen = Math.min(0.02, delaySec * 4);
  const burstSamples = Math.ceil(burstLen * ctx.sampleRate);
  const noiseBuffer = ctx.createBuffer(1, burstSamples, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < burstSamples; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / burstSamples));
    data[i] = (Math.random() * 2 - 1) * w;
  }
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  // Excitation pre-filter: color controls spectral content of pluck
  const excFilter = ctx.createBiquadFilter();
  excFilter.type = 'bandpass';
  excFilter.frequency.value = frequency * (1 + color * 8);
  excFilter.Q.value = 0.7 + (1 - color) * 2;

  // --- Delay line (string resonator) ---
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySec;

  // --- Loop filter: one-pole LP controlling decay brightness ---
  const loopFilter = ctx.createBiquadFilter();
  loopFilter.type = 'lowpass';
  const loopCutoff = frequency * (2 + (1 - damping) * 30);
  loopFilter.frequency.value = Math.min(loopCutoff, ctx.sampleRate / 2 - 100);
  loopFilter.Q.value = 0.5;

  // --- Dispersion allpass: adds inharmonicity (stiffness) ---
  const dispersion = ctx.createBiquadFilter();
  dispersion.type = 'allpass';
  dispersion.frequency.value = frequency * 5;
  dispersion.Q.value = 0.1 + color * 1.2;

  // --- Feedback gain: controls sustain ---
  const fb = ctx.createGain();
  fb.gain.value = 0.95 + (1 - damping) * 0.048;

  // --- Output ---
  const outGain = ctx.createGain();
  outGain.gain.value = 1;

  // Wiring
  noiseSrc.connect(excFilter);
  excFilter.connect(delay);
  delay.connect(loopFilter);
  loopFilter.connect(dispersion);
  dispersion.connect(fb);
  fb.connect(delay);
  delay.connect(outGain);
  outGain.connect(dest);

  noiseSrc.start(now);
  noiseSrc.stop(now + burstLen);

  const freq = frequency;
  return {
    nodes: [noiseSrc, excFilter, delay, loopFilter, dispersion, fb, outGain],
    outGain,
    stop(when) {
      outGain.gain.setTargetAtTime(0, when || ctx.currentTime, 0.02);
    },
    disconnect() {
      [noiseSrc, excFilter, delay, loopFilter, dispersion, fb, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setColor(v) {
      const t = ctx.currentTime;
      excFilter.frequency.setTargetAtTime(freq * (1 + v * 8), t, 0.02);
      excFilter.Q.setTargetAtTime(0.7 + (1 - v) * 2, t, 0.02);
      dispersion.Q.setTargetAtTime(0.1 + v * 1.2, t, 0.02);
    },
    setDamping(v) {
      const t = ctx.currentTime;
      const cut = freq * (2 + (1 - v) * 30);
      loopFilter.frequency.setTargetAtTime(Math.min(cut, ctx.sampleRate / 2 - 100), t, 0.02);
      fb.gain.setTargetAtTime(0.95 + (1 - v) * 0.048, t, 0.02);
    }
  };
}


/* ============================================================
 * FM - 2-operator FM with carrier saturation
 *
 * Modulator -> modGain (index * modFreq) -> carrier.frequency
 * Carrier -> soft-clip waveshaper (simulates feedback FM) -> out
 *
 * Ratio = modulator:carrier frequency ratio
 * Index = modulation depth (peak deviation / mod freq)
 * ============================================================ */

export function createFMVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  let _ratio = params.ratio !== undefined ? params.ratio : 2;
  let _index = params.index !== undefined ? params.index : 3;

  // Carrier
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(frequency, now);

  // Modulator
  const modulator = ctx.createOscillator();
  modulator.type = 'sine';
  const modFreq = frequency * _ratio;
  modulator.frequency.setValueAtTime(modFreq, now);

  // Mod depth: index * modulator_frequency = peak deviation Hz
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(_index * modFreq, now);

  // Carrier output saturation (simulates feedback path)
  const fbShaper = ctx.createWaveShaper();
  const curveLen = 1024;
  const fbCurve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (2 * i / (curveLen - 1)) - 1;
    fbCurve[i] = Math.tanh(x * 1.5);
  }
  fbShaper.curve = fbCurve;
  fbShaper.oversample = '2x';

  // Output
  const outGain = ctx.createGain();
  outGain.gain.value = 1;

  // Wiring
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(fbShaper);
  fbShaper.connect(outGain);
  outGain.connect(dest);

  carrier.start(now);
  modulator.start(now);

  const freq = frequency;
  return {
    nodes: [carrier, modulator, modGain, fbShaper, outGain],
    outGain,
    stop(when) {
      const t = when || ctx.currentTime;
      carrier.stop(t + 0.05);
      modulator.stop(t + 0.05);
    },
    disconnect() {
      [carrier, modulator, modGain, fbShaper, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setRatio(r) {
      _ratio = r;
      const mf = freq * r;
      const t = ctx.currentTime;
      modulator.frequency.setTargetAtTime(mf, t, 0.02);
      modGain.gain.setTargetAtTime(_index * mf, t, 0.02);
    },
    setIndex(idx) {
      _index = idx;
      const mf = freq * _ratio;
      modGain.gain.setTargetAtTime(idx * mf, ctx.currentTime, 0.02);
    }
  };
}


/* ============================================================
 * FORMANT - 5-band parallel vowel synthesis
 *
 * Sawtooth + noise blend -> 5 parallel bandpass filters at
 * formant frequencies with proper Q (freq/bandwidth) and
 * amplitude weighting from linguistic data.
 *
 * Morph   = vowel blend across A-E-I-O-U
 * Vibrato = pitch vibrato depth
 * ============================================================ */

// Formant data: frequencies, bandwidths, amplitudes (Hillenbrand et al.)
const VOWELS = {
  A: { f: [730, 1090, 2440, 3300, 3750], bw: [90, 110, 170, 250, 300], a: [1.0, 0.50, 0.25, 0.10, 0.05] },
  E: { f: [530, 1840, 2480, 3300, 3750], bw: [70, 100, 160, 250, 300], a: [1.0, 0.40, 0.20, 0.10, 0.05] },
  I: { f: [270, 2290, 3010, 3300, 3750], bw: [60,  90, 160, 250, 300], a: [1.0, 0.32, 0.16, 0.08, 0.04] },
  O: { f: [570,  840, 2410, 3300, 3750], bw: [80, 100, 170, 250, 300], a: [1.0, 0.50, 0.20, 0.10, 0.05] },
  U: { f: [300,  870, 2240, 3300, 3750], bw: [65,  90, 160, 250, 300], a: [1.0, 0.40, 0.16, 0.08, 0.04] },
};
const VOWEL_ORDER = ['A', 'E', 'I', 'O', 'U'];
const NUM_FORMANTS = 5;

function lerpVowelData(morph) {
  const pos = morph * (VOWEL_ORDER.length - 1);
  const idx = Math.min(Math.floor(pos), VOWEL_ORDER.length - 2);
  const t = pos - idx;
  const va = VOWELS[VOWEL_ORDER[idx]];
  const vb = VOWELS[VOWEL_ORDER[idx + 1]];
  const f = [], q = [], a = [];
  for (let i = 0; i < NUM_FORMANTS; i++) {
    const fi = va.f[i] + (vb.f[i] - va.f[i]) * t;
    const bi = va.bw[i] + (vb.bw[i] - va.bw[i]) * t;
    f.push(fi);
    q.push(fi / bi);
    a.push(va.a[i] + (vb.a[i] - va.a[i]) * t);
  }
  return { f, q, a };
}

export function createFormantVoice(ctx, frequency, dest, params) {
  const now = ctx.currentTime;
  const morph = params.morph !== undefined ? params.morph : 0;
  const vibratoAmt = params.vibrato !== undefined ? params.vibrato : 0.3;

  // Source: sawtooth (rich harmonics)
  const source = ctx.createOscillator();
  source.type = 'sawtooth';
  source.frequency.setValueAtTime(frequency, now);

  // Noise source for breathiness
  const noiseLen = 4;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.08;
  noiseSrc.connect(noiseGain);

  // Vibrato LFO
  const vibLFO = ctx.createOscillator();
  vibLFO.type = 'sine';
  vibLFO.frequency.value = 5.2;
  const vibGain = ctx.createGain();
  vibGain.gain.value = vibratoAmt * frequency * 0.012;
  vibLFO.connect(vibGain);
  vibGain.connect(source.frequency);
  vibLFO.start(now);

  // 5 parallel formant bandpass filters
  const vowelData = lerpVowelData(morph);
  const filters = [];
  const filterGains = [];
  const sumGain = ctx.createGain();
  sumGain.gain.value = 0.4;

  for (let i = 0; i < NUM_FORMANTS; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = vowelData.f[i];
    bp.Q.value = vowelData.q[i];
    const g = ctx.createGain();
    g.gain.value = vowelData.a[i];
    source.connect(bp);
    noiseGain.connect(bp);
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
  noiseSrc.start(now);

  return {
    nodes: [source, noiseSrc, noiseGain, vibLFO, vibGain, ...filters, ...filterGains, sumGain, outGain],
    outGain,
    filters,
    filterGains,
    stop(when) {
      const t = when || ctx.currentTime;
      source.stop(t + 0.05);
      noiseSrc.stop(t + 0.05);
      vibLFO.stop(t + 0.05);
    },
    disconnect() {
      [source, noiseSrc, noiseGain, vibLFO, vibGain, ...filters, ...filterGains, sumGain, outGain].forEach(n => {
        try { n.disconnect(); } catch {}
      });
    },
    setMorph(m) {
      const vd = lerpVowelData(Math.max(0, Math.min(1, m)));
      const t = ctx.currentTime;
      for (let i = 0; i < NUM_FORMANTS; i++) {
        filters[i].frequency.setTargetAtTime(vd.f[i], t, 0.03);
        filters[i].Q.setTargetAtTime(vd.q[i], t, 0.03);
        filterGains[i].gain.setTargetAtTime(vd.a[i], t, 0.03);
      }
    },
    setVibrato(v) {
      vibGain.gain.setTargetAtTime(v * source.frequency.value * 0.012, ctx.currentTime, 0.02);
    }
  };
}