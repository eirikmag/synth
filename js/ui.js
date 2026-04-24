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
  }

  init() {
    this._noteDisplay = document.getElementById('note-display');
    this._arpPopup = document.getElementById('arp-popup');

    this._bindOscWaveforms();
    this._bindOscVolumes();
    this._bindOscShapes();
    this._bindOscPitches();
    this._bindOscOctaves();
    this._bindFilter();
    this._bindADSR();
    this._bindPlayMode();
    this._bindArpControls();
    this._bindEffects();
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

  /** Which controls are visible per filter type. */
  _filterParamVisibility(type) {
    switch (type) {
      case 'lowshelf':
      case 'highshelf':
        return { q: true, gain: true, model: false };
      case 'lowpass':
        return { q: true, gain: false, model: true };
      default:            // highpass, bandpass, notch
        return { q: true, gain: false, model: false };
    }
  }

  _updateFilterVisibility(type) {
    const vis = this._filterParamVisibility(type);
    const qGroup = document.getElementById('filter-q-group');
    const gainGroup = document.getElementById('filter-gain-group');
    const modelGroup = document.getElementById('filter-model-group');
    if (qGroup) qGroup.classList.toggle('hidden', !vis.q);
    if (gainGroup) gainGroup.classList.toggle('hidden', !vis.gain);
    if (modelGroup) modelGroup.classList.toggle('hidden', !vis.model);
  }

  _bindFilter() {
    // Type buttons
    const btns = document.querySelectorAll('.filter-type-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._updateFilterVisibility(btn.dataset.ftype);
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
    document.querySelectorAll('.filter-type-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.ftype === type));
    this._updateFilterVisibility(type);
  }

  setFilterModel(model) {
    document.querySelectorAll('.filter-model-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.model === model));
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

  /* --- arpeggiator controls --- */

  _bindArpControls() {
    const bpmSlider = document.getElementById('arp-bpm');
    const bpmValue = document.getElementById('arp-bpm-value');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', () => {
        const v = parseInt(bpmSlider.value);
        bpmValue.textContent = v;
        this._cb.onArpBPMChange(v);
      });
    }

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
  }

  setArpSettings({ bpm, division, mode }) {
    const bpmSlider = document.getElementById('arp-bpm');
    const bpmValue = document.getElementById('arp-bpm-value');
    if (bpmSlider) { bpmSlider.value = bpm; bpmValue.textContent = bpm; }

    document.querySelectorAll('.arp-div-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.div === division));
    document.querySelectorAll('.arp-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.arpmode === mode));
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

    // Chorus depth
    const chorusDepth = document.getElementById('chorus-depth');
    const chorusDepthVal = document.getElementById('chorus-depth-value');
    if (chorusDepth) {
      chorusDepth.addEventListener('input', () => {
        const v = parseFloat(chorusDepth.value);
        chorusDepthVal.textContent = Math.round(v) + '%';
        this._cb.onChorusDepthChange(v);
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
    if (s) { s.value = value; d.textContent = Math.round(value) + '%'; }
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
