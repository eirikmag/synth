/**
 * Arpeggiator -- cycles through held notes at a tempo-synced rate.
 *
 * Modes: up, down, random
 * Controlled by BPM and time division (1/4, 1/8, 1/16, 1/32).
 *
 * Quantize (SYNC):
 *   When enabled, the arp uses a precise AudioContext-time grid scheduler
 *   (look-ahead pattern, like the drum machine) so that every note lands
 *   exactly on a beat-grid boundary. This keeps the arp perfectly locked
 *   to the drum sequencer.
 *
 *   When disabled, the arp uses simple setInterval (lower CPU, but drifts
 *   slightly over time and is not beat-locked).
 */

import { midiToFreq, midiToName } from './keyboard.js';

const ARP_MODES = ['up', 'down', 'random'];
const DIVISIONS = ['1/4', '1/8', '1/16', '1/32'];

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
   * @param {function(): AudioContext} [callbacks.getAudioContext] - needed for quantize mode
   */
  constructor(callbacks) {
    this._cb = callbacks;
    this._heldNotes = [];
    this._mode = 'up';
    this._bpm = 120;
    this._division = '1/8';
    this._running = false;
    this._stepIndex = 0;
    this._lastPlayedMidi = null;

    // Free-run timer (non-quantized)
    this._intervalId = null;

    // Quantize / grid-locked scheduler
    this._quantize = false;
    this._gridOrigin = 0;
    this._nextStepTime = 0;
    this._timerId = null;
  }

  /* -- config -- */

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

  setQuantize(on) {
    const changed = this._quantize !== !!on;
    this._quantize = !!on;
    if (changed && this._running) this._restart();
  }
  getQuantize() { return this._quantize; }

  /* -- note hold tracking -- */

  addNote(midi) {
    if (this._heldNotes.includes(midi)) return;
    this._heldNotes.push(midi);
    this._heldNotes.sort((a, b) => a - b);

    if (this._running && this._heldNotes.length === 1) {
      this._stepIndex = 0;
      if (!this._quantize) this._tick();
    }
    if (!this._running && this._heldNotes.length >= 1) {
      this.start();
    }
  }

  removeNote(midi) {
    const idx = this._heldNotes.indexOf(midi);
    if (idx === -1) return;
    this._heldNotes.splice(idx, 1);
    if (this._lastPlayedMidi === midi) {
      this._cb.onNoteOff(midi);
      this._lastPlayedMidi = null;
    }
    if (this._heldNotes.length === 0) {
      this.stop();
    }
  }

  /* -- transport -- */

  start() {
    if (this._running) return;
    this._running = true;
    this._stepIndex = 0;

    if (this._quantize && this._cb.getAudioContext) {
      this._startQuantized();
    } else {
      this._startFreeRun();
    }
  }

  stop() {
    this._running = false;
    this._stopTimers();
    if (this._lastPlayedMidi != null) {
      this._cb.onNoteOff(this._lastPlayedMidi);
      this._lastPlayedMidi = null;
    }
  }

  reset() {
    this._heldNotes = [];
    this.stop();
  }

  /* -- internal: free-run (non-quantized) -- */

  _startFreeRun() {
    this._intervalId = setInterval(() => this._tick(), this._getIntervalMs());
    this._tick();
  }

  _getIntervalMs() {
    return (60000 / this._bpm) * DIV_TO_BEATS[this._division];
  }

  /* -- internal: quantized (grid-locked) -- */

  _startQuantized() {
    const ctx = this._cb.getAudioContext();
    if (!ctx) { this._startFreeRun(); return; }

    // Snap grid origin to now
    const stepSec = this._getStepSec();
    const now = ctx.currentTime;
    this._gridOrigin = now;
    this._nextStepTime = now;
    this._scheduleGrid();
  }

  _getStepSec() {
    return (60 / this._bpm) * DIV_TO_BEATS[this._division];
  }

  _scheduleGrid() {
    if (!this._running) return;
    const ctx = this._cb.getAudioContext();
    if (!ctx) return;

    const lookAhead = 0.1;
    const interval = 25;

    while (this._nextStepTime < ctx.currentTime + lookAhead) {
      // Schedule the tick at the precise grid time via a short setTimeout
      const delay = Math.max(0, (this._nextStepTime - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (this._running) this._tick();
      }, delay);
      this._nextStepTime += this._getStepSec();
    }

    this._timerId = setTimeout(() => this._scheduleGrid(), interval);
  }

  /* -- shared -- */

  _restart() {
    if (!this._running) return;
    this._stopTimers();
    if (this._quantize && this._cb.getAudioContext) {
      this._startQuantized();
    } else {
      this._intervalId = setInterval(() => this._tick(), this._getIntervalMs());
    }
  }

  _stopTimers() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _tick() {
    if (this._heldNotes.length === 0) return;

    if (this._lastPlayedMidi != null) {
      this._cb.onNoteOff(this._lastPlayedMidi);
    }

    let midi;
    switch (this._mode) {
      case 'down':
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