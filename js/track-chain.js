/**
 * TrackChain — per-track audio processing module chain.
 *
 * Signal flow:
 *   input → [filter (cascaded stages)] → [chorus] → [reverb] → output (gain)
 *
 * Filter uses the same model system as the synth engine (SVF12, SVF24, RD3, MG, OB12, OB24)
 * with cascaded BiquadFilterNodes and per-stage Q multipliers.
 */

import { ChorusEffect, ReverbEffect } from './effects.js';

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'];

const FILTER_MODELS = {
  'svf12': { label: 'SVF 12', stages: 1, qFactors: [1.0] },
  'svf24': { label: 'SVF 24', stages: 2, qFactors: [0.54, 1.31] },
  'rd3':   { label: 'RD3',    stages: 3, qFactors: [0.33, 0.33, 1.0] },
  'mg':    { label: 'MG',     stages: 4, qFactors: [0.18, 0.18, 0.18, 1.2] },
  'ob12':  { label: 'OB 12',  stages: 1, qFactors: [1.3] },
  'ob24':  { label: 'OB 24',  stages: 2, qFactors: [0.7, 1.5] },
};

export const CHAIN_FILTER_MODELS = FILTER_MODELS;

export class TrackChain {
  constructor(ctx, output) {
    this._ctx = ctx;
    this._output = output; // final destination (e.g. track gain node)

    // Input node (all sources connect here)
    this._input = ctx.createGain();
    this._input.gain.value = 1;

    // Filter state
    this._filterEnabled = false;
    this._filterType = 'lowpass';
    this._filterModel = 'svf24';
    this._filterCutoff = 20000;
    this._filterQ = 0.5;
    this._filterGain = 0;
    this._filters = [];        // array of BiquadFilterNodes (cascaded)
    this._filterOutput = ctx.createGain(); // junction node after filter chain

    // Chorus / Reverb
    this._chorusEnabled = false;
    this._reverbEnabled = false;
    this._chorus = new ChorusEffect(ctx);
    this._reverb = new ReverbEffect(ctx);

    // Build initial filter nodes and routing
    this._buildFilterChain();
    this._rebuildRouting();
  }

  get input() { return this._input; }

  /* ── Internal routing ───────────────────────── */

  /** Create cascaded BiquadFilter nodes based on current model. */
  _buildFilterChain() {
    // Disconnect old filters
    this._filters.forEach(f => { try { f.disconnect(); } catch {} });
    try { this._filterOutput.disconnect(); } catch {};

    const model = FILTER_MODELS[this._filterModel] || FILTER_MODELS['svf24'];
    const stages = this._filterType === 'lowpass' ? model.stages : 1;
    const qFactors = this._filterType === 'lowpass' ? model.qFactors : [1.0];

    this._filters = [];
    for (let i = 0; i < stages; i++) {
      const f = this._ctx.createBiquadFilter();
      f.type = this._filterType;
      f.frequency.value = this._filterCutoff;
      f.Q.value = this._filterQ * (qFactors[i] || 1);
      f.gain.value = this._filterGain;
      this._filters.push(f);
    }

    // Chain filters in series → filterOutput
    if (this._filters.length > 0) {
      for (let i = 1; i < this._filters.length; i++) {
        this._filters[i - 1].connect(this._filters[i]);
      }
      this._filters[this._filters.length - 1].connect(this._filterOutput);
    }
  }

  /** Rebuild the full audio graph routing based on enabled modules. */
  _rebuildRouting() {
    // Disconnect everything from input onward
    try { this._input.disconnect(); } catch {}
    try { this._filterOutput.disconnect(); } catch {}
    try { this._chorus.output.disconnect(); } catch {}
    try { this._reverb.output.disconnect(); } catch {}

    // Build chain: input → [filter?] → [chorus?] → [reverb?] → output
    let current = this._input;

    if (this._filterEnabled && this._filters.length > 0) {
      current.connect(this._filters[0]);
      current = this._filterOutput;
    }

    if (this._chorusEnabled) {
      current.connect(this._chorus.input);
      current = this._chorus.output;
    }

    if (this._reverbEnabled) {
      current.connect(this._reverb.input);
      current = this._reverb.output;
    }

    current.connect(this._output);
  }

  /** Apply current params to all filter stages (without rebuilding). */
  _updateFilterParams() {
    const model = FILTER_MODELS[this._filterModel] || FILTER_MODELS['svf24'];
    const qFactors = this._filterType === 'lowpass' ? model.qFactors : [1.0];
    const t = this._ctx.currentTime;
    this._filters.forEach((f, i) => {
      f.type = this._filterType;
      f.frequency.setTargetAtTime(this._filterCutoff, t, 0.01);
      f.Q.setTargetAtTime(this._filterQ * (qFactors[i] || 1), t, 0.01);
      f.gain.setTargetAtTime(this._filterGain, t, 0.01);
    });
  }

  /* ── Filter ─────────────────────────────────── */

  setFilterEnabled(on) {
    this._filterEnabled = !!on;
    this._rebuildRouting();
  }
  getFilterEnabled() { return this._filterEnabled; }

  setFilterType(type) {
    if (!FILTER_TYPES.includes(type)) return;
    const oldType = this._filterType;
    this._filterType = type;
    // Stage count changes when switching to/from lowpass (lowpass uses model stages, others use 1)
    const needsRebuild = (oldType === 'lowpass') !== (type === 'lowpass');
    if (needsRebuild) {
      this._buildFilterChain();
      this._rebuildRouting();
    } else {
      this._updateFilterParams();
    }
  }
  getFilterType() { return this._filterType; }

  setFilterModel(model) {
    if (!FILTER_MODELS[model]) return;
    const oldModel = this._filterModel;
    this._filterModel = model;
    if (this._filterType === 'lowpass') {
      const oldStages = (FILTER_MODELS[oldModel] || FILTER_MODELS['svf24']).stages;
      const newStages = FILTER_MODELS[model].stages;
      if (oldStages !== newStages) {
        this._buildFilterChain();
        this._rebuildRouting();
      } else {
        this._updateFilterParams();
      }
    }
  }
  getFilterModel() { return this._filterModel; }

  setFilterCutoff(freq) {
    this._filterCutoff = Math.max(20, Math.min(20000, freq));
    this._updateFilterParams();
  }
  getFilterCutoff() { return this._filterCutoff; }

  setFilterQ(value) {
    this._filterQ = Math.max(0.01, Math.min(30, value));
    this._updateFilterParams();
  }
  getFilterQ() { return this._filterQ; }

  setFilterGain(dB) {
    this._filterGain = Math.max(-24, Math.min(24, dB));
    this._updateFilterParams();
  }
  getFilterGain() { return this._filterGain; }

  /* ── Chorus ─────────────────────────────────── */

  setChorusEnabled(on) {
    this._chorusEnabled = !!on;
    this._chorus.setEnabled(on);
    this._rebuildRouting();
  }
  getChorusEnabled() { return this._chorusEnabled; }

  setChorusRate(hz) { this._chorus.setRate(hz); }
  setChorusDepth(ms) { this._chorus.setDepth(ms); }
  setChorusWidth(pct) { this._chorus.setWidth(pct / 100); }
  setChorusMix(pct) { this._chorus.setMix(pct / 100); }
  setChorusHPC(freq) { this._chorus.setHPC(freq); }

  getChorusRate() { return this._chorus._rate; }
  getChorusDepth() { return this._chorus._depth; }
  getChorusWidth() { return this._chorus._width * 100; }
  getChorusMix() { return this._chorus._mix * 100; }
  getChorusHPC() { return this._chorus._hpc; }

  /* ── Reverb ─────────────────────────────────── */

  setReverbEnabled(on) {
    this._reverbEnabled = !!on;
    this._reverb.setEnabled(on);
    this._rebuildRouting();
  }
  getReverbEnabled() { return this._reverbEnabled; }

  setReverbDecay(seconds) { this._reverb.setDecay(seconds); }
  setReverbMix(pct) { this._reverb.setMix(pct / 100); }

  getReverbDecay() { return this._reverb._decay; }
  getReverbMix() { return this._reverb._mix * 100; }

  /* ── Module list (for UI) ─────────────────── */

  getActiveModules() {
    const mods = [];
    if (this._filterEnabled) mods.push('filter');
    if (this._chorusEnabled) mods.push('chorus');
    if (this._reverbEnabled) mods.push('reverb');
    return mods;
  }

  /* ── State serialization ────────────────────── */

  getState() {
    return {
      filter: {
        enabled: this._filterEnabled,
        type: this._filterType,
        model: this._filterModel,
        cutoff: this._filterCutoff,
        q: this._filterQ,
        gain: this._filterGain,
      },
      chorus: {
        enabled: this._chorusEnabled,
        rate: this._chorus._rate,
        depth: this._chorus._depth,
        width: this._chorus._width,
        mix: this._chorus._mix,
        hpc: this._chorus._hpc,
      },
      reverb: {
        enabled: this._reverbEnabled,
        decay: this._reverb._decay,
        mix: this._reverb._mix,
      },
    };
  }

  loadState(s) {
    if (!s) return;
    if (s.filter) {
      this._filterType = s.filter.type || 'lowpass';
      this._filterModel = s.filter.model || 'svf24';
      this._filterCutoff = s.filter.cutoff !== undefined ? s.filter.cutoff : 20000;
      this._filterQ = s.filter.q !== undefined ? s.filter.q : 0.5;
      this._filterGain = s.filter.gain !== undefined ? s.filter.gain : 0;
      this._filterEnabled = !!s.filter.enabled;
      this._buildFilterChain();
    }
    if (s.chorus) {
      this._chorus.setRate(s.chorus.rate !== undefined ? s.chorus.rate : 1.5);
      this._chorus.setDepth(s.chorus.depth !== undefined ? s.chorus.depth : 3);
      this._chorus.setWidth(s.chorus.width !== undefined ? s.chorus.width : 0.5);
      this._chorus.setMix(s.chorus.mix !== undefined ? s.chorus.mix : 0.5);
      this._chorus.setHPC(s.chorus.hpc !== undefined ? s.chorus.hpc : 200);
      this._chorusEnabled = !!s.chorus.enabled;
      this._chorus.setEnabled(this._chorusEnabled);
    }
    if (s.reverb) {
      this._reverb.setDecay(s.reverb.decay !== undefined ? s.reverb.decay : 2);
      this._reverb.setMix(s.reverb.mix !== undefined ? s.reverb.mix : 0.3);
      this._reverbEnabled = !!s.reverb.enabled;
      this._reverb.setEnabled(this._reverbEnabled);
    }
    this._rebuildRouting();
  }

  /** Reset all modules to bypass defaults. */
  reset() {
    this._filterEnabled = false;
    this._filterType = 'lowpass';
    this._filterModel = 'svf24';
    this._filterCutoff = 20000;
    this._filterQ = 0.5;
    this._filterGain = 0;
    this._buildFilterChain();
    this._chorusEnabled = false;
    this._chorus.setEnabled(false);
    this._chorus.setRate(1.5);
    this._chorus.setDepth(3);
    this._chorus.setWidth(0.5);
    this._chorus.setMix(0.5);
    this._chorus.setHPC(200);
    this._reverbEnabled = false;
    this._reverb.setEnabled(false);
    this._reverb.setDecay(2);
    this._reverb.setMix(0.3);
    this._rebuildRouting();
  }

  /** Disconnect and clean up all nodes. */
  destroy() {
    try { this._input.disconnect(); } catch {}
    this._filters.forEach(f => { try { f.disconnect(); } catch {} });
    try { this._filterOutput.disconnect(); } catch {}
    try { this._chorus.output.disconnect(); } catch {}
    try { this._reverb.output.disconnect(); } catch {}
  }
}
