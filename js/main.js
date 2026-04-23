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
  visualizer = new Visualizer(canvas, audio.analyser);
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
  onWaveformChange(type) { audio.setWaveform(type); },
  onVolumeChange(value) { audio.setVolume(value); },
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

document.addEventListener('DOMContentLoaded', () => {
  ui.init();
  ui.setActiveWaveform(audio.getWaveform());
  ui.setVolume(audio.getVolume());
  ui.setADSR(audio.getADSR());
  ui.setPlayMode(playMode);
  ui.setArpSettings({ bpm: arp.getBPM(), division: arp.getDivision(), mode: arp.getMode() });
  keyboard.start();
});
