/**
 * Main entry — wires AudioEngine, KeyboardManager, and UIManager together.
 */

import { AudioEngine } from './audio.js';
import { KeyboardManager } from './keyboard.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';

const audio = new AudioEngine();
let visualizer = null;

function ensureVisualizer() {
  if (visualizer) return;
  const canvas = document.getElementById('oscilloscope');
  visualizer = new Visualizer(canvas, audio.analyser);
  visualizer.start();
}

function noteOn(freq, midi, name) {
  ensureVisualizer();
  audio.noteOn(freq);
  ui.showNote(name);
  ui.highlightKey(midi);
}

function noteOff(midi) {
  audio.noteOff();
  ui.clearNote();
  ui.releaseKey(midi);
}

const ui = new UIManager({
  onWaveformChange(type) {
    audio.setWaveform(type);
  },
  onVolumeChange(value) {
    audio.setVolume(value);
  },
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
  keyboard.start();
});
