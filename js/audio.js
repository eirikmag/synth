/**
 * Audio engine — dual-oscillator architecture.
 *
 * Per voice signal chain:
 *   OSC1 → shaper1 → osc1Gain ─┐
 *                                ├─→ envGain (ADSR) → filters[] → masterGain → analyser → dest
 *   OSC2 → shaper2 → osc2Gain ─┘
 *
 * Filter chain uses cascaded BiquadFilterNodes for different filter models.
 */

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'];

/**
 * Filter models — only active when type is 'lowpass'.
 * Each model defines number of cascaded stages and per-stage Q multipliers.
 * The user-set Q is multiplied by the stage factor, giving each model its character.
 */
const FILTER_MODELS = {
  'svf12':  { label: 'SVF 12', stages: 1, qFactors: [1.0] },
  'svf24':  { label: 'SVF 24', stages: 2, qFactors: [0.54, 1.31] },
  'rd3':    { label: 'RD3',    stages: 3, qFactors: [0.33, 0.33, 1.0] },
  'mg':     { label: 'MG',     stages: 4, qFactors: [0.18, 0.18, 0.18, 1.2] },
  'ob12':   { label: 'OB 12',  stages: 1, qFactors: [1.3] },
  'ob24':   { label: 'OB 24',  stages: 2, qFactors: [0.7, 1.5] },
};

/** Build a tanh-ish waveshaper curve. amount 0 = bypass, 1 = heavy. */
function makeShapeCurve(amount, samples = 256) {
  const curve = new Float32Array(samples);
  if (amount <= 0) {
    for (let i = 0; i < samples; i++) curve[i] = (2 * i) / (samples - 1) - 1;
    return curve;
  }
  const k = amount * 50;
  for (let i = 0; i < samples; i++) {
    const x = (2 * i) / (samples - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._analyser = null;
    this._voices = new Map();

    // Per-oscillator config
    this._osc1 = { waveform: 'sawtooth', volume: 0.5, shape: 0, pitch: 0, octave: 0 };
    this._osc2 = { waveform: 'square',   volume: 0.0, shape: 0, pitch: 0, octave: 0 };

    // Cached curves
    this._shapeCurve1 = makeShapeCurve(0);
    this._shapeCurve2 = makeShapeCurve(0);

    // Filter
    this._filterType   = 'lowpass';
    this._filterModel  = 'svf12';
    this._filterCutoff = 20000;
    this._filterQ      = 0.5;
    this._filterGain   = 0;
    this._refFilters   = null; // array of BiquadFilterNodes for visualisation

    // ADSR
    this._attack  = 0.01;
    this._decay   = 0.1;
    this._sustain  = 0.7;
    this._release  = 0.3;
  }

  /* --- lazy AudioContext --- */

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 1;
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._masterGain.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);

    this._buildRefFilters();
  }

  /** Create reference filter chain for visualisation. */
  _buildRefFilters() {
    this._refFilters = this._makeFilterChain();
  }

  /** How many stages does the current config need? */
  _stageCount() {
    if (this._filterType === 'lowpass' && FILTER_MODELS[this._filterModel]) {
      return FILTER_MODELS[this._filterModel].stages;
    }
    return 1;
  }

  /** Q factors per stage for current config. */
  _qFactors() {
    if (this._filterType === 'lowpass' && FILTER_MODELS[this._filterModel]) {
      return FILTER_MODELS[this._filterModel].qFactors;
    }
    return [1.0];
  }

  /** Create an array of BiquadFilterNodes configured for current settings. */
  _makeFilterChain() {
    const stages = this._stageCount();
    const qFactors = this._qFactors();
    const filters = [];
    for (let i = 0; i < stages; i++) {
      const f = this._ctx.createBiquadFilter();
      f.type = this._filterType;
      f.frequency.value = this._filterCutoff;
      f.Q.value = this._filterQ * qFactors[i];
      f.gain.value = this._filterGain;
      filters.push(f);
    }
    return filters;
  }

  /** Connect an array of filters in series; return { first, last }. */
  _chainFilters(filters) {
    for (let i = 1; i < filters.length; i++) {
      filters[i - 1].connect(filters[i]);
    }
    return { first: filters[0], last: filters[filters.length - 1] };
  }

  /** Apply current cutoff/Q/gain/type to an array of filter nodes. */
  _applyFilterParams(filters, time) {
    const qFactors = this._qFactors();
    filters.forEach((f, i) => {
      f.type = this._filterType;
      if (time !== undefined) {
        f.frequency.setTargetAtTime(this._filterCutoff, time, 0.01);
        f.Q.setTargetAtTime(this._filterQ * (qFactors[i] || 1), time, 0.01);
        f.gain.setTargetAtTime(this._filterGain, time, 0.01);
      } else {
        f.frequency.value = this._filterCutoff;
        f.Q.value = this._filterQ * (qFactors[i] || 1);
        f.gain.value = this._filterGain;
      }
    });
  }

  get analyser() { this._ensureContext(); return this._analyser; }
  get context()  { this._ensureContext(); return this._ctx; }
  get waveforms() { return WAVEFORMS; }
  get filterTypes() { return FILTER_TYPES; }
  get filterModels() { return FILTER_MODELS; }

  _cfg(n) { return n === 2 ? this._osc2 : this._osc1; }

  /* --- oscillator parameters --- */

  setWaveform(oscNum, type) {
    if (!WAVEFORMS.includes(type)) return;
    this._cfg(oscNum).waveform = type;
    const key = oscNum === 2 ? 'osc2' : 'osc1';
    for (const v of this._voices.values()) v[key].type = type;
  }
  getWaveform(oscNum) { return this._cfg(oscNum).waveform; }

  setVolume(oscNum, value) {
    const cfg = this._cfg(oscNum);
    cfg.volume = Math.max(0, Math.min(1, value));
    const gk = oscNum === 2 ? 'osc2Gain' : 'osc1Gain';
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v[gk].gain.setTargetAtTime(cfg.volume, this._ctx.currentTime, 0.01);
      }
    }
  }
  getVolume(oscNum) { return this._cfg(oscNum).volume; }

  setShape(oscNum, value) {
    const cfg = this._cfg(oscNum);
    cfg.shape = Math.max(0, Math.min(1, value));
    const curve = makeShapeCurve(cfg.shape);
    if (oscNum === 2) this._shapeCurve2 = curve; else this._shapeCurve1 = curve;
    const sk = oscNum === 2 ? 'shaper2' : 'shaper1';
    for (const v of this._voices.values()) v[sk].curve = curve;
  }
  getShape(oscNum) { return this._cfg(oscNum).shape; }

  setPitch(oscNum, semitones) {
    const cfg = this._cfg(oscNum);
    cfg.pitch = Math.max(-7, Math.min(7, semitones));
    this._applyDetune(oscNum);
  }
  getPitch(oscNum) { return this._cfg(oscNum).pitch; }

  setOctave(oscNum, oct) {
    const cfg = this._cfg(oscNum);
    cfg.octave = Math.max(-3, Math.min(3, Math.round(oct)));
    this._applyDetune(oscNum);
  }
  getOctave(oscNum) { return this._cfg(oscNum).octave; }

  _applyDetune(oscNum) {
    const cfg = this._cfg(oscNum);
    const key = oscNum === 2 ? 'osc2' : 'osc1';
    const cents = (cfg.octave * 12 + cfg.pitch) * 100;
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v[key].detune.setTargetAtTime(cents, this._ctx.currentTime, 0.01);
      }
    }
  }

  /* --- filter --- */

  /**
   * Change filter type. Rebuilds all voice filter chains if stage count changes.
   */
  setFilterType(type) {
    if (!FILTER_TYPES.includes(type)) return;
    const oldStages = this._stageCount();
    this._filterType = type;
    const newStages = this._stageCount();
    if (oldStages !== newStages) {
      this._rebuildAllFilters();
    } else {
      this._updateAllFilters();
    }
  }
  getFilterType() { return this._filterType; }

  /**
   * Change lowpass filter model. Only relevant when type is 'lowpass'.
   * Rebuilds filter chains if stage count changes.
   */
  setFilterModel(model) {
    if (!FILTER_MODELS[model]) return;
    const oldStages = this._stageCount();
    this._filterModel = model;
    const newStages = this._stageCount();
    if (oldStages !== newStages) {
      this._rebuildAllFilters();
    } else {
      this._updateAllFilters();
    }
  }
  getFilterModel() { return this._filterModel; }

  setFilterCutoff(freq) {
    this._filterCutoff = Math.max(20, Math.min(20000, freq));
    this._updateAllFilters();
  }
  getFilterCutoff() { return this._filterCutoff; }

  setFilterQ(value) {
    this._filterQ = Math.max(0.01, Math.min(30, value));
    this._updateAllFilters();
  }
  getFilterQ() { return this._filterQ; }

  setFilterGain(dB) {
    this._filterGain = Math.max(-24, Math.min(24, dB));
    this._updateAllFilters();
  }
  getFilterGain() { return this._filterGain; }

  /** Update params on all existing voice filters + ref filters (no rebuild). */
  _updateAllFilters() {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    for (const v of this._voices.values()) {
      this._applyFilterParams(v.filters, t);
    }
    if (this._refFilters) this._applyFilterParams(this._refFilters);
  }

  /** Rebuild all voice filter chains (stage count changed). */
  _rebuildAllFilters() {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    for (const v of this._voices.values()) {
      // Disconnect old
      v.filters.forEach(f => { try { f.disconnect(); } catch {} });

      // Build new chain
      const newFilters = this._makeFilterChain();
      const { first, last } = this._chainFilters(newFilters);
      v.envGain.disconnect();
      v.envGain.connect(first);
      last.connect(this._masterGain);

      v.filters = newFilters;
    }
    this._buildRefFilters();
  }

  /** Returns the reference filter array (for visualisation). */
  getRefFilters() {
    this._ensureContext();
    return this._refFilters;
  }

  /* --- ADSR --- */

  setADSR({ attack, decay, sustain, release }) {
    if (attack !== undefined)  this._attack  = Math.max(0.001, attack);
    if (decay !== undefined)   this._decay   = Math.max(0.001, decay);
    if (sustain !== undefined) this._sustain  = Math.max(0, Math.min(1, sustain));
    if (release !== undefined) this._release  = Math.max(0.001, release);
  }
  getADSR() {
    return { attack: this._attack, decay: this._decay, sustain: this._sustain, release: this._release };
  }

  /* --- voice management --- */

  noteOn(frequency, midi) {
    this._ensureContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    if (this._voices.has(midi)) this._killVoice(midi);

    const now = this._ctx.currentTime;

    // Shared envelope
    const envGain = this._ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(1, now + this._attack);
    envGain.gain.linearRampToValueAtTime(this._sustain, now + this._attack + this._decay);

    // Per-voice filter chain
    const filters = this._makeFilterChain();
    const { first, last } = this._chainFilters(filters);
    envGain.connect(first);
    last.connect(this._masterGain);

    // OSC 1
    const osc1 = this._ctx.createOscillator();
    osc1.type = this._osc1.waveform;
    osc1.frequency.setValueAtTime(frequency, now);
    osc1.detune.setValueAtTime((this._osc1.octave * 12 + this._osc1.pitch) * 100, now);
    const shaper1 = this._ctx.createWaveShaper();
    shaper1.curve = this._shapeCurve1;
    shaper1.oversample = '2x';
    const osc1Gain = this._ctx.createGain();
    osc1Gain.gain.value = this._osc1.volume;
    osc1.connect(shaper1);
    shaper1.connect(osc1Gain);
    osc1Gain.connect(envGain);
    osc1.start();

    // OSC 2
    const osc2 = this._ctx.createOscillator();
    osc2.type = this._osc2.waveform;
    osc2.frequency.setValueAtTime(frequency, now);
    osc2.detune.setValueAtTime((this._osc2.octave * 12 + this._osc2.pitch) * 100, now);
    const shaper2 = this._ctx.createWaveShaper();
    shaper2.curve = this._shapeCurve2;
    shaper2.oversample = '2x';
    const osc2Gain = this._ctx.createGain();
    osc2Gain.gain.value = this._osc2.volume;
    osc2.connect(shaper2);
    shaper2.connect(osc2Gain);
    osc2Gain.connect(envGain);
    osc2.start();

    this._voices.set(midi, { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, envGain, filters });
  }

  noteOff(midi) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    const now = this._ctx.currentTime;
    const { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, envGain, filters } = voice;

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + this._release);

    const stop = now + this._release + 0.01;
    osc1.stop(stop);
    osc2.stop(stop);
    osc1.onended = () => { osc1.disconnect(); shaper1.disconnect(); osc1Gain.disconnect(); };
    osc2.onended = () => {
      osc2.disconnect(); shaper2.disconnect(); osc2Gain.disconnect();
      envGain.disconnect();
      filters.forEach(f => { try { f.disconnect(); } catch {} });
    };
    this._voices.delete(midi);
  }

  allNotesOff() {
    for (const midi of [...this._voices.keys()]) this._killVoice(midi);
  }

  get activeVoiceCount() { return this._voices.size; }

  _killVoice(midi) {
    const v = this._voices.get(midi);
    if (!v) return;
    try { v.osc1.stop(); v.osc1.disconnect(); } catch {}
    try { v.osc2.stop(); v.osc2.disconnect(); } catch {}
    try { v.shaper1.disconnect(); } catch {}
    try { v.shaper2.disconnect(); } catch {}
    try { v.osc1Gain.disconnect(); } catch {}
    try { v.osc2Gain.disconnect(); } catch {}
    try { v.envGain.disconnect(); } catch {}
    v.filters.forEach(f => { try { f.disconnect(); } catch {} });
    this._voices.delete(midi);
  }
}
/**
 * Audio engine — dual-oscillator architecture.
 *
 * Per voice signal chain:
 *   OSC1 → shaper1 → osc1Gain ─┐
 *                                ├─→ envGain (ADSR) → filter → masterGain → analyser → dest
 *   OSC2 → shaper2 → osc2Gain ─┘
 *
 * Each oscillator: independent waveform, volume, shape (waveshaper drive), pitch (semitones).
 * Shared filter: BiquadFilterNode with configurable type, cutoff, and resonance.
 */

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'];

/** Build a tanh-ish waveshaper curve. amount 0 = bypass, 1 = heavy. */
function makeShapeCurve(amount, samples = 256) {
  const curve = new Float32Array(samples);
  if (amount <= 0) {
    // Linear passthrough
    for (let i = 0; i < samples; i++) curve[i] = (2 * i) / (samples - 1) - 1;
    return curve;
  }
  const k = amount * 50;
  for (let i = 0; i < samples; i++) {
    const x = (2 * i) / (samples - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._analyser = null;
    this._voices = new Map();

    // Per-oscillator config
    this._osc1 = { waveform: 'sawtooth', volume: 0.5, shape: 0, pitch: 0, octave: 0 };
    this._osc2 = { waveform: 'square',   volume: 0.0, shape: 0, pitch: 0, octave: 0 };

    // Cached curves
    this._shapeCurve1 = makeShapeCurve(0);
    this._shapeCurve2 = makeShapeCurve(0);

    // Filter
    this._filterType   = 'lowpass';
    this._filterCutoff = 20000;
    this._filterQ      = 0.5;
    this._filterGain   = 0;   // dB, used by lowshelf/highshelf/peaking
    this._refFilter    = null; // offline filter node for visualization

    // ADSR
    this._attack  = 0.01;
    this._decay   = 0.1;
    this._sustain  = 0.7;
    this._release  = 0.3;
  }

  /* --- lazy AudioContext --- */

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 1;
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._masterGain.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);

    // Reference filter for getFrequencyResponse() visualisation
    this._refFilter = this._ctx.createBiquadFilter();
    this._refFilter.type = this._filterType;
    this._refFilter.frequency.value = this._filterCutoff;
    this._refFilter.Q.value = this._filterQ;
    this._refFilter.gain.value = this._filterGain;
  }

  get analyser() { this._ensureContext(); return this._analyser; }
  get context()  { this._ensureContext(); return this._ctx; }
  get waveforms() { return WAVEFORMS; }
  get filterTypes() { return FILTER_TYPES; }

  _cfg(n) { return n === 2 ? this._osc2 : this._osc1; }

  /* --- oscillator parameters --- */

  setWaveform(oscNum, type) {
    if (!WAVEFORMS.includes(type)) return;
    this._cfg(oscNum).waveform = type;
    const key = oscNum === 2 ? 'osc2' : 'osc1';
    for (const v of this._voices.values()) v[key].type = type;
  }
  getWaveform(oscNum) { return this._cfg(oscNum).waveform; }

  setVolume(oscNum, value) {
    const cfg = this._cfg(oscNum);
    cfg.volume = Math.max(0, Math.min(1, value));
    const gk = oscNum === 2 ? 'osc2Gain' : 'osc1Gain';
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v[gk].gain.setTargetAtTime(cfg.volume, this._ctx.currentTime, 0.01);
      }
    }
  }
  getVolume(oscNum) { return this._cfg(oscNum).volume; }

  /** Shape: 0 (clean) → 1 (heavy drive) */
  setShape(oscNum, value) {
    const cfg = this._cfg(oscNum);
    cfg.shape = Math.max(0, Math.min(1, value));
    const curve = makeShapeCurve(cfg.shape);
    if (oscNum === 2) this._shapeCurve2 = curve; else this._shapeCurve1 = curve;
    const sk = oscNum === 2 ? 'shaper2' : 'shaper1';
    for (const v of this._voices.values()) v[sk].curve = curve;
  }
  getShape(oscNum) { return this._cfg(oscNum).shape; }

  /** Pitch fine-tune in semitones (–7 to +7, continuous). */
  setPitch(oscNum, semitones) {
    const cfg = this._cfg(oscNum);
    cfg.pitch = Math.max(-7, Math.min(7, semitones));
    this._applyDetune(oscNum);
  }
  getPitch(oscNum) { return this._cfg(oscNum).pitch; }

  /** Octave shift (–3 to +3). Each octave = 12 semitones. */
  setOctave(oscNum, oct) {
    const cfg = this._cfg(oscNum);
    cfg.octave = Math.max(-3, Math.min(3, Math.round(oct)));
    this._applyDetune(oscNum);
  }
  getOctave(oscNum) { return this._cfg(oscNum).octave; }

  /** Combines octave + pitch fine-tune into detune cents and applies to voices. */
  _applyDetune(oscNum) {
    const cfg = this._cfg(oscNum);
    const key = oscNum === 2 ? 'osc2' : 'osc1';
    const cents = (cfg.octave * 12 + cfg.pitch) * 100;
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v[key].detune.setTargetAtTime(cents, this._ctx.currentTime, 0.01);
      }
    }
  }

  /* --- filter --- */

  setFilterType(type) {
    if (!FILTER_TYPES.includes(type)) return;
    this._filterType = type;
    for (const v of this._voices.values()) v.filter.type = type;
    if (this._refFilter) this._refFilter.type = type;
  }
  getFilterType() { return this._filterType; }

  setFilterCutoff(freq) {
    this._filterCutoff = Math.max(20, Math.min(20000, freq));
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v.filter.frequency.setTargetAtTime(this._filterCutoff, this._ctx.currentTime, 0.01);
      }
      if (this._refFilter) this._refFilter.frequency.value = this._filterCutoff;
    }
  }
  getFilterCutoff() { return this._filterCutoff; }

  setFilterQ(value) {
    this._filterQ = Math.max(0.01, Math.min(30, value));
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v.filter.Q.setTargetAtTime(this._filterQ, this._ctx.currentTime, 0.01);
      }
      if (this._refFilter) this._refFilter.Q.value = this._filterQ;
    }
  }
  getFilterQ() { return this._filterQ; }

  setFilterGain(dB) {
    this._filterGain = Math.max(-24, Math.min(24, dB));
    if (this._ctx) {
      for (const v of this._voices.values()) {
        v.filter.gain.setTargetAtTime(this._filterGain, this._ctx.currentTime, 0.01);
      }
      if (this._refFilter) this._refFilter.gain.value = this._filterGain;
    }
  }
  getFilterGain() { return this._filterGain; }

  /** Returns the reference BiquadFilterNode (for visualisation). */
  getRefFilter() {
    this._ensureContext();
    return this._refFilter;
  }

  /* --- ADSR --- */

  setADSR({ attack, decay, sustain, release }) {
    if (attack !== undefined)  this._attack  = Math.max(0.001, attack);
    if (decay !== undefined)   this._decay   = Math.max(0.001, decay);
    if (sustain !== undefined) this._sustain  = Math.max(0, Math.min(1, sustain));
    if (release !== undefined) this._release  = Math.max(0.001, release);
  }
  getADSR() {
    return { attack: this._attack, decay: this._decay, sustain: this._sustain, release: this._release };
  }

  /* --- voice management --- */

  noteOn(frequency, midi) {
    this._ensureContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    if (this._voices.has(midi)) this._killVoice(midi);

    const now = this._ctx.currentTime;

    // Shared envelope
    const envGain = this._ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(1, now + this._attack);
    envGain.gain.linearRampToValueAtTime(this._sustain, now + this._attack + this._decay);

    // Per-voice filter
    const filter = this._ctx.createBiquadFilter();
    filter.type = this._filterType;
    filter.frequency.setValueAtTime(this._filterCutoff, now);
    filter.Q.setValueAtTime(this._filterQ, now);
    filter.gain.setValueAtTime(this._filterGain, now);
    envGain.connect(filter);
    filter.connect(this._masterGain);

    // OSC 1
    const osc1 = this._ctx.createOscillator();
    osc1.type = this._osc1.waveform;
    osc1.frequency.setValueAtTime(frequency, now);
    osc1.detune.setValueAtTime((this._osc1.octave * 12 + this._osc1.pitch) * 100, now);
    const shaper1 = this._ctx.createWaveShaper();
    shaper1.curve = this._shapeCurve1;
    shaper1.oversample = '2x';
    const osc1Gain = this._ctx.createGain();
    osc1Gain.gain.value = this._osc1.volume;
    osc1.connect(shaper1);
    shaper1.connect(osc1Gain);
    osc1Gain.connect(envGain);
    osc1.start();

    // OSC 2
    const osc2 = this._ctx.createOscillator();
    osc2.type = this._osc2.waveform;
    osc2.frequency.setValueAtTime(frequency, now);
    osc2.detune.setValueAtTime((this._osc2.octave * 12 + this._osc2.pitch) * 100, now);
    const shaper2 = this._ctx.createWaveShaper();
    shaper2.curve = this._shapeCurve2;
    shaper2.oversample = '2x';
    const osc2Gain = this._ctx.createGain();
    osc2Gain.gain.value = this._osc2.volume;
    osc2.connect(shaper2);
    shaper2.connect(osc2Gain);
    osc2Gain.connect(envGain);
    osc2.start();

    this._voices.set(midi, { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, envGain, filter });
  }

  noteOff(midi) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    const now = this._ctx.currentTime;
    const { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, envGain, filter } = voice;

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + this._release);

    const stop = now + this._release + 0.01;
    osc1.stop(stop);
    osc2.stop(stop);
    osc1.onended = () => { osc1.disconnect(); shaper1.disconnect(); osc1Gain.disconnect(); };
    osc2.onended = () => { osc2.disconnect(); shaper2.disconnect(); osc2Gain.disconnect(); envGain.disconnect(); filter.disconnect(); };
    this._voices.delete(midi);
  }

  allNotesOff() {
    for (const midi of [...this._voices.keys()]) this._killVoice(midi);
  }

  get activeVoiceCount() { return this._voices.size; }

  _killVoice(midi) {
    const v = this._voices.get(midi);
    if (!v) return;
    try { v.osc1.stop(); v.osc1.disconnect(); } catch {}
    try { v.osc2.stop(); v.osc2.disconnect(); } catch {}
    try { v.shaper1.disconnect(); } catch {}
    try { v.shaper2.disconnect(); } catch {}
    try { v.osc1Gain.disconnect(); } catch {}
    try { v.osc2Gain.disconnect(); } catch {}
    try { v.envGain.disconnect(); } catch {}
    try { v.filter.disconnect(); } catch {}
    this._voices.delete(midi);
  }
}
