/**
 * Drum Machine - multi-kit synthesized drums + step sequencer.
 * All sounds are synthesized using Web Audio API (no samples).
 * 16-step sequencer with per-track volume, swing, and per-sound shaping.
 */

export const DRUM_TRACKS = [
  { id: 'kick',  label: 'KICK' },
  { id: 'snare', label: 'SNR' },
  { id: 'clap',  label: 'CLAP' },
  { id: 'chh',   label: 'CH' },
  { id: 'ohh',   label: 'OH' },
  { id: 'rim',   label: 'RIM' },
];

const NUM_STEPS = 16;

/* ── Per-track parameter definitions (for UI) ─────────────── */

export const TRACK_PARAM_DEFS = {
  kick: [
    { id: 'tune',  label: 'TUNE',  min: 0.5, max: 2.0, step: 0.01 },
    { id: 'decay', label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'drive', label: 'DRIVE', min: 0,   max: 1.0, step: 0.01 },
    { id: 'click', label: 'CLICK', min: 0,   max: 1.0, step: 0.01 },
  ],
  snare: [
    { id: 'tune',  label: 'TUNE',  min: 0.5, max: 2.0, step: 0.01 },
    { id: 'decay', label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'noise', label: 'NOISE', min: 0,   max: 1.0, step: 0.01 },
    { id: 'snap',  label: 'SNAP',  min: 0,   max: 1.0, step: 0.01 },
  ],
  clap: [
    { id: 'tone',   label: 'TONE',  min: 0.3, max: 3.0, step: 0.01 },
    { id: 'decay',  label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'spread', label: 'SPRD',  min: 0.2, max: 3.0, step: 0.01 },
  ],
  chh: [
    { id: 'tune',  label: 'TUNE',  min: 0.5, max: 2.0, step: 0.01 },
    { id: 'decay', label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'tone',  label: 'TONE',  min: 0.5, max: 2.0, step: 0.01 },
  ],
  ohh: [
    { id: 'tune',  label: 'TUNE',  min: 0.5, max: 2.0, step: 0.01 },
    { id: 'decay', label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'tone',  label: 'TONE',  min: 0.5, max: 2.0, step: 0.01 },
  ],
  rim: [
    { id: 'tune',  label: 'TUNE',  min: 0.5, max: 2.0, step: 0.01 },
    { id: 'decay', label: 'DECAY', min: 0.2, max: 3.0, step: 0.01 },
    { id: 'tone',  label: 'TONE',  min: 0.5, max: 2.0, step: 0.01 },
  ],
};

/* ── Kit Definitions ──────────────────────────────────────── */

const KITS = {
  '909': {
    kick:  { tune: 1.0,  decay: 1.0, drive: 0.5,  click: 0.6 },
    snare: { tune: 1.0,  decay: 1.0, noise: 0.7,  snap: 0.5 },
    clap:  { tone: 1.0,  decay: 1.0, spread: 1.0 },
    chh:   { tune: 1.0,  decay: 1.0, tone: 1.0 },
    ohh:   { tune: 1.0,  decay: 1.0, tone: 1.0 },
    rim:   { tune: 1.0,  decay: 1.0, tone: 1.0 },
  },
  '808': {
    kick:  { tune: 0.55, decay: 2.2, drive: 0.15, click: 0.1 },
    snare: { tune: 0.8,  decay: 1.4, noise: 0.5,  snap: 0.7 },
    clap:  { tone: 0.7,  decay: 1.6, spread: 1.8 },
    chh:   { tune: 0.85, decay: 0.7, tone: 0.75 },
    ohh:   { tune: 0.85, decay: 1.5, tone: 0.75 },
    rim:   { tune: 1.6,  decay: 0.6, tone: 1.4 },
  },
  '707': {
    kick:  { tune: 1.2,  decay: 0.65, drive: 0.3, click: 0.8 },
    snare: { tune: 1.15, decay: 0.75, noise: 0.8, snap: 0.6 },
    clap:  { tone: 1.3,  decay: 0.65, spread: 0.5 },
    chh:   { tune: 1.15, decay: 0.6,  tone: 1.3 },
    ohh:   { tune: 1.15, decay: 0.7,  tone: 1.3 },
    rim:   { tune: 1.1,  decay: 0.6,  tone: 1.1 },
  },
  'HVY': {
    kick:  { tune: 0.75, decay: 1.6, drive: 1.0, click: 0.9 },
    snare: { tune: 0.85, decay: 1.5, noise: 1.0, snap: 1.0 },
    clap:  { tone: 1.6,  decay: 1.4, spread: 0.4 },
    chh:   { tune: 1.4,  decay: 1.3, tone: 1.6 },
    ohh:   { tune: 1.4,  decay: 1.6, tone: 1.6 },
    rim:   { tune: 0.7,  decay: 1.4, tone: 0.6 },
  },
};

export const KIT_NAMES = Object.keys(KITS);

/* ── Sound Synthesis (parameterized) ─────────────────────── */

function playKick(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const startF = 160 * p.tune;
  const endF = Math.max(20, 40 * p.tune);
  const dur = 0.45 * p.decay;
  const sweepT = 0.12 * Math.max(0.3, p.decay);

  // Body oscillator
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startF, now);
  osc.frequency.exponentialRampToValueAtTime(endF, now + sweepT);

  // Click transient
  if (p.click > 0.01) {
    const clk = ctx.createOscillator();
    clk.type = 'square';
    clk.frequency.setValueAtTime(800 * p.tune, now);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(p.click * vol, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
    clk.connect(cg);
    cg.connect(dest);
    clk.start(now);
    clk.stop(now + 0.02);
  }

  // Envelope
  const env = ctx.createGain();
  env.gain.setValueAtTime(vol, now);
  env.gain.setValueAtTime(vol, now + Math.min(0.05, dur * 0.11));
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // Drive / saturation
  const driveK = 1 + p.drive * 8;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (2 * i / 255) - 1;
    curve[i] = Math.tanh(x * driveK);
  }
  shaper.curve = curve;

  osc.connect(shaper);
  shaper.connect(env);
  env.connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

function playSnare(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const bodyDur = 0.15 * p.decay;
  const noiseDur = 0.2 * p.decay;

  // Body: two sine oscillators
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(180 * p.tune, now);
  osc1.frequency.exponentialRampToValueAtTime(Math.max(20, 120 * p.tune), now + 0.05 * p.decay);
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(vol * 0.5 * (1 - p.noise * 0.3), now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + bodyDur);
  osc1.connect(g1);
  g1.connect(dest);
  osc1.start(now);
  osc1.stop(now + bodyDur + 0.01);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(330 * p.tune, now);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(vol * 0.3 * (1 - p.noise * 0.2), now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + bodyDur * 0.7);
  osc2.connect(g2);
  g2.connect(dest);
  osc2.start(now);
  osc2.stop(now + bodyDur + 0.01);

  // Noise snap
  const bufLen = Math.ceil(ctx.sampleRate * noiseDur);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const snapFreq = 2000 + p.snap * 6000;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = snapFreq * 0.3;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = snapFreq;

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * p.noise, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

  noise.connect(hp);
  hp.connect(lp);
  lp.connect(ng);
  ng.connect(dest);
  noise.start(now);
  noise.stop(now + noiseDur + 0.01);
}

function playClap(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const burstGap = 0.012 * p.spread;
  const bpFreq = 1200 * p.tone;
  const tailDur = 0.15 * p.decay;

  // Multiple short noise bursts
  for (let i = 0; i < 3; i++) {
    const t = now + i * burstGap;
    const bLen = Math.ceil(ctx.sampleRate * 0.01);
    const b = ctx.createBuffer(1, bLen, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let j = 0; j < bLen; j++) d[j] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = bpFreq;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 0.02);
  }

  // Tail
  const tailStart = now + 3 * burstGap;
  const tLen = Math.ceil(ctx.sampleRate * tailDur);
  const tBuf = ctx.createBuffer(1, tLen, ctx.sampleRate);
  const td = tBuf.getChannelData(0);
  for (let i = 0; i < tLen; i++) td[i] = Math.random() * 2 - 1;
  const tSrc = ctx.createBufferSource();
  tSrc.buffer = tBuf;
  const tbp = ctx.createBiquadFilter();
  tbp.type = 'bandpass';
  tbp.frequency.value = bpFreq * 1.15;
  tbp.Q.value = 2;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(vol * 0.6, tailStart);
  tg.gain.exponentialRampToValueAtTime(0.001, tailStart + tailDur);
  tSrc.connect(tbp);
  tbp.connect(tg);
  tg.connect(dest);
  tSrc.start(tailStart);
  tSrc.stop(tailStart + tailDur + 0.02);
}

function playCHH(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const dur = 0.05 * p.decay;

  const baseFreqs = [296, 370, 523, 588, 672, 784];
  const freqs = baseFreqs.map(f => f * p.tune);
  const sum = ctx.createGain();
  sum.gain.value = vol * 0.15;

  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(sum);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  });

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000 * p.tone;

  const env = ctx.createGain();
  env.gain.setValueAtTime(1, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  sum.connect(hp);
  hp.connect(env);
  env.connect(dest);
}

function playOHH(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const dur = 0.35 * p.decay;

  const baseFreqs = [296, 370, 523, 588, 672, 784];
  const freqs = baseFreqs.map(f => f * p.tune);
  const sum = ctx.createGain();
  sum.gain.value = vol * 0.15;

  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(sum);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  });

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000 * p.tone;

  const env = ctx.createGain();
  env.gain.setValueAtTime(1, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  sum.connect(hp);
  hp.connect(env);
  env.connect(dest);
}

function playRim(ctx, dest, vol, p) {
  const now = ctx.currentTime;
  const dur = 0.03 * p.decay;

  // Triangle body
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 500 * p.tune;
  const og = ctx.createGain();
  og.gain.setValueAtTime(vol * 0.5, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(og);
  og.connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // Noise click
  const bLen = Math.ceil(ctx.sampleRate * 0.01);
  const nBuf = ctx.createBuffer(1, bLen, ctx.sampleRate);
  const nd = nBuf.getChannelData(0);
  for (let i = 0; i < bLen; i++) nd[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = nBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3500 * p.tone;
  bp.Q.value = 3;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.8, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.02 * p.decay);
  src.connect(bp);
  bp.connect(ng);
  ng.connect(dest);
  src.start(now);
  src.stop(now + 0.02 * p.decay + 0.01);
}

const SYNTH_FN = {
  kick:  playKick,
  snare: playSnare,
  clap:  playClap,
  chh:   playCHH,
  ohh:   playOHH,
  rim:   playRim,
};

/* ── Preset patterns ─────────────────────────────────────── */

const PRESETS = {
  'basic': {
    kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    ohh:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    clap:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'house': {
    kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    ohh:   [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1],
    rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'hiphop': {
    kick:  [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    clap:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    chh:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0],
    ohh:   [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,1,0],
    rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'electro': {
    kick:  [1,0,0,1, 0,0,1,0, 1,0,0,0, 1,0,1,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    clap:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
    chh:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    ohh:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    rim:   [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
  },
};

/* ── DrumMachine class ───────────────────────────────────── */

export class DrumMachine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._dest = null;
    this._bpm = 120;
    this._swing = 0;
    this._playing = false;
    this._currentStep = -1;
    this._nextStepTime = 0;
    this._timerID = null;
    this._masterVol = 0.8;
    this._currentKit = '909';

    // Per-track state
    this._trackVolumes = {};
    this._trackParams = {};
    this._pattern = {};
    DRUM_TRACKS.forEach(t => {
      this._trackVolumes[t.id] = 0.8;
      this._trackParams[t.id] = { ...KITS['909'][t.id] };
      this._pattern[t.id] = new Array(NUM_STEPS).fill(0);
    });

    this._onStep = null;
  }

  init(audioContext, destination) {
    this._ctx = audioContext;
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._masterVol;
    this._masterGain.connect(destination);
    this._dest = this._masterGain;
  }

  get playing() { return this._playing; }
  get currentStep() { return this._currentStep; }
  get bpm() { return this._bpm; }
  get pattern() { return this._pattern; }
  get numSteps() { return NUM_STEPS; }
  get currentKit() { return this._currentKit; }

  set onStep(fn) { this._onStep = fn; }

  setBPM(bpm) { this._bpm = Math.max(40, Math.min(300, bpm)); }
  setSwing(amount) { this._swing = Math.max(0, Math.min(0.7, amount)); }

  setMasterVolume(v) {
    this._masterVol = Math.max(0, Math.min(1, v));
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._masterVol, this._ctx.currentTime, 0.01);
    }
  }
  getMasterVolume() { return this._masterVol; }

  setTrackVolume(trackId, v) {
    this._trackVolumes[trackId] = Math.max(0, Math.min(1, v));
  }
  getTrackVolume(trackId) { return this._trackVolumes[trackId]; }

  /* ── Kit + track params ── */

  loadKit(name) {
    if (!KITS[name]) return;
    this._currentKit = name;
    DRUM_TRACKS.forEach(t => {
      this._trackParams[t.id] = { ...KITS[name][t.id] };
    });
  }

  getKitNames() { return KIT_NAMES; }

  getTrackParams(trackId) { return { ...this._trackParams[trackId] }; }

  setTrackParam(trackId, paramId, value) {
    if (this._trackParams[trackId]) {
      this._trackParams[trackId][paramId] = value;
    }
  }

  /* ── Pattern ── */

  toggleStep(trackId, step) {
    this._pattern[trackId][step] = this._pattern[trackId][step] ? 0 : 1;
    return this._pattern[trackId][step];
  }

  setStep(trackId, step, on) {
    this._pattern[trackId][step] = on ? 1 : 0;
  }

  clearPattern() {
    DRUM_TRACKS.forEach(t => {
      this._pattern[t.id] = new Array(NUM_STEPS).fill(0);
    });
  }

  loadPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    DRUM_TRACKS.forEach(t => {
      this._pattern[t.id] = p[t.id] ? [...p[t.id]] : new Array(NUM_STEPS).fill(0);
    });
  }

  getPresetNames() { return Object.keys(PRESETS); }

  trigger(trackId) {
    if (!this._ctx) return;
    const fn = SYNTH_FN[trackId];
    if (fn) fn(this._ctx, this._dest, this._trackVolumes[trackId], this._trackParams[trackId]);
  }

  start() {
    if (this._playing) return;
    if (!this._ctx) return;
    this._playing = true;
    this._currentStep = -1;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._schedule();
  }

  stop() {
    this._playing = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    this._currentStep = -1;
    if (this._onStep) this._onStep(-1);
  }

  _stepDuration(stepIndex) {
    const base = (60 / this._bpm) / 4;
    if (stepIndex % 2 === 1) {
      return base * (1 - this._swing);
    }
    return base * (1 + this._swing);
  }

  _schedule() {
    if (!this._playing) return;
    const lookAhead = 0.1;
    const interval = 25;

    while (this._nextStepTime < this._ctx.currentTime + lookAhead) {
      this._currentStep = (this._currentStep + 1) % NUM_STEPS;
      this._playStep(this._currentStep, this._nextStepTime);
      if (this._onStep) this._onStep(this._currentStep);
      this._nextStepTime += this._stepDuration(this._currentStep);
    }

    this._timerID = setTimeout(() => this._schedule(), interval);
  }

  _playStep(step, time) {
    const delay = Math.max(0, (time - this._ctx.currentTime) * 1000);

    DRUM_TRACKS.forEach(t => {
      if (this._pattern[t.id][step]) {
        const fn = SYNTH_FN[t.id];
        if (fn) {
          const params = this._trackParams[t.id];
          setTimeout(() => {
            if (this._playing || step === this._currentStep) {
              fn(this._ctx, this._dest, this._trackVolumes[t.id], params);
            }
          }, delay);
        }
      }
    });
  }
}