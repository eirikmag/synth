/**
 * Audio engine — manages the Web Audio graph.
 *
 * Signal chain per voice:  Oscillator → envGain (ADSR) → masterGain → analyser → destination
 * Supports mono and poly modes via a voice map keyed by MIDI note.
 */

const WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._analyser = null;
    this._voices = new Map();   // midi → { osc, envGain }
    this._waveform = 'sawtooth';
    this._volume = 0.5;

    this._attack = 0.01;
    this._decay = 0.1;
    this._sustain = 0.7;
    this._release = 0.3;
  }

  /* --- lazy AudioContext --- */

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._volume;

    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 2048;

    this._masterGain.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);
  }

  get analyser() { this._ensureContext(); return this._analyser; }
  get context()  { this._ensureContext(); return this._ctx; }
  get waveforms() { return WAVEFORMS; }

  /* --- parameters --- */

  setWaveform(type) {
    if (!WAVEFORMS.includes(type)) return;
    this._waveform = type;
    for (const v of this._voices.values()) v.osc.type = type;
  }
  getWaveform() { return this._waveform; }

  setVolume(value) {
    this._volume = Math.max(0, Math.min(1, value));
    if (this._masterGain) {
      this._masterGain.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.01);
    }
  }
  getVolume() { return this._volume; }

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

  /**
   * Start a voice for the given MIDI note.
   * If a voice for this note already exists it is replaced.
   */
  noteOn(frequency, midi) {
    this._ensureContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();

    // Kill existing voice on same note
    if (this._voices.has(midi)) this._killVoice(midi);

    const now = this._ctx.currentTime;

    const envGain = this._ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(1, now + this._attack);
    envGain.gain.linearRampToValueAtTime(this._sustain, now + this._attack + this._decay);

    const osc = this._ctx.createOscillator();
    osc.type = this._waveform;
    osc.frequency.setValueAtTime(frequency, now);
    osc.connect(envGain);
    envGain.connect(this._masterGain);
    osc.start();

    this._voices.set(midi, { osc, envGain });
  }

  /**
   * Release the voice for a given MIDI note (applies release envelope).
   */
  noteOff(midi) {
    const voice = this._voices.get(midi);
    if (!voice) return;

    const now = this._ctx.currentTime;
    const { osc, envGain } = voice;

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + this._release);

    osc.stop(now + this._release + 0.01);
    osc.onended = () => { osc.disconnect(); envGain.disconnect(); };

    this._voices.delete(midi);
  }

  /** Hard-kill all active voices immediately. */
  allNotesOff() {
    for (const midi of [...this._voices.keys()]) {
      this._killVoice(midi);
    }
  }

  get activeVoiceCount() {
    return this._voices.size;
  }

  /* --- internal --- */

  _killVoice(midi) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    try { voice.osc.stop(); voice.osc.disconnect(); } catch {}
    try { voice.envGain.disconnect(); } catch {}
    this._voices.delete(midi);
  }
}
