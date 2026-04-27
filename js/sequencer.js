/**
 * Unified Sequencer — up to 16 tracks, each assigned to synth / drum / sample.
 *
 * Single transport with look-ahead scheduler.
 * Synth tracks trigger via callbacks; drum & sample tracks play audio directly.
 */

import { midiToFreq, midiToName } from './keyboard.js';
import { playDrumPart, getDefaultDrumParams, DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES } from './drum-voices.js';

export { DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES };

const NUM_STEPS = 16;
const MAX_TRACKS = 16;
const DEFAULT_NOTE = 60;
export const SOURCE_TYPES = ['synth', 'drum', 'sample'];

/* ── Synth presets (note patterns) ────────────────────────── */

const SYNTH_PRESETS = {
  'arpUp': {
    label: 'ARP',
    notes:  [60,62,64,65, 67,69,71,72, 72,71,69,67, 65,64,62,60],
    gates:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:   [1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8, 1,0.8,0.8,0.8],
    glides: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'bass1': {
    label: 'BASS',
    notes:  [36,36,0,36, 38,0,36,0, 36,36,0,41, 38,0,36,0],
    gates:  [1,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0],
    vels:   [1,0.7,0,0.8, 0.9,0,0.7,0, 1,0.7,0,0.8, 0.9,0,0.7,0],
    glides: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'acid': {
    label: 'ACID',
    notes:  [36,36,48,36, 39,36,48,39, 36,36,48,36, 41,39,36,48],
    gates:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:   [1,0.6,0.9,0.5, 0.8,0.6,1,0.7, 1,0.6,0.9,0.5, 0.8,0.7,0.6,1],
    glides: [0,1,0,1, 0,1,0,0, 0,1,0,1, 0,0,1,0],
  },
  'melody': {
    label: 'MEL',
    notes:  [60,64,67,72, 71,67,64,60, 62,65,69,74, 72,69,65,62],
    gates:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    vels:   [1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8, 1,0.8,0.8,0.9, 0.8,0.7,0.7,0.8],
    glides: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
};

export const SYNTH_PRESET_NAMES = Object.keys(SYNTH_PRESETS);

/* ── Track factory ────────────────────────────────────────── */

function makeTrack(sourceType = 'synth', name = '', config = null) {
  let srcCfg;
  if (config) {
    srcCfg = config;
  } else if (sourceType === 'drum') {
    srcCfg = { part: 'kick', kit: '909', params: getDefaultDrumParams('kick', '909') };
  } else if (sourceType === 'sample') {
    srcCfg = { sampleName: null };
  } else {
    srcCfg = {};
  }
  return {
    sourceType,
    sourceConfig: srcCfg,
    notes:  new Array(NUM_STEPS).fill(DEFAULT_NOTE),
    gates:  new Array(NUM_STEPS).fill(0),
    vels:   new Array(NUM_STEPS).fill(1),
    glides: new Array(NUM_STEPS).fill(0),
    muted:  false,
    volume: 1.0,
    name:   name || (sourceType === 'drum' ? 'Drum' : sourceType === 'sample' ? 'Sample' : 'Synth'),
  };
}

/* ── Sequencer class ──────────────────────────────────────── */

export class Sequencer {
  constructor() {
    this._bpm = 120;
    this._swing = 0;
    this._playing = false;
    this._recording = false;
    this._recTrack = 0;
    this._currentStep = -1;
    this._nextStepTime = 0;
    this._timerID = null;

    this._tracks = [makeTrack('synth', 'Synth 1')];

    // Per-track runtime audio (not serialized)
    this._trackGains = [];   // index -> GainNode | null
    this._lastPlayed = [];   // index -> midi | null (synth tracks)
    this._masterGain = null; // master output for drum/sample tracks

    // Recording state
    this._recHeldNotes = new Map(); // midi -> { track, step }

    // Callbacks
    this._onSynthNoteOn = null;   // (trackIdx, freq, midi, name, vel)
    this._onSynthNoteOff = null;  // (trackIdx, midi)
    this._onStep = null;          // (stepIdx)
    this._onRecordStep = null;    // (trackIdx, stepIdx)

    // Audio
    this._getCtx = null;
    this._samplePlayer = null;
  }

  init(getAudioContext, samplePlayer = null) {
    this._getCtx = getAudioContext;
    this._samplePlayer = samplePlayer;
  }

  _ensureAudio() {
    if (this._masterGain) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = 1.0;
    this._masterGain.connect(ctx.destination);
  }

  _ensureTrackGain(idx) {
    if (this._trackGains[idx]) return this._trackGains[idx];
    this._ensureAudio();
    const ctx = this._getCtx();
    if (!ctx) return null;
    const g = ctx.createGain();
    const track = this._tracks[idx];
    g.gain.value = track ? track.volume : 1;
    g.connect(this._masterGain);
    this._trackGains[idx] = g;
    return g;
  }

  /* ── Getters ────────────────────────────────────────────── */

  get playing() { return this._playing; }
  get currentStep() { return this._currentStep; }
  get numSteps() { return NUM_STEPS; }
  get trackCount() { return this._tracks.length; }
  get maxTracks() { return MAX_TRACKS; }
  get recTrack() { return this._recTrack; }
  get recording() { return this._recording; }

  set onSynthNoteOn(fn) { this._onSynthNoteOn = fn; }
  set onSynthNoteOff(fn) { this._onSynthNoteOff = fn; }
  set onStep(fn) { this._onStep = fn; }
  set onRecordStep(fn) { this._onRecordStep = fn; }

  /* ── Track management ───────────────────────────────────── */

  addTrack(sourceType = 'synth', name = '', config = null) {
    if (this._tracks.length >= MAX_TRACKS) return -1;
    this._tracks.push(makeTrack(sourceType, name, config));
    this._trackGains.push(null);
    this._lastPlayed.push(null);
    return this._tracks.length - 1;
  }

  removeTrack(idx) {
    if (this._tracks.length <= 1 || idx < 0 || idx >= this._tracks.length) return;
    // Release sounding note
    if (this._lastPlayed[idx] != null && this._onSynthNoteOff) {
      this._onSynthNoteOff(idx, this._lastPlayed[idx]);
    }
    // Disconnect gain
    if (this._trackGains[idx]) {
      try { this._trackGains[idx].disconnect(); } catch {}
    }
    this._tracks.splice(idx, 1);
    this._trackGains.splice(idx, 1);
    this._lastPlayed.splice(idx, 1);
    if (this._recTrack >= this._tracks.length) this._recTrack = this._tracks.length - 1;
  }

  getTrack(idx) {
    const t = this._tracks[idx];
    if (!t) return null;
    return {
      sourceType: t.sourceType,
      sourceConfig: t.sourceConfig,
      name: t.name,
      muted: t.muted,
      volume: t.volume,
    };
  }

  setTrackSource(idx, sourceType, config = null) {
    const t = this._tracks[idx];
    if (!t) return;
    // Release any sounding note if switching from synth
    if (t.sourceType === 'synth' && this._lastPlayed[idx] != null && this._onSynthNoteOff) {
      this._onSynthNoteOff(idx, this._lastPlayed[idx]);
      this._lastPlayed[idx] = null;
    }
    t.sourceType = sourceType;
    if (config) {
      t.sourceConfig = config;
    } else if (sourceType === 'drum') {
      t.sourceConfig = { part: 'kick', kit: '909', params: getDefaultDrumParams('kick', '909') };
    } else if (sourceType === 'sample') {
      t.sourceConfig = { sampleName: null };
    } else {
      t.sourceConfig = {};
    }
  }

  setTrackName(idx, name) {
    if (this._tracks[idx]) this._tracks[idx].name = name;
  }

  setTrackMuted(idx, on) {
    if (this._tracks[idx]) this._tracks[idx].muted = !!on;
  }

  toggleTrackMute(idx) {
    const t = this._tracks[idx];
    if (!t) return false;
    t.muted = !t.muted;
    return t.muted;
  }

  setTrackVolume(idx, vol) {
    const t = this._tracks[idx];
    if (!t) return;
    t.volume = Math.max(0, Math.min(1, vol));
    if (this._trackGains[idx]) {
      const ctx = this._getCtx();
      if (ctx) this._trackGains[idx].gain.setTargetAtTime(t.volume, ctx.currentTime, 0.01);
    }
  }

  getTrackVolume(idx) { return this._tracks[idx] ? this._tracks[idx].volume : 1; }
  getTrackMuted(idx) { return this._tracks[idx] ? this._tracks[idx].muted : false; }

  /* ── Drum track config ──────────────────────────────────── */

  setDrumPart(idx, partId) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'drum') return;
    t.sourceConfig.part = partId;
    t.sourceConfig.params = getDefaultDrumParams(partId, t.sourceConfig.kit || '909');
    t.name = (DRUM_PARTS.find(p => p.id === partId) || {}).label || partId;
  }

  setDrumKit(idx, kitName) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'drum') return;
    t.sourceConfig.kit = kitName;
    t.sourceConfig.params = getDefaultDrumParams(t.sourceConfig.part, kitName);
  }

  setDrumParam(idx, paramId, value) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'drum' || !t.sourceConfig.params) return;
    t.sourceConfig.params[paramId] = value;
  }

  getDrumParams(idx) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'drum') return {};
    return { ...t.sourceConfig.params };
  }

  /* ── Sample track config ────────────────────────────────── */

  setSampleName(idx, name) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'sample') return;
    t.sourceConfig.sampleName = name;
    t.name = name || 'Sample';
  }

  /* ── Step data ──────────────────────────────────────────── */

  getStepNote(t, s)  { return this._tracks[t] ? this._tracks[t].notes[s]  : DEFAULT_NOTE; }
  getStepGate(t, s)  { return this._tracks[t] ? this._tracks[t].gates[s]  : 0; }
  getStepVel(t, s)   { return this._tracks[t] ? this._tracks[t].vels[s]   : 1; }
  getStepGlide(t, s) { return this._tracks[t] ? this._tracks[t].glides[s] : 0; }

  setStepNote(t, s, midi) { if (this._tracks[t]) this._tracks[t].notes[s] = Math.max(0, Math.min(127, midi)); }
  setStepVel(t, s, v)     { if (this._tracks[t]) this._tracks[t].vels[s] = Math.max(0, Math.min(1, v)); }
  setStepGlide(t, s, on)  { if (this._tracks[t]) this._tracks[t].glides[s] = on ? 1 : 0; }

  toggleGate(t, s) {
    if (!this._tracks[t]) return 0;
    this._tracks[t].gates[s] = this._tracks[t].gates[s] ? 0 : 1;
    return this._tracks[t].gates[s];
  }

  setGate(t, s, on) {
    if (this._tracks[t]) this._tracks[t].gates[s] = on ? 1 : 0;
  }

  /* ── Recording (synth tracks only) ─────────────────────── */

  setRecording(on) { this._recording = !!on; }

  setRecTrack(idx) {
    if (idx >= 0 && idx < this._tracks.length) this._recTrack = idx;
  }

  recordNote(midi, vel = 1) {
    if (!this._playing || this._currentStep < 0) return;
    if (this._recHeldNotes.has(midi)) {
      this.recordNoteOff(midi);
    }
    const t = this._recTrack;
    const s = this._currentStep;
    const track = this._tracks[t];
    if (!track || track.sourceType !== 'synth') return;
    const prev = (s - 1 + NUM_STEPS) % NUM_STEPS;
    track.glides[prev] = 0;
    track.notes[s] = Math.max(0, Math.min(127, midi));
    track.gates[s] = 1;
    track.vels[s] = Math.max(0, Math.min(1, vel));
    this._recHeldNotes.set(midi, { track: t, step: s });
    if (this._onRecordStep) this._onRecordStep(t, s);
  }

  recordNoteOff(midi) {
    if (!this._playing || this._currentStep < 0) return;
    const held = this._recHeldNotes.get(midi);
    if (!held) return;
    this._recHeldNotes.delete(midi);
    const { track: t, step: startStep } = held;
    const track = this._tracks[t];
    if (!track) return;
    let endStep = this._currentStep;
    let span = (endStep - startStep + NUM_STEPS) % NUM_STEPS;
    if (span === 0) return;
    const vel = track.vels[startStep];
    for (let i = 1; i <= span; i++) {
      const s = (startStep + i) % NUM_STEPS;
      track.notes[s] = track.notes[startStep];
      track.gates[s] = 1;
      track.vels[s] = vel;
      const prev = (s - 1 + NUM_STEPS) % NUM_STEPS;
      track.glides[prev] = 1;
      if (this._onRecordStep) this._onRecordStep(t, s);
    }
  }

  /* ── Trigger / audition ─────────────────────────────────── */

  triggerDrum(idx) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'drum') return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    const dest = this._ensureTrackGain(idx);
    if (!dest) return;
    playDrumPart(ctx, dest, t.sourceConfig.part, t.volume, t.sourceConfig.params);
  }

  triggerSample(idx) {
    const t = this._tracks[idx];
    if (!t || t.sourceType !== 'sample' || !this._samplePlayer) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    const dest = this._ensureTrackGain(idx);
    if (!dest) return;
    this._samplePlayer.play(ctx, dest, t.sourceConfig.sampleName, t.volume);
  }

  /* ── Pattern operations ─────────────────────────────────── */

  clearPattern() {
    this._tracks.forEach(t => {
      t.notes.fill(DEFAULT_NOTE);
      t.gates.fill(0);
      t.vels.fill(1);
      t.glides.fill(0);
    });
  }

  clearTrack(idx) {
    const t = this._tracks[idx];
    if (!t) return;
    t.notes.fill(DEFAULT_NOTE);
    t.gates.fill(0);
    t.vels.fill(1);
    t.glides.fill(0);
  }

  /** Load a synth preset into a specific track */
  loadSynthPreset(trackIdx, presetName) {
    const p = SYNTH_PRESETS[presetName];
    const t = this._tracks[trackIdx];
    if (!p || !t || t.sourceType !== 'synth') return;
    for (let i = 0; i < NUM_STEPS; i++) {
      t.notes[i]  = p.notes[i]  !== undefined ? p.notes[i]  : DEFAULT_NOTE;
      t.gates[i]  = p.gates[i]  !== undefined ? p.gates[i]  : 0;
      t.vels[i]   = p.vels[i]   !== undefined ? p.vels[i]   : 1;
      t.glides[i] = p.glides[i] !== undefined ? p.glides[i] : 0;
    }
  }

  /** Load a drum preset — creates/fills drum tracks for each part */
  loadDrumPreset(presetName, kit = '909') {
    const p = DRUM_PRESETS[presetName];
    if (!p) return;

    for (const [partId, pattern] of Object.entries(p)) {
      // Find existing drum track for this part, or create one
      let idx = this._tracks.findIndex(t =>
        t.sourceType === 'drum' && t.sourceConfig.part === partId
      );
      if (idx === -1) {
        const partDef = DRUM_PARTS.find(d => d.id === partId);
        idx = this.addTrack('drum', partDef ? partDef.label : partId, {
          part: partId, kit, params: getDefaultDrumParams(partId, kit),
        });
        if (idx === -1) return; // max tracks reached
      }
      const track = this._tracks[idx];
      for (let s = 0; s < NUM_STEPS; s++) {
        track.gates[s] = pattern[s] || 0;
        track.vels[s] = pattern[s] ? 1 : 0;
      }
    }
  }

  getSynthPresetNames() { return Object.keys(SYNTH_PRESETS); }
  getSynthPresetLabel(name) { return SYNTH_PRESETS[name] ? SYNTH_PRESETS[name].label : name; }

  /* ── Transport ──────────────────────────────────────────── */

  setBPM(bpm) { this._bpm = Math.max(40, Math.min(300, bpm)); }
  setSwing(amount) { this._swing = Math.max(0, Math.min(0.7, amount)); }
  getBPM() { return this._bpm; }

  start() {
    if (this._playing) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._playing = true;
    this._currentStep = -1;
    this._nextStepTime = ctx.currentTime + 0.05;
    this._schedule();
  }

  stop() {
    this._playing = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    // Release sounding synth notes
    this._tracks.forEach((t, idx) => {
      if (t.sourceType === 'synth' && this._lastPlayed[idx] != null) {
        if (this._onSynthNoteOff) this._onSynthNoteOff(idx, this._lastPlayed[idx]);
        this._lastPlayed[idx] = null;
      }
    });
    this._recHeldNotes.clear();
    this._currentStep = -1;
    if (this._onStep) this._onStep(-1);
  }

  /* ── Scheduler ──────────────────────────────────────────── */

  _stepDuration(stepIndex) {
    const base = (60 / this._bpm) / 4;
    if (stepIndex % 2 === 1) return base * (1 - this._swing);
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
    const ctx = this._getCtx();
    if (!ctx) return;
    const delay = Math.max(0, (time - ctx.currentTime) * 1000);

    this._tracks.forEach((track, idx) => {
      setTimeout(() => {
        if (!this._playing && step !== this._currentStep) return;

        const gateOn = track.gates[step];

        if (track.sourceType === 'synth') {
          this._playSynthStep(track, idx, step, gateOn);
        } else if (track.sourceType === 'drum') {
          this._playDrumStep(track, idx, step, gateOn);
        } else if (track.sourceType === 'sample') {
          this._playSampleStep(track, idx, step, gateOn);
        }
      }, delay);
    });
  }

  _playSynthStep(track, idx, step, gateOn) {
    const nextStep = (step + 1) % NUM_STEPS;
    const glide = track.glides[step] && track.gates[nextStep];

    // Release previous note unless gliding into same note
    if (this._lastPlayed[idx] != null) {
      if (!glide || track.notes[step] !== this._lastPlayed[idx]) {
        if (this._onSynthNoteOff) this._onSynthNoteOff(idx, this._lastPlayed[idx]);
        this._lastPlayed[idx] = null;
      }
    }

    if (gateOn && !track.muted) {
      const midi = track.notes[step];
      if (glide && midi === this._lastPlayed[idx]) return;
      this._lastPlayed[idx] = midi;
      const vel = track.vels[step] * track.volume;
      if (this._onSynthNoteOn) {
        this._onSynthNoteOn(idx, midiToFreq(midi), midi, midiToName(midi), vel);
      }
    }
  }

  _playDrumStep(track, idx, step, gateOn) {
    if (!gateOn || track.muted) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const dest = this._ensureTrackGain(idx);
    if (!dest) return;
    const vel = track.vels[step] * track.volume;
    playDrumPart(ctx, dest, track.sourceConfig.part, vel, track.sourceConfig.params);
  }

  _playSampleStep(track, idx, step, gateOn) {
    if (!gateOn || track.muted || !this._samplePlayer) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const dest = this._ensureTrackGain(idx);
    if (!dest) return;
    const vel = track.vels[step] * track.volume;
    this._samplePlayer.play(ctx, dest, track.sourceConfig.sampleName, vel);
  }

  /* ── State serialization ────────────────────────────────── */

  getState() {
    return {
      bpm: this._bpm,
      swing: this._swing,
      tracks: this._tracks.map(t => ({
        sourceType: t.sourceType,
        sourceConfig: JSON.parse(JSON.stringify(t.sourceConfig)),
        notes:  [...t.notes],
        gates:  [...t.gates],
        vels:   [...t.vels],
        glides: [...t.glides],
        muted:  t.muted,
        volume: t.volume,
        name:   t.name,
      })),
    };
  }

  loadState(s) {
    if (!s || !Array.isArray(s.tracks) || s.tracks.length === 0) return;
    const wasPlaying = this._playing;
    if (wasPlaying) this.stop();

    if (s.bpm !== undefined) this._bpm = s.bpm;
    if (s.swing !== undefined) this._swing = s.swing;

    // Disconnect old track gains
    this._trackGains.forEach(g => { if (g) try { g.disconnect(); } catch {} });

    this._tracks = s.tracks.map(st => {
      const t = makeTrack(st.sourceType, st.name, st.sourceConfig);
      for (let i = 0; i < NUM_STEPS; i++) {
        if (st.notes  && st.notes[i]  !== undefined) t.notes[i]  = st.notes[i];
        if (st.gates  && st.gates[i]  !== undefined) t.gates[i]  = st.gates[i];
        if (st.vels   && st.vels[i]   !== undefined) t.vels[i]   = st.vels[i];
        if (st.glides && st.glides[i] !== undefined) t.glides[i] = st.glides[i];
      }
      t.muted  = !!st.muted;
      t.volume = st.volume !== undefined ? st.volume : 1.0;
      return t;
    });

    this._trackGains = new Array(this._tracks.length).fill(null);
    this._lastPlayed = new Array(this._tracks.length).fill(null);

    if (this._recTrack >= this._tracks.length) this._recTrack = 0;
    this._recHeldNotes.clear();
  }
}
