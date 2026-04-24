/**
 * Step Sequencer -- 16-step note sequencer for the synth.
 *
 * Each step has: on/off, MIDI note number, velocity (0-1), glide (tie to next).
 * Uses the same look-ahead scheduler pattern as the drum machine
 * so it stays perfectly beat-locked to global BPM.
 *
 * Callbacks:
 *   onNoteOn(freq, midi, name)  -- trigger synth note
 *   onNoteOff(midi)             -- release synth note
 *   onStep(stepIndex)           -- UI highlight
 */

import { midiToFreq, midiToName } from './keyboard.js';

const NUM_STEPS = 16;
const DEFAULT_NOTE = 60; // C4

/* ── Preset sequences ────────────────────────────────────── */

const SEQ_PRESETS = {
  'arpUp': {
    label: 'ARP',
    notes:   [60,62,64,65, 67,69,71,72, 72,71,69,67, 65,64,62,60],
    gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:    [1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8],
    glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'bass1': {
    label: 'BASS',
    notes:   [36,36,0,36, 38,0,36,0, 36,36,0,41, 38,0,36,0],
    gates:   [1,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0],
    vels:    [1,0.7,0,0.8, 0.9,0,0.7,0, 1,0.7,0,0.8, 0.9,0,0.7,0],
    glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'acid': {
    label: 'ACID',
    notes:   [36,36,48,36, 39,36,48,39, 36,36,48,36, 41,39,36,48],
    gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:    [1,0.6,0.9,0.5, 0.8,0.6,1,0.7, 1,0.6,0.9,0.5, 0.8,0.7,0.6,1],
    glides:  [0,1,0,1, 0,1,0,0, 0,1,0,1, 0,0,1,0],
  },
  'melody': {
    label: 'MEL',
    notes:   [60,64,67,72, 71,67,64,60, 62,65,69,74, 72,69,65,62],
    gates:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:    [1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8, 1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8],
    glides:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
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
    this._lastPlayedMidi = null;

    // Per-step state
    this._notes  = new Array(NUM_STEPS).fill(DEFAULT_NOTE);
    this._gates  = new Array(NUM_STEPS).fill(0);
    this._vels   = new Array(NUM_STEPS).fill(1);
    this._glides = new Array(NUM_STEPS).fill(0);

    // Callbacks
    this._onNoteOn = null;
    this._onNoteOff = null;
    this._onStep = null;

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

  set onNoteOn(fn) { this._onNoteOn = fn; }
  set onNoteOff(fn) { this._onNoteOff = fn; }
  set onStep(fn) { this._onStep = fn; }

  setBPM(bpm) { this._bpm = Math.max(40, Math.min(300, bpm)); }
  setSwing(amount) { this._swing = Math.max(0, Math.min(0.7, amount)); }

  /* -- step data -- */

  getStepNote(i)  { return this._notes[i]; }
  getStepGate(i)  { return this._gates[i]; }
  getStepVel(i)   { return this._vels[i]; }
  getStepGlide(i) { return this._glides[i]; }

  setStepNote(i, midi) { this._notes[i] = Math.max(0, Math.min(127, midi)); }
  setStepVel(i, v) { this._vels[i] = Math.max(0, Math.min(1, v)); }
  setStepGlide(i, on) { this._glides[i] = on ? 1 : 0; }

  toggleGate(i) {
    this._gates[i] = this._gates[i] ? 0 : 1;
    return this._gates[i];
  }

  setGate(i, on) {
    this._gates[i] = on ? 1 : 0;
  }

  getPattern() {
    return {
      notes: [...this._notes],
      gates: [...this._gates],
      vels: [...this._vels],
      glides: [...this._glides],
    };
  }

  clearPattern() {
    this._notes.fill(DEFAULT_NOTE);
    this._gates.fill(0);
    this._vels.fill(1);
    this._glides.fill(0);
  }

  loadPreset(name) {
    const p = SEQ_PRESETS[name];
    if (!p) return;
    for (let i = 0; i < NUM_STEPS; i++) {
      this._notes[i]  = p.notes[i]  !== undefined ? p.notes[i] : DEFAULT_NOTE;
      this._gates[i]  = p.gates[i]  !== undefined ? p.gates[i] : 0;
      this._vels[i]   = p.vels[i]   !== undefined ? p.vels[i]  : 1;
      this._glides[i] = p.glides[i] !== undefined ? p.glides[i] : 0;
    }
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
    // Release any sounding note
    if (this._lastPlayedMidi != null && this._onNoteOff) {
      this._onNoteOff(this._lastPlayedMidi);
      this._lastPlayedMidi = null;
    }
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

    setTimeout(() => {
      if (!this._playing && step !== this._currentStep) return;

      const gateOn = this._gates[step];
      const nextStep = (step + 1) % NUM_STEPS;
      const glide = this._glides[step] && this._gates[nextStep];

      // Release previous note (unless gliding into same note)
      if (this._lastPlayedMidi != null) {
        if (!glide || this._notes[step] !== this._lastPlayedMidi) {
          if (this._onNoteOff) this._onNoteOff(this._lastPlayedMidi);
          this._lastPlayedMidi = null;
        }
      }

      if (gateOn) {
        const midi = this._notes[step];
        // If gliding and same note, skip re-trigger
        if (glide && midi === this._lastPlayedMidi) return;
        this._lastPlayedMidi = midi;
        if (this._onNoteOn) {
          this._onNoteOn(midiToFreq(midi), midi, midiToName(midi));
        }
      }
    }, delay);
  }
}