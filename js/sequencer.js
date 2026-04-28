/**
 * Sequencer — 16 tracks with per-track page/step control.
 * Central transport engine. Each track can have 1-8 pages (16 steps each, up to 128 steps).
 */

import { midiToFreq, midiToName } from './keyboard.js';
import { playDrumPart, getDefaultDrumParams, DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES } from './drum-voices.js';
import { TrackChain, CHAIN_FILTER_MODELS } from './track-chain.js';
import { AudioEngine } from './audio.js';

export { DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES };
export { TrackChain, CHAIN_FILTER_MODELS };

export const STEPS_PER_PAGE = 16;
export const MAX_PAGES = 8;
export const MAX_STEPS = STEPS_PER_PAGE * MAX_PAGES; // 128
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
    length: 64,
    //  "Around the World" — Daft Punk style bassline (B minor, 64 steps)
    //  B1=35, E2=40, F#2=42
    notes: [
      35,35, 0,35, 0,35,35, 0, 35,35, 0,35, 0, 0, 0, 0,   // Bar 1: B root pumping
      40,40, 0,40, 0,40,42, 0, 42, 0, 0,42, 40, 0, 0, 0,   // Bar 2: climb E→F#
      35,35, 0,35, 0,35,35, 0, 35,35, 0,35, 0, 0, 0, 0,   // Bar 3: B root again
      40,40, 0,40, 0,40,42, 0, 42,42, 0, 0, 35, 0, 0, 0,   // Bar 4: E→F#→resolve B
    ],
    gates: [
      1,1,0,1, 0,1,1,0, 1,1,0,1, 0,0,0,0,
      1,1,0,1, 0,1,1,0, 1,0,0,1, 1,0,0,0,
      1,1,0,1, 0,1,1,0, 1,1,0,1, 0,0,0,0,
      1,1,0,1, 0,1,1,0, 1,1,0,0, 1,0,0,0,
    ],
    vels: [
      1,.7,0,.8, 0,.7,.9,0, 1,.7,0,.8, 0,0,0,0,
      .9,.7,0,.8, 0,.7,.9,0, .8,0,0,.7, .8,0,0,0,
      1,.7,0,.8, 0,.7,.9,0, 1,.7,0,.8, 0,0,0,0,
      .9,.7,0,.8, 0,.7,.9,0, .8,.7,0,0, 1,0,0,0,
    ],
    glides: [
      0,1,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0,
      0,1,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
      0,1,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0,
      0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0,
    ],
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

function makeTrack(sourceType = 'synth', name = '', config = null, pages = 1, numSteps = STEPS_PER_PAGE) {
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
  const p = Math.max(1, Math.min(MAX_PAGES, pages));
  const s = Math.max(1, Math.min(p * STEPS_PER_PAGE, numSteps));
  return {
    sourceType,
    sourceConfig: srcCfg,
    pages: p,
    numSteps: s,
    notes:  new Array(MAX_STEPS).fill(DEFAULT_NOTE),
    gates:  new Array(MAX_STEPS).fill(0),
    vels:   new Array(MAX_STEPS).fill(1),
    glides: new Array(MAX_STEPS).fill(0),
    muted:  false,
    solo:   false,
    volume: 1.0,
    name:   name || (sourceType === 'drum' ? 'Anvil' : sourceType === 'sample' ? 'Cast' : 'Forge'),
  };
}

/* ── Sequencer class ──────────────────────────────────────── */

export class Sequencer {
  constructor() {
    this._bpm = 120;
    this._swing = 0;
    this._masterLength = 0; // 0 = off (each track loops independently), >0 = global loop point in steps
    this._playing = false;
    this._recording = false;
    this._recTrack = 0;
    this._globalTick = -1;
    this._trackSteps = new Array(MAX_TRACKS).fill(-1);
    this._nextStepTime = 0;
    this._timerID = null;

    this._tracks = this._buildDefaultTracks();

    this._trackGains = new Array(MAX_TRACKS).fill(null);
    this._trackChains = new Array(MAX_TRACKS).fill(null);
    this._trackEngines = new Array(MAX_TRACKS).fill(null);
    this._lastPlayed = new Array(MAX_TRACKS).fill(null);
    this._masterGain = null;
    this._monitorAnalyser = null; // analyser for visualizing the selected track
    this._monitoredTrack = -1;   // which track feeds the monitor (-1 = master mix)

    this._recHeldNotes = new Map();

    // Metronome
    this._metronome = false;       // enabled?
    this._metronomeVol = 0.5;
    this._preroll = false;         // preroll enabled? (1 bar before rec start)
    this._prerollTicks = 0;        // remaining preroll ticks
    this._prerolling = false;      // currently in preroll countdown?
    this._onPrerollTick = null;    // callback(remaining, total) for UI countdown

    this._onSynthNoteOn = null;
    this._onSynthNoteOff = null;
    this._onStep = null;
    this._onRecordStep = null;

    this._getCtx = null;
    this._samplePlayer = null;
  }

  _buildDefaultTracks() {
    const drumParts = ['kick', 'snare', 'clap', 'chh', 'ohh'];
    const tracks = [];

    // Tracks 1-5 (idx 0-4): Drum kit 909
    for (const part of drumParts) {
      const partDef = DRUM_PARTS.find(p => p.id === part);
      tracks.push(makeTrack('drum', partDef ? partDef.label : part, {
        part, kit: '909', params: getDefaultDrumParams(part, '909')
      }));
    }

    // Tracks 6-8 (idx 5-7): empty synth
    tracks.push(makeTrack('synth', 'Forge 6'));
    tracks.push(makeTrack('synth', 'Forge 7'));
    tracks.push(makeTrack('synth', 'Forge 8'));

    // Tracks 9-16 (idx 8-15): empty synth
    for (let i = 9; i <= MAX_TRACKS; i++) {
      tracks.push(makeTrack('synth', `Forge ${i}`));
    }

    return tracks;
  }

  init(getAudioContext, samplePlayer = null) {
    this._getCtx = getAudioContext;
    this._samplePlayer = samplePlayer;
  }

  /** Get/create the monitor analyser for visualization. */
  get monitorAnalyser() {
    if (this._monitorAnalyser) return this._monitorAnalyser;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return null;
    this._ensureAudio();
    this._monitorAnalyser = ctx.createAnalyser();
    this._monitorAnalyser.fftSize = 2048;
    // Connect master mix by default
    this._masterGain.connect(this._monitorAnalyser);
    this._monitoredTrack = -1;
    return this._monitorAnalyser;
  }

  /** Switch which track the monitor analyser listens to. -1 = full mix. */
  setMonitorTrack(idx) {
    if (!this._monitorAnalyser) return;
    // Disconnect previous source from monitor
    if (this._monitoredTrack === -1) {
      try { this._masterGain.disconnect(this._monitorAnalyser); } catch {}
    } else {
      const prevGain = this._trackGains[this._monitoredTrack];
      if (prevGain) try { prevGain.disconnect(this._monitorAnalyser); } catch {}
    }
    this._monitoredTrack = idx;
    // Connect new source
    if (idx === -1) {
      this._masterGain.connect(this._monitorAnalyser);
    } else {
      const g = this._ensureTrackGain(idx);
      if (g) g.connect(this._monitorAnalyser);
    }
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

    // Create per-track processing chain: source → chain → trackGain → master
    const chain = new TrackChain(ctx, g);
    this._trackChains[idx] = chain;
    // Load saved chain state if present
    if (track && track.chainState) {
      chain.loadState(track.chainState);
    }
    return g;
  }

  /** Get the TrackChain input node for routing audio through the track's modules. */
  getTrackInput(idx) {
    this._ensureTrackGain(idx);
    const chain = this._trackChains[idx];
    return chain ? chain.input : this._trackGains[idx];
  }

  /** Get the TrackChain instance for a track (for UI parameter control). */
  getTrackChain(idx) {
    this._ensureTrackGain(idx);
    return this._trackChains[idx];
  }

  /** Get or create the per-track AudioEngine for a synth track. */
  getTrackEngine(idx) {
    if (this._trackEngines[idx]) return this._trackEngines[idx];
    const track = this._tracks[idx];
    if (!track || track.sourceType !== 'synth') return null;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return null;

    const engine = new AudioEngine();
    engine.initWithContext(ctx);
    // Connect engine masterGain → track chain input (so voices go through the chain)
    const chainInput = this.getTrackInput(idx);
    engine._masterGain.connect(chainInput);
    this._trackEngines[idx] = engine;

    // Load saved engine state if present
    if (track.engineState) {
      this._loadEngineState(engine, track.engineState);
    }
    return engine;
  }

  /* ── Getters ────────────────────────────────────────────── */

  get playing() { return this._playing; }
  get trackCount() { return this._tracks.length; }
  get maxTracks() { return MAX_TRACKS; }
  get recTrack() { return this._recTrack; }
  get recording() { return this._recording; }

  setMasterVolume(v) {
    if (!this._masterGain) return;
    this._masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)),
      this._masterGain.context.currentTime, 0.01
    );
  }

  get masterLength() { return this._masterLength; }
  setMasterLength(steps) {
    this._masterLength = Math.max(0, Math.min(MAX_STEPS, steps));
  }

  getTrackStep(idx) { return this._trackSteps[idx]; }

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
    this._trackSteps.push(-1);
    return this._tracks.length - 1;
  }

  removeTrack(idx) {
    if (this._tracks.length <= 1 || idx < 0 || idx >= this._tracks.length) return;
    if (this._lastPlayed[idx] != null && this._onSynthNoteOff) {
      this._onSynthNoteOff(idx, this._lastPlayed[idx]);
    }
    if (this._trackGains[idx]) {
      try { this._trackGains[idx].disconnect(); } catch {}
    }
    this._tracks.splice(idx, 1);
    this._trackGains.splice(idx, 1);
    this._lastPlayed.splice(idx, 1);
    this._trackSteps.splice(idx, 1);
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
      solo: t.solo,
      volume: t.volume,
      pages: t.pages,
      numSteps: t.numSteps,
    };
  }

  setTrackSource(idx, sourceType, config = null) {
    const t = this._tracks[idx];
    if (!t) return;
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

  setTrackName(idx, name) { if (this._tracks[idx]) this._tracks[idx].name = name; }
  setTrackMuted(idx, on) { if (this._tracks[idx]) this._tracks[idx].muted = !!on; }

  toggleTrackMute(idx) {
    const t = this._tracks[idx];
    if (!t) return false;
    t.muted = !t.muted;
    return t.muted;
  }

  setTrackSolo(idx, on) { if (this._tracks[idx]) this._tracks[idx].solo = !!on; }

  toggleTrackSolo(idx) {
    const t = this._tracks[idx];
    if (!t) return false;
    t.solo = !t.solo;
    return t.solo;
  }

  _isTrackAudible(idx) {
    const hasSolo = this._tracks.some(t => t.solo);
    if (hasSolo) return this._tracks[idx].solo;
    return !this._tracks[idx].muted;
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
  getTrackSolo(idx) { return this._tracks[idx] ? this._tracks[idx].solo : false; }

  /* ── Per-track pages and steps ──────────────────────────── */

  setTrackPages(idx, pages) {
    const t = this._tracks[idx];
    if (!t) return;
    t.pages = Math.max(1, Math.min(MAX_PAGES, pages));
    const maxSteps = t.pages * STEPS_PER_PAGE;
    if (t.numSteps > maxSteps) t.numSteps = maxSteps;
  }

  setTrackNumSteps(idx, numSteps) {
    const t = this._tracks[idx];
    if (!t) return;
    const maxSteps = t.pages * STEPS_PER_PAGE;
    t.numSteps = Math.max(1, Math.min(maxSteps, numSteps));
  }

  getTrackPages(idx) { return this._tracks[idx] ? this._tracks[idx].pages : 1; }
  getTrackNumSteps(idx) { return this._tracks[idx] ? this._tracks[idx].numSteps : STEPS_PER_PAGE; }

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

  getStepNote(t, s)  { return (this._tracks[t] && s < MAX_STEPS) ? this._tracks[t].notes[s]  : DEFAULT_NOTE; }
  getStepGate(t, s)  { return (this._tracks[t] && s < MAX_STEPS) ? this._tracks[t].gates[s]  : 0; }
  getStepVel(t, s)   { return (this._tracks[t] && s < MAX_STEPS) ? this._tracks[t].vels[s]   : 1; }
  getStepGlide(t, s) { return (this._tracks[t] && s < MAX_STEPS) ? this._tracks[t].glides[s] : 0; }

  setStepNote(t, s, midi) { if (this._tracks[t] && s < MAX_STEPS) this._tracks[t].notes[s] = Math.max(0, Math.min(127, midi)); }
  setStepVel(t, s, v)     { if (this._tracks[t] && s < MAX_STEPS) this._tracks[t].vels[s] = Math.max(0, Math.min(1, v)); }
  setStepGlide(t, s, on)  { if (this._tracks[t] && s < MAX_STEPS) this._tracks[t].glides[s] = on ? 1 : 0; }

  toggleGate(t, s) {
    if (!this._tracks[t] || s >= MAX_STEPS) return 0;
    this._tracks[t].gates[s] = this._tracks[t].gates[s] ? 0 : 1;
    return this._tracks[t].gates[s];
  }

  setGate(t, s, on) {
    if (this._tracks[t] && s < MAX_STEPS) this._tracks[t].gates[s] = on ? 1 : 0;
  }

  /* ── Recording (synth tracks only) ─────────────────────── */

  setRecording(on) { this._recording = !!on; }

  setRecTrack(idx) {
    if (idx >= 0 && idx < this._tracks.length) this._recTrack = idx;
  }

  recordNote(midi, vel = 1) {
    if (!this._playing) return;
    if (this._recHeldNotes.has(midi)) this.recordNoteOff(midi);
    const t = this._recTrack;
    const s = this._trackSteps[t];
    if (s < 0) return;
    const track = this._tracks[t];
    if (!track || track.sourceType !== 'synth') return;
    track.notes[s] = Math.max(0, Math.min(127, midi));
    track.gates[s] = 1;
    track.vels[s] = Math.max(0, Math.min(1, vel));
    this._recHeldNotes.set(midi, { track: t, step: s });
    if (this._onRecordStep) this._onRecordStep(t, s);
  }

  recordNoteOff(midi) {
    if (!this._playing) return;
    const held = this._recHeldNotes.get(midi);
    if (!held) return;
    this._recHeldNotes.delete(midi);
    const { track: t, step: startStep } = held;
    const track = this._tracks[t];
    if (!track) return;
    const ns = track.numSteps;
    let endStep = this._trackSteps[t];
    let span = (endStep - startStep + ns) % ns;
    if (span === 0) return;
    const vel = track.vels[startStep];
    for (let i = 1; i <= span; i++) {
      const s = (startStep + i) % ns;
      track.notes[s] = track.notes[startStep];
      track.gates[s] = 1;
      track.vels[s] = vel;
      const prev = (s - 1 + ns) % ns;
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

  /** Full reset: clear notes, reset engine to defaults, reset chain to bypass. */
  resetTrack(idx) {
    this.clearTrack(idx);
    const t = this._tracks[idx];
    if (!t) return;
    // Reset engine
    const engine = this._trackEngines[idx];
    if (engine) {
      engine.allNotesOff();
      this._loadEngineState(engine, null);
    }
    t.engineState = null;
    // Reset chain
    const chain = this._trackChains[idx];
    if (chain) chain.reset();
    t.chainState = null;
  }

  loadSynthPreset(trackIdx, presetName) {
    const p = SYNTH_PRESETS[presetName];
    const t = this._tracks[trackIdx];
    if (!p || !t || t.sourceType !== 'synth') return;
    const len = p.length || STEPS_PER_PAGE;
    const pages = Math.ceil(len / STEPS_PER_PAGE);
    t.pages = Math.max(t.pages, pages);
    t.numSteps = Math.max(t.numSteps, len);
    // Clear existing, then write preset
    t.notes.fill(DEFAULT_NOTE); t.gates.fill(0); t.vels.fill(1); t.glides.fill(0);
    for (let i = 0; i < len; i++) {
      t.notes[i]  = p.notes[i]  !== undefined ? p.notes[i]  : DEFAULT_NOTE;
      t.gates[i]  = p.gates[i]  !== undefined ? p.gates[i]  : 0;
      t.vels[i]   = p.vels[i]   !== undefined ? p.vels[i]   : 1;
      t.glides[i] = p.glides[i] !== undefined ? p.glides[i] : 0;
    }
  }

  loadDrumPreset(presetName, kit = '909') {
    const p = DRUM_PRESETS[presetName];
    if (!p) return;
    for (const [partId, pattern] of Object.entries(p)) {
      let idx = this._tracks.findIndex(t =>
        t.sourceType === 'drum' && t.sourceConfig.part === partId
      );
      if (idx === -1) {
        const partDef = DRUM_PARTS.find(d => d.id === partId);
        idx = this.addTrack('drum', partDef ? partDef.label : partId, {
          part: partId, kit, params: getDefaultDrumParams(partId, kit),
        });
        if (idx === -1) return;
      }
      const track = this._tracks[idx];
      for (let s = 0; s < STEPS_PER_PAGE; s++) {
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

  /* ── Metronome ──────────────────────────────────────────── */

  get metronome() { return this._metronome; }
  setMetronome(on) { this._metronome = !!on; }
  setMetronomeVol(v) { this._metronomeVol = Math.max(0, Math.min(1, v)); }
  get preroll() { return this._preroll; }
  setPreroll(on) { this._preroll = !!on; }
  get prerolling() { return this._prerolling; }
  set onPrerollTick(fn) { this._onPrerollTick = fn; }

  _playClick(time, accent) {
    const ctx = this._getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1200 : 800;
    g.gain.value = this._metronomeVol * (accent ? 1 : 0.5);
    g.gain.setTargetAtTime(0, time + 0.02, 0.01);
    osc.connect(g);
    g.connect(this._masterGain || ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  /** Start with preroll: count in 1 bar (16 steps) of metronome before actual play/rec. */
  startWithPreroll() {
    if (this._playing || this._prerolling) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._ensureAudio();
    this._prerolling = true;
    this._prerollTicks = 0;
    const totalPrerollSteps = STEPS_PER_PAGE; // 1 bar = 16 sixteenth notes
    this._nextStepTime = ctx.currentTime + 0.05;
    this._schedulePreroll(totalPrerollSteps);
  }

  _schedulePreroll(total) {
    if (!this._prerolling) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const lookAhead = 0.1;
    const interval = 25;
    while (this._nextStepTime < ctx.currentTime + lookAhead) {
      if (this._prerollTicks >= total) {
        // Preroll done — start actual playback
        this._prerolling = false;
        this._playing = true;
        this._globalTick = -1;
        this._trackSteps.fill(-1);
        // _nextStepTime carries over seamlessly
        this._schedule();
        return;
      }
      // Play metronome click during preroll
      const beatPos = this._prerollTicks % 4;
      this._playClick(this._nextStepTime, beatPos === 0);
      if (this._onPrerollTick) {
        this._onPrerollTick(total - this._prerollTicks, total);
      }
      this._prerollTicks++;
      const base = (60 / this._bpm) / 4;
      this._nextStepTime += base; // no swing during preroll
    }
    this._timerID = setTimeout(() => this._schedulePreroll(total), interval);
  }

  cancelPreroll() {
    this._prerolling = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    if (this._onPrerollTick) this._onPrerollTick(0, 0);
  }

  start() {
    if (this._playing) return;
    const ctx = this._getCtx && this._getCtx();
    if (!ctx) return;
    this._playing = true;
    this._globalTick = -1;
    this._trackSteps.fill(-1);
    this._nextStepTime = ctx.currentTime + 0.05;
    this._schedule();
  }

  stop() {
    this._playing = false;
    this._prerolling = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    this._tracks.forEach((t, idx) => {
      if (t.sourceType === 'synth') {
        // Actually stop the engine's voices
        const engine = this._trackEngines[idx];
        if (engine) engine.allNotesOff();
        if (this._lastPlayed[idx] != null) {
          if (this._onSynthNoteOff) this._onSynthNoteOff(idx, this._lastPlayed[idx]);
          this._lastPlayed[idx] = null;
        }
      }
    });
    this._recHeldNotes.clear();
    this._globalTick = -1;
    this._trackSteps.fill(-1);
    if (this._onStep) this._onStep(null);
  }

  /** Kill all sound on all track engines immediately. */
  panic() {
    this._trackEngines.forEach(engine => {
      if (engine) engine.allNotesOff();
    });
    this._lastPlayed.fill(null);
  }

  /* ── Scheduler ──────────────────────────────────────────── */

  _stepDuration(tick) {
    const base = (60 / this._bpm) / 4;
    if (tick % 2 === 1) return base * (1 - this._swing);
    return base * (1 + this._swing);
  }

  _schedule() {
    if (!this._playing) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const lookAhead = 0.1;
    const interval = 25;
    while (this._nextStepTime < ctx.currentTime + lookAhead) {
      this._globalTick++;
      // Master length: if set, reset all tracks to 0 when global tick reaches it
      if (this._masterLength > 0 && this._globalTick > 0 && (this._globalTick % this._masterLength) === 0) {
        this._tracks.forEach((track, idx) => {
          this._trackSteps[idx] = 0;
        });
      } else {
        // Advance each track's step independently
        this._tracks.forEach((track, idx) => {
          this._trackSteps[idx] = (this._trackSteps[idx] + 1) % track.numSteps;
        });
      }
      this._playAllTracks(this._nextStepTime);
      // Metronome click during playback
      if (this._metronome) {
        const beatPos = this._globalTick % 4;
        this._playClick(this._nextStepTime, beatPos === 0);
      }
      if (this._onStep) this._onStep(this._trackSteps.slice(0, this._tracks.length));
      this._nextStepTime += this._stepDuration(this._globalTick);
    }
    this._timerID = setTimeout(() => this._schedule(), interval);
  }

  _playAllTracks(time) {
    const ctx = this._getCtx();
    if (!ctx) return;
    this._tracks.forEach((track, idx) => {
      const step = this._trackSteps[idx];
      const delay = Math.max(0, (time - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (!this._playing) return;
        if (!this._isTrackAudible(idx)) {
          if (track.sourceType === 'synth' && this._lastPlayed[idx] != null) {
            if (this._onSynthNoteOff) this._onSynthNoteOff(idx, this._lastPlayed[idx]);
            this._lastPlayed[idx] = null;
          }
          return;
        }
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
    const engine = this.getTrackEngine(idx);
    if (!engine) return;

    const nextStep = (step + 1) % track.numSteps;
    const glide = track.glides[step] && track.gates[nextStep];

    if (this._lastPlayed[idx] != null) {
      if (!glide || track.notes[step] !== this._lastPlayed[idx]) {
        engine.noteOff(this._lastPlayed[idx]);
        if (this._onSynthNoteOff) this._onSynthNoteOff(idx, this._lastPlayed[idx]);
        this._lastPlayed[idx] = null;
      }
    }

    if (gateOn) {
      const midi = track.notes[step];
      if (glide && midi === this._lastPlayed[idx]) return;
      this._lastPlayed[idx] = midi;
      const vel = track.vels[step] * track.volume;
      engine.noteOn(midiToFreq(midi), midi, vel);
      if (this._onSynthNoteOn) {
        this._onSynthNoteOn(idx, midiToFreq(midi), midi, midiToName(midi), vel);
      }
    }
  }

  _playDrumStep(track, idx, step, gateOn) {
    if (!gateOn) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    this._ensureTrackGain(idx);
    const dest = this.getTrackInput(idx);
    if (!dest) return;
    const vel = track.vels[step] * track.volume;
    playDrumPart(ctx, dest, track.sourceConfig.part, vel, track.sourceConfig.params);
  }

  _playSampleStep(track, idx, step, gateOn) {
    if (!gateOn || !this._samplePlayer) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    this._ensureTrackGain(idx);
    const dest = this.getTrackInput(idx);
    if (!dest) return;
    const vel = track.vels[step] * track.volume;
    this._samplePlayer.play(ctx, dest, track.sourceConfig.sampleName, vel);
  }

  /* ── State serialization ────────────────────────────────── */

  getState() {
    return {
      bpm: this._bpm,
      swing: this._swing,
      masterLength: this._masterLength,
      tracks: this._tracks.map((t, idx) => ({
        sourceType: t.sourceType,
        sourceConfig: JSON.parse(JSON.stringify(t.sourceConfig)),
        pages: t.pages,
        numSteps: t.numSteps,
        notes:  [...t.notes],
        gates:  [...t.gates],
        vels:   [...t.vels],
        glides: [...t.glides],
        muted:  t.muted,
        solo:   t.solo,
        volume: t.volume,
        name:   t.name,
        chainState: this._trackChains[idx] ? this._trackChains[idx].getState() : (t.chainState || null),
        engineState: this._trackEngines[idx] ? this._getEngineState(this._trackEngines[idx]) : (t.engineState || null),
      })),
    };
  }

  loadState(s) {
    if (!s || !Array.isArray(s.tracks) || s.tracks.length === 0) return;
    const wasPlaying = this._playing;
    if (wasPlaying) this.stop();

    if (s.bpm !== undefined) this._bpm = s.bpm;
    if (s.swing !== undefined) this._swing = s.swing;
    if (s.masterLength !== undefined) this._masterLength = s.masterLength;

    this._trackGains.forEach(g => { if (g) try { g.disconnect(); } catch {} });
    this._trackChains.forEach(c => { if (c) try { c.destroy(); } catch {} });
    this._trackEngines.forEach(e => { if (e) e.allNotesOff(); });

    this._tracks = s.tracks.map(st => {
      const t = makeTrack(st.sourceType, st.name, st.sourceConfig, st.pages || 1, st.numSteps || STEPS_PER_PAGE);
      for (let i = 0; i < MAX_STEPS; i++) {
        if (st.notes  && st.notes[i]  !== undefined) t.notes[i]  = st.notes[i];
        if (st.gates  && st.gates[i]  !== undefined) t.gates[i]  = st.gates[i];
        if (st.vels   && st.vels[i]   !== undefined) t.vels[i]   = st.vels[i];
        if (st.glides && st.glides[i] !== undefined) t.glides[i] = st.glides[i];
      }
      t.muted  = !!st.muted;
      t.solo   = !!st.solo;
      t.volume = st.volume !== undefined ? st.volume : 1.0;
      t.chainState = st.chainState || null;
      t.engineState = st.engineState || null;
      return t;
    });

    this._trackGains = new Array(this._tracks.length).fill(null);
    this._trackChains = new Array(this._tracks.length).fill(null);
    this._trackEngines = new Array(this._tracks.length).fill(null);
    this._lastPlayed = new Array(this._tracks.length).fill(null);
    this._trackSteps = new Array(this._tracks.length).fill(-1);

    if (this._recTrack >= this._tracks.length) this._recTrack = 0;
    this._recHeldNotes.clear();
  }

  /* ── Engine state helpers ───────────────────────────────── */

  _getEngineState(engine) {
    return {
      osc1: { ...engine._osc1 },
      osc2: { ...engine._osc2 },
      osc3: { ...engine._osc3 },
      filter: {
        type: engine._filterType,
        model: engine._filterModel,
        cutoff: engine._filterCutoff,
        q: engine._filterQ,
        gain: engine._filterGain,
      },
      adsr: engine.getADSR(),
      masterVol: engine.getMasterVolume(),
    };
  }

  _loadEngineState(engine, s) {
    if (!s) return;
    if (s.osc1) {
      engine.setWaveform(1, s.osc1.waveform || 'sawtooth');
      engine.setVolume(1, s.osc1.volume !== undefined ? s.osc1.volume : 0.5);
      engine.setShape(1, s.osc1.shape || 0);
      engine.setPitch(1, s.osc1.pitch || 0);
      engine.setOctave(1, s.osc1.octave || 0);
    }
    if (s.osc2) {
      engine.setWaveform(2, s.osc2.waveform || 'square');
      engine.setVolume(2, s.osc2.volume !== undefined ? s.osc2.volume : 0);
      engine.setShape(2, s.osc2.shape || 0);
      engine.setPitch(2, s.osc2.pitch || 0);
      engine.setOctave(2, s.osc2.octave || 0);
    }
    if (s.osc3) {
      engine.setOsc3Mode(s.osc3.mode || 'string');
      engine.setOsc3Volume(s.osc3.volume !== undefined ? s.osc3.volume : 0);
      engine.setOsc3Octave(s.osc3.octave || 0);
      engine.setOsc3Pitch(s.osc3.pitch || 0);
      if (s.osc3.color !== undefined) engine.setOsc3Color(s.osc3.color);
      if (s.osc3.damping !== undefined) engine.setOsc3Damping(s.osc3.damping);
      if (s.osc3.ratio !== undefined) engine.setOsc3Ratio(s.osc3.ratio);
      if (s.osc3.index !== undefined) engine.setOsc3Index(s.osc3.index);
      if (s.osc3.morph !== undefined) engine.setOsc3Morph(s.osc3.morph);
      if (s.osc3.vibrato !== undefined) engine.setOsc3Vibrato(s.osc3.vibrato);
    }
    if (s.filter) {
      engine.setFilterType(s.filter.type || 'lowpass');
      engine.setFilterModel(s.filter.model || 'svf12');
      engine.setFilterCutoff(s.filter.cutoff !== undefined ? s.filter.cutoff : 20000);
      engine.setFilterQ(s.filter.q !== undefined ? s.filter.q : 0.5);
      engine.setFilterGain(s.filter.gain !== undefined ? s.filter.gain : 0);
    }
    if (s.adsr) engine.setADSR(s.adsr);
    if (s.masterVol !== undefined) engine.setMasterVolume(s.masterVol);
  }
}
