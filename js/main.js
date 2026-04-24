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
import { DrumMachine, DRUM_TRACKS, TRACK_PARAM_DEFS, KIT_NAMES } from './drum-machine.js';
import { StepSequencer } from './sequencer.js';

const audio = new AudioEngine();
const lfo = new LFO();
const drums = new DrumMachine();
const seq = new StepSequencer();
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
  getAudioContext: () => audio.context,
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
  onTempoChange(bpm) {
    arp.setBPM(bpm);
    drums.setBPM(bpm);
    seq.setBPM(bpm);
  },
  onMasterVolumeChange(v) { audio.setMasterVolume(v); },
  onArpDivisionChange(div) { arp.setDivision(div); },
  onArpModeChange(mode) { arp.setMode(mode); },
  onArpQuantizeChange(on) { arp.setQuantize(on); },
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
  onDrumToggle(open) {
    if (open) ensureDrumInit();
  },
  onSeqToggle(open) {
    if (open) ensureSeqInit();
  },
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

/* --- Drum Machine --- */

let drumInited = false;

function ensureDrumInit() {
  if (drumInited) return;
  drumInited = true;

  // Share the synth AudioContext
  const ctx = audio.context;
  drums.init(ctx, ctx.destination);
  buildDrumGrid();
  bindDrumControls();
}

let _openEditor = null; // currently open param editor track id

function buildDrumGrid() {
  const grid = document.getElementById('drum-grid');
  if (!grid) return;
  grid.innerHTML = '';
  _openEditor = null;

  DRUM_TRACKS.forEach(track => {
    const row = document.createElement('div');
    row.className = 'drum-row';
    row.dataset.trackRow = track.id;

    // Label (click to toggle param editor + audition)
    const label = document.createElement('div');
    label.className = 'drum-row-label';
    label.textContent = track.label;
    label.addEventListener('click', () => {
      drums.trigger(track.id);
      toggleParamEditor(grid, track.id);
    });
    row.appendChild(label);

    // Steps
    const stepsDiv = document.createElement('div');
    stepsDiv.className = 'drum-row-steps';
    for (let s = 0; s < drums.numSteps; s++) {
      const step = document.createElement('div');
      step.className = 'drum-step';
      step.dataset.track = track.id;
      step.dataset.step = s;
      step.addEventListener('click', () => {
        const on = drums.toggleStep(track.id, s);
        step.classList.toggle('on', !!on);
      });
      stepsDiv.appendChild(step);
    }
    row.appendChild(stepsDiv);

    // Track volume
    const volWrap = document.createElement('div');
    volWrap.className = 'drum-row-vol';
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.01';
    vol.value = drums.getTrackVolume(track.id);
    vol.addEventListener('input', () => drums.setTrackVolume(track.id, parseFloat(vol.value)));
    volWrap.appendChild(vol);
    row.appendChild(volWrap);

    grid.appendChild(row);
  });

  // Step highlight callback
  drums.onStep = (stepIdx) => {
    grid.querySelectorAll('.drum-step').forEach(el => el.classList.remove('current'));
    if (stepIdx >= 0) {
      grid.querySelectorAll(`.drum-step[data-step="${stepIdx}"]`).forEach(el => el.classList.add('current'));
    }
  };
}

function toggleParamEditor(grid, trackId) {
  // Close any existing editor
  const existing = grid.querySelector('.drum-param-editor');
  if (existing) {
    const prevTrack = existing.dataset.track;
    existing.remove();
    const prevLabel = grid.querySelector(`.drum-row[data-track-row="${prevTrack}"] .drum-row-label`);
    if (prevLabel) prevLabel.classList.remove('editing');
    if (prevTrack === trackId) { _openEditor = null; return; } // toggle off
  }

  _openEditor = trackId;
  const row = grid.querySelector(`.drum-row[data-track-row="${trackId}"]`);
  if (!row) return;
  row.querySelector('.drum-row-label').classList.add('editing');

  const editor = document.createElement('div');
  editor.className = 'drum-param-editor';
  editor.dataset.track = trackId;

  const defs = TRACK_PARAM_DEFS[trackId] || [];
  const params = drums.getTrackParams(trackId);

  defs.forEach(def => {
    const grp = document.createElement('div');
    grp.className = 'drum-param-group';
    const lbl = document.createElement('label');
    lbl.textContent = def.label;
    grp.appendChild(lbl);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = def.min;
    slider.max = def.max;
    slider.step = def.step;
    slider.value = params[def.id] !== undefined ? params[def.id] : 1;
    slider.addEventListener('input', () => {
      drums.setTrackParam(trackId, def.id, parseFloat(slider.value));
    });
    grp.appendChild(slider);
    editor.appendChild(grp);
  });

  // Audition button
  const aud = document.createElement('button');
  aud.className = 'drum-param-audition';
  aud.textContent = '\u25B6';
  aud.addEventListener('click', () => drums.trigger(trackId));
  editor.appendChild(aud);

  // Insert editor right after the row
  row.after(editor);
}

function refreshDrumGrid() {
  const grid = document.getElementById('drum-grid');
  if (!grid) return;
  DRUM_TRACKS.forEach(track => {
    for (let s = 0; s < drums.numSteps; s++) {
      const el = grid.querySelector(`.drum-step[data-track="${track.id}"][data-step="${s}"]`);
      if (el) el.classList.toggle('on', !!drums.pattern[track.id][s]);
    }
  });
  // Refresh open param editor if kit changed
  if (_openEditor) {
    const existing = grid.querySelector('.drum-param-editor');
    if (existing) existing.remove();
    const row = grid.querySelector(`.drum-row[data-track-row="${_openEditor}"]`);
    if (row) {
      _openEditor = null;
      toggleParamEditor(grid, row.dataset.trackRow);
    }
  }
}

function bindDrumControls() {
  const playBtn = document.getElementById('drum-play');
  const clearBtn = document.getElementById('drum-clear');
  const masterVol = document.getElementById('drum-master-vol');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (drums.playing) {
        drums.stop();
        playBtn.textContent = 'PLAY';
        playBtn.classList.remove('active');
      } else {
        if (seq.playing) {
          const s = seq.getScheduleState();
          drums.startAt(s.nextStepTime, s.currentStep);
        } else {
          drums.start();
        }
        playBtn.textContent = 'STOP';
        playBtn.classList.add('active');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      drums.clearPattern();
      refreshDrumGrid();
    });
  }

  if (masterVol) {
    masterVol.addEventListener('input', () => drums.setMasterVolume(parseFloat(masterVol.value)));
  }

  document.querySelectorAll('.drum-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      drums.loadPreset(btn.dataset.preset);
      refreshDrumGrid();
    });
  });

  // Kit selector buttons
  document.querySelectorAll('.drum-kit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drum-kit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drums.loadKit(btn.dataset.kit);
      // Refresh param editor sliders if one is open
      const grid = document.getElementById('drum-grid');
      if (_openEditor && grid) {
        const existing = grid.querySelector('.drum-param-editor');
        if (existing) existing.remove();
        const savedTrack = _openEditor;
        _openEditor = null;
        toggleParamEditor(grid, savedTrack);
      }
    });
  });
}

/* --- Step Sequencer --- */

let seqInited = false;

function ensureSeqInit() {
  if (seqInited) return;
  seqInited = true;

  seq.init(() => audio.context);
  seq.onNoteOn = audioNoteOn;
  seq.onNoteOff = audioNoteOff;
  seq.setBPM(arp.getBPM());
  buildSeqGrid();
  bindSeqControls();
}

function buildSeqGrid() {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Note row
  const noteRow = document.createElement('div');
  noteRow.className = 'seq-note-row';
  const noteLabel = document.createElement('div');
  noteLabel.className = 'seq-note-row-label';
  noteLabel.textContent = 'NOTE';
  noteRow.appendChild(noteLabel);

  const noteSteps = document.createElement('div');
  noteSteps.className = 'seq-note-row-steps';

  for (let s = 0; s < seq.numSteps; s++) {
    const cell = document.createElement('div');
    cell.className = 'seq-note-cell';
    cell.dataset.step = s;
    const gate = seq.getStepGate(s);
    const midi = seq.getStepNote(s);
    cell.classList.toggle('on', !!gate);
    cell.textContent = gate ? midiToName(midi) : '';

    // Left click: toggle gate on/off
    cell.addEventListener('click', (e) => {
      if (e.detail > 1) return; // ignore double-click
      const on = seq.toggleGate(s);
      cell.classList.toggle('on', !!on);
      cell.textContent = on ? midiToName(seq.getStepNote(s)) : '';
    });

    // Double-click: edit note
    cell.addEventListener('dblclick', () => {
      if (!seq.getStepGate(s)) {
        seq.setGate(s, true);
        cell.classList.add('on');
      }
      const input = document.createElement('input');
      input.className = 'seq-note-input';
      input.type = 'text';
      input.value = midiToName(seq.getStepNote(s));
      cell.textContent = '';
      cell.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const parsed = parseNoteName(input.value);
        if (parsed !== null) {
          seq.setStepNote(s, parsed);
        }
        if (input.parentNode) {
          cell.textContent = midiToName(seq.getStepNote(s));
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.blur(); }
      });
    });

    // Scroll: change note up/down
    cell.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!seq.getStepGate(s)) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      const cur = seq.getStepNote(s);
      seq.setStepNote(s, cur + dir);
      cell.textContent = midiToName(seq.getStepNote(s));
    });

    noteSteps.appendChild(cell);
  }
  noteRow.appendChild(noteSteps);
  grid.appendChild(noteRow);

  // Glide row
  const glideRow = document.createElement('div');
  glideRow.className = 'seq-glide-row';
  const glideLabel = document.createElement('div');
  glideLabel.className = 'seq-glide-row-label';
  glideLabel.textContent = 'GLIDE';
  glideRow.appendChild(glideLabel);

  const glideSteps = document.createElement('div');
  glideSteps.className = 'seq-glide-row-steps';
  for (let s = 0; s < seq.numSteps; s++) {
    const cell = document.createElement('div');
    cell.className = 'seq-glide-cell';
    cell.dataset.step = s;
    cell.classList.toggle('on', !!seq.getStepGlide(s));
    cell.addEventListener('click', () => {
      const on = seq.getStepGlide(s) ? 0 : 1;
      seq.setStepGlide(s, on);
      cell.classList.toggle('on', !!on);
    });
    glideSteps.appendChild(cell);
  }
  glideRow.appendChild(glideSteps);
  grid.appendChild(glideRow);

  // Step highlight callback
  seq.onStep = (stepIdx) => {
    grid.querySelectorAll('.seq-note-cell').forEach(el => el.classList.remove('current'));
    if (stepIdx >= 0) {
      grid.querySelectorAll(`.seq-note-cell[data-step="${stepIdx}"]`).forEach(el => el.classList.add('current'));
    }
  };
}

function refreshSeqGrid() {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  for (let s = 0; s < seq.numSteps; s++) {
    const cell = grid.querySelector(`.seq-note-cell[data-step="${s}"]`);
    if (cell) {
      const gate = seq.getStepGate(s);
      cell.classList.toggle('on', !!gate);
      cell.textContent = gate ? midiToName(seq.getStepNote(s)) : '';
    }
    const glide = grid.querySelector(`.seq-glide-cell[data-step="${s}"]`);
    if (glide) {
      glide.classList.toggle('on', !!seq.getStepGlide(s));
    }
  }
}

function parseNoteName(str) {
  str = str.trim().toUpperCase();
  const m = str.match(/^([A-G])(#|B)?(-?\d+)$/);
  if (!m) {
    // Try as raw MIDI number
    const n = parseInt(str);
    if (!isNaN(n) && n >= 0 && n <= 127) return n;
    return null;
  }
  const noteMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let note = noteMap[m[1]];
  if (note === undefined) return null;
  if (m[2] === '#') note++;
  else if (m[2] === 'B' && m[1] !== 'B') note--;
  const octave = parseInt(m[3]);
  const midi = (octave + 1) * 12 + note;
  return (midi >= 0 && midi <= 127) ? midi : null;
}

function bindSeqControls() {
  const playBtn = document.getElementById('seq-play');
  const clearBtn = document.getElementById('seq-clear');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (seq.playing) {
        seq.stop();
        playBtn.textContent = 'PLAY';
        playBtn.classList.remove('active');
      } else {
        if (drums.playing) {
          const s = drums.getScheduleState();
          seq.startAt(s.nextStepTime, s.currentStep);
        } else {
          seq.start();
        }
        playBtn.textContent = 'STOP';
        playBtn.classList.add('active');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      seq.clearPattern();
      refreshSeqGrid();
    });
  }

  document.querySelectorAll('.seq-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seq.loadPreset(btn.dataset.seqpreset);
      refreshSeqGrid();
    });
  });
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
  ui.setTempo(arp.getBPM());
  ui.setMasterVolume(audio.getMasterVolume());
  ui.setArpSettings({ division: arp.getDivision(), mode: arp.getMode(), quantize: arp.getQuantize() });
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
