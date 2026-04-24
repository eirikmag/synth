/**
 * Step Sequencer -- multi-row 16-step note sequencer for the synth.
 *
 * Each row is an independent note line with its own notes/gates/glides/mute/volume.
 * Uses the same look-ahead scheduler pattern as the drum machine.
 *
 * Callbacks:
 *   onNoteOn(freq, midi, name)  -- trigger synth note
 *   onNoteOff(midi)             -- release synth note
 *   onStep(stepIndex)           -- UI highlight
 *   onRecordStep(rowIdx, stepIdx) -- UI update after recording
 */

import { midiToFreq, midiToName } from './keyboard.js';

const NUM_STEPS = 16;
const DEFAULT_NOTE = 60; // C4
const MAX_ROWS = 8;

function makeRow(defaultNote) {
  return {
    notes:  new Array(NUM_STEPS).fill(defaultNote || DEFAULT_NOTE),
    gates:  new Array(NUM_STEPS).fill(0),
    vels:   new Array(NUM_STEPS).fill(1),
    glides: new Array(NUM_STEPS).fill(0),
    muted:  false,
    volume: 1.0,
    lastPlayedMidi: null,
  };
}

/* -- Preset sequences -- */

const SEQ_PRESETS = {
  'arpUp': {
    label: 'ARP',
    rows: [{
      notes:   [60,62,64,65, 67,69,71,72, 72,71,69,67, 65,64,62,60],
      gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      vels:    [1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8],
      glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    }],
  },
  'bass1': {
    label: 'BASS',
    rows: [{
      notes:   [36,36,0,36, 38,0,36,0, 36,36,0,41, 38,0,36,0],
      gates:   [1,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0],
      vels:    [1,0.7,0,0.8, 0.9,0,0.7,0, 1,0.7,0,0.8, 0.9,0,0.7,0],
      glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    }],
  },
  'acid': {
    label: 'ACID',
    rows: [{
      notes:   [36,36,48,36, 39,36,48,39, 36,36,48,36, 41,39,36,48],
      gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      vels:    [1,0.6,0.9,0.5, 0.8,0.6,1,0.7, 1,0.6,0.9,0.5, 0.8,0.7,0.6,1],
      glides:  [0,1,0,1, 0,1,0,0, 0,1,0,1, 0,0,1,0],
    }],
  },
  'melody': {
    label: 'MEL',
    rows: [{
      notes:   [60,64,67,72, 71,67,64,60, 62,65,69,74, 72,69,65,62],
      gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      vels:    [1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8, 1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8],
      glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    }],
  },
};

export const SEQ_PRESET_NAMES = Object.keys(SEQ_PRESETS);

export class StepSequencer {
  constructor() {
    this._bpm = 120;
    this._swing = 0;
    this._playing = false;
    this._currentStep = -1;
    this._nextStepTime = 0;
    this._timerID = null;

    // Multi-row state
    this._rows = [makeRow(DEFAULT_NOTE)];
    this._recRow = 0; // row that receives recorded notes

    // Recording
    this._recording = false;

    // Callbacks
    this._onNoteOn = null;
    this._onNoteOff = null;
    this._onStep = null;
    this._onRecordStep = null;

    // AudioContext provider
    this._getCtx = null;
  }

  init(getAudioContext) {
    this._getCtx = getAudioContext;
  }

  /* -- getters / setters -- */

  get playing() { return this._playing; }
  get currentStep() { return this._currentStep; }
  get numSteps() { return NUM_STEPS; }
  get numRows() { return this._rows.length; }
  get maxRows() { return MAX_ROWS; }
  get recRow() { return this._recRow; }

  set onNoteOn(fn) { this._onNoteOn = fn; }
  set onNoteOff(fn) { this._onNoteOff = fn; }
  set onStep(fn) { this._onStep = fn; }
  set onRecordStep(fn) { this._onRecordStep = fn; }

  get recording() { return this._recording; }
  setRecording(on) { this._recording = !!on; }

  /* -- row management -- */

  addRow() {
    if (this._rows.length >= MAX_ROWS) return -1;
    this._rows.push(makeRow(DEFAULT_NOTE));
    return this._rows.length - 1;
  }

  removeRow(r) {
    if (this._rows.length <= 1 || r < 0 || r >= this._rows.length) return;
    // Release any sounding note on this row
    const row = this._rows[r];
    if (row.lastPlayedMidi != null && this._onNoteOff) {
      this._onNoteOff(row.lastPlayedMidi);
    }
    this._rows.splice(r, 1);
    if (this._recRow >= this._rows.length) this._recRow = this._rows.length - 1;
  }

  setRecRow(r) {
    if (r >= 0 && r < this._rows.length) this._recRow = r;
  }

  /* -- per-row mute/volume -- */

  getRowMuted(r)      { return this._rows[r] ? this._rows[r].muted : false; }
  setRowMuted(r, on)  { if (this._rows[r]) this._rows[r].muted = !!on; }
  toggleRowMute(r)    { if (this._rows[r]) { this._rows[r].muted = !this._rows[r].muted; return this._rows[r].muted; } return false; }

  getRowVolume(r)     { return this._rows[r] ? this._rows[r].volume : 1; }
  setRowVolume(r, v)  { if (this._rows[r]) this._rows[r].volume = Math.max(0, Math.min(1, v)); }

  /* -- recording -- */

  recordNote(midi) {
    if (!this._playing || this._currentStep < 0) return;
    const r = this._recRow;
    const s = this._currentStep;
    const row = this._rows[r];
    if (!row) return;
    row.notes[s] = Math.max(0, Math.min(127, midi));
    row.gates[s] = 1;
    if (this._onRecordStep) this._onRecordStep(r, s);
  }

  setBPM(bpm) { this._bpm = Math.max(40, Math.min(300, bpm)); }
  setSwing(amount) { this._swing = Math.max(0, Math.min(0.7, amount)); }

  /* -- step data (row-aware) -- */

  getStepNote(r, i)  { return this._rows[r] ? this._rows[r].notes[i]  : DEFAULT_NOTE; }
  getStepGate(r, i)  { return this._rows[r] ? this._rows[r].gates[i]  : 0; }
  getStepVel(r, i)   { return this._rows[r] ? this._rows[r].vels[i]   : 1; }
  getStepGlide(r, i) { return this._rows[r] ? this._rows[r].glides[i] : 0; }

  setStepNote(r, i, midi) { if (this._rows[r]) this._rows[r].notes[i] = Math.max(0, Math.min(127, midi)); }
  setStepVel(r, i, v)     { if (this._rows[r]) this._rows[r].vels[i] = Math.max(0, Math.min(1, v)); }
  setStepGlide(r, i, on)  { if (this._rows[r]) this._rows[r].glides[i] = on ? 1 : 0; }

  toggleGate(r, i) {
    if (!this._rows[r]) return 0;
    this._rows[r].gates[i] = this._rows[r].gates[i] ? 0 : 1;
    return this._rows[r].gates[i];
  }

  setGate(r, i, on) {
    if (this._rows[r]) this._rows[r].gates[i] = on ? 1 : 0;
  }

  clearPattern() {
    this._rows.forEach(row => {
      row.notes.fill(DEFAULT_NOTE);
      row.gates.fill(0);
      row.vels.fill(1);
      row.glides.fill(0);
    });
  }

  clearRow(r) {
    const row = this._rows[r];
    if (!row) return;
    row.notes.fill(DEFAULT_NOTE);
    row.gates.fill(0);
    row.vels.fill(1);
    row.glides.fill(0);
  }

  loadPreset(name) {
    const p = SEQ_PRESETS[name];
    if (!p) return;
    // Reset to the number of rows in the preset
    while (this._rows.length > p.rows.length && this._rows.length > 1) {
      const removed = this._rows.pop();
      if (removed.lastPlayedMidi != null && this._onNoteOff) {
        this._onNoteOff(removed.lastPlayedMidi);
      }
    }
    while (this._rows.length < p.rows.length) {
      this._rows.push(makeRow(DEFAULT_NOTE));
    }
    p.rows.forEach((pr, r) => {
      const row = this._rows[r];
      for (let i = 0; i < NUM_STEPS; i++) {
        row.notes[i]  = pr.notes[i]  !== undefined ? pr.notes[i]  : DEFAULT_NOTE;
        row.gates[i]  = pr.gates[i]  !== undefined ? pr.gates[i]  : 0;
        row.vels[i]   = pr.vels[i]   !== undefined ? pr.vels[i]   : 1;
        row.glides[i] = pr.glides[i] !== undefined ? pr.glides[i] : 0;
      }
      row.muted = false;
      row.volume = 1.0;
    });
    if (this._recRow >= this._rows.length) this._recRow = 0;
  }

  getPresetNames() { return SEQ_PRESET_NAMES; }
  getPresetLabel(name) { return SEQ_PRESETS[name] ? SEQ_PRESETS[name].label : name; }

  /* -- transport -- */

  start() {
    if (this._playing) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._playing = true;
    this._currentStep = -1;
    this._nextStepTime = ctx.currentTime + 0.05;
    this._schedule();
  }

  startAt(nextStepTime, currentStep) {
    if (this._playing) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._playing = true;
    this._currentStep = currentStep;
    this._nextStepTime = nextStepTime;
    this._schedule();
  }

  getScheduleState() {
    return { nextStepTime: this._nextStepTime, currentStep: this._currentStep };
  }

  stop() {
    this._playing = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    // Release any sounding notes on all rows
    this._rows.forEach(row => {
      if (row.lastPlayedMidi != null && this._onNoteOff) {
        this._onNoteOff(row.lastPlayedMidi);
        row.lastPlayedMidi = null;
      }
    });
    this._currentStep = -1;
    if (this._onStep) this._onStep(-1);
  }

  /* -- scheduler -- */

  _stepDuration(stepIndex) {
    const base = (60 / this._bpm) / 4;
    if (stepIndex % 2 === 1) {
      return base * (1 - this._swing);
    }
    return base * (1 + this._swing);
  }

  _schedule() {
    if (!this._playing) return;
    const ctx = this._getCtx();
    if (!ctx) return;

    const lookAhead = 0.1;
    const interval = 25;

    while (this._nextStepTime < ctx.currentTime + lookAhead) {
      this._currentStep = (this._currentStep + 1) % NUM_STEPS;
      this._playStep(this._currentStep, this._nextStepTime);
      if (this._onStep) this._onStep(this._currentStep);
      this._nextStepTime += this._stepDuration(this._currentStep);
    }

    this._timerID = setTimeout(() => this._schedule(), interval);
  }

  _playStep(step, time) {
    const delay = Math.max(0, (time - this._getCtx().currentTime) * 1000);

    this._rows.forEach((row, r) => {
      setTimeout(() => {
        if (!this._playing && step !== this._currentStep) return;

        const gateOn = row.gates[step];
        const nextStep = (step + 1) % NUM_STEPS;
        const glide = row.glides[step] && row.gates[nextStep];

        // Release previous note (unless gliding into same note)
        if (row.lastPlayedMidi != null) {
          if (!glide || row.notes[step] !== row.lastPlayedMidi) {
            if (this._onNoteOff) this._onNoteOff(row.lastPlayedMidi);
            row.lastPlayedMidi = null;
          }
        }

        if (gateOn && !row.muted) {
          const midi = row.notes[step];
          if (glide && midi === row.lastPlayedMidi) return;
          row.lastPlayedMidi = midi;
          if (this._onNoteOn) {
            this._onNoteOn(midiToFreq(midi), midi, midiToName(midi));
          }
        }
      }, delay);
    });
  }
}