/**
 * Audio engine -- dual-oscillator architecture.
 *
 * Per voice signal chain:
 *   OSC1 -> shaper1 -> osc1Gain --+
 *                                 +-> envGain (ADSR) -> filters[] -> masterGain -> chorus -> reverb -> analyser -> dest
 *   OSC2 -> shaper2 -> osc2Gain --+
 *
 * Filter chain uses cascaded BiquadFilterNodes for different filter models.
 */

import { ChorusEffect, ReverbEffect } from './effects.js';
import { ALT_MODES, createStringVoice, createFMVoice, createFormantVoice } from './alt-osc.js';

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'];

/**
 * Filter models -- only active when type is 'lowpass'.
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
  'cst':    { label: 'CST',    stages: 0, qFactors: [] },
};

/** Number of bands for the CST (custom) filter model. */
const CST_NUM_BANDS = 24;

/** Build logarithmically-spaced center frequencies for CST bands (25 Hz - 18 kHz). */
function buildCSTFreqs() {
  const freqs = new Float32Array(CST_NUM_BANDS);
  const logMin = Math.log(25);
  const logMax = Math.log(18000);
  for (let i = 0; i < CST_NUM_BANDS; i++) {
    freqs[i] = Math.exp(logMin + (i / (CST_NUM_BANDS - 1)) * (logMax - logMin));
  }
  return freqs;
}

const CST_FREQS = buildCSTFreqs();
/** Q for ~1/3 octave bandwidth peaking filter. */
const CST_Q = 2.0;

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

    // OSC 3 (alt engines)
    this._osc3 = {
      mode: 'string', volume: 0.0, octave: 0, pitch: 0,
      color: 0.5, damping: 0.5,      // STRING params
      ratio: 2, index: 3,            // FM params
      morph: 0, vibrato: 0.3,        // FORMANT params
    };

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

    // CST (custom drawn) filter -- per-band gains in dB
    this._cstGains = new Float32Array(CST_NUM_BANDS); // default 0 dB (flat)

    // ADSR
    this._attack  = 0.01;
    this._decay   = 0.1;
    this._sustain  = 0.7;
    this._release  = 0.3;

    // Master volume
    this._masterVol = 0.8;

    // Effects (created lazily in _ensureContext)
    this._chorus = null;
    this._reverb = null;
  }

  /* --- lazy AudioContext --- */

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._masterVol;
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;

    // Effects chain: masterGain → chorus → reverb → analyser → destination
    this._chorus = new ChorusEffect(this._ctx);
    this._reverb = new ReverbEffect(this._ctx);
    this._masterGain.connect(this._chorus.input);
    this._chorus.output.connect(this._reverb.input);
    this._reverb.output.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);

    this._buildRefFilters();
  }

  /** Create reference filter chain for visualisation. */
  _buildRefFilters() {
    this._refFilters = this._makeFilterChain();
  }

  /** How many stages does the current config need? */
  _stageCount() {
    if (this._filterModel === 'cst') return CST_NUM_BANDS;
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
    if (this._filterModel === 'cst') return this._makeCSTChain();
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
    if (this._filterModel === 'cst') {
      this._applyCSTParams(filters, time);
      return;
    }
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

  setMasterVolume(v) {
    this._masterVol = Math.max(0, Math.min(1, v));
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._masterVol, this._ctx.currentTime, 0.01);
    }
  }
  getMasterVolume() { return this._masterVol; }

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

  /* --- CST (custom drawn) filter --- */

  /** Create a bank of peaking EQ filters for the CST model. */
  _makeCSTChain() {
    const filters = [];
    for (let i = 0; i < CST_NUM_BANDS; i++) {
      const f = this._ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = CST_FREQS[i];
      f.Q.value = CST_Q;
      f.gain.value = this._cstGains[i];
      filters.push(f);
    }
    return filters;
  }

  /** Apply CST gains to existing filter nodes. */
  _applyCSTParams(filters, time) {
    for (let i = 0; i < filters.length; i++) {
      if (time !== undefined) {
        filters[i].gain.setTargetAtTime(this._cstGains[i] || 0, time, 0.01);
      } else {
        filters[i].gain.value = this._cstGains[i] || 0;
      }
    }
  }

  /**
   * Set the custom filter curve -- array of gain values in dB (length = CST_NUM_BANDS).
   * Called from the visualizer draw interaction.
   */
  setCustomFilterCurve(gains) {
    for (let i = 0; i < CST_NUM_BANDS; i++) {
      this._cstGains[i] = gains[i] !== undefined ? Math.max(-24, Math.min(24, gains[i])) : 0;
    }
    if (this._filterModel === 'cst') {
      this._updateAllFilters();
    }
  }

  getCustomFilterCurve() {
    return Array.from(this._cstGains);
  }

  /** Returns the CST band center frequencies (for visualizer x-axis mapping). */
  getCSTFreqs() { return CST_FREQS; }
  getCSTBandCount() { return CST_NUM_BANDS; }

  isCustomFilterActive() {
    return this._filterType === 'lowpass' && this._filterModel === 'cst';
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

    // OSC 3 (alt engine)
    const osc3Gain = this._ctx.createGain();
    osc3Gain.gain.value = this._osc3.volume;
    osc3Gain.connect(envGain);
    const osc3Freq = frequency * Math.pow(2, this._osc3.octave + this._osc3.pitch / 12);
    const altVoice = this._createAltVoice(osc3Freq, osc3Gain);

    this._voices.set(midi, { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, osc3Gain, altVoice, envGain, filters });
  }

  noteOff(midi) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    const now = this._ctx.currentTime;
    const { osc1, shaper1, osc1Gain, osc2, shaper2, osc2Gain, osc3Gain, altVoice, envGain, filters } = voice;

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + this._release);

    const stop = now + this._release + 0.01;
    osc1.stop(stop);
    osc2.stop(stop);
    if (altVoice) altVoice.stop(stop);
    osc1.onended = () => { osc1.disconnect(); shaper1.disconnect(); osc1Gain.disconnect(); };
    osc2.onended = () => {
      osc2.disconnect(); shaper2.disconnect(); osc2Gain.disconnect();
      if (osc3Gain) osc3Gain.disconnect();
      if (altVoice) altVoice.disconnect();
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
    if (v.osc3Gain) try { v.osc3Gain.disconnect(); } catch {}
    if (v.altVoice) try { v.altVoice.stop(); v.altVoice.disconnect(); } catch {}
    try { v.envGain.disconnect(); } catch {}
    v.filters.forEach(f => { try { f.disconnect(); } catch {} });
    this._voices.delete(midi);
  }

  /* --- OSC 3 (alt engines) --- */

  _createAltVoice(frequency, destNode) {
    const p = this._osc3;
    switch (p.mode) {
      case 'string':
        return createStringVoice(this._ctx, frequency, destNode, { color: p.color, damping: p.damping });
      case 'fm':
        return createFMVoice(this._ctx, frequency, destNode, { ratio: p.ratio, index: p.index });
      case 'formant':
        return createFormantVoice(this._ctx, frequency, destNode, { morph: p.morph, vibrato: p.vibrato });
      default:
        return null;
    }
  }

  setOsc3Mode(mode) {
    if (!ALT_MODES.includes(mode)) return;
    this._osc3.mode = mode;
  }
  getOsc3Mode() { return this._osc3.mode; }

  setOsc3Volume(value) {
    this._osc3.volume = Math.max(0, Math.min(1, value));
    if (this._ctx) {
      for (const v of this._voices.values()) {
        if (v.osc3Gain) v.osc3Gain.gain.setTargetAtTime(this._osc3.volume, this._ctx.currentTime, 0.01);
      }
    }
  }
  getOsc3Volume() { return this._osc3.volume; }

  setOsc3Octave(oct) {
    this._osc3.octave = Math.max(-3, Math.min(3, Math.round(oct)));
  }
  getOsc3Octave() { return this._osc3.octave; }

  setOsc3Pitch(semitones) {
    this._osc3.pitch = Math.max(-7, Math.min(7, semitones));
  }
  getOsc3Pitch() { return this._osc3.pitch; }

  // STRING params
  setOsc3Color(v) {
    this._osc3.color = Math.max(0, Math.min(1, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setColor) voice.altVoice.setColor(this._osc3.color);
    }
  }
  getOsc3Color() { return this._osc3.color; }

  setOsc3Damping(v) {
    this._osc3.damping = Math.max(0, Math.min(1, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setDamping) voice.altVoice.setDamping(this._osc3.damping);
    }
  }
  getOsc3Damping() { return this._osc3.damping; }

  // FM params
  setOsc3Ratio(v) {
    this._osc3.ratio = Math.max(0.5, Math.min(12, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setRatio) voice.altVoice.setRatio(this._osc3.ratio);
    }
  }
  getOsc3Ratio() { return this._osc3.ratio; }

  setOsc3Index(v) {
    this._osc3.index = Math.max(0, Math.min(20, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setIndex) voice.altVoice.setIndex(this._osc3.index);
    }
  }
  getOsc3Index() { return this._osc3.index; }

  // FORMANT params
  setOsc3Morph(v) {
    this._osc3.morph = Math.max(0, Math.min(1, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setMorph) voice.altVoice.setMorph(this._osc3.morph);
    }
  }
  getOsc3Morph() { return this._osc3.morph; }

  setOsc3Vibrato(v) {
    this._osc3.vibrato = Math.max(0, Math.min(1, v));
    for (const voice of this._voices.values()) {
      if (voice.altVoice && voice.altVoice.setVibrato) voice.altVoice.setVibrato(this._osc3.vibrato);
    }
  }
  getOsc3Vibrato() { return this._osc3.vibrato; }

  get altModes() { return ALT_MODES; }

  /* --- effects --- */

  setChorusEnabled(on) { this._ensureContext(); this._chorus.setEnabled(on); }
  getChorusEnabled() { return this._chorus ? this._chorus.getState().enabled : false; }

  setChorusRate(hz) { this._ensureContext(); this._chorus.setRate(hz); }
  getChorusRate() { return this._chorus ? this._chorus.getState().rate : 1.5; }

  setChorusDepth(ms) {
    this._ensureContext();
    this._chorus.setDepth(ms);
  }
  getChorusDepth() {
    return this._chorus ? this._chorus.getState().depth : 3.0;
  }

  setChorusMix(pct) { this._ensureContext(); this._chorus.setMix(pct / 100); }
  getChorusMix() { return this._chorus ? this._chorus.getState().mix * 100 : 50; }

  setChorusWidth(pct) { this._ensureContext(); this._chorus.setWidth(pct / 100); }
  getChorusWidth() { return this._chorus ? this._chorus.getState().width * 100 : 50; }

  setChorusHPC(freq) { this._ensureContext(); this._chorus.setHPC(freq); }
  getChorusHPC() { return this._chorus ? this._chorus.getState().hpc : 200; }

  setReverbEnabled(on) { this._ensureContext(); this._reverb.setEnabled(on); }
  getReverbEnabled() { return this._reverb ? this._reverb.getState().enabled : false; }

  setReverbDecay(seconds) { this._ensureContext(); this._reverb.setDecay(seconds); }
  getReverbDecay() { return this._reverb ? this._reverb.getState().decay : 2.0; }

  setReverbMix(pct) { this._ensureContext(); this._reverb.setMix(pct / 100); }
  getReverbMix() { return this._reverb ? this._reverb.getState().mix * 100 : 30; }
}
