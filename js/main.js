/**
 * Main entry — wires AudioEngine, KeyboardManager, UIManager, and Arpeggiator.
 * Manages mono / poly / arp voice modes.
 */

import { AudioEngine } from './audio.js';
import { KeyboardManager, midiToFreq, midiToName } from './keyboard.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { Arpeggiator } from './arpeggiator.js';
import { LFO } from './lfo.js';

const audio = new AudioEngine();
const lfo = new LFO();
let visualizer = null;
let playMode = 'mono'; // 'mono' | 'poly' | 'arp'

// Track held notes for mono mode (last-note priority)
const monoHeld = [];

function ensureVisualizer() {
  if (visualizer) return;
  const canvas = document.getElementById('oscilloscope');
  visualizer = new Visualizer(canvas, audio.analyser, audio.getRefFilters());
  visualizer.setOnCSTDraw((gains) => {
    audio.setCustomFilterCurve(gains);
  });
  visualizer.start();
}

function updateVisualizerDrawMode() {
  if (!visualizer) return;
  const active = audio.isCustomFilterActive();
  visualizer.setDrawMode(
    active,
    active ? audio.getCSTFreqs() : null,
    active ? audio.getCSTBandCount() : 0,
    active ? audio.getCustomFilterCurve() : null
  );
}

/* --- Low-level audio note helpers (used by arp too) --- */

function audioNoteOn(freq, midi, name) {
  ensureVisualizer();
  audio.noteOn(freq, midi);
  ui.showNote(name);
  ui.highlightKey(midi);
}

function audioNoteOff(midi) {
  audio.noteOff(midi);
  ui.releaseKey(midi);
  if (audio.activeVoiceCount === 0) ui.clearNote();
}

/* --- Arpeggiator (its callbacks go straight to audio) --- */

const arp = new Arpeggiator({
  onNoteOn: audioNoteOn,
  onNoteOff: audioNoteOff,
});

/* --- Input handlers (keyboard + piano clicks route here) --- */

function noteOn(freq, midi, name) {
  ensureVisualizer();

  switch (playMode) {
    case 'mono':
      // Last-note priority: kill all, play new
      audio.allNotesOff();
      ui.releaseAllKeys();
      monoHeld.push(midi);
      audioNoteOn(freq, midi, name);
      break;

    case 'poly':
      audioNoteOn(freq, midi, name);
      break;

    case 'arp':
      arp.addNote(midi);
      break;
  }
}

function noteOff(midi) {
  switch (playMode) {
    case 'mono': {
      const idx = monoHeld.indexOf(midi);
      if (idx !== -1) monoHeld.splice(idx, 1);
      audioNoteOff(midi);
      // Retrigger previous held note
      if (monoHeld.length > 0) {
        const prev = monoHeld[monoHeld.length - 1];
        audioNoteOn(midiToFreq(prev), prev, midiToName(prev));
      } else {
        ui.clearNote();
      }
      break;
    }
    case 'poly':
      audioNoteOff(midi);
      break;

    case 'arp':
      arp.removeNote(midi);
      break;
  }
}

function setPlayMode(mode) {
  // Clean up current mode
  audio.allNotesOff();
  ui.releaseAllKeys();
  ui.clearNote();
  monoHeld.length = 0;
  arp.reset();

  playMode = mode;
}

/* --- UI --- */

const ui = new UIManager({
  onWaveformChange(oscNum, type) { audio.setWaveform(oscNum, type); },
  onVolumeChange(oscNum, value) {
    audio.setVolume(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-volume', value);
  },
  onShapeChange(oscNum, value) {
    audio.setShape(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-shape', value);
  },
  onPitchChange(oscNum, value) {
    audio.setPitch(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-pitch', value);
  },
  onOctaveChange(oscNum, value) { audio.setOctave(oscNum, value); },
  onFilterTypeChange(type) {
    audio.setFilterType(type);
    if (visualizer) {
      updateVisualizerDrawMode();
      visualizer.setRefFilters(audio.getRefFilters());
    }
  },
  onFilterModelChange(model) {
    audio.setFilterModel(model);
    if (visualizer) {
      updateVisualizerDrawMode();
      visualizer.setRefFilters(audio.getRefFilters());
    }
  },
  onFilterCutoffChange(freq) {
    audio.setFilterCutoff(freq);
    lfo.updateBase('filter-cutoff', freq);
  },
  onFilterQChange(value) {
    audio.setFilterQ(value);
    lfo.updateBase('filter-q', value);
  },
  onFilterGainChange(dB) {
    audio.setFilterGain(dB);
    lfo.updateBase('filter-gain', dB);
  },
  onADSRChange(params) { audio.setADSR(params); },
  onPlayModeChange(mode) { setPlayMode(mode); },
  onArpBPMChange(bpm) { arp.setBPM(bpm); },
  onArpDivisionChange(div) { arp.setDivision(div); },
  onArpModeChange(mode) { arp.setMode(mode); },
  onChorusEnabledChange(on) { audio.setChorusEnabled(on); },
  onChorusRateChange(hz) { audio.setChorusRate(hz); },
  onChorusDepthChange(ms) { audio.setChorusDepth(ms); },
  onChorusWidthChange(pct) { audio.setChorusWidth(pct); },
  onChorusHPCChange(freq) { audio.setChorusHPC(freq); },
  onChorusMixChange(pct) { audio.setChorusMix(pct); },
  onReverbEnabledChange(on) { audio.setReverbEnabled(on); },
  onReverbDecayChange(seconds) { audio.setReverbDecay(seconds); },
  onReverbMixChange(pct) { audio.setReverbMix(pct); },
  onLFOWaveformChange(type) { lfo.setWaveform(type); },
  onLFORateChange(hz) { lfo.setRate(hz); },
  onLFORouteAdd(targetId) { lfo.addRoute(targetId); },
  onLFORouteRemove(targetId) { lfo.removeRoute(targetId); },
  onLFORouteAmountChange(targetId, amount) { lfo.setRouteAmount(targetId, amount); },
  onOsc3ModeChange(mode) { audio.setOsc3Mode(mode); },
  onOsc3VolumeChange(v) {
    audio.setOsc3Volume(v);
    lfo.updateBase('osc3-volume', v);
  },
  onOsc3PitchChange(v) {
    audio.setOsc3Pitch(v);
    lfo.updateBase('osc3-pitch', v);
  },
  onOsc3OctaveChange(v) { audio.setOsc3Octave(v); },
  onOsc3ColorChange(v) { audio.setOsc3Color(v); },
  onOsc3DampingChange(v) { audio.setOsc3Damping(v); },
  onOsc3RatioChange(v) { audio.setOsc3Ratio(v); },
  onOsc3IndexChange(v) { audio.setOsc3Index(v); },
  onOsc3MorphChange(v) { audio.setOsc3Morph(v); },
  onOsc3VibratoChange(v) { audio.setOsc3Vibrato(v); },
  onNoteOn: noteOn,
  onNoteOff: noteOff,
});

const keyboard = new KeyboardManager({
  onNoteOn: noteOn,
  onNoteOff: noteOff,
});

/* --- Web MIDI input --- */

function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    console.warn('Web MIDI API not supported in this browser.');
    return;
  }
  navigator.requestMIDIAccess().then(access => {
    const connectInputs = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = handleMIDIMessage;
      }
    };
    connectInputs();
    access.onstatechange = connectInputs;
    console.log(`MIDI: ${access.inputs.size} input(s) connected.`);
  }).catch(err => console.warn('MIDI access denied:', err));
}

function handleMIDIMessage(e) {
  const [status, note, velocity] = e.data;
  const cmd = status & 0xf0;

  if (cmd === 0x90 && velocity > 0) {
    // Note On
    noteOn(midiToFreq(note), note, midiToName(note));
  } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
    // Note Off
    noteOff(note);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  ui.init();
  initMIDI();

  // Register LFO modulation targets
  lfo.setTargets({
    'osc1-volume': {
      label: 'O1 Vol', min: 0, max: 1,
      get: () => audio.getVolume(1),
      set: (v) => audio.setVolume(1, v),
    },
    'osc1-shape': {
      label: 'O1 Shp', min: 0, max: 1,
      get: () => audio.getShape(1),
      set: (v) => audio.setShape(1, v),
    },
    'osc1-pitch': {
      label: 'O1 Pit', min: -7, max: 7,
      get: () => audio.getPitch(1),
      set: (v) => audio.setPitch(1, v),
    },
    'osc2-volume': {
      label: 'O2 Vol', min: 0, max: 1,
      get: () => audio.getVolume(2),
      set: (v) => audio.setVolume(2, v),
    },
    'osc2-shape': {
      label: 'O2 Shp', min: 0, max: 1,
      get: () => audio.getShape(2),
      set: (v) => audio.setShape(2, v),
    },
    'osc2-pitch': {
      label: 'O2 Pit', min: -7, max: 7,
      get: () => audio.getPitch(2),
      set: (v) => audio.setPitch(2, v),
    },
    'filter-cutoff': {
      label: 'Cutoff', min: 20, max: 20000, log: true,
      get: () => audio.getFilterCutoff(),
      set: (v) => audio.setFilterCutoff(v),
    },
    'filter-q': {
      label: 'Reso', min: 0.01, max: 30,
      get: () => audio.getFilterQ(),
      set: (v) => audio.setFilterQ(v),
    },
    'filter-gain': {
      label: 'Flt Gain', min: -24, max: 24,
      get: () => audio.getFilterGain(),
      set: (v) => audio.setFilterGain(v),
    },
    'osc3-volume': {
      label: 'O3 Vol', min: 0, max: 1,
      get: () => audio.getOsc3Volume(),
      set: (v) => audio.setOsc3Volume(v),
    },
    'osc3-pitch': {
      label: 'O3 Pit', min: -7, max: 7,
      get: () => audio.getOsc3Pitch(),
      set: (v) => audio.setOsc3Pitch(v),
    },
    'osc3-color': {
      label: 'O3 Clr', min: 0, max: 1,
      get: () => audio.getOsc3Color(),
      set: (v) => audio.setOsc3Color(v),
    },
    'osc3-damping': {
      label: 'O3 Dmp', min: 0, max: 1,
      get: () => audio.getOsc3Damping(),
      set: (v) => audio.setOsc3Damping(v),
    },
    'osc3-ratio': {
      label: 'O3 Rat', min: 0.5, max: 12,
      get: () => audio.getOsc3Ratio(),
      set: (v) => audio.setOsc3Ratio(v),
    },
    'osc3-index': {
      label: 'O3 Idx', min: 0, max: 20,
      get: () => audio.getOsc3Index(),
      set: (v) => audio.setOsc3Index(v),
    },
    'osc3-morph': {
      label: 'O3 Mph', min: 0, max: 1,
      get: () => audio.getOsc3Morph(),
      set: (v) => audio.setOsc3Morph(v),
    },
    'osc3-vibrato': {
      label: 'O3 Vib', min: 0, max: 1,
      get: () => audio.getOsc3Vibrato(),
      set: (v) => audio.setOsc3Vibrato(v),
    },
  });

  lfo.setOnRoutesChange(() => {
    const routes = lfo.getRoutes();
    const targets = lfo.getTargets();
    ui.renderLFORoutes(routes, targets);
    ui.updateLFORouteIndicators(routes);
  });

  ui.setActiveWaveform(1, audio.getWaveform(1));
  ui.setActiveWaveform(2, audio.getWaveform(2));
  ui.setVolume(1, audio.getVolume(1));
  ui.setVolume(2, audio.getVolume(2));
  ui.setShape(1, audio.getShape(1));
  ui.setShape(2, audio.getShape(2));
  ui.setPitch(1, audio.getPitch(1));
  ui.setPitch(2, audio.getPitch(2));
  ui.setOctave(1, audio.getOctave(1));
  ui.setOctave(2, audio.getOctave(2));
  ui.setFilterType(audio.getFilterType());
  ui.setFilterModel(audio.getFilterModel());
  ui.setFilterCutoff(audio.getFilterCutoff());
  ui.setFilterQ(audio.getFilterQ());
  ui.setFilterGain(audio.getFilterGain());
  ui.setADSR(audio.getADSR());
  ui.setPlayMode(playMode);
  ui.setArpSettings({ bpm: arp.getBPM(), division: arp.getDivision(), mode: arp.getMode() });
  ui.setChorusEnabled(audio.getChorusEnabled());
  ui.setChorusRate(audio.getChorusRate());
  ui.setChorusDepth(audio.getChorusDepth());
  ui.setChorusWidth(audio.getChorusWidth());
  ui.setChorusHPC(audio.getChorusHPC());
  ui.setChorusMix(audio.getChorusMix());
  ui.setReverbEnabled(audio.getReverbEnabled());
  ui.setReverbDecay(audio.getReverbDecay());
  ui.setReverbMix(audio.getReverbMix());
  ui.setLFOWaveform(lfo.getWaveform());
  ui.setLFORate(lfo.getRate());
  ui.setOsc3Mode(audio.getOsc3Mode());
  ui.setOsc3Volume(audio.getOsc3Volume());
  ui.setOsc3Pitch(audio.getOsc3Pitch());
  ui.setOsc3Octave(audio.getOsc3Octave());
  keyboard.start();
});
