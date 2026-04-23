/**
 * Arpeggiator — cycles through held notes at a tempo-synced rate.
 *
 * Modes: up, down, random
 * Controlled by BPM and time division (1/4, 1/8, 1/16, 1/32).
 */

import { midiToFreq, midiToName } from './keyboard.js';

const ARP_MODES = ['up', 'down', 'random'];
const DIVISIONS = ['1/4', '1/8', '1/16', '1/32'];

// Division → beats multiplier (quarter note = 1 beat)
const DIV_TO_BEATS = {
  '1/4':  1,
  '1/8':  0.5,
  '1/16': 0.25,
  '1/32': 0.125,
};

export { ARP_MODES, DIVISIONS };

export class Arpeggiator {
  /**
   * @param {object} callbacks
   * @param {function(freq, midi, name)} callbacks.onNoteOn
   * @param {function(midi)} callbacks.onNoteOff
   */
  constructor(callbacks) {
    this._cb = callbacks;
    this._heldNotes = [];       // sorted MIDI note numbers currently held
    this._mode = 'up';
    this._bpm = 120;
    this._division = '1/8';
    this._running = false;
    this._intervalId = null;
    this._stepIndex = 0;
    this._lastPlayedMidi = null;
  }

  /* --- config --- */

  get modes() { return ARP_MODES; }
  get divisions() { return DIVISIONS; }

  setMode(mode) {
    if (ARP_MODES.includes(mode)) this._mode = mode;
  }
  getMode() { return this._mode; }

  setBPM(bpm) {
    this._bpm = Math.max(20, Math.min(300, bpm));
    if (this._running) this._restart();
  }
  getBPM() { return this._bpm; }

  setDivision(div) {
    if (div in DIV_TO_BEATS) this._division = div;
    if (this._running) this._restart();
  }
  getDivision() { return this._division; }

  /* --- note hold tracking --- */

  addNote(midi) {
    if (this._heldNotes.includes(midi)) return;
    this._heldNotes.push(midi);
    this._heldNotes.sort((a, b) => a - b);
    // Start the clock on first note
    if (this._running && this._heldNotes.length === 1) {
      this._stepIndex = 0;
      this._tick();  // play immediately
    }
    if (!this._running && this._heldNotes.length >= 1) {
      this.start();
    }
  }

  removeNote(midi) {
    const idx = this._heldNotes.indexOf(midi);
    if (idx === -1) return;
    this._heldNotes.splice(idx, 1);
    // If the removed note is currently sounding, stop it
    if (this._lastPlayedMidi === midi) {
      this._cb.onNoteOff(midi);
      this._lastPlayedMidi = null;
    }
    if (this._heldNotes.length === 0) {
      this.stop();
    }
  }

  /* --- transport --- */

  start() {
    if (this._running) return;
    this._running = true;
    this._stepIndex = 0;
    this._scheduleNext();
    this._tick(); // play first note immediately
  }

  stop() {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    if (this._lastPlayedMidi != null) {
      this._cb.onNoteOff(this._lastPlayedMidi);
      this._lastPlayedMidi = null;
    }
  }

  /** Clear all held notes and stop. */
  reset() {
    this._heldNotes = [];
    this.stop();
  }

  /* --- internal --- */

  _getIntervalMs() {
    const beatsPerStep = DIV_TO_BEATS[this._division];
    const msPerBeat = 60000 / this._bpm;
    return msPerBeat * beatsPerStep;
  }

  _restart() {
    if (!this._running) return;
    clearInterval(this._intervalId);
    this._scheduleNext();
  }

  _scheduleNext() {
    this._intervalId = setInterval(() => this._tick(), this._getIntervalMs());
  }

  _tick() {
    if (this._heldNotes.length === 0) return;

    // Release previous note
    if (this._lastPlayedMidi != null) {
      this._cb.onNoteOff(this._lastPlayedMidi);
    }

    // Pick next note
    let midi;
    switch (this._mode) {
      case 'down':
        // Reverse order
        this._stepIndex = this._stepIndex % this._heldNotes.length;
        midi = this._heldNotes[this._heldNotes.length - 1 - this._stepIndex];
        this._stepIndex++;
        break;
      case 'random':
        midi = this._heldNotes[Math.floor(Math.random() * this._heldNotes.length)];
        break;
      case 'up':
      default:
        this._stepIndex = this._stepIndex % this._heldNotes.length;
        midi = this._heldNotes[this._stepIndex];
        this._stepIndex++;
        break;
    }

    this._lastPlayedMidi = midi;
    this._cb.onNoteOn(midiToFreq(midi), midi, midiToName(midi));
  }
}
