/**
 * Audio engine — manages the Web Audio graph.
 *
 * Current signal chain:  Oscillator → GainNode (master) → destination
 * Designed so filter, envelope, and effects nodes can be inserted later.
 */

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];

export class AudioEngine {
  constructor() {
    this._ctx = null;          // created on first user gesture
    this._masterGain = null;
    this._analyser = null;     // for oscilloscope visualization
    this._osc = null;          // active oscillator (monophonic for now)
    this._waveform = 'sawtooth';
    this._volume = 0.5;
  }

  /* --- lazy AudioContext (browsers require a user gesture) --- */

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._volume;

    // Analyser for oscilloscope visualization
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;

    this._masterGain.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);
  }

  get analyser() {
    this._ensureContext();
    return this._analyser;
  }

  get context() {
    this._ensureContext();
    return this._ctx;
  }

  /* --- public API --- */

  get waveforms() {
    return WAVEFORMS;
  }

  setWaveform(type) {
    if (!WAVEFORMS.includes(type)) return;
    this._waveform = type;
    if (this._osc) this._osc.type = type;
  }

  getWaveform() {
    return this._waveform;
  }

  setVolume(value) {
    this._volume = Math.max(0, Math.min(1, value));
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.01);
    }
  }

  getVolume() {
    return this._volume;
  }

  /**
   * Start a note at the given frequency.
   * Returns a voice id (for future polyphony support).
   */
  noteOn(frequency) {
    this._ensureContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();

    // Monophonic: stop previous note instantly
    this._stopOsc();

    const osc = this._ctx.createOscillator();
    osc.type = this._waveform;
    osc.frequency.setValueAtTime(frequency, this._ctx.currentTime);

    // Connect through the signal chain
    // (future: osc → filter → envelope → master)
    osc.connect(this._masterGain);
    osc.start();

    this._osc = osc;
    return 0; // voice id placeholder
  }

  noteOff(_voiceId) {
    this._stopOsc();
  }

  /* --- internal --- */

  _stopOsc() {
    if (!this._osc) return;
    try {
      this._osc.stop();
      this._osc.disconnect();
    } catch { /* already stopped */ }
    this._osc = null;
  }
}
