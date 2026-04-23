/**
 * UI module — binds DOM controls to engine parameters and shows visual feedback.
 */

import { KEY_TO_MIDI, midiToFreq, midiToName } from './keyboard.js';

export class UIManager {
  /**
   * @param {object} callbacks
   * @param {function(waveform: string)} callbacks.onWaveformChange
   * @param {function(volume: number)}   callbacks.onVolumeChange
   * @param {function(object)} callbacks.onADSRChange
   * @param {function(frequency: number, midi: number, noteName: string)} callbacks.onNoteOn
   * @param {function(midi: number)} callbacks.onNoteOff
   */
  constructor(callbacks) {
    this._callbacks = callbacks;
    this._activeTouchMidi = null;

    // DOM references (resolved in init)
    this._waveformBtns = null;
    this._modeBtns = null;
    this._volumeSlider = null;
    this._volumeValue = null;
    this._noteDisplay = null;
    this._pianoKeys = null;
    this._adsrSliders = {};
    this._adsrValues = {};
    this._arpSection = null;
  }

  init() {
    this._waveformBtns = document.querySelectorAll('.waveform-btn');
    this._modeBtns = document.querySelectorAll('.mode-btn');
    this._volumeSlider = document.getElementById('volume');
    this._volumeValue = document.getElementById('volume-value');
    this._noteDisplay = document.getElementById('note-display');
    this._arpSection = document.getElementById('arp-section');

    this._bindWaveformButtons();
    this._bindVolumeSlider();
    this._bindADSR();
    this._bindPlayMode();
    this._bindArpControls();
    this._buildPianoVisual();
  }

  /* --- waveform selector --- */

  _bindWaveformButtons() {
    this._waveformBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._waveformBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._callbacks.onWaveformChange(btn.dataset.waveform);
      });
    });
  }

  setActiveWaveform(type) {
    this._waveformBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.waveform === type);
    });
  }

  /* --- volume slider --- */

  _bindVolumeSlider() {
    this._volumeSlider.addEventListener('input', () => {
      const v = parseFloat(this._volumeSlider.value);
      this._volumeValue.textContent = Math.round(v * 100) + '%';
      this._callbacks.onVolumeChange(v);
    });
  }

  setVolume(value) {
    this._volumeSlider.value = value;
    this._volumeValue.textContent = Math.round(value * 100) + '%';
  }

  /* --- ADSR sliders --- */

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
        this._callbacks.onADSRChange({ [param]: v });
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
    this._modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this._toggleArpSection(mode === 'arp');
        this._callbacks.onPlayModeChange(mode);
      });
    });
  }

  setPlayMode(mode) {
    this._modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    this._toggleArpSection(mode === 'arp');
  }

  _toggleArpSection(enabled) {
    if (this._arpSection) {
      this._arpSection.classList.toggle('disabled', !enabled);
    }
  }

  /* --- arpeggiator controls --- */

  _bindArpControls() {
    // BPM slider
    const bpmSlider = document.getElementById('arp-bpm');
    const bpmValue = document.getElementById('arp-bpm-value');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', () => {
        const v = parseInt(bpmSlider.value);
        bpmValue.textContent = v;
        this._callbacks.onArpBPMChange(v);
      });
    }

    // Division buttons
    document.querySelectorAll('.arp-div-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-div-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._callbacks.onArpDivisionChange(btn.dataset.div);
      });
    });

    // Mode buttons (up/down/random)
    document.querySelectorAll('.arp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.arp-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._callbacks.onArpModeChange(btn.dataset.arpmode);
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

    // Collect and sort all mapped MIDI notes
    const entries = Object.entries(KEY_TO_MIDI)
      .map(([key, midi]) => ({ key, midi, name: midiToName(midi) }))
      .sort((a, b) => a.midi - b.midi);

    // Remove duplicates (same midi from different keys — shouldn't happen but safety)
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
      this._callbacks.onNoteOn(midiToFreq(midi), midi, name);
    };
    const triggerOff = () => {
      if (this._activeTouchMidi == null) return;
      this._callbacks.onNoteOff(this._activeTouchMidi);
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
