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
import { Sequencer, DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES, SOURCE_TYPES, SYNTH_PRESET_NAMES } from './sequencer.js';
import { SamplePlayer } from './sample-player.js';
import { PresetManager } from './preset-manager.js';

const audio = new AudioEngine();
const lfo = new LFO();
const seq = new Sequencer();
const samplePlayer = new SamplePlayer();
const presets = new PresetManager();
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

function audioNoteOn(freq, midi, name, vel = 1) {
  ensureVisualizer();
  // Record into sequencer if recording + playing
  if (seq.recording && seq.playing) {
    seq.recordNote(midi, vel);
  }
  audio.noteOn(freq, midi, vel);
  ui.showNote(name);
  ui.highlightKey(midi);
}

function audioNoteOff(midi) {
  // Record note-off for note-length tracking
  if (seq.recording && seq.playing) {
    seq.recordNoteOff(midi);
  }
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

function noteOn(freq, midi, name, vel = 1) {
  ensureVisualizer();

  switch (playMode) {
    case 'mono':
      // Last-note priority: kill all, play new
      audio.allNotesOff();
      ui.releaseAllKeys();
      monoHeld.push(midi);
      audioNoteOn(freq, midi, name, vel);
      break;

    case 'poly':
      audioNoteOn(freq, midi, name, vel);
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
    // Note On — normalize velocity 0-127 → 0-1
    const vel = velocity / 127;
    noteOn(midiToFreq(note), note, midiToName(note), vel);
  } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
    // Note Off
    noteOff(note);
  }
}

/* --- Unified Sequencer --- */

let seqInited = false;

function ensureSeqInit() {
  if (seqInited) return;
  seqInited = true;

  seq.init(() => audio.context, samplePlayer);
  seq.onSynthNoteOn = (trackIdx, freq, midi, name, vel) => {
    ensureVisualizer();
    audio.noteOn(freq, midi, vel);
    ui.showNote(name);
    ui.highlightKey(midi);
  };
  seq.onSynthNoteOff = (trackIdx, midi) => {
    audio.noteOff(midi);
    ui.releaseKey(midi);
    if (audio.activeVoiceCount === 0) ui.clearNote();
  };
  seq.setBPM(arp.getBPM());
  buildSeqGrid();
  bindSeqControls();
}

/* ── Track config editor ── */

let _openEditor = null;

function toggleTrackEditor(grid, trackIdx) {
  const existing = grid.querySelector('.track-param-editor');
  if (existing) {
    const prevIdx = parseInt(existing.dataset.trackIdx);
    existing.remove();
    const prevLabel = grid.querySelector(`.track-row[data-track="${prevIdx}"] .track-row-label`);
    if (prevLabel) prevLabel.classList.remove('editing');
    if (prevIdx === trackIdx) { _openEditor = null; return; }
  }

  _openEditor = trackIdx;
  const info = seq.getTrack(trackIdx);
  if (!info) return;
  const row = grid.querySelector(`.track-row[data-track="${trackIdx}"]`);
  if (!row) return;
  row.querySelector('.track-row-label').classList.add('editing');

  const editor = document.createElement('div');
  editor.className = 'track-param-editor';
  editor.dataset.trackIdx = trackIdx;

  if (info.sourceType === 'drum') {
    // Part selector
    const partGrp = document.createElement('div');
    partGrp.className = 'track-param-group';
    const partLabel = document.createElement('label');
    partLabel.textContent = 'PART';
    partGrp.appendChild(partLabel);
    const partSel = document.createElement('div');
    partSel.className = 'track-part-selector';
    DRUM_PARTS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'track-part-btn';
      btn.textContent = p.label;
      if (info.sourceConfig.part === p.id) btn.classList.add('active');
      btn.addEventListener('click', () => {
        seq.setDrumPart(trackIdx, p.id);
        partSel.querySelectorAll('.track-part-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Rebuild param sliders
        rebuildDrumParamSliders(editor, trackIdx);
        // Update row label
        const label = grid.querySelector(`.track-row[data-track="${trackIdx}"] .track-row-label`);
        if (label) label.textContent = p.label;
      });
      partSel.appendChild(btn);
    });
    partGrp.appendChild(partSel);
    editor.appendChild(partGrp);

    // Kit selector
    const kitGrp = document.createElement('div');
    kitGrp.className = 'track-param-group';
    const kitLabel = document.createElement('label');
    kitLabel.textContent = 'KIT';
    kitGrp.appendChild(kitLabel);
    const kitSel = document.createElement('div');
    kitSel.className = 'track-kit-selector';
    KIT_NAMES.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'track-kit-btn';
      btn.textContent = k;
      if (info.sourceConfig.kit === k) btn.classList.add('active');
      btn.addEventListener('click', () => {
        seq.setDrumKit(trackIdx, k);
        kitSel.querySelectorAll('.track-kit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rebuildDrumParamSliders(editor, trackIdx);
      });
      kitSel.appendChild(btn);
    });
    kitGrp.appendChild(kitSel);
    editor.appendChild(kitGrp);

    // Param sliders container
    const paramsDiv = document.createElement('div');
    paramsDiv.className = 'track-drum-params';
    editor.appendChild(paramsDiv);
    rebuildDrumParamSliders(editor, trackIdx);

    // Audition
    const aud = document.createElement('button');
    aud.className = 'track-audition-btn';
    aud.textContent = '\u25B6';
    aud.addEventListener('click', () => seq.triggerDrum(trackIdx));
    editor.appendChild(aud);

  } else if (info.sourceType === 'sample') {
    const fileGrp = document.createElement('div');
    fileGrp.className = 'track-param-group';
    const fileLabel = document.createElement('label');
    fileLabel.textContent = info.sourceConfig.sampleName || 'No sample loaded';
    fileGrp.appendChild(fileLabel);
    const fileBtn = document.createElement('button');
    fileBtn.className = 'track-part-btn';
    fileBtn.textContent = 'LOAD';
    fileBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.addEventListener('change', async () => {
        if (!input.files.length) return;
        const ctx = audio.context;
        const name = await samplePlayer.loadFile(ctx, input.files[0]);
        seq.setSampleName(trackIdx, name);
        fileLabel.textContent = name;
        // Update row label
        const rowLabel = grid.querySelector(`.track-row[data-track="${trackIdx}"] .track-row-label`);
        if (rowLabel) rowLabel.textContent = name;
      });
      input.click();
    });
    fileGrp.appendChild(fileBtn);
    editor.appendChild(fileGrp);

    // Audition
    const aud = document.createElement('button');
    aud.className = 'track-audition-btn';
    aud.textContent = '\u25B6';
    aud.addEventListener('click', () => seq.triggerSample(trackIdx));
    editor.appendChild(aud);

  } else {
    // Synth track — synth preset buttons
    const presetGrp = document.createElement('div');
    presetGrp.className = 'track-param-group';
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'PATTERN';
    presetGrp.appendChild(presetLabel);
    const presetSel = document.createElement('div');
    presetSel.className = 'track-part-selector';
    SYNTH_PRESET_NAMES.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'track-part-btn';
      btn.textContent = seq.getSynthPresetLabel(name);
      btn.addEventListener('click', () => {
        seq.loadSynthPreset(trackIdx, name);
        refreshSeqGrid();
      });
      presetSel.appendChild(btn);
    });
    presetGrp.appendChild(presetSel);
    editor.appendChild(presetGrp);
  }

  // Insert editor after the row's group
  const rowGroup = row.closest('.track-row-group');
  if (rowGroup) rowGroup.after(editor);
  else row.after(editor);
}

function rebuildDrumParamSliders(editor, trackIdx) {
  const container = editor.querySelector('.track-drum-params');
  if (!container) return;
  container.innerHTML = '';
  const info = seq.getTrack(trackIdx);
  if (!info || info.sourceType !== 'drum') return;
  const defs = DRUM_PART_PARAMS[info.sourceConfig.part] || [];
  const params = seq.getDrumParams(trackIdx);
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
      seq.setDrumParam(trackIdx, def.id, parseFloat(slider.value));
    });
    grp.appendChild(slider);
    container.appendChild(grp);
  });
}

/* ── Grid building ── */

function buildSeqGrid() {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  grid.innerHTML = '';
  _openEditor = null;

  for (let t = 0; t < seq.trackCount; t++) {
    buildTrackRow(grid, t);
  }

  // Add track buttons
  if (seq.trackCount < seq.maxTracks) {
    const addRow = document.createElement('div');
    addRow.className = 'seq-add-row';
    ['synth', 'drum', 'sample'].forEach(type => {
      const btn = document.createElement('button');
      btn.className = 'seq-add-btn seq-add-' + type;
      btn.textContent = '+ ' + type.toUpperCase();
      btn.addEventListener('click', () => {
        seq.addTrack(type);
        buildSeqGrid();
      });
      addRow.appendChild(btn);
    });
    grid.appendChild(addRow);
  }

  // Step highlight
  seq.onStep = (stepIdx) => {
    grid.querySelectorAll('.track-step').forEach(el => el.classList.remove('current'));
    if (stepIdx >= 0) {
      grid.querySelectorAll(`.track-step[data-step="${stepIdx}"]`).forEach(el => el.classList.add('current'));
    }
  };
}

function applySeqTieClasses(t) {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  const cells = Array.from(grid.querySelectorAll(`.track-step[data-track="${t}"]`));
  if (cells.length !== seq.numSteps) return;
  cells.forEach(c => c.classList.remove('tie-start', 'tie-mid', 'tie-end'));
  for (let s = 0; s < seq.numSteps; s++) {
    if (!seq.getStepGate(t, s)) continue;
    const tiedFromPrev = s > 0
      && seq.getStepGate(t, s - 1)
      && seq.getStepGlide(t, s - 1)
      && seq.getStepNote(t, s) === seq.getStepNote(t, s - 1);
    const tiesToNext = s < seq.numSteps - 1
      && seq.getStepGlide(t, s)
      && seq.getStepGate(t, s + 1)
      && seq.getStepNote(t, s) === seq.getStepNote(t, s + 1);
    if (tiedFromPrev && tiesToNext) {
      cells[s].classList.add('tie-mid');
      cells[s].textContent = '';
    } else if (tiedFromPrev) {
      cells[s].classList.add('tie-end');
      cells[s].textContent = '';
    } else if (tiesToNext) {
      cells[s].classList.add('tie-start');
    }
  }
}

function buildTrackRow(grid, t) {
  const info = seq.getTrack(t);
  if (!info) return;
  const isSynth = info.sourceType === 'synth';

  const rowGroup = document.createElement('div');
  rowGroup.className = 'track-row-group';
  rowGroup.dataset.track = t;

  // Main row
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.track = t;
  row.dataset.type = info.sourceType;
  if (isSynth && t === seq.recTrack) row.classList.add('rec-target');

  // Type badge
  const badge = document.createElement('div');
  badge.className = 'track-type-badge track-type-' + info.sourceType;
  badge.textContent = info.sourceType === 'synth' ? 'S' : info.sourceType === 'drum' ? 'D' : 'P';
  badge.title = 'Click to change type';
  badge.addEventListener('click', () => {
    const types = SOURCE_TYPES;
    const cur = types.indexOf(info.sourceType);
    const next = types[(cur + 1) % types.length];
    seq.setTrackSource(t, next);
    buildSeqGrid();
  });
  row.appendChild(badge);

  // Label
  const label = document.createElement('div');
  label.className = 'track-row-label';
  label.textContent = info.name;
  label.addEventListener('click', () => {
    if (info.sourceType === 'drum') seq.triggerDrum(t);
    else if (info.sourceType === 'sample') seq.triggerSample(t);
    toggleTrackEditor(grid, t);
  });
  if (isSynth) {
    label.addEventListener('click', (e) => {
      if (e.detail === 1) {
        seq.setRecTrack(t);
        grid.querySelectorAll('.track-row').forEach(el => el.classList.remove('rec-target'));
        grid.querySelectorAll(`.track-row[data-track="${t}"]`).forEach(el => el.classList.add('rec-target'));
      }
    });
  }
  row.appendChild(label);

  // Steps
  const stepsDiv = document.createElement('div');
  stepsDiv.className = 'track-row-steps';

  for (let s = 0; s < seq.numSteps; s++) {
    const cell = document.createElement('div');
    cell.className = 'track-step';
    cell.dataset.track = t;
    cell.dataset.step = s;
    const gate = seq.getStepGate(t, s);
    const vel = seq.getStepVel(t, s);
    cell.classList.toggle('on', !!gate);

    if (isSynth && gate) {
      cell.textContent = midiToName(seq.getStepNote(t, s));
      cell.style.opacity = 0.3 + vel * 0.7;
    }

    cell.addEventListener('click', (e) => {
      if (e.detail > 1) return;
      const on = seq.toggleGate(t, s);
      cell.classList.toggle('on', !!on);
      if (isSynth) {
        cell.textContent = on ? midiToName(seq.getStepNote(t, s)) : '';
        if (on) cell.style.opacity = 0.3 + seq.getStepVel(t, s) * 0.7;
        else cell.style.opacity = '';
        applySeqTieClasses(t);
      }
    });

    // Synth-specific: double-click to edit note, wheel to adjust
    if (isSynth) {
      cell.addEventListener('dblclick', () => {
        if (!seq.getStepGate(t, s)) {
          seq.setGate(t, s, true);
          cell.classList.add('on');
        }
        const input = document.createElement('input');
        input.className = 'seq-note-input';
        input.type = 'text';
        input.value = midiToName(seq.getStepNote(t, s));
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const parsed = parseNoteName(input.value);
          if (parsed !== null) seq.setStepNote(t, s, parsed);
          if (input.parentNode) cell.textContent = midiToName(seq.getStepNote(t, s));
          applySeqTieClasses(t);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { input.blur(); }
        });
      });

      cell.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!seq.getStepGate(t, s)) return;
        if (e.shiftKey) {
          const dir = e.deltaY < 0 ? 0.05 : -0.05;
          const newVel = Math.max(0.05, Math.min(1, seq.getStepVel(t, s) + dir));
          seq.setStepVel(t, s, newVel);
          cell.style.opacity = 0.3 + newVel * 0.7;
        } else {
          const dir = e.deltaY < 0 ? 1 : -1;
          seq.setStepNote(t, s, seq.getStepNote(t, s) + dir);
          cell.textContent = midiToName(seq.getStepNote(t, s));
          applySeqTieClasses(t);
        }
      });
    }

    stepsDiv.appendChild(cell);
  }
  row.appendChild(stepsDiv);

  // Mute
  const muteBtn = document.createElement('div');
  muteBtn.className = 'track-mute-btn';
  muteBtn.textContent = 'M';
  muteBtn.classList.toggle('active', seq.getTrackMuted(t));
  muteBtn.addEventListener('click', () => {
    const muted = seq.toggleTrackMute(t);
    muteBtn.classList.toggle('active', muted);
  });
  row.appendChild(muteBtn);

  // Volume
  const volWrap = document.createElement('div');
  volWrap.className = 'track-row-vol';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.01';
  vol.value = seq.getTrackVolume(t);
  vol.addEventListener('input', () => seq.setTrackVolume(t, parseFloat(vol.value)));
  volWrap.appendChild(vol);
  row.appendChild(volWrap);

  // Remove button
  if (seq.trackCount > 1) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'track-remove-btn';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove track';
    removeBtn.addEventListener('click', () => {
      seq.removeTrack(t);
      buildSeqGrid();
    });
    row.appendChild(removeBtn);
  }

  rowGroup.appendChild(row);

  // Glide row (synth tracks only)
  if (isSynth) {
    const glideRow = document.createElement('div');
    glideRow.className = 'track-glide-row';
    const glideLabel = document.createElement('div');
    glideLabel.className = 'track-glide-label';
    glideLabel.textContent = 'GLD';
    glideRow.appendChild(glideLabel);
    const glideSteps = document.createElement('div');
    glideSteps.className = 'track-glide-steps';
    for (let s = 0; s < seq.numSteps; s++) {
      const cell = document.createElement('div');
      cell.className = 'track-glide-cell';
      cell.dataset.track = t;
      cell.dataset.step = s;
      cell.classList.toggle('on', !!seq.getStepGlide(t, s));
      cell.addEventListener('click', () => {
        const on = seq.getStepGlide(t, s) ? 0 : 1;
        seq.setStepGlide(t, s, on);
        cell.classList.toggle('on', !!on);
        applySeqTieClasses(t);
      });
      glideSteps.appendChild(cell);
    }
    glideRow.appendChild(glideSteps);
    const spacer = document.createElement('div');
    spacer.className = 'track-glide-spacer';
    glideRow.appendChild(spacer);
    rowGroup.appendChild(glideRow);
  }

  grid.appendChild(rowGroup);
  if (isSynth) applySeqTieClasses(t);
}

function refreshSeqGrid() {
  buildSeqGrid();
}

function parseNoteName(str) {
  str = str.trim().toUpperCase();
  const m = str.match(/^([A-G])(#|B)?(-?\d+)$/);
  if (!m) {
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
  const recBtn = document.getElementById('seq-rec');
  const clearBtn = document.getElementById('seq-clear');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (seq.playing) {
        seq.stop();
        seq.setRecording(false);
        playBtn.textContent = 'PLAY';
        playBtn.classList.remove('active');
        if (recBtn) recBtn.classList.remove('active');
      } else {
        seq.start();
        playBtn.textContent = 'STOP';
        playBtn.classList.add('active');
      }
    });
  }

  if (recBtn) {
    recBtn.addEventListener('click', () => {
      const on = !seq.recording;
      seq.setRecording(on);
      recBtn.classList.toggle('active', on);
      if (on && !seq.playing && playBtn) {
        seq.start();
        playBtn.textContent = 'STOP';
        playBtn.classList.add('active');
      }
    });
  }

  // Record step update callback
  seq.onRecordStep = (trackIdx, stepIdx) => {
    const grid = document.getElementById('seq-grid');
    if (!grid) return;
    const cell = grid.querySelector(`.track-step[data-track="${trackIdx}"][data-step="${stepIdx}"]`);
    if (cell) {
      cell.classList.add('on');
      const info = seq.getTrack(trackIdx);
      if (info && info.sourceType === 'synth') {
        cell.textContent = midiToName(seq.getStepNote(trackIdx, stepIdx));
        cell.style.opacity = 0.3 + seq.getStepVel(trackIdx, stepIdx) * 0.7;
      }
    }
    const prevStep = (stepIdx - 1 + seq.numSteps) % seq.numSteps;
    const glideCell = grid.querySelector(`.track-glide-cell[data-track="${trackIdx}"][data-step="${prevStep}"]`);
    if (glideCell) {
      glideCell.classList.toggle('on', !!seq.getStepGlide(trackIdx, prevStep));
    }
    applySeqTieClasses(trackIdx);
  };

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      seq.clearPattern();
      refreshSeqGrid();
    });
  }

  // Drum preset buttons
  document.querySelectorAll('.seq-drum-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seq.loadDrumPreset(btn.dataset.preset);
      refreshSeqGrid();
    });
  });
}

/* ── Project management ── */

function getGlobalBPM() { return arp.getBPM(); }

function setGlobalBPM(bpm) {
  arp.setBPM(bpm);
  seq.setBPM(bpm);
  ui.setTempo(bpm);
}

function setGlobalSwing(amount) {
  seq.setSwing(amount);
}

function refreshAllUI() {
  // Synth panel
  ui.setWaveform(1, audio.getWaveform(1));
  ui.setWaveform(2, audio.getWaveform(2));
  ui.setOscVolume(1, audio.getVolume(1));
  ui.setOscVolume(2, audio.getVolume(2));
  ui.setOscShape(1, audio.getShape(1));
  ui.setOscShape(2, audio.getShape(2));
  ui.setOscPitch(1, audio.getPitch(1));
  ui.setOscPitch(2, audio.getPitch(2));
  ui.setOscOctave(1, audio.getOctave(1));
  ui.setOscOctave(2, audio.getOctave(2));
  ui.setFilterType(audio.getFilterType());
  ui.setFilterModel(audio.getFilterModel());
  ui.setFilterCutoff(audio.getFilterCutoff());
  ui.setFilterQ(audio.getFilterQ());
  ui.setFilterGain(audio.getFilterGain());
  const adsr = audio.getADSR();
  ui.setADSR(adsr);
  ui.setMasterVolume(audio.getMasterVolume());
  ui.setChorusEnabled(audio.getChorusEnabled());
  ui.setChorusRate(audio.getChorusRate());
  ui.setChorusDepth(audio.getChorusDepth());
  ui.setChorusMix(audio.getChorusMix());
  ui.setChorusWidth(audio.getChorusWidth());
  ui.setChorusHPC(audio.getChorusHPC());
  ui.setReverbEnabled(audio.getReverbEnabled());
  ui.setReverbDecay(audio.getReverbDecay());
  ui.setReverbMix(audio.getReverbMix());
  ui.setLFOWaveform(lfo.getWaveform());
  ui.setLFORate(lfo.getRate());
  ui.setOsc3Mode(audio.getOsc3Mode());
  ui.setOsc3Volume(audio.getOsc3Volume());
  ui.setOsc3Pitch(audio.getOsc3Pitch());
  ui.setOsc3Octave(audio.getOsc3Octave());
  // Sequencer grid
  if (document.getElementById('seq-grid')) {
    refreshSeqGrid();
  }
}

function refreshProjectList() {
  const list = document.getElementById('project-list');
  if (!list) return;
  list.innerHTML = '';
  const names = presets.listStoredProjects();
  names.forEach(name => {
    const item = document.createElement('div');
    item.className = 'project-list-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    nameSpan.className = 'project-list-name';
    nameSpan.addEventListener('click', () => {
      const ok = presets.loadFromStorage(name, seq, audio, lfo, setGlobalBPM, setGlobalSwing);
      if (ok) {
        const nameInput = document.getElementById('project-name');
        if (nameInput) nameInput.value = name;
        refreshAllUI();
      }
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'project-delete-btn';
    delBtn.textContent = '\u00D7';
    delBtn.title = 'Delete project';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      presets.deleteFromStorage(name);
      refreshProjectList();
    });
    item.appendChild(nameSpan);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

function bindProjectControls() {
  const saveBtn = document.getElementById('project-save');
  const exportBtn = document.getElementById('project-export');
  const importBtn = document.getElementById('project-import');
  const importFile = document.getElementById('project-import-file');
  const nameInput = document.getElementById('project-name');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const name = (nameInput && nameInput.value.trim()) || 'Untitled';
      presets.saveToStorage(name, seq, audio, lfo);
      refreshProjectList();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const name = (nameInput && nameInput.value.trim()) || 'Untitled';
      presets.exportJSON(name, seq, audio, lfo);
    });
  }

  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      if (!importFile.files.length) return;
      try {
        const name = await presets.importJSON(
          importFile.files[0], seq, audio, lfo, setGlobalBPM, setGlobalSwing
        );
        if (name && nameInput) nameInput.value = name;
        refreshAllUI();
        refreshProjectList();
      } catch (e) {
        console.warn('Import failed:', e);
      }
      importFile.value = '';
    });
  }

  // Patch save/load
  const patchSaveBtn = document.getElementById('patch-save');
  const patchNameInput = document.getElementById('patch-name');
  const patchList = document.getElementById('patch-list');

  if (patchSaveBtn) {
    patchSaveBtn.addEventListener('click', () => {
      const name = (patchNameInput && patchNameInput.value.trim()) || 'Patch 1';
      presets.savePatch(name, audio, lfo);
      refreshPatchList();
    });
  }

  refreshProjectList();
  refreshPatchList();
}

function refreshPatchList() {
  const list = document.getElementById('patch-list');
  if (!list) return;
  list.innerHTML = '';
  presets.getPatchIds().forEach(id => {
    const item = document.createElement('div');
    item.className = 'patch-list-item';
    if (id === presets.currentPatchId) item.classList.add('active');
    item.textContent = id;
    item.addEventListener('click', () => {
      presets.loadPatch(id, audio, lfo);
      refreshAllUI();
      refreshPatchList();
    });
    list.appendChild(item);
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

  /* ── Project save/load/export UI ── */
  bindProjectControls();
});
