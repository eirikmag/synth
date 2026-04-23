/**
 * Main entry — wires AudioEngine, KeyboardManager, UIManager, and Arpeggiator.
 * Manages mono / poly / arp voice modes.
 */

import { AudioEngine } from './audio.js';
import { KeyboardManager, midiToFreq, midiToName } from './keyboard.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { Arpeggiator } from './arpeggiator.js';

const audio = new AudioEngine();
let visualizer = null;
let playMode = 'mono'; // 'mono' | 'poly' | 'arp'

// Track held notes for mono mode (last-note priority)
const monoHeld = [];

function ensureVisualizer() {
  if (visualizer) return;
  const canvas = document.getElementById('oscilloscope');
  visualizer = new Visualizer(canvas, audio.analyser, audio.getRefFilters());
  visualizer.start();
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
  onVolumeChange(oscNum, value) { audio.setVolume(oscNum, value); },
  onShapeChange(oscNum, value) { audio.setShape(oscNum, value); },
  onPitchChange(oscNum, value) { audio.setPitch(oscNum, value); },
  onOctaveChange(oscNum, value) { audio.setOctave(oscNum, value); },
  onFilterTypeChange(type) {
    audio.setFilterType(type);
    if (visualizer) visualizer.setRefFilters(audio.getRefFilters());
  },
  onFilterModelChange(model) {
    audio.setFilterModel(model);
    if (visualizer) visualizer.setRefFilters(audio.getRefFilters());
  },
  onFilterCutoffChange(freq) { audio.setFilterCutoff(freq); },
  onFilterQChange(value) { audio.setFilterQ(value); },
  onFilterGainChange(dB) { audio.setFilterGain(dB); },
  onADSRChange(params) { audio.setADSR(params); },
  onPlayModeChange(mode) { setPlayMode(mode); },
  onArpBPMChange(bpm) { arp.setBPM(bpm); },
  onArpDivisionChange(div) { arp.setDivision(div); },
  onArpModeChange(mode) { arp.setMode(mode); },
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
  keyboard.start();
});
