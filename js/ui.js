/**
 * UI module — binds DOM controls to engine parameters and shows visual feedback.
 * Supports dual oscillators (each with waveform + volume) and arp popup.
 */

import { KEY_TO_MIDI, midiToFreq, midiToName } from './keyboard.js';

export class UIManager {
  constructor(callbacks) {
    this._cb = callbacks;
    this._activeTouchMidi = null;
    this._pianoKeys = null;
    this._adsrSliders = {};
    this._adsrValues = {};
    this._arpPopup = null;
    this._fxPopup = null;
    this._drumPopup = null;
    this._seqPopup = null;
  }

  init() {
    this._noteDisplay = document.getElementById('note-display');
    this._arpPopup = document.getElementById('arp-popup');
    this._fxPopup = document.getElementById('fx-popup');
    this._drumPopup = document.getElementById('drum-popup');
    this._seqPopup = document.getElementById('seq-popup');
    this._currentFilterType = 'lowpass';
    this._currentFilterModel = 'svf12';

    this._bindOscWaveforms();
    this._bindOscVolumes();
    this._bindOscShapes();
    this._bindOscPitches();
    this._bindOscOctaves();
    this._bindOsc3();
    this._bindFilter();
    this._bindADSR();
    this._bindPlayMode();
    this._bindTempo();
    this._bindArpControls();
    this._bindEffects();
    this._bindLFO();
    this._buildPianoVisual();
  }

  /* --- oscillator waveforms (per-osc via data-osc attribute) --- */

  _bindOscWaveforms() {
    [1, 2].forEach(oscNum => {
      const btns = document.querySelectorAll(`.waveform-btn[data-osc="${oscNum}"]`);
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._cb.onWaveformChange(oscNum, btn.dataset.waveform);
        });
      });
    });
  }

  setActiveWaveform(oscNum, type) {
    const btns = document.querySelectorAll(`.waveform-btn[data-osc="${oscNum}"]`);
    btns.forEach(b => b.classList.toggle('active', b.dataset.waveform === type));
  }

  /* --- oscillator volumes --- */

  _bindOscVolumes() {
    [1, 2].forEach(oscNum => {
      const slider = document.getElementById(`osc${oscNum}-volume`);
      const display = document.getElementById(`osc${oscNum}-volume-value`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        display.textContent = Math.round(v * 100) + '%';
        this._cb.onVolumeChange(oscNum, v);
      });
    });
  }

  setVolume(oscNum, value) {
    const slider = document.getElementById(`osc${oscNum}-volume`);
    const display = document.getElementById(`osc${oscNum}-volume-value`);
    if (!slider) return;
    slider.value = value;
    display.textContent = Math.round(value * 100) + '%';
  }

  /* --- oscillator shape (waveshaper drive) --- */

  _bindOscShapes() {
    [1, 2].forEach(oscNum => {
      const slider = document.getElementById(`osc${oscNum}-shape`);
      const display = document.getElementById(`osc${oscNum}-shape-value`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        display.textContent = Math.round(v * 100) + '%';
        this._cb.onShapeChange(oscNum, v);
      });
    });
  }

  setShape(oscNum, value) {
    const slider = document.getElementById(`osc${oscNum}-shape`);
    const display = document.getElementById(`osc${oscNum}-shape-value`);
    if (!slider) return;
    slider.value = value;
    display.textContent = Math.round(value * 100) + '%';
  }

  /* --- oscillator pitch (semitones) --- */

  _bindOscPitches() {
    [1, 2].forEach(oscNum => {
      const slider = document.getElementById(`osc${oscNum}-pitch`);
      const display = document.getElementById(`osc${oscNum}-pitch-value`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        display.textContent = v.toFixed(2) + ' st';
        this._cb.onPitchChange(oscNum, v);
      });
    });
  }

  setPitch(oscNum, value) {
    const slider = document.getElementById(`osc${oscNum}-pitch`);
    const display = document.getElementById(`osc${oscNum}-pitch-value`);
    if (!slider) return;
    slider.value = value;
    display.textContent = parseFloat(value).toFixed(2) + ' st';
  }

  /* --- oscillator octave (whole octaves) --- */

  _bindOscOctaves() {
    [1, 2].forEach(oscNum => {
      const slider = document.getElementById(`osc${oscNum}-octave`);
      const display = document.getElementById(`osc${oscNum}-octave-value`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value);
        display.textContent = (v >= 0 ? '+' : '') + v;
        this._cb.onOctaveChange(oscNum, v);
      });
    });
  }

  setOctave(oscNum, value) {
    const slider = document.getElementById(`osc${oscNum}-octave`);
    const display = document.getElementById(`osc${oscNum}-octave-value`);
    if (!slider) return;
    slider.value = value;
    display.textContent = (value >= 0 ? '+' : '') + value;
  }

  /* --- OSC 3 (alt engines) --- */

  _bindOsc3() {
    // mode selector
    document.querySelectorAll('.osc3-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.osc3-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.altmode;
        this._updateOsc3ParamVisibility(mode);
        if (this._cb.onOsc3ModeChange) this._cb.onOsc3ModeChange(mode);
      });
    });

    // volume
    const vol = document.getElementById('osc3-volume');
    const volVal = document.getElementById('osc3-volume-value');
    if (vol) vol.addEventListener('input', () => {
      const v = parseFloat(vol.value);
      volVal.textContent = Math.round(v * 100) + '%';
      if (this._cb.onOsc3VolumeChange) this._cb.onOsc3VolumeChange(v);
    });

    // pitch
    const pitch = document.getElementById('osc3-pitch');
    const pitchVal = document.getElementById('osc3-pitch-value');
    if (pitch) pitch.addEventListener('input', () => {
      const v = parseFloat(pitch.value);
      pitchVal.textContent = v.toFixed(2) + ' st';
      if (this._cb.onOsc3PitchChange) this._cb.onOsc3PitchChange(v);
    });

    // octave
    const oct = document.getElementById('osc3-octave');
    const octVal = document.getElementById('osc3-octave-value');
    if (oct) oct.addEventListener('input', () => {
      const v = parseInt(oct.value);
      octVal.textContent = v;
      if (this._cb.onOsc3OctaveChange) this._cb.onOsc3OctaveChange(v);
    });

    // STRING: color, damping
    const color = document.getElementById('osc3-color');
    const colorVal = document.getElementById('osc3-color-value');
    if (color) color.addEventListener('input', () => {
      const v = parseFloat(color.value);
      colorVal.textContent = Math.round(v * 100) + '%';
      if (this._cb.onOsc3ColorChange) this._cb.onOsc3ColorChange(v);
    });

    const damping = document.getElementById('osc3-damping');
    const dampVal = document.getElementById('osc3-damping-value');
    if (damping) damping.addEventListener('input', () => {
      const v = parseFloat(damping.value);
      dampVal.textContent = Math.round(v * 100) + '%';
      if (this._cb.onOsc3DampingChange) this._cb.onOsc3DampingChange(v);
    });

    // FM: ratio, index
    const ratio = document.getElementById('osc3-ratio');
    const ratioVal = document.getElementById('osc3-ratio-value');
    if (ratio) ratio.addEventListener('input', () => {
      const v = parseFloat(ratio.value);
      ratioVal.textContent = v.toFixed(1);
      if (this._cb.onOsc3RatioChange) this._cb.onOsc3RatioChange(v);
    });

    const index = document.getElementById('osc3-index');
    const indexVal = document.getElementById('osc3-index-value');
    if (index) index.addEventListener('input', () => {
      const v = parseFloat(index.value);
      indexVal.textContent = v.toFixed(1);
      if (this._cb.onOsc3IndexChange) this._cb.onOsc3IndexChange(v);
    });

    // FORMANT: morph, vibrato
    const morph = document.getElementById('osc3-morph');
    const morphVal = document.getElementById('osc3-morph-value');
    if (morph) morph.addEventListener('input', () => {
      const v = parseFloat(morph.value);
      const vowels = ['A', 'E', 'I', 'O', 'U'];
      const idx = v * (vowels.length - 1);
      const lo = Math.floor(idx), hi = Math.min(lo + 1, vowels.length - 1);
      const frac = idx - lo;
      morphVal.textContent = frac < 0.15 ? vowels[lo] : frac > 0.85 ? vowels[hi] : vowels[lo] + '-' + vowels[hi];
      if (this._cb.onOsc3MorphChange) this._cb.onOsc3MorphChange(v);
    });

    const vibrato = document.getElementById('osc3-vibrato');
    const vibVal = document.getElementById('osc3-vibrato-value');
    if (vibrato) vibrato.addEventListener('input', () => {
      const v = parseFloat(vibrato.value);
      vibVal.textContent = Math.round(v * 100) + '%';
      if (this._cb.onOsc3VibratoChange) this._cb.onOsc3VibratoChange(v);
    });
  }

  _updateOsc3ParamVisibility(mode) {
    document.getElementById('osc3-string-params').classList.toggle('hidden', mode !== 'string');
    document.getElementById('osc3-fm-params').classList.toggle('hidden', mode !== 'fm');
    document.getElementById('osc3-formant-params').classList.toggle('hidden', mode !== 'formant');
  }

  setOsc3Mode(mode) {
    document.querySelectorAll('.osc3-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.altmode === mode);
    });
    this._updateOsc3ParamVisibility(mode);
  }

  setOsc3Volume(v) {
    const el = document.getElementById('osc3-volume');
    const d = document.getElementById('osc3-volume-value');
    if (el) { el.value = v; d.textContent = Math.round(v * 100) + '%'; }
  }

  setOsc3Pitch(v) {
    const el = document.getElementById('osc3-pitch');
    const d = document.getElementById('osc3-pitch-value');
    if (el) { el.value = v; d.textContent = v.toFixed(2) + ' st'; }
  }

  setOsc3Octave(v) {
    const el = document.getElementById('osc3-octave');
    const d = document.getElementById('osc3-octave-value');
    if (el) { el.value = v; d.textContent = v; }
  }

  /* --- filter --- */

  /** Map 0–1000 slider position to 20–20000 Hz (log scale). */
  _sliderToFreq(pos) {
    const minLog = Math.log(20);
    const maxLog = Math.log(20000);
    return Math.exp(minLog + (pos / 1000) * (maxLog - minLog));
  }

  /** Map 20–20000 Hz to 0–1000 slider position. */
  _freqToSlider(hz) {
    const minLog = Math.log(20);
    const maxLog = Math.log(20000);
    return ((Math.log(hz) - minLog) / (maxLog - minLog)) * 1000;
  }

  _formatCutoff(hz) {
    if (hz >= 1000) return (hz / 1000).toFixed(1) + 'k';
    return Math.round(hz) + ' Hz';
  }

  /** Which controls are visible per filter type + model. */
  _filterParamVisibility(type, model) {
    if (model === 'cst') {
      return { q: false, gain: false, model: true, cutoff: false };
    }
    switch (type) {
      case 'lowshelf':
      case 'highshelf':
        return { q: true, gain: true, model: false, cutoff: true };
      case 'lowpass':
        return { q: true, gain: false, model: true, cutoff: true };
      default:            // highpass, bandpass, notch
        return { q: true, gain: false, model: false, cutoff: true };
    }
  }

  _updateFilterVisibility(type, model) {
    const vis = this._filterParamVisibility(type, model);
    const qGroup = document.getElementById('filter-q-group');
    const gainGroup = document.getElementById('filter-gain-group');
    const modelGroup = document.getElementById('filter-model-group');
    const cutoffGroup = document.querySelector('[data-route-target="filter-cutoff"]');
    if (qGroup) qGroup.classList.toggle('hidden', !vis.q);
    if (gainGroup) gainGroup.classList.toggle('hidden', !vis.gain);
    if (modelGroup) modelGroup.classList.toggle('hidden', !vis.model);
    if (cutoffGroup) cutoffGroup.classList.toggle('hidden', !vis.cutoff);
  }

  _bindFilter() {
    // Type buttons
    const btns = document.querySelectorAll('.filter-type-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentFilterType = btn.dataset.ftype;
        this._updateFilterVisibility(this._currentFilterType, this._currentFilterModel);
        this._cb.onFilterTypeChange(btn.dataset.ftype);
      });
    });

    // Cutoff slider (log scale)
    const cutoffSlider = document.getElementById('filter-cutoff');
    const cutoffDisplay = document.getElementById('filter-cutoff-value');
    if (cutoffSlider) {
      cutoffSlider.addEventListener('input', () => {
        const hz = this._sliderToFreq(parseFloat(cutoffSlider.value));
        cutoffDisplay.textContent = this._formatCutoff(hz);
        this._cb.onFilterCutoffChange(hz);
      });
    }

    // Model buttons (lowpass sub-type)
    const modelBtns = document.querySelectorAll('.filter-model-btn');
    modelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modelBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentFilterModel = btn.dataset.model;
        this._updateFilterVisibility(this._currentFilterType, this._currentFilterModel);
        this._cb.onFilterModelChange(btn.dataset.model);
      });
    });

    // Resonance slider
    const qSlider = document.getElementById('filter-q');
    const qDisplay = document.getElementById('filter-q-value');
    if (qSlider) {
      qSlider.addEventListener('input', () => {
        const v = parseFloat(qSlider.value);
        qDisplay.textContent = v.toFixed(2);
        this._cb.onFilterQChange(v);
      });
    }

    // Gain slider (dB) — used by lowshelf, highshelf, peaking
    const gainSlider = document.getElementById('filter-gain');
    const gainDisplay = document.getElementById('filter-gain-value');
    if (gainSlider) {
      gainSlider.addEventListener('input', () => {
        const v = parseFloat(gainSlider.value);
        gainDisplay.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
        this._cb.onFilterGainChange(v);
      });
    }
  }

  setFilterType(type) {
    this._currentFilterType = type;
    document.querySelectorAll('.filter-type-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.ftype === type));
    this._updateFilterVisibility(type, this._currentFilterModel);
  }

  setFilterModel(model) {
    this._currentFilterModel = model;
    document.querySelectorAll('.filter-model-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.model === model));
    this._updateFilterVisibility(this._currentFilterType, model);
  }

  setFilterCutoff(value) {
    const slider = document.getElementById('filter-cutoff');
    const display = document.getElementById('filter-cutoff-value');
    if (!slider) return;
    slider.value = this._freqToSlider(value);
    display.textContent = this._formatCutoff(value);
  }

  setFilterQ(value) {
    const slider = document.getElementById('filter-q');
    const display = document.getElementById('filter-q-value');
    if (!slider) return;
    slider.value = value;
    display.textContent = value.toFixed(2);
  }

  setFilterGain(value) {
    const slider = document.getElementById('filter-gain');
    const display = document.getElementById('filter-gain-value');
    if (!slider) return;
    slider.value = value;
    display.textContent = (value >= 0 ? '+' : '') + parseFloat(value).toFixed(1) + ' dB';
  }

  /* --- ADSR --- */

  _formatADSR(param, value) {
    if (param === 'sustain') return Math.round(value * 100) + '%';
    return value >= 1 ? value.toFixed(2) + 's' : Math.round(value * 1000) + 'ms';
  }

  _bindADSR() {
    ['attack', 'decay', 'sustain', 'release'].forEach(param => {
      const slider = document.getElementById(param);
      const display = document.getElementById(param + '-value');
      this._adsrSliders[param] = slider;
      this._adsrValues[param] = display;

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        display.textContent = this._formatADSR(param, v);
        this._cb.onADSRChange({ [param]: v });
      });
    });
  }

  setADSR(adsr) {
    for (const [param, value] of Object.entries(adsr)) {
      if (this._adsrSliders[param]) {
        this._adsrSliders[param].value = value;
        this._adsrValues[param].textContent = this._formatADSR(param, value);
      }
    }
  }

  /* --- play mode (mono / poly / arp) --- */

  _bindPlayMode() {
    this._modeBtns = document.querySelectorAll('.mode-btn');
    this._modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this._toggleArpPopup(mode === 'arp');
        this._cb.onPlayModeChange(mode);
      });
    });

    // FX popup toggle (independent of play mode)
    const fxBtn = document.getElementById('fx-btn');
    if (fxBtn) {
      fxBtn.addEventListener('click', () => {
        const open = !fxBtn.classList.contains('active');
        fxBtn.classList.toggle('active', open);
        this._toggleFxPopup(open);
      });
    }

    // Drum Machine popup toggle
    const drumBtn = document.getElementById('drum-btn');
    if (drumBtn) {
      drumBtn.addEventListener('click', () => {
        const open = !drumBtn.classList.contains('active');
        drumBtn.classList.toggle('active', open);
        this._toggleDrumPopup(open);
        if (this._cb.onDrumToggle) this._cb.onDrumToggle(open);
      });
    }

    // Step Sequencer popup toggle
    const seqBtn = document.getElementById('seq-btn');
    if (seqBtn) {
      seqBtn.addEventListener('click', () => {
        const open = !seqBtn.classList.contains('active');
        seqBtn.classList.toggle('active', open);
        this._toggleSeqPopup(open);
        if (this._cb.onSeqToggle) this._cb.onSeqToggle(open);
      });
    }
  }

  setPlayMode(mode) {
    if (this._modeBtns) {
      this._modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    }
    this._toggleArpPopup(mode === 'arp');
  }

  _toggleArpPopup(open) {
    if (this._arpPopup) {
      this._arpPopup.classList.toggle('open', open);
    }
  }

  _toggleFxPopup(open) {
    if (this._fxPopup) {
      this._fxPopup.classList.toggle('open', open);
    }
  }

  _toggleDrumPopup(open) {
    if (this._drumPopup) {
      this._drumPopup.classList.toggle('open', open);
    }
  }

  _toggleSeqPopup(open) {
    if (this._seqPopup) {
      this._seqPopup.classList.toggle('open', open);
    }
  }

  /* --- global tempo --- */

  _bindTempo() {
    const display = document.getElementById('tempo-display');
    const upBtn = document.getElementById('tempo-up');
    const downBtn = document.getElementById('tempo-down');
    this._tempoBpm = 120;

    const update = (bpm) => {
      bpm = Math.max(20, Math.min(300, bpm));
      this._tempoBpm = bpm;
      if (display) display.textContent = bpm + ' BPM';
      if (this._cb.onTempoChange) this._cb.onTempoChange(bpm);
    };

    if (upBtn) {
      upBtn.addEventListener('click', () => update(this._tempoBpm + 5));
    }
    if (downBtn) {
      downBtn.addEventListener('click', () => update(this._tempoBpm - 5));
    }

    // Click display to type BPM
    if (display) {
      display.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'tempo-input';
        input.min = 20;
        input.max = 300;
        input.value = this._tempoBpm;
        display.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
          const v = parseInt(input.value);
          input.replaceWith(display);
          if (!isNaN(v)) update(v);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { input.value = this._tempoBpm; input.blur(); }
        });
      });
    }

    // Master volume
    const masterVol = document.getElementById('master-vol');
    if (masterVol) {
      masterVol.addEventListener('input', () => {
        if (this._cb.onMasterVolumeChange) this._cb.onMasterVolumeChange(parseFloat(masterVol.value));
      });
    }
  }

  setTempo(bpm) {
    this._tempoBpm = bpm;
    const display = document.getElementById('tempo-display');
    if (display) display.textContent = bpm + ' BPM';
  }

  setMasterVolume(v) {
    const el = document.getElementById('master-vol');
    if (el) el.value = v;
  }

  /* --- arpeggiator controls --- */

  _bindArpControls() {
    document.querySelectorAll('.arp-div-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-div-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._cb.onArpDivisionChange(btn.dataset.div);
      });
    });

    document.querySelectorAll('.arp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._cb.onArpModeChange(btn.dataset.arpmode);
      });
    });

    const syncBtn = document.getElementById('arp-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        const on = !syncBtn.classList.contains('active');
        syncBtn.classList.toggle('active', on);
        if (this._cb.onArpQuantizeChange) this._cb.onArpQuantizeChange(on);
      });
    }
  }

  setArpSettings({ division, mode, quantize }) {
    document.querySelectorAll('.arp-div-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.div === division));
    document.querySelectorAll('.arp-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.arpmode === mode));
    if (quantize !== undefined) {
      const syncBtn = document.getElementById('arp-sync');
      if (syncBtn) syncBtn.classList.toggle('active', !!quantize);
    }
  }

  /* --- effects (chorus + reverb) --- */

  _bindEffects() {
    // Chorus toggle
    const chorusBtn = document.getElementById('chorus-toggle');
    const chorusParams = document.getElementById('chorus-params');
    if (chorusBtn) {
      chorusBtn.addEventListener('click', () => {
        const on = !chorusBtn.classList.contains('active');
        chorusBtn.classList.toggle('active', on);
        if (chorusParams) chorusParams.classList.toggle('active', on);
        this._cb.onChorusEnabledChange(on);
      });
    }

    // Chorus rate
    const chorusRate = document.getElementById('chorus-rate');
    const chorusRateVal = document.getElementById('chorus-rate-value');
    if (chorusRate) {
      chorusRate.addEventListener('input', () => {
        const v = parseFloat(chorusRate.value);
        chorusRateVal.textContent = v.toFixed(1) + ' Hz';
        this._cb.onChorusRateChange(v);
      });
    }

    // Chorus depth (ms)
    const chorusDepth = document.getElementById('chorus-depth');
    const chorusDepthVal = document.getElementById('chorus-depth-value');
    if (chorusDepth) {
      chorusDepth.addEventListener('input', () => {
        const v = parseFloat(chorusDepth.value);
        chorusDepthVal.textContent = v.toFixed(1) + ' ms';
        this._cb.onChorusDepthChange(v);
      });
    }

    // Chorus width
    const chorusWidth = document.getElementById('chorus-width');
    const chorusWidthVal = document.getElementById('chorus-width-value');
    if (chorusWidth) {
      chorusWidth.addEventListener('input', () => {
        const v = parseFloat(chorusWidth.value);
        chorusWidthVal.textContent = Math.round(v) + '%';
        this._cb.onChorusWidthChange(v);
      });
    }

    // Chorus HPC
    const chorusHpc = document.getElementById('chorus-hpc');
    const chorusHpcVal = document.getElementById('chorus-hpc-value');
    if (chorusHpc) {
      chorusHpc.addEventListener('input', () => {
        const v = parseFloat(chorusHpc.value);
        chorusHpcVal.textContent = Math.round(v) + ' Hz';
        this._cb.onChorusHPCChange(v);
      });
    }

    // Chorus mix
    const chorusMix = document.getElementById('chorus-mix');
    const chorusMixVal = document.getElementById('chorus-mix-value');
    if (chorusMix) {
      chorusMix.addEventListener('input', () => {
        const v = parseFloat(chorusMix.value);
        chorusMixVal.textContent = Math.round(v) + '%';
        this._cb.onChorusMixChange(v);
      });
    }

    // Reverb toggle
    const reverbBtn = document.getElementById('reverb-toggle');
    const reverbParams = document.getElementById('reverb-params');
    if (reverbBtn) {
      reverbBtn.addEventListener('click', () => {
        const on = !reverbBtn.classList.contains('active');
        reverbBtn.classList.toggle('active', on);
        if (reverbParams) reverbParams.classList.toggle('active', on);
        this._cb.onReverbEnabledChange(on);
      });
    }

    // Reverb decay
    const reverbDecay = document.getElementById('reverb-decay');
    const reverbDecayVal = document.getElementById('reverb-decay-value');
    if (reverbDecay) {
      reverbDecay.addEventListener('input', () => {
        const v = parseFloat(reverbDecay.value);
        reverbDecayVal.textContent = v.toFixed(1) + 's';
        this._cb.onReverbDecayChange(v);
      });
    }

    // Reverb mix
    const reverbMix = document.getElementById('reverb-mix');
    const reverbMixVal = document.getElementById('reverb-mix-value');
    if (reverbMix) {
      reverbMix.addEventListener('input', () => {
        const v = parseFloat(reverbMix.value);
        reverbMixVal.textContent = Math.round(v) + '%';
        this._cb.onReverbMixChange(v);
      });
    }
  }

  setChorusEnabled(on) {
    const btn = document.getElementById('chorus-toggle');
    const params = document.getElementById('chorus-params');
    if (btn) btn.classList.toggle('active', on);
    if (params) params.classList.toggle('active', on);
  }

  setChorusRate(value) {
    const s = document.getElementById('chorus-rate');
    const d = document.getElementById('chorus-rate-value');
    if (s) { s.value = value; d.textContent = parseFloat(value).toFixed(1) + ' Hz'; }
  }

  setChorusDepth(value) {
    const s = document.getElementById('chorus-depth');
    const d = document.getElementById('chorus-depth-value');
    if (s) { s.value = value; d.textContent = parseFloat(value).toFixed(1) + ' ms'; }
  }

  setChorusWidth(value) {
    const s = document.getElementById('chorus-width');
    const d = document.getElementById('chorus-width-value');
    if (s) { s.value = value; d.textContent = Math.round(value) + '%'; }
  }

  setChorusHPC(value) {
    const s = document.getElementById('chorus-hpc');
    const d = document.getElementById('chorus-hpc-value');
    if (s) { s.value = value; d.textContent = Math.round(value) + ' Hz'; }
  }

  setChorusMix(value) {
    const s = document.getElementById('chorus-mix');
    const d = document.getElementById('chorus-mix-value');
    if (s) { s.value = value; d.textContent = Math.round(value) + '%'; }
  }

  setReverbEnabled(on) {
    const btn = document.getElementById('reverb-toggle');
    const params = document.getElementById('reverb-params');
    if (btn) btn.classList.toggle('active', on);
    if (params) params.classList.toggle('active', on);
  }

  setReverbDecay(value) {
    const s = document.getElementById('reverb-decay');
    const d = document.getElementById('reverb-decay-value');
    if (s) { s.value = value; d.textContent = parseFloat(value).toFixed(1) + 's'; }
  }

  setReverbMix(value) {
    const s = document.getElementById('reverb-mix');
    const d = document.getElementById('reverb-mix-value');
    if (s) { s.value = value; d.textContent = Math.round(value) + '%'; }
  }

  /* --- LFO controls + drag routing --- */

  _bindLFO() {
    // Waveform buttons
    const waveBtns = document.querySelectorAll('.lfo-wave-btn');
    waveBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        waveBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._cb.onLFOWaveformChange(btn.dataset.lfowave);
      });
    });

    // Rate slider
    const rateSlider = document.getElementById('lfo-rate');
    const rateVal = document.getElementById('lfo-rate-value');
    if (rateSlider) {
      rateSlider.addEventListener('input', () => {
        const v = parseFloat(rateSlider.value);
        rateVal.textContent = v.toFixed(1) + ' Hz';
        this._cb.onLFORateChange(v);
      });
    }

    // Drag routing
    this._initDragRouting();

    // Route list event delegation
    const routeList = document.getElementById('lfo-route-list');
    if (routeList) {
      routeList.addEventListener('input', (e) => {
        if (e.target.classList.contains('lfo-route-amount')) {
          const item = e.target.closest('.lfo-route-item');
          const targetId = item.dataset.target;
          const amount = parseFloat(e.target.value);
          item.querySelector('.lfo-route-amount-val').textContent = amount + '%';
          this._cb.onLFORouteAmountChange(targetId, amount);
        }
      });
      routeList.addEventListener('click', (e) => {
        if (e.target.classList.contains('lfo-route-remove')) {
          const item = e.target.closest('.lfo-route-item');
          this._cb.onLFORouteRemove(item.dataset.target);
        }
      });
    }
  }

  _initDragRouting() {
    const pin = document.getElementById('lfo-route-pin');
    const overlay = document.getElementById('lfo-drag-overlay');
    const line = document.getElementById('lfo-drag-line');
    if (!pin || !overlay || !line) return;

    let dragging = false;
    let pinRect;

    const startDrag = (clientX, clientY) => {
      dragging = true;
      pinRect = pin.getBoundingClientRect();
      overlay.classList.add('active');
      document.querySelectorAll('[data-route-target]').forEach(el => {
        el.classList.add('lfo-drop-target');
      });
    };

    const moveDrag = (clientX, clientY) => {
      if (!dragging) return;
      const sx = pinRect.left + pinRect.width / 2;
      const sy = pinRect.top + pinRect.height / 2;
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', clientX);
      line.setAttribute('y2', clientY);
    };

    const endDrag = (clientX, clientY) => {
      if (!dragging) return;
      dragging = false;
      overlay.classList.remove('active');
      document.querySelectorAll('[data-route-target]').forEach(el => {
        el.classList.remove('lfo-drop-target');
      });
      line.setAttribute('x1', 0);
      line.setAttribute('y1', 0);
      line.setAttribute('x2', 0);
      line.setAttribute('y2', 0);

      // Find target under cursor
      const el = document.elementFromPoint(clientX, clientY);
      const routeEl = el ? el.closest('[data-route-target]') : null;
      if (routeEl) {
        this._cb.onLFORouteAdd(routeEl.dataset.routeTarget);
      }
    };

    // Mouse events
    pin.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
      moveDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', (e) => {
      endDrag(e.clientX, e.clientY);
    });

    // Touch events
    pin.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const t = e.touches[0];
      moveDrag(t.clientX, t.clientY);
    });
    document.addEventListener('touchend', (e) => {
      if (!dragging) return;
      const t = e.changedTouches[0];
      endDrag(t.clientX, t.clientY);
    });
  }

  setLFOWaveform(type) {
    document.querySelectorAll('.lfo-wave-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.lfowave === type));
  }

  setLFORate(value) {
    const s = document.getElementById('lfo-rate');
    const d = document.getElementById('lfo-rate-value');
    if (s) { s.value = value; d.textContent = parseFloat(value).toFixed(1) + ' Hz'; }
  }

  /** Rebuild the route list UI from route data. */
  renderLFORoutes(routes, targets) {
    const list = document.getElementById('lfo-route-list');
    if (!list) return;
    list.innerHTML = '';
    for (const route of routes) {
      const target = targets[route.targetId];
      if (!target) continue;
      const item = document.createElement('div');
      item.className = 'lfo-route-item';
      item.dataset.target = route.targetId;
      item.innerHTML =
        '<span class="lfo-route-name">' + target.label + '</span>' +
        '<input type="range" class="lfo-route-amount" min="-100" max="100" value="' + route.amount + '" />' +
        '<span class="lfo-route-amount-val">' + route.amount + '%</span>' +
        '<button class="lfo-route-remove">x</button>';
      list.appendChild(item);
    }
  }

  /** Update the visual route indicators on target parameter elements. */
  updateLFORouteIndicators(routes) {
    document.querySelectorAll('[data-route-target].lfo-routed').forEach(el => {
      el.classList.remove('lfo-routed');
    });
    for (const route of routes) {
      const el = document.querySelector('[data-route-target="' + route.targetId + '"]');
      if (el) el.classList.add('lfo-routed');
    }
  }

  /* --- note display --- */

  showNote(noteName) {
    this._noteDisplay.textContent = noteName;
    this._noteDisplay.classList.add('active');
  }

  clearNote() {
    this._noteDisplay.classList.remove('active');
  }

  /* --- on-screen piano --- */

  _buildPianoVisual() {
    const container = document.getElementById('piano');
    if (!container) return;

    const entries = Object.entries(KEY_TO_MIDI)
      .map(([key, midi]) => ({ key, midi, name: midiToName(midi) }))
      .sort((a, b) => a.midi - b.midi);

    const seen = new Set();
    const unique = entries.filter(e => {
      if (seen.has(e.midi)) return false;
      seen.add(e.midi);
      return true;
    });

    unique.forEach(({ key, midi, name }) => {
      const el = document.createElement('div');
      const isBlack = name.includes('#');
      el.className = 'piano-key' + (isBlack ? ' black' : ' white');
      el.dataset.midi = midi;
      el.innerHTML = `<span class="key-label">${key.toUpperCase()}</span><span class="note-label">${name}</span>`;
      container.appendChild(el);
    });

    this._pianoKeys = container.querySelectorAll('.piano-key');
    this._bindPianoClicks();
  }

  _bindPianoClicks() {
    const triggerOn = (el) => {
      const midi = parseInt(el.dataset.midi);
      this._activeTouchMidi = midi;
      const name = midiToName(midi);
      this._cb.onNoteOn(midiToFreq(midi), midi, name);
    };
    const triggerOff = () => {
      if (this._activeTouchMidi == null) return;
      this._cb.onNoteOff(this._activeTouchMidi);
      this._activeTouchMidi = null;
    };

    this._pianoKeys.forEach(el => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); triggerOn(el); });
      el.addEventListener('touchstart', (e) => { e.preventDefault(); triggerOn(el); }, { passive: false });
    });
    window.addEventListener('mouseup', triggerOff);
    window.addEventListener('touchend', triggerOff);
  }

  highlightKey(midi) {
    if (!this._pianoKeys) return;
    this._pianoKeys.forEach(k => {
      if (parseInt(k.dataset.midi) === midi) k.classList.add('pressed');
    });
  }

  releaseKey(midi) {
    if (!this._pianoKeys) return;
    this._pianoKeys.forEach(k => {
      if (parseInt(k.dataset.midi) === midi) k.classList.remove('pressed');
    });
  }

  releaseAllKeys() {
    if (!this._pianoKeys) return;
    this._pianoKeys.forEach(k => k.classList.remove('pressed'));
  }
}
