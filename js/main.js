/**
 * Main entry — sequencer-centric app.
 * The sequencer is the primary view with 16 tracks.
 * The synth engine panel is collapsible below.
 */

import { AudioEngine } from './audio.js';
import { KeyboardManager, midiToFreq, midiToName } from './keyboard.js';
import { UIManager } from './ui.js';
import { Visualizer } from './visualizer.js';
import { Arpeggiator } from './arpeggiator.js';
import { LFO } from './lfo.js';
import { Sequencer, STEPS_PER_PAGE, MAX_PAGES, MAX_STEPS, DRUM_PARTS, DRUM_PART_IDS, DRUM_PART_PARAMS, DRUM_KITS, KIT_NAMES, DRUM_PRESETS, DRUM_PRESET_NAMES, SOURCE_TYPES, SYNTH_PRESET_NAMES, CHAIN_FILTER_MODELS } from './sequencer.js';
import { SamplePlayer } from './sample-player.js';
import { PresetManager } from './preset-manager.js';

const ENGINE_LABELS = { synth: 'FORGE', drum: 'ANVIL', sample: 'CAST' };
const audio = new AudioEngine();
const lfo = new LFO();
const seq = new Sequencer();
const samplePlayer = new SamplePlayer();
const presets = new PresetManager();
let visualizer = null;
let playMode = 'mono';

// Active engine — the engine whose params the synth panel edits & keyboard plays through.
// Starts as the global engine; switches to per-track engine when a synth track is selected.
let activeEngine = audio;
let activeTrackIdx = -1;  // -1 = global engine, otherwise the track index

// MIDI step-edit: when set, incoming MIDI notes write to this step instead of playing
let _midiEditStep = null;  // { track, step } or null

/** Switch the synth panel to control a specific track's engine. */
function selectSynthTrack(trackIdx) {
  const engine = seq.getTrackEngine(trackIdx);
  if (!engine) return;
  activeEngine = engine;
  activeTrackIdx = trackIdx;
  seq.setRecTrack(trackIdx);
  // Update visualizer to show this engine's filter response
  if (visualizer) {
    visualizer.setRefFilters(activeEngine.getRefFilters());
    updateVisualizerDrawMode();
  }
  // Refresh the synth panel to show this engine's current settings
  refreshSynthPanelUI();
}

/** Update synth panel controls to reflect activeEngine state (without triggering callbacks). */
function refreshSynthPanelUI() {
  ui.setActiveWaveform(1, activeEngine.getWaveform(1));
  ui.setActiveWaveform(2, activeEngine.getWaveform(2));
  ui.setVolume(1, activeEngine.getVolume(1));
  ui.setVolume(2, activeEngine.getVolume(2));
  ui.setShape(1, activeEngine.getShape(1));
  ui.setShape(2, activeEngine.getShape(2));
  ui.setPitch(1, activeEngine.getPitch(1));
  ui.setPitch(2, activeEngine.getPitch(2));
  ui.setOctave(1, activeEngine.getOctave(1));
  ui.setOctave(2, activeEngine.getOctave(2));
  ui.setFilterType(activeEngine.getFilterType());
  ui.setFilterModel(activeEngine.getFilterModel());
  ui.setFilterCutoff(activeEngine.getFilterCutoff());
  ui.setFilterQ(activeEngine.getFilterQ());
  ui.setFilterGain(activeEngine.getFilterGain());
  ui.setADSR(activeEngine.getADSR());
  ui.setMasterVolume(activeEngine.getMasterVolume());
  ui.setOsc3Mode(activeEngine.getOsc3Mode());
  ui.setOsc3Volume(activeEngine.getOsc3Volume());
  ui.setOsc3Pitch(activeEngine.getOsc3Pitch());
  ui.setOsc3Octave(activeEngine.getOsc3Octave());
}

// Current page view (0-indexed, global for all tracks)
let currentPage = 0;

const monoHeld = [];

function ensureVisualizer() {
  if (visualizer) return;
  const canvas = document.getElementById('oscilloscope');
  if (!canvas) return;
  // Use the sequencer's monitor analyser so we can solo-monitor individual tracks
  const analyser = seq.monitorAnalyser || audio.analyser;
  visualizer = new Visualizer(canvas, analyser, audio.getRefFilters());
  visualizer.setOnCSTDraw((gains) => {
    audio.setCustomFilterCurve(gains);
  });
  visualizer.start();
}

function updateVisualizerDrawMode() {
  if (!visualizer) return;
  const active = activeEngine.isCustomFilterActive();
  visualizer.setDrawMode(
    active,
    active ? activeEngine.getCSTFreqs() : null,
    active ? activeEngine.getCSTBandCount() : 0,
    active ? activeEngine.getCustomFilterCurve() : null
  );
}

/* --- Audio note helpers --- */

function audioNoteOn(freq, midi, name, vel = 1) {
  ensureVisualizer();
  if (seq.recording && seq.playing) {
    seq.recordNote(midi, vel);
  }
  activeEngine.noteOn(freq, midi, vel);
  ui.showNote(name);
  ui.highlightKey(midi);
}

function audioNoteOff(midi) {
  if (seq.recording && seq.playing) {
    seq.recordNoteOff(midi);
  }
  activeEngine.noteOff(midi);
  ui.releaseKey(midi);
  if (activeEngine.activeVoiceCount === 0) ui.clearNote();
}

/* --- Arpeggiator --- */

const arp = new Arpeggiator({
  onNoteOn: audioNoteOn,
  onNoteOff: audioNoteOff,
  getAudioContext: () => audio.context,
});

/* --- Input handlers --- */

function noteOn(freq, midi, name, vel = 1) {
  ensureVisualizer();
  switch (playMode) {
    case 'mono':
      activeEngine.allNotesOff();
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
  activeEngine.allNotesOff();
  ui.releaseAllKeys();
  ui.clearNote();
  monoHeld.length = 0;
  arp.reset();
  playMode = mode;
}

/* --- UI callbacks --- */

const ui = new UIManager({
  onWaveformChange(oscNum, type) { activeEngine.setWaveform(oscNum, type); },
  onVolumeChange(oscNum, value) {
    activeEngine.setVolume(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-volume', value);
  },
  onShapeChange(oscNum, value) {
    activeEngine.setShape(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-shape', value);
  },
  onPitchChange(oscNum, value) {
    activeEngine.setPitch(oscNum, value);
    lfo.updateBase('osc' + oscNum + '-pitch', value);
  },
  onOctaveChange(oscNum, value) { activeEngine.setOctave(oscNum, value); },
  onFilterTypeChange(type) {
    activeEngine.setFilterType(type);
    if (visualizer) {
      updateVisualizerDrawMode();
      visualizer.setRefFilters(activeEngine.getRefFilters());
    }
  },
  onFilterModelChange(model) {
    activeEngine.setFilterModel(model);
    if (visualizer) {
      updateVisualizerDrawMode();
      visualizer.setRefFilters(activeEngine.getRefFilters());
    }
  },
  onFilterCutoffChange(freq) {
    activeEngine.setFilterCutoff(freq);
    lfo.updateBase('filter-cutoff', freq);
  },
  onFilterQChange(value) {
    activeEngine.setFilterQ(value);
    lfo.updateBase('filter-q', value);
  },
  onFilterGainChange(dB) {
    activeEngine.setFilterGain(dB);
    lfo.updateBase('filter-gain', dB);
  },
  onADSRChange(params) { activeEngine.setADSR(params); },
  onPlayModeChange(mode) { setPlayMode(mode); },
  onTempoChange(bpm) {
    arp.setBPM(bpm);
    seq.setBPM(bpm);
  },
  onMasterVolumeChange(v) { activeEngine.setMasterVolume(v); },
  onArpDivisionChange(div) { arp.setDivision(div); },
  onArpModeChange(mode) { arp.setMode(mode); },
  onArpQuantizeChange(on) { arp.setQuantize(on); },
  onChorusEnabledChange(on) { activeEngine.setChorusEnabled(on); },
  onChorusRateChange(hz) { activeEngine.setChorusRate(hz); },
  onChorusDepthChange(ms) { activeEngine.setChorusDepth(ms); },
  onChorusWidthChange(pct) { activeEngine.setChorusWidth(pct); },
  onChorusHPCChange(freq) { activeEngine.setChorusHPC(freq); },
  onChorusMixChange(pct) { activeEngine.setChorusMix(pct); },
  onReverbEnabledChange(on) { activeEngine.setReverbEnabled(on); },
  onReverbDecayChange(seconds) { activeEngine.setReverbDecay(seconds); },
  onReverbMixChange(pct) { activeEngine.setReverbMix(pct); },
  onLFOWaveformChange(type) { lfo.setWaveform(type); },
  onLFORateChange(hz) { lfo.setRate(hz); },
  onLFORouteAdd(targetId) { lfo.addRoute(targetId, 50, activeEngine); },
  onLFORouteRemove(targetId) { lfo.removeRoute(targetId); },
  onLFORouteAmountChange(targetId, amount) { lfo.setRouteAmount(targetId, amount); },
  onOsc3ModeChange(mode) { activeEngine.setOsc3Mode(mode); },
  onOsc3VolumeChange(v) {
    activeEngine.setOsc3Volume(v);
    lfo.updateBase('osc3-volume', v);
  },
  onOsc3PitchChange(v) {
    activeEngine.setOsc3Pitch(v);
    lfo.updateBase('osc3-pitch', v);
  },
  onOsc3OctaveChange(v) { activeEngine.setOsc3Octave(v); },
  onOsc3ColorChange(v) { activeEngine.setOsc3Color(v); },
  onOsc3DampingChange(v) { activeEngine.setOsc3Damping(v); },
  onOsc3RatioChange(v) { activeEngine.setOsc3Ratio(v); },
  onOsc3IndexChange(v) { activeEngine.setOsc3Index(v); },
  onOsc3MorphChange(v) { activeEngine.setOsc3Morph(v); },
  onOsc3VibratoChange(v) { activeEngine.setOsc3Vibrato(v); },
  onNoteOn: noteOn,
  onNoteOff: noteOff,
});

const keyboard = new KeyboardManager({
  onNoteOn: noteOn,
  onNoteOff: noteOff,
});

/* --- Web MIDI --- */

function initMIDI() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then(access => {
    const connectInputs = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = handleMIDIMessage;
      }
    };
    connectInputs();
    access.onstatechange = connectInputs;
  }).catch(() => {});
}

function handleMIDIMessage(e) {
  const [status, note, velocity] = e.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && velocity > 0) {
    // If a step is selected for MIDI edit, write note there instead of playing
    if (_midiEditStep) {
      const { track: t, step: s } = _midiEditStep;
      seq.setStepNote(t, s, note);
      seq.setStepVel(t, s, velocity / 127);
      _updateMidiEditCellDisplay();
      // Also audition the note so the user hears what they entered
      activeEngine.noteOn(midiToFreq(note), note, velocity / 127);
      setTimeout(() => activeEngine.noteOff(note), 200);
      return;
    }
    noteOn(midiToFreq(note), note, midiToName(note), velocity / 127);
  } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
    if (_midiEditStep) return; // Ignore note-off in edit mode
    noteOff(note);
  }
}

/* ── MIDI step-edit helpers ── */

function _setMidiEditStep(track, step, cellEl) {
  _clearMidiEditStep();
  _midiEditStep = { track, step, cell: cellEl };
  cellEl.classList.add('midi-edit');
}

function _clearMidiEditStep() {
  if (_midiEditStep && _midiEditStep.cell) {
    _midiEditStep.cell.classList.remove('midi-edit');
  }
  _midiEditStep = null;
}

function _moveMidiEditStep(dir) {
  if (!_midiEditStep) return;
  const { track: t, step: s } = _midiEditStep;
  const info = seq.getTrack(t);
  if (!info) return;
  const ns = info.numSteps;
  const newStep = (s + dir + ns) % ns;
  const pageOffset = currentPage * STEPS_PER_PAGE;
  // If the new step is on a different page, switch page
  const newPage = Math.floor(newStep / STEPS_PER_PAGE);
  if (newPage !== currentPage) {
    setPage(newPage);
  }
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  const newCell = grid.querySelector(`.track-step[data-track="${t}"][data-step="${newStep}"]`);
  if (newCell) _setMidiEditStep(t, newStep, newCell);
}

function _updateMidiEditCellDisplay() {
  if (!_midiEditStep) return;
  const { track: t, step: s, cell } = _midiEditStep;
  cell.textContent = midiToName(seq.getStepNote(t, s));
  cell.style.opacity = 0.3 + seq.getStepVel(t, s) * 0.7;
  const pageOffset = currentPage * STEPS_PER_PAGE;
  applySeqTieClasses(t, pageOffset);
}

/* ════════════════════════════════════════════════════════════
   SEQUENCER GRID — main UI
   ════════════════════════════════════════════════════════════ */

let _openEditor = null;

function setPage(page) {
  currentPage = Math.max(0, Math.min(MAX_PAGES - 1, page));
  updatePageButtons();
  buildSeqGrid();
}

/* ── Track FX slide-out panel ── */
let _fxPanelTrack = -1;

function openTrackFxPanel(trackIdx) {
  const panel = document.getElementById('track-fx-panel');
  const body = document.getElementById('track-fx-body');
  const title = document.getElementById('track-fx-title');
  if (!panel || !body) return;

  const info = seq.getTrack(trackIdx);
  if (!info) return;

  _fxPanelTrack = trackIdx;

  // Update title
  const label = ENGINE_LABELS[info.sourceType] || info.sourceType.toUpperCase();
  if (title) title.textContent = `${info.name} — ${label} FX`;

  // Populate body with chain modules
  body.innerHTML = '';
  const chain = seq.getTrackChain(trackIdx);
  body.appendChild(buildChainFilterUI(chain, trackIdx));
  body.appendChild(buildChainDistortionUI(chain, trackIdx));
  body.appendChild(buildChainChorusUI(chain, trackIdx));
  body.appendChild(buildChainReverbUI(chain, trackIdx));

  panel.classList.add('open');

  // Highlight the FX button on the track row
  const grid = document.getElementById('seq-grid');
  if (grid) {
    grid.querySelectorAll('.track-fx-btn').forEach(b => b.classList.remove('active'));
    const btn = grid.querySelector(`.track-fx-btn[data-track="${trackIdx}"]`);
    if (btn) btn.classList.add('active');
  }
}

function closeTrackFxPanel() {
  const panel = document.getElementById('track-fx-panel');
  if (panel) panel.classList.remove('open');
  _fxPanelTrack = -1;
  const grid = document.getElementById('seq-grid');
  if (grid) grid.querySelectorAll('.track-fx-btn').forEach(b => b.classList.remove('active'));
}

function toggleTrackFxPanel(trackIdx) {
  if (_fxPanelTrack === trackIdx) {
    closeTrackFxPanel();
  } else {
    openTrackFxPanel(trackIdx);
  }
}

/* ── Track Chain module UI builders ── */

function buildChainFilterUI(chain, trackIdx) {
  const sec = document.createElement('div');
  sec.className = 'chain-module-section';

  const header = document.createElement('div');
  header.className = 'chain-module-header';
  const toggle = document.createElement('button');
  toggle.className = 'chain-module-toggle' + (chain && chain.getFilterEnabled() ? ' active' : '');
  toggle.textContent = 'FILTER';
  header.appendChild(toggle);
  sec.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chain-module-body' + (chain && chain.getFilterEnabled() ? '' : ' hidden');

  // Type selector
  const typeRow = document.createElement('div');
  typeRow.className = 'chain-control-row';
  const typeLabel = document.createElement('span');
  typeLabel.textContent = 'Type';
  typeRow.appendChild(typeLabel);
  const typeSel = document.createElement('select');
  typeSel.className = 'chain-filter-type';
  ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.toUpperCase();
    if (chain && chain.getFilterType() === t) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', () => {
    if (!chain) return;
    chain.setFilterType(typeSel.value);
    // Show/hide model selector (only relevant for lowpass)
    modelRow.style.display = typeSel.value === 'lowpass' ? 'flex' : 'none';
  });
  typeRow.appendChild(typeSel);
  body.appendChild(typeRow);

  // Model selector (only for lowpass)
  const modelRow = document.createElement('div');
  modelRow.className = 'chain-control-row';
  modelRow.style.display = (chain && chain.getFilterType() === 'lowpass') ? 'flex' : 'none';
  const modelLabel = document.createElement('span');
  modelLabel.textContent = 'Model';
  modelRow.appendChild(modelLabel);
  const modelSel = document.createElement('select');
  modelSel.className = 'chain-filter-model';
  Object.entries(CHAIN_FILTER_MODELS).forEach(([key, m]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = m.label;
    if (chain && chain.getFilterModel() === key) opt.selected = true;
    modelSel.appendChild(opt);
  });
  modelSel.addEventListener('change', () => { if (chain) chain.setFilterModel(modelSel.value); });
  modelRow.appendChild(modelSel);
  body.appendChild(modelRow);

  // Cutoff
  const cutRow = document.createElement('div');
  cutRow.className = 'chain-control-row';
  const cutLabel = document.createElement('span');
  cutLabel.textContent = 'Cutoff';
  cutRow.appendChild(cutLabel);
  const cutSlider = document.createElement('input');
  cutSlider.type = 'range';
  cutSlider.min = 0;
  cutSlider.max = 1000;
  const cutoffHz = chain ? chain.getFilterCutoff() : 20000;
  cutSlider.value = Math.round(Math.log(cutoffHz / 20) / Math.log(1000) * 1000);
  cutSlider.dataset.default = 1000;
  const cutVal = document.createElement('span');
  cutVal.className = 'chain-value';
  cutVal.textContent = Math.round(cutoffHz) + ' Hz';
  cutSlider.addEventListener('input', () => {
    if (!chain) return;
    const hz = 20 * Math.pow(1000, cutSlider.value / 1000);
    chain.setFilterCutoff(hz);
    cutVal.textContent = Math.round(hz) + ' Hz';
  });
  cutRow.appendChild(cutSlider);
  cutRow.appendChild(cutVal);
  body.appendChild(cutRow);

  // Q
  const qRow = document.createElement('div');
  qRow.className = 'chain-control-row';
  const qLabel = document.createElement('span');
  qLabel.textContent = 'Q';
  qRow.appendChild(qLabel);
  const qSlider = document.createElement('input');
  qSlider.type = 'range';
  qSlider.min = 1;
  qSlider.max = 3000;
  qSlider.value = Math.round((chain ? chain.getFilterQ() : 0.5) * 100);
  qSlider.dataset.default = 50;
  const qVal = document.createElement('span');
  qVal.className = 'chain-value';
  qVal.textContent = (chain ? chain.getFilterQ() : 0.5).toFixed(2);
  qSlider.addEventListener('input', () => {
    if (!chain) return;
    const q = qSlider.value / 100;
    chain.setFilterQ(q);
    qVal.textContent = q.toFixed(2);
  });
  qRow.appendChild(qSlider);
  qRow.appendChild(qVal);
  body.appendChild(qRow);

  // Gain
  const gainRow = document.createElement('div');
  gainRow.className = 'chain-control-row';
  const gainLabel = document.createElement('span');
  gainLabel.textContent = 'Gain';
  gainRow.appendChild(gainLabel);
  const gainSlider = document.createElement('input');
  gainSlider.type = 'range';
  gainSlider.min = -2400;
  gainSlider.max = 2400;
  gainSlider.value = Math.round((chain ? chain.getFilterGain() : 0) * 100);
  gainSlider.dataset.default = 0;
  const gainVal = document.createElement('span');
  gainVal.className = 'chain-value';
  gainVal.textContent = (chain ? chain.getFilterGain() : 0).toFixed(1) + ' dB';
  gainSlider.addEventListener('input', () => {
    if (!chain) return;
    const dB = gainSlider.value / 100;
    chain.setFilterGain(dB);
    gainVal.textContent = dB.toFixed(1) + ' dB';
  });
  gainRow.appendChild(gainSlider);
  gainRow.appendChild(gainVal);
  body.appendChild(gainRow);

  sec.appendChild(body);

  toggle.addEventListener('click', () => {
    if (!chain) return;
    const on = !chain.getFilterEnabled();
    chain.setFilterEnabled(on);
    toggle.classList.toggle('active', on);
    body.classList.toggle('hidden', !on);
  });

  return sec;
}

function buildChainChorusUI(chain, trackIdx) {
  const sec = document.createElement('div');
  sec.className = 'chain-module-section';

  const header = document.createElement('div');
  header.className = 'chain-module-header';
  const toggle = document.createElement('button');
  toggle.className = 'chain-module-toggle' + (chain && chain.getChorusEnabled() ? ' active' : '');
  toggle.textContent = 'CHORUS';
  header.appendChild(toggle);
  sec.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chain-module-body' + (chain && chain.getChorusEnabled() ? '' : ' hidden');

  // Rate
  const rateRow = document.createElement('div');
  rateRow.className = 'chain-control-row';
  const rateLabel = document.createElement('span');
  rateLabel.textContent = 'Rate';
  rateRow.appendChild(rateLabel);
  const rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.min = 10;
  rateSlider.max = 800;
  rateSlider.value = Math.round((chain ? chain.getChorusRate() : 1.5) * 100);
  rateSlider.dataset.default = 150;
  const rateVal = document.createElement('span');
  rateVal.className = 'chain-value';
  rateVal.textContent = (chain ? chain.getChorusRate() : 1.5).toFixed(2) + ' Hz';
  rateSlider.addEventListener('input', () => {
    if (!chain) return;
    const v = rateSlider.value / 100;
    chain.setChorusRate(v);
    rateVal.textContent = v.toFixed(2) + ' Hz';
  });
  rateRow.appendChild(rateSlider);
  rateRow.appendChild(rateVal);
  body.appendChild(rateRow);

  // Depth
  const depthRow = document.createElement('div');
  depthRow.className = 'chain-control-row';
  const depthLabel = document.createElement('span');
  depthLabel.textContent = 'Depth';
  depthRow.appendChild(depthLabel);
  const depthSlider = document.createElement('input');
  depthSlider.type = 'range';
  depthSlider.min = 0;
  depthSlider.max = 1000;
  depthSlider.value = Math.round((chain ? chain.getChorusDepth() : 3) * 100);
  depthSlider.dataset.default = 300;
  const depthVal = document.createElement('span');
  depthVal.className = 'chain-value';
  depthVal.textContent = (chain ? chain.getChorusDepth() : 3).toFixed(1) + ' ms';
  depthSlider.addEventListener('input', () => {
    if (!chain) return;
    const v = depthSlider.value / 100;
    chain.setChorusDepth(v);
    depthVal.textContent = v.toFixed(1) + ' ms';
  });
  depthRow.appendChild(depthSlider);
  depthRow.appendChild(depthVal);
  body.appendChild(depthRow);

  // Mix
  const mixRow = document.createElement('div');
  mixRow.className = 'chain-control-row';
  const mixLabel = document.createElement('span');
  mixLabel.textContent = 'Mix';
  mixRow.appendChild(mixLabel);
  const mixSlider = document.createElement('input');
  mixSlider.type = 'range';
  mixSlider.min = 0;
  mixSlider.max = 100;
  mixSlider.value = Math.round(chain ? chain.getChorusMix() : 50);
  mixSlider.dataset.default = 50;
  const mixVal = document.createElement('span');
  mixVal.className = 'chain-value';
  mixVal.textContent = Math.round(chain ? chain.getChorusMix() : 50) + '%';
  mixSlider.addEventListener('input', () => {
    if (!chain) return;
    chain.setChorusMix(parseInt(mixSlider.value));
    mixVal.textContent = mixSlider.value + '%';
  });
  mixRow.appendChild(mixSlider);
  mixRow.appendChild(mixVal);
  body.appendChild(mixRow);

  sec.appendChild(body);

  toggle.addEventListener('click', () => {
    if (!chain) return;
    const on = !chain.getChorusEnabled();
    chain.setChorusEnabled(on);
    toggle.classList.toggle('active', on);
    body.classList.toggle('hidden', !on);
  });

  return sec;
}

function buildChainReverbUI(chain, trackIdx) {
  const sec = document.createElement('div');
  sec.className = 'chain-module-section';

  const header = document.createElement('div');
  header.className = 'chain-module-header';
  const toggle = document.createElement('button');
  toggle.className = 'chain-module-toggle' + (chain && chain.getReverbEnabled() ? ' active' : '');
  toggle.textContent = 'REVERB';
  header.appendChild(toggle);
  sec.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chain-module-body' + (chain && chain.getReverbEnabled() ? '' : ' hidden');

  // Decay
  const decayRow = document.createElement('div');
  decayRow.className = 'chain-control-row';
  const decayLabel = document.createElement('span');
  decayLabel.textContent = 'Decay';
  decayRow.appendChild(decayLabel);
  const decaySlider = document.createElement('input');
  decaySlider.type = 'range';
  decaySlider.min = 10;
  decaySlider.max = 1000;
  decaySlider.value = Math.round((chain ? chain.getReverbDecay() : 2) * 100);
  decaySlider.dataset.default = 200;
  const decayVal = document.createElement('span');
  decayVal.className = 'chain-value';
  decayVal.textContent = (chain ? chain.getReverbDecay() : 2).toFixed(1) + 's';
  decaySlider.addEventListener('input', () => {
    if (!chain) return;
    const v = decaySlider.value / 100;
    chain.setReverbDecay(v);
    decayVal.textContent = v.toFixed(1) + 's';
  });
  decayRow.appendChild(decaySlider);
  decayRow.appendChild(decayVal);
  body.appendChild(decayRow);

  // Mix
  const mixRow = document.createElement('div');
  mixRow.className = 'chain-control-row';
  const mixLabel = document.createElement('span');
  mixLabel.textContent = 'Mix';
  mixRow.appendChild(mixLabel);
  const mixSlider = document.createElement('input');
  mixSlider.type = 'range';
  mixSlider.min = 0;
  mixSlider.max = 100;
  mixSlider.value = Math.round(chain ? chain.getReverbMix() : 30);
  mixSlider.dataset.default = 30;
  const mixVal = document.createElement('span');
  mixVal.className = 'chain-value';
  mixVal.textContent = Math.round(chain ? chain.getReverbMix() : 30) + '%';
  mixSlider.addEventListener('input', () => {
    if (!chain) return;
    chain.setReverbMix(parseInt(mixSlider.value));
    mixVal.textContent = mixSlider.value + '%';
  });
  mixRow.appendChild(mixSlider);
  mixRow.appendChild(mixVal);
  body.appendChild(mixRow);

  sec.appendChild(body);

  toggle.addEventListener('click', () => {
    if (!chain) return;
    const on = !chain.getReverbEnabled();
    chain.setReverbEnabled(on);
    toggle.classList.toggle('active', on);
    body.classList.toggle('hidden', !on);
  });

  return sec;
}

function buildChainDistortionUI(chain, trackIdx) {
  const sec = document.createElement('div');
  sec.className = 'chain-module-section';

  const header = document.createElement('div');
  header.className = 'chain-module-header';
  const toggle = document.createElement('button');
  toggle.className = 'chain-module-toggle';
  toggle.textContent = 'DISTORTION';
  if (chain && chain.getDistortionEnabled()) toggle.classList.add('active');
  header.appendChild(toggle);
  sec.appendChild(header);

  const body = document.createElement('div');
  body.className = 'chain-module-body';
  if (!chain || !chain.getDistortionEnabled()) body.classList.add('hidden');

  // Drive
  const driveRow = document.createElement('div');
  driveRow.className = 'chain-control-row';
  const driveLbl = document.createElement('span');
  driveLbl.textContent = 'Drive';
  driveRow.appendChild(driveLbl);
  const driveSlider = document.createElement('input');
  driveSlider.type = 'range'; driveSlider.min = 10; driveSlider.max = 5000; driveSlider.step = 1;
  driveSlider.value = chain ? Math.round(chain.getDistortionDrive() * 100) : 400;
  driveSlider.dataset.default = 400;
  const driveVal = document.createElement('span');
  driveVal.className = 'chain-value';
  driveVal.textContent = chain ? chain.getDistortionDrive().toFixed(1) : '4.0';
  driveSlider.addEventListener('input', () => {
    if (!chain) return;
    const v = parseInt(driveSlider.value) / 100;
    chain.setDistortionDrive(v);
    driveVal.textContent = v.toFixed(1);
  });
  driveRow.appendChild(driveSlider);
  driveRow.appendChild(driveVal);
  body.appendChild(driveRow);

  // Tone
  const toneRow = document.createElement('div');
  toneRow.className = 'chain-control-row';
  const toneLbl = document.createElement('span');
  toneLbl.textContent = 'Tone';
  toneRow.appendChild(toneLbl);
  const toneSlider = document.createElement('input');
  toneSlider.type = 'range'; toneSlider.min = 200; toneSlider.max = 12000; toneSlider.step = 10;
  toneSlider.value = chain ? chain.getDistortionTone() : 4000;
  toneSlider.dataset.default = 4000;
  const toneVal = document.createElement('span');
  toneVal.className = 'chain-value';
  toneVal.textContent = chain ? Math.round(chain.getDistortionTone()) + ' Hz' : '4000 Hz';
  toneSlider.addEventListener('input', () => {
    if (!chain) return;
    const v = parseInt(toneSlider.value);
    chain.setDistortionTone(v);
    toneVal.textContent = v + ' Hz';
  });
  toneRow.appendChild(toneSlider);
  toneRow.appendChild(toneVal);
  body.appendChild(toneRow);

  // Mix
  const mixRow = document.createElement('div');
  mixRow.className = 'chain-control-row';
  const mixLbl = document.createElement('span');
  mixLbl.textContent = 'Mix';
  mixRow.appendChild(mixLbl);
  const mixSlider = document.createElement('input');
  mixSlider.type = 'range'; mixSlider.min = 0; mixSlider.max = 100; mixSlider.step = 1;
  mixSlider.value = chain ? Math.round(chain.getDistortionMix()) : 50;
  mixSlider.dataset.default = 50;
  const mixVal = document.createElement('span');
  mixVal.className = 'chain-value';
  mixVal.textContent = (chain ? Math.round(chain.getDistortionMix()) : 50) + '%';
  mixSlider.addEventListener('input', () => {
    if (!chain) return;
    chain.setDistortionMix(parseInt(mixSlider.value));
    mixVal.textContent = mixSlider.value + '%';
  });
  mixRow.appendChild(mixSlider);
  mixRow.appendChild(mixVal);
  body.appendChild(mixRow);

  sec.appendChild(body);

  toggle.addEventListener('click', () => {
    if (!chain) return;
    const on = !chain.getDistortionEnabled();
    chain.setDistortionEnabled(on);
    toggle.classList.toggle('active', on);
    body.classList.toggle('hidden', !on);
  });

  return sec;
}

/* ── Track selection — populates bottom panel ── */

function selectTrack(trackIdx) {
  const info = seq.getTrack(trackIdx);
  if (!info) return;

  // Release any held notes on the current engine before switching
  if (activeEngine) {
    activeEngine.allNotesOff();
    ui.releaseAllKeys();
    monoHeld.length = 0;
    arp.reset();
  }

  activeTrackIdx = trackIdx;

  // Monitor this track in the visualizer
  seq.setMonitorTrack(trackIdx);

  // Highlight the selected track row-group
  const grid = document.getElementById('seq-grid');
  if (grid) {
    grid.querySelectorAll('.track-row-group').forEach(el => {
      el.classList.remove('selected');
      const lbl = el.querySelector('.track-row-label');
      if (lbl) { lbl.style.color = ''; lbl.style.fontWeight = ''; }
      const nm = el.querySelector('.track-num');
      if (nm) { nm.style.color = ''; nm.style.fontWeight = ''; }
    });
    grid.querySelectorAll(`.track-row-group[data-track="${trackIdx}"]`).forEach(el => {
      el.classList.add('selected');
      const lbl = el.querySelector('.track-row-label');
      if (lbl) { lbl.style.color = '#5bc0eb'; lbl.style.fontWeight = '700'; }
      const nm = el.querySelector('.track-num');
      if (nm) { nm.style.color = '#5bc0eb'; nm.style.fontWeight = '700'; }
    });
  }

  // Open the panel if closed
  const panelBody = document.getElementById('synth-panel-body');
  const arrow = document.getElementById('synth-panel-toggle');
  if (panelBody && !panelBody.classList.contains('open')) {
    panelBody.classList.add('open');
    if (arrow) arrow.textContent = '\u25B2';
  }

  // Update panel title
  const titleEl = document.getElementById('synth-panel-title');
  if (titleEl) titleEl.textContent = `${info.name} — ${ENGINE_LABELS[info.sourceType] || info.sourceType.toUpperCase()}`;

  const synthSections = document.getElementById('synth-sections');
  const trackParamsView = document.getElementById('track-params-view');
  const modeDiv = document.querySelector('.synth-panel-mode');

  if (info.sourceType === 'synth') {
    // Show synth UI, hide track-params
    if (synthSections) synthSections.classList.remove('hidden');
    if (trackParamsView) { trackParamsView.classList.add('hidden'); trackParamsView.innerHTML = ''; }
    if (modeDiv) modeDiv.style.display = '';
    selectSynthTrack(trackIdx);
    seq.setRecTrack(trackIdx);
  } else {
    // Hide synth UI, show track-params
    if (synthSections) synthSections.classList.add('hidden');
    if (modeDiv) modeDiv.style.display = 'none';
    if (trackParamsView) {
      trackParamsView.classList.remove('hidden');
      trackParamsView.innerHTML = '';
      buildTrackParamsPanel(trackParamsView, trackIdx, info);
    }
  }

  updatePageButtons();
}

function buildTrackParamsPanel(container, trackIdx, info) {
  // Pages & Steps
  const pgSection = document.createElement('div');
  pgSection.className = 'track-params-section';
  const pgTitle = document.createElement('div');
  pgTitle.className = 'track-params-section-label';
  pgTitle.textContent = 'SEQUENCE';
  pgSection.appendChild(pgTitle);

  const pgRow = document.createElement('div');
  pgRow.className = 'track-params-row';
  const pgLabel = document.createElement('label');
  pgLabel.textContent = 'Pages';
  pgRow.appendChild(pgLabel);
  const pgSel = document.createElement('select');
  for (let p = 1; p <= MAX_PAGES; p++) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === info.pages) opt.selected = true;
    pgSel.appendChild(opt);
  }
  pgRow.appendChild(pgSel);
  pgSection.appendChild(pgRow);

  const stRow = document.createElement('div');
  stRow.className = 'track-params-row';
  const stLabel = document.createElement('label');
  stLabel.textContent = 'Steps';
  stRow.appendChild(stLabel);
  const stepsInput = document.createElement('input');
  stepsInput.type = 'range';
  stepsInput.min = 1;
  stepsInput.max = info.pages * STEPS_PER_PAGE;
  stepsInput.value = info.numSteps;
  const stepsVal = document.createElement('span');
  stepsVal.className = 'param-value';
  stepsVal.textContent = info.numSteps;
  stepsInput.addEventListener('input', () => {
    seq.setTrackNumSteps(trackIdx, parseInt(stepsInput.value) || 1);
    const ni = seq.getTrack(trackIdx);
    stepsInput.value = ni.numSteps;
    stepsVal.textContent = ni.numSteps;
    buildSeqGrid();
  });
  pgSel.addEventListener('change', () => {
    seq.setTrackPages(trackIdx, parseInt(pgSel.value));
    const ni = seq.getTrack(trackIdx);
    stepsInput.max = ni.pages * STEPS_PER_PAGE;
    stepsInput.value = ni.numSteps;
    stepsVal.textContent = ni.numSteps;
    buildSeqGrid();
  });
  stRow.appendChild(stepsInput);
  stRow.appendChild(stepsVal);
  pgSection.appendChild(stRow);
  container.appendChild(pgSection);

  // Type-specific controls
  if (info.sourceType === 'drum') {
    buildDrumParamsPanel(container, trackIdx, info);
  } else if (info.sourceType === 'sample') {
    buildSampleParamsPanel(container, trackIdx, info);
  }

}

function buildDrumParamsPanel(container, trackIdx, info) {
  const section = document.createElement('div');
  section.className = 'track-params-section';
  const title = document.createElement('div');
  title.className = 'track-params-section-label';
  title.textContent = 'ANVIL';
  section.appendChild(title);

  // Part selector
  const partRow = document.createElement('div');
  partRow.className = 'track-params-row';
  const partLabel = document.createElement('label');
  partLabel.textContent = 'Part';
  partRow.appendChild(partLabel);
  const partBtns = document.createElement('div');
  partBtns.className = 'track-params-btn-group';
  DRUM_PARTS.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    if (info.sourceConfig.part === p.id) btn.classList.add('active');
    btn.addEventListener('click', () => {
      seq.setDrumPart(trackIdx, p.id);
      partBtns.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Rebuild param sliders
      const paramContainer = section.querySelector('.drum-param-sliders');
      if (paramContainer) buildDrumSliders(paramContainer, trackIdx);
      // Update track label
      const grid = document.getElementById('seq-grid');
      if (grid) {
        const lbl = grid.querySelector(`.track-row[data-track="${trackIdx}"] .track-row-label`);
        if (lbl) lbl.textContent = p.label;
      }
    });
    partBtns.appendChild(btn);
  });
  partRow.appendChild(partBtns);
  section.appendChild(partRow);

  // Kit selector
  const kitRow = document.createElement('div');
  kitRow.className = 'track-params-row';
  const kitLabel = document.createElement('label');
  kitLabel.textContent = 'Kit';
  kitRow.appendChild(kitLabel);
  const kitBtns = document.createElement('div');
  kitBtns.className = 'track-params-btn-group';
  KIT_NAMES.forEach(k => {
    const btn = document.createElement('button');
    btn.textContent = k;
    if (info.sourceConfig.kit === k) btn.classList.add('active');
    btn.addEventListener('click', () => {
      seq.setDrumKit(trackIdx, k);
      kitBtns.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const paramContainer = section.querySelector('.drum-param-sliders');
      if (paramContainer) buildDrumSliders(paramContainer, trackIdx);
    });
    kitBtns.appendChild(btn);
  });
  kitRow.appendChild(kitBtns);
  section.appendChild(kitRow);

  // Param sliders
  const paramDiv = document.createElement('div');
  paramDiv.className = 'drum-param-sliders';
  section.appendChild(paramDiv);
  buildDrumSliders(paramDiv, trackIdx);

  // Audition button
  const audRow = document.createElement('div');
  audRow.className = 'track-params-row';
  const aud = document.createElement('button');
  aud.className = 'track-params-btn-group';
  aud.textContent = '\u25B6 PLAY';
  aud.style.cssText = 'background:#5bc0eb;color:#111;border:none;padding:4px 12px;border-radius:3px;cursor:pointer;font-weight:600;font-size:11px;';
  aud.addEventListener('click', () => seq.triggerDrum(trackIdx));
  audRow.appendChild(aud);
  section.appendChild(audRow);

  container.appendChild(section);
}

function buildDrumSliders(container, trackIdx) {
  container.innerHTML = '';
  const info = seq.getTrack(trackIdx);
  if (!info || info.sourceType !== 'drum') return;
  const defs = DRUM_PART_PARAMS[info.sourceConfig.part] || [];
  const params = seq.getDrumParams(trackIdx);
  defs.forEach(def => {
    const row = document.createElement('div');
    row.className = 'track-params-row';
    const lbl = document.createElement('label');
    lbl.textContent = def.label;
    row.appendChild(lbl);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = def.min;
    slider.max = def.max;
    slider.step = def.step;
    slider.value = params[def.id] !== undefined ? params[def.id] : 1;
    slider.dataset.default = slider.value;
    const val = document.createElement('span');
    val.className = 'param-value';
    val.textContent = parseFloat(slider.value).toFixed(2);
    slider.addEventListener('input', () => {
      seq.setDrumParam(trackIdx, def.id, parseFloat(slider.value));
      val.textContent = parseFloat(slider.value).toFixed(2);
    });
    row.appendChild(slider);
    row.appendChild(val);
    container.appendChild(row);
  });
}

function buildSampleParamsPanel(container, trackIdx, info) {
  const section = document.createElement('div');
  section.className = 'track-params-section';
  const title = document.createElement('div');
  title.className = 'track-params-section-label';
  title.textContent = 'CAST';
  section.appendChild(title);

  const fileRow = document.createElement('div');
  fileRow.className = 'track-params-row';
  const fileLabel = document.createElement('label');
  fileLabel.textContent = info.sourceConfig.sampleName || 'None';
  fileLabel.style.width = 'auto';
  fileRow.appendChild(fileLabel);
  const fileBtn = document.createElement('button');
  fileBtn.textContent = 'LOAD';
  fileBtn.style.cssText = 'background:#5bc0eb;color:#111;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;font-weight:600;font-size:10px;';
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
      const grid = document.getElementById('seq-grid');
      if (grid) {
        const lbl = grid.querySelector(`.track-row[data-track="${trackIdx}"] .track-row-label`);
        if (lbl) lbl.textContent = name;
      }
    });
    input.click();
  });
  fileRow.appendChild(fileBtn);
  section.appendChild(fileRow);

  // Audition
  const audRow = document.createElement('div');
  audRow.className = 'track-params-row';
  const aud = document.createElement('button');
  aud.textContent = '\u25B6 PLAY';
  aud.style.cssText = 'background:#5bc0eb;color:#111;border:none;padding:4px 12px;border-radius:3px;cursor:pointer;font-weight:600;font-size:11px;';
  aud.addEventListener('click', () => seq.triggerSample(trackIdx));
  audRow.appendChild(aud);
  section.appendChild(audRow);

  container.appendChild(section);
}

/* ── Grid building ── */

// Paint-drag state: mousedown on a step → drag across to paint on/off
let _painting = false;   // currently dragging?
let _paintMode = null;   // 'on' or 'off' — determined by first cell
let _paintTrack = -1;    // locked to the track where drag started

// Note-resize drag state
let _resizing = false;
let _resizeTrack = -1;
let _resizeEdge = null;     // 'left' or 'right'
let _resizeMidi = 60;       // the MIDI note being resized
let _resizeVel = 1;
let _resizeOrigStart = -1;  // original note group start step
let _resizeOrigEnd = -1;    // original note group end step
let _resizePageOffset = 0;

/** Find the tied note group containing step s on track t.
 *  Returns { start, end } absolute step indices (inclusive). */
function _findNoteGroup(t, s) {
  const note = seq.getStepNote(t, s);
  let start = s;
  while (start > 0
    && seq.getStepGate(t, start - 1)
    && seq.getStepGlide(t, start - 1)
    && seq.getStepNote(t, start - 1) === note) {
    start--;
  }
  let end = s;
  const info = seq.getTrack(t);
  const ns = info ? info.numSteps : 16;
  while (end < ns - 1
    && seq.getStepGlide(t, end)
    && seq.getStepGate(t, end + 1)
    && seq.getStepNote(t, end + 1) === note) {
    end++;
  }
  return { start, end };
}

/** Check if mouse is near left or right edge of a cell (within edgePx). */
function _getEdge(e, cell, edgePx) {
  const rect = cell.getBoundingClientRect();
  if (e.clientX - rect.left < edgePx) return 'left';
  if (rect.right - e.clientX < edgePx) return 'right';
  return null;
}

/** Refresh a single step cell's visual state (gate, note text, opacity, ties). */
function _refreshCell(t, s, pageOffset) {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  const cellIdx = s - pageOffset;
  if (cellIdx < 0 || cellIdx >= STEPS_PER_PAGE) return;
  const cell = grid.querySelector(`.track-step[data-track="${t}"][data-cell="${cellIdx}"]`);
  if (!cell) return;
  const gate = seq.getStepGate(t, s);
  cell.classList.toggle('on', !!gate);
  if (gate) {
    cell.textContent = midiToName(seq.getStepNote(t, s));
    cell.style.opacity = 0.3 + seq.getStepVel(t, s) * 0.7;
  } else {
    cell.textContent = '';
    cell.style.opacity = '';
  }
  // Also update corresponding glide cell
  const glideCell = grid.querySelector(`.track-glide-cell[data-track="${t}"][data-step="${s}"]`);
  if (glideCell) glideCell.classList.toggle('on', !!seq.getStepGlide(t, s));
}

/** Start a note-resize drag from a cell edge. */
function _startResize(t, s, edge, pageOffset) {
  const group = _findNoteGroup(t, s);
  _resizing = true;
  _resizeTrack = t;
  _resizeEdge = edge;
  _resizeMidi = seq.getStepNote(t, s);
  _resizeVel = seq.getStepVel(t, s);
  _resizeOrigStart = group.start;
  _resizeOrigEnd = group.end;
  _resizePageOffset = pageOffset;
}

/** Handle mousemove during resize — extend/shrink note group to target step. */
function _handleResizeMove(targetStep) {
  const t = _resizeTrack;
  const info = seq.getTrack(t);
  if (!info) return;
  const ns = info.numSteps;
  const po = _resizePageOffset;

  // Clamp target
  targetStep = Math.max(0, Math.min(ns - 1, targetStep));

  // Current group boundaries
  const cur = _findNoteGroup(t, _resizeEdge === 'left' ? _resizeOrigEnd : _resizeOrigStart);
  const curStart = cur.start;
  const curEnd = cur.end;

  if (_resizeEdge === 'right') {
    // Extend or shrink the right side of the group
    const newEnd = Math.max(_resizeOrigStart, targetStep); // can't shrink past group start
    if (newEnd > curEnd) {
      // Extend right: fill steps from curEnd+1..newEnd
      for (let i = curEnd + 1; i <= newEnd; i++) {
        // Only extend into empty steps (don't overwrite other notes)
        if (seq.getStepGate(t, i) && seq.getStepNote(t, i) !== _resizeMidi) break;
        seq.setGate(t, i, true);
        seq.setStepNote(t, i, _resizeMidi);
        seq.setStepVel(t, i, _resizeVel);
        if (i > 0) seq.setStepGlide(t, i - 1, true);
        _refreshCell(t, i, po);
      }
    } else if (newEnd < curEnd) {
      // Shrink right: remove steps from curEnd..newEnd+1
      for (let i = curEnd; i > newEnd; i--) {
        seq.setGate(t, i, false);
        seq.setStepGlide(t, i, false);
        _refreshCell(t, i, po);
      }
      // The new last step should not glide
      seq.setStepGlide(t, newEnd, false);
    }
    // Ensure the step before the group end has glide
    if (newEnd > _resizeOrigStart) {
      for (let i = _resizeOrigStart; i < newEnd; i++) {
        seq.setStepGlide(t, i, true);
      }
    }
  } else {
    // Extend or shrink the left side of the group
    const newStart = Math.min(_resizeOrigEnd, targetStep); // can't shrink past group end
    if (newStart < curStart) {
      // Extend left: fill steps from newStart..curStart-1
      for (let i = curStart - 1; i >= newStart; i--) {
        if (seq.getStepGate(t, i) && seq.getStepNote(t, i) !== _resizeMidi) break;
        seq.setGate(t, i, true);
        seq.setStepNote(t, i, _resizeMidi);
        seq.setStepVel(t, i, _resizeVel);
        seq.setStepGlide(t, i, true);
        _refreshCell(t, i, po);
      }
    } else if (newStart > curStart) {
      // Shrink left: remove steps from curStart..newStart-1
      for (let i = curStart; i < newStart; i++) {
        seq.setGate(t, i, false);
        seq.setStepGlide(t, i, false);
        _refreshCell(t, i, po);
      }
    }
    // Ensure glides within the group
    const finalEnd = _resizeOrigEnd;
    for (let i = newStart; i < finalEnd; i++) {
      if (seq.getStepGate(t, i) && seq.getStepNote(t, i) === _resizeMidi) {
        seq.setStepGlide(t, i, true);
      }
    }
    // Last step of group should not glide (unless it already tied to something after)
    seq.setStepGlide(t, finalEnd, false);
  }
  applySeqTieClasses(t, po);
}

function _applyPaint(cell, t, s, isSynth, pageOffset) {
  const current = seq.getStepGate(t, s);
  if (_paintMode === 'on' && !current) {
    seq.setGate(t, s, true);
    cell.classList.add('on');
    if (isSynth) {
      cell.textContent = midiToName(seq.getStepNote(t, s));
      cell.style.opacity = 0.3 + seq.getStepVel(t, s) * 0.7;
      applySeqTieClasses(t, pageOffset);
    }
  } else if (_paintMode === 'off' && current) {
    seq.setGate(t, s, false);
    cell.classList.remove('on');
    if (isSynth) {
      cell.textContent = '';
      cell.style.opacity = '';
      if (_midiEditStep && _midiEditStep.track === t && _midiEditStep.step === s) _clearMidiEditStep();
      applySeqTieClasses(t, pageOffset);
    }
  }
}

window.addEventListener('mouseup', () => {
  _painting = false;
  _paintMode = null;
  _paintTrack = -1;
  _resizing = false;
  _resizeTrack = -1;
  _resizeEdge = null;
});

const LABEL_MAX = 10;
function truncLabel(name) {
  if (!name) return '';
  return name.length > LABEL_MAX ? name.slice(0, LABEL_MAX - 2) + '..' : name;
}

function buildSeqGrid() {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  grid.innerHTML = '';
  _openEditor = null;
  _clearMidiEditStep();

  const pageOffset = currentPage * STEPS_PER_PAGE;

  for (let t = 0; t < seq.trackCount; t++) {
    buildTrackRow(grid, t, pageOffset);
  }

  // Step highlight callback (per-track steps array)
  seq.onStep = (trackStepsArr) => {
    grid.querySelectorAll('.track-step').forEach(el => el.classList.remove('current'));
    if (!trackStepsArr) return;
    trackStepsArr.forEach((step, idx) => {
      if (step < 0) return;
      // Only highlight if step is on the current page
      if (step >= pageOffset && step < pageOffset + STEPS_PER_PAGE) {
        const cellIdx = step - pageOffset;
        const cell = grid.querySelector(`.track-step[data-track="${idx}"][data-cell="${cellIdx}"]`);
        if (cell) cell.classList.add('current');
      }
    });
  };
}

function buildTrackRow(grid, t, pageOffset) {
  const info = seq.getTrack(t);
  if (!info) return;
  const isSynth = info.sourceType === 'synth';
  const trackNumSteps = info.numSteps;
  const trackMaxStep = info.pages * STEPS_PER_PAGE;

  const rowGroup = document.createElement('div');
  rowGroup.className = 'track-row-group';
  rowGroup.dataset.track = t;
  const isSelected = (t === activeTrackIdx);
  if (isSelected) rowGroup.classList.add('selected');

  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.track = t;
  row.dataset.type = info.sourceType;
  if (isSynth && t === seq.recTrack) row.classList.add('rec-target');
  row.addEventListener('click', () => {
    if (activeTrackIdx !== t) selectTrack(t);
  });

  // Track number
  const num = document.createElement('div');
  num.className = 'track-num';
  num.textContent = t + 1;
  if (isSelected) { num.style.color = '#5bc0eb'; num.style.fontWeight = '700'; }
  num.style.cursor = 'pointer';
  num.addEventListener('click', (e) => {
    e.stopPropagation();
    selectTrack(t);
  });
  row.appendChild(num);

  // Type badge
  const badge = document.createElement('div');
  badge.className = 'track-type-badge track-type-' + info.sourceType;
  badge.textContent = info.sourceType === 'synth' ? 'F' : info.sourceType === 'drum' ? 'A' : 'C';
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
  // Label (truncated display, double-click to rename)
  const label = document.createElement('div');
  label.className = 'track-row-label';
  label.textContent = truncLabel(info.name);
  label.title = info.name;
  if (isSelected) { label.style.color = '#5bc0eb'; label.style.fontWeight = '700'; }
  label.addEventListener('click', () => {
    selectTrack(t);
  });
  label.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'track-rename-input';
    input.value = seq.getTrack(t)?.name || '';
    input.maxLength = 32;
    label.textContent = '';
    label.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) {
        seq.setTrackName(t, val);
        // Update bottom panel title if this track is selected
        if (activeTrackIdx === t) {
          const titleEl = document.getElementById('synth-panel-title');
          if (titleEl) titleEl.textContent = `${val} — ${ENGINE_LABELS[seq.getTrack(t).sourceType] || seq.getTrack(t).sourceType.toUpperCase()}`;
        }
      }
      const current = seq.getTrack(t)?.name || '';
      label.textContent = truncLabel(current);
      label.title = current;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = seq.getTrack(t)?.name || ''; input.blur(); }
    });
  });
  row.appendChild(label);

  // Per-track steps control (drag or click to edit)
  const stepsCtrl = document.createElement('div');
  stepsCtrl.className = 'track-steps-ctrl';
  stepsCtrl.textContent = trackNumSteps;
  stepsCtrl.title = 'Drag up/down or click to edit steps';

  // Click to type
  stepsCtrl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'track-steps-edit';
    inp.min = 1;
    inp.max = MAX_STEPS;
    inp.value = seq.getTrack(t)?.numSteps || STEPS_PER_PAGE;
    stepsCtrl.textContent = '';
    stepsCtrl.appendChild(inp);
    inp.focus();
    inp.select();
    const commit = () => {
      const v = parseInt(inp.value);
      if (!isNaN(v) && v > 0) {
        const pages = Math.ceil(v / STEPS_PER_PAGE);
        seq.setTrackPages(t, pages);
        seq.setTrackNumSteps(t, v);
      }
      const ni = seq.getTrack(t);
      stepsCtrl.textContent = ni ? ni.numSteps : STEPS_PER_PAGE;
      buildSeqGrid();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { inp.blur(); }
    });
  });

  // Drag up/down to adjust (snap to 16)
  let dragStartY = null;
  let dragStartVal = 0;
  stepsCtrl.addEventListener('mousedown', (e) => {
    if (e.detail > 1) return; // ignore dblclick start
    e.preventDefault();
    dragStartY = e.clientY;
    dragStartVal = seq.getTrack(t)?.numSteps || STEPS_PER_PAGE;
    stepsCtrl.classList.add('dragging');

    const onMove = (ev) => {
      const dy = dragStartY - ev.clientY; // up = positive
      const stepsDelta = Math.round(dy / 12) * STEPS_PER_PAGE; // snap every 12px to 16 steps
      const newVal = Math.max(1, Math.min(MAX_STEPS, dragStartVal + stepsDelta));
      const pages = Math.ceil(newVal / STEPS_PER_PAGE);
      seq.setTrackPages(t, pages);
      seq.setTrackNumSteps(t, newVal);
      stepsCtrl.textContent = newVal;
    };
    const onUp = () => {
      stepsCtrl.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      buildSeqGrid();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  row.appendChild(stepsCtrl);

  // Steps (16 cells for current page)
  const stepsDiv = document.createElement('div');
  stepsDiv.className = 'track-row-steps';

  for (let c = 0; c < STEPS_PER_PAGE; c++) {
    const s = pageOffset + c; // absolute step index
    const cell = document.createElement('div');
    cell.className = 'track-step';
    cell.dataset.track = t;
    cell.dataset.cell = c;
    cell.dataset.step = s;

    // Check if step is beyond this track's range
    const beyondPages = s >= trackMaxStep;
    const beyondSteps = s >= trackNumSteps;

    if (beyondPages) {
      cell.classList.add('disabled');
    } else if (beyondSteps) {
      cell.classList.add('inactive');
    } else {
      const gate = seq.getStepGate(t, s);
      const vel = seq.getStepVel(t, s);
      cell.classList.toggle('on', !!gate);

      if (isSynth && gate) {
        cell.textContent = midiToName(seq.getStepNote(t, s));
        cell.style.opacity = 0.3 + vel * 0.7;
      }

      cell.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        if (_resizing) return;
        if (activeTrackIdx !== t) { selectTrack(t); return; }
        // If painting handled it, skip normal click
        if (_painting) return;
        const gate = seq.getStepGate(t, s);
        if (isSynth && gate) {
          // If this step is already selected for MIDI edit, deselect it
          if (_midiEditStep && _midiEditStep.track === t && _midiEditStep.step === s) {
            _clearMidiEditStep();
            return;
          }
          // Select this step for MIDI input
          _setMidiEditStep(t, s, cell);
          return;
        }
      });

      // Paint-drag: mousedown starts painting
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (activeTrackIdx !== t) { selectTrack(t); }
        const gate = seq.getStepGate(t, s);
        // Note-resize: detect edge drag on active synth steps
        if (isSynth && gate) {
          const edge = _getEdge(e, cell, 7);
          if (edge) {
            e.preventDefault();
            e.stopPropagation();
            _startResize(t, s, edge, pageOffset);
            return;
          }
          return; // let click handle MIDI edit
        }
        e.preventDefault();
        _painting = true;
        _paintTrack = t;
        _paintMode = gate ? 'off' : 'on';
        _applyPaint(cell, t, s, isSynth, pageOffset);
      });

      cell.addEventListener('mouseenter', () => {
        // Resize drag: determine target step from which cell we entered
        if (_resizing && _resizeTrack === t) {
          _handleResizeMove(s);
          return;
        }
        if (!_painting || _paintTrack !== t) return;
        _applyPaint(cell, t, s, isSynth, pageOffset);
      });

      // Cursor: show resize cursor when hovering near edges of active synth steps
      if (isSynth) {
        cell.addEventListener('mousemove', (e) => {
          if (_resizing || _painting) return;
          if (!seq.getStepGate(t, s)) { cell.style.cursor = ''; return; }
          const edge = _getEdge(e, cell, 7);
          cell.style.cursor = edge ? 'ew-resize' : '';
        });
        cell.addEventListener('mouseleave', () => {
          if (!_resizing) cell.style.cursor = '';
        });
      }

      // Double-click to delete a step (all track types)
      cell.addEventListener('dblclick', () => {
        if (!seq.getStepGate(t, s)) return;
        seq.setGate(t, s, false);
        cell.classList.remove('on');
        if (isSynth) {
          cell.textContent = '';
          cell.style.opacity = '';
          if (_midiEditStep && _midiEditStep.track === t && _midiEditStep.step === s) _clearMidiEditStep();
          applySeqTieClasses(t, pageOffset);
        }
      });

      if (isSynth) {
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
            applySeqTieClasses(t, pageOffset);
          }
        });
      }
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

  // Solo
  const soloBtn = document.createElement('div');
  soloBtn.className = 'track-solo-btn';
  soloBtn.textContent = 'S';
  soloBtn.classList.toggle('active', seq.getTrackSolo(t));
  soloBtn.addEventListener('click', () => {
    const solo = seq.toggleTrackSolo(t);
    soloBtn.classList.toggle('active', solo);
  });
  row.appendChild(soloBtn);

  // Volume
  const volWrap = document.createElement('div');
  volWrap.className = 'track-row-vol';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.01';
  vol.value = seq.getTrackVolume(t);
  vol.dataset.default = '1';
  vol.addEventListener('input', () => seq.setTrackVolume(t, parseFloat(vol.value)));
  volWrap.appendChild(vol);
  row.appendChild(volWrap);

  // Clear track (hold-to-confirm pattern)
  const clearBtn = document.createElement('button');
  clearBtn.className = 'track-clear-btn';
  clearBtn.textContent = 'CLR';
  clearBtn.title = 'Clear track (click twice to confirm)';
  let clearArmed = false;
  let clearTimer = null;
  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.classList.add('armed');
      clearBtn.textContent = 'SURE?';
      clearTimer = setTimeout(() => {
        clearArmed = false;
        clearBtn.classList.remove('armed');
        clearBtn.textContent = 'CLR';
      }, 2000);
    } else {
      clearArmed = false;
      if (clearTimer) clearTimeout(clearTimer);
      clearBtn.classList.remove('armed');
      clearBtn.textContent = 'CLR';
      seq.resetTrack(t);
      buildSeqGrid();
      // Refresh bottom panel if this track is selected
      if (activeTrackIdx === t) selectTrack(t);
    }
  });
  row.appendChild(clearBtn);

  // FX button — opens the track effects slide-out panel
  const fxBtn = document.createElement('div');
  fxBtn.className = 'track-fx-btn';
  fxBtn.dataset.track = t;
  fxBtn.textContent = 'FX';
  if (_fxPanelTrack === t) fxBtn.classList.add('active');
  fxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTrackFxPanel(t);
  });
  row.appendChild(fxBtn);

  rowGroup.appendChild(row);

  // Glide row (always rendered for consistent height; interactive only for synth)
  {
    const glideRow = document.createElement('div');
    glideRow.className = 'track-glide-row';
    const glideLabel = document.createElement('div');
    glideLabel.className = 'track-glide-label';
    glideLabel.textContent = isSynth ? 'GLD' : '';
    glideRow.appendChild(glideLabel);
    const glideSteps = document.createElement('div');
    glideSteps.className = 'track-glide-steps';
    for (let c = 0; c < STEPS_PER_PAGE; c++) {
      const s = pageOffset + c;
      const cell = document.createElement('div');
      cell.className = 'track-glide-cell';
      cell.dataset.track = t;
      cell.dataset.step = s;
      if (!isSynth || s >= trackMaxStep) {
        cell.classList.add('inactive');
      } else if (s >= trackNumSteps) {
        cell.classList.add('inactive');
      } else {
        cell.classList.toggle('on', !!seq.getStepGlide(t, s));
        cell.addEventListener('click', () => {
          const on = seq.getStepGlide(t, s) ? 0 : 1;
          seq.setStepGlide(t, s, on);
          cell.classList.toggle('on', !!on);
          applySeqTieClasses(t, pageOffset);
        });
      }
      glideSteps.appendChild(cell);
    }
    glideRow.appendChild(glideSteps);
    const spacer = document.createElement('div');
    spacer.className = 'track-glide-spacer';
    glideRow.appendChild(spacer);
    rowGroup.appendChild(glideRow);
  }

  grid.appendChild(rowGroup);
  if (isSynth && pageOffset < trackMaxStep) applySeqTieClasses(t, pageOffset);
}

function applySeqTieClasses(t, pageOffset) {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  const cells = Array.from(grid.querySelectorAll(`.track-step[data-track="${t}"]`));
  if (cells.length !== STEPS_PER_PAGE) return;
  cells.forEach(c => c.classList.remove('tie-start', 'tie-mid', 'tie-end'));
  for (let c = 0; c < STEPS_PER_PAGE; c++) {
    const s = pageOffset + c;
    if (!seq.getStepGate(t, s)) continue;
    const tiedFromPrev = s > 0
      && seq.getStepGate(t, s - 1)
      && seq.getStepGlide(t, s - 1)
      && seq.getStepNote(t, s) === seq.getStepNote(t, s - 1);
    const tiesToNext = seq.getStepGlide(t, s)
      && seq.getStepGate(t, s + 1)
      && seq.getStepNote(t, s) === seq.getStepNote(t, s + 1);
    if (tiedFromPrev && tiesToNext) {
      cells[c].classList.add('tie-mid');
      cells[c].textContent = '';
    } else if (tiedFromPrev) {
      cells[c].classList.add('tie-end');
      cells[c].textContent = '';
    } else if (tiesToNext) {
      cells[c].classList.add('tie-start');
    }
  }
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

/* ── Transport controls ── */

function bindTransportControls() {
  const playBtn = document.getElementById('seq-play');
  const recBtn = document.getElementById('seq-rec');
  const clearBtn = document.getElementById('seq-clear');
  const metroBtn = document.getElementById('metro-btn');
  const prerollBtn = document.getElementById('preroll-btn');

  // Metronome toggle
  if (metroBtn) {
    metroBtn.addEventListener('click', () => {
      const on = !seq.metronome;
      seq.setMetronome(on);
      metroBtn.classList.toggle('active', on);
    });
  }

  // Preroll toggle
  if (prerollBtn) {
    prerollBtn.addEventListener('click', () => {
      const on = !seq.preroll;
      seq.setPreroll(on);
      prerollBtn.classList.toggle('active', on);
    });
  }

  // Preroll countdown UI
  seq.onPrerollTick = (remaining, total) => {
    if (remaining <= 0) {
      if (playBtn) { playBtn.textContent = '\u25A0 STOP'; playBtn.classList.add('active'); }
      return;
    }
    if (playBtn) {
      const beat = Math.ceil(remaining / 4);
      playBtn.textContent = `${beat}...`;
      playBtn.classList.add('active');
    }
  };

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (seq.playing || seq.prerolling) {
        seq.stop();
        seq.setRecording(false);
        playBtn.textContent = '\u25B6 PLAY';
        playBtn.classList.remove('active');
        if (recBtn) recBtn.classList.remove('active');
      } else {
        seq.start();
        playBtn.textContent = '\u25A0 STOP';
        playBtn.classList.add('active');
      }
    });
  }

  if (recBtn) {
    recBtn.addEventListener('click', () => {
      const on = !seq.recording;
      seq.setRecording(on);
      recBtn.classList.toggle('active', on);
      if (on && !seq.playing && !seq.prerolling) {
        if (seq.preroll) {
          // Start with preroll countdown, then playback begins automatically
          seq.startWithPreroll();
        } else {
          seq.start();
        }
        if (playBtn) { playBtn.textContent = '\u25A0 STOP'; playBtn.classList.add('active'); }
      }
    });
  }

  // Panic — kill all sound immediately
  const panicBtn = document.getElementById('seq-panic');
  if (panicBtn) {
    panicBtn.addEventListener('click', () => {
      audio.allNotesOff();
      seq.panic();
      arp.reset();
      monoHeld.length = 0;
      ui.releaseAllKeys();
      ui.clearNote();
    });
  }

  // Record step update
  seq.onRecordStep = (trackIdx, stepIdx) => {
    const grid = document.getElementById('seq-grid');
    if (!grid) return;
    const pageOffset = currentPage * STEPS_PER_PAGE;
    if (stepIdx >= pageOffset && stepIdx < pageOffset + STEPS_PER_PAGE) {
      const cellIdx = stepIdx - pageOffset;
      const cell = grid.querySelector(`.track-step[data-track="${trackIdx}"][data-cell="${cellIdx}"]`);
      if (cell) {
        cell.classList.add('on');
        const info = seq.getTrack(trackIdx);
        if (info && info.sourceType === 'synth') {
          cell.textContent = midiToName(seq.getStepNote(trackIdx, stepIdx));
          cell.style.opacity = 0.3 + seq.getStepVel(trackIdx, stepIdx) * 0.7;
        }
      }
    }
    applySeqTieClasses(trackIdx, pageOffset);
  };

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      seq.clearPattern();
      buildSeqGrid();
    });
  }

  // Drum preset buttons
  document.querySelectorAll('.seq-drum-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      seq.loadDrumPreset(btn.dataset.preset);
      buildSeqGrid();
    });
  });
}

/* ── Page navigation ── */

function bindPageNav() {
  document.querySelectorAll('.seq-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      // If a track is selected and this page is beyond its current pages, expand it
      if (activeTrackIdx >= 0) {
        const info = seq.getTrack(activeTrackIdx);
        if (info && page >= info.pages) {
          seq.setTrackPages(activeTrackIdx, page + 1);
          // Also extend numSteps to fill the new page
          seq.setTrackNumSteps(activeTrackIdx, (page + 1) * STEPS_PER_PAGE);
        }
      }
      setPage(page);
    });
  });
}

/* ── Master pattern length ── */

function bindMasterLength() {
  const display = document.getElementById('master-len-display');
  const upBtn = document.getElementById('master-len-up');
  const downBtn = document.getElementById('master-len-down');
  if (!display) return;

  function updateDisplay() {
    const len = seq.masterLength;
    display.textContent = len === 0 ? 'OFF' : len;
  }

  if (upBtn) {
    upBtn.addEventListener('click', () => {
      const cur = seq.masterLength;
      seq.setMasterLength(cur === 0 ? STEPS_PER_PAGE : cur + STEPS_PER_PAGE);
      updateDisplay();
    });
  }
  if (downBtn) {
    downBtn.addEventListener('click', () => {
      const cur = seq.masterLength;
      seq.setMasterLength(cur <= STEPS_PER_PAGE ? 0 : cur - STEPS_PER_PAGE);
      updateDisplay();
    });
  }

  // Click display to type value
  if (display) {
    display.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'master-len-input';
      input.min = 0;
      input.max = MAX_STEPS;
      input.value = seq.masterLength || '';
      input.placeholder = 'OFF';
      display.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = parseInt(input.value);
        input.replaceWith(display);
        seq.setMasterLength(isNaN(v) || v <= 0 ? 0 : v);
        updateDisplay();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = ''; input.blur(); }
      });
    });
  }
}

function updatePageButtons() {
  const pages = activeTrackIdx >= 0 ? (seq.getTrack(activeTrackIdx)?.pages || 1) : MAX_PAGES;
  document.querySelectorAll('.seq-page-btn').forEach(btn => {
    const p = parseInt(btn.dataset.page);
    btn.classList.toggle('active', p === currentPage);
    btn.classList.toggle('available', p < pages);
    btn.classList.remove('dimmed');
  });
}

/* ── Synth panel toggle ── */

function bindSynthPanel() {
  const header = document.getElementById('synth-panel-header');
  const body = document.getElementById('synth-panel-body');
  const arrow = document.getElementById('synth-panel-toggle');
  if (!header || !body) return;

  header.addEventListener('click', (e) => {
    // Don't toggle panel when clicking mode buttons or other interactive children
    if (e.target.closest('.synth-panel-mode')) return;
    const open = body.classList.toggle('open');
    if (arrow) arrow.textContent = open ? '\u25B2' : '\u25BC';
  });

  // Keyboard toggle
  const kbToggle = document.getElementById('keyboard-toggle');
  const kbArea = document.getElementById('keyboard-area');
  if (kbToggle && kbArea) {
    kbToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const show = kbArea.classList.toggle('hidden');
      kbToggle.classList.toggle('active', !show);
    });
  }
}

/* ── FX popup toggle ── */

function bindFxPopup() {
  const fxBtn = document.getElementById('fx-btn');
  const fxPopup = document.getElementById('fx-popup');
  if (fxBtn && fxPopup) {
    fxBtn.addEventListener('click', () => {
      const open = !fxBtn.classList.contains('active');
      fxBtn.classList.toggle('active', open);
      fxPopup.classList.toggle('open', open);
    });
  }
}

/* ── Project popup toggle ── */

function bindProjectPopup() {
  const projectBtn = document.getElementById('project-btn');
  const projectPopup = document.getElementById('project-popup');
  if (projectBtn && projectPopup) {
    projectBtn.addEventListener('click', () => {
      const open = !projectBtn.classList.contains('active');
      projectBtn.classList.toggle('active', open);
      projectPopup.classList.toggle('open', open);
    });
  }
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
  ui.setWaveform(1, activeEngine.getWaveform(1));
  ui.setWaveform(2, activeEngine.getWaveform(2));
  ui.setOscVolume(1, activeEngine.getVolume(1));
  ui.setOscVolume(2, activeEngine.getVolume(2));
  ui.setOscShape(1, activeEngine.getShape(1));
  ui.setOscShape(2, activeEngine.getShape(2));
  ui.setOscPitch(1, activeEngine.getPitch(1));
  ui.setOscPitch(2, activeEngine.getPitch(2));
  ui.setOscOctave(1, activeEngine.getOctave(1));
  ui.setOscOctave(2, activeEngine.getOctave(2));
  ui.setFilterType(activeEngine.getFilterType());
  ui.setFilterModel(activeEngine.getFilterModel());
  ui.setFilterCutoff(activeEngine.getFilterCutoff());
  ui.setFilterQ(activeEngine.getFilterQ());
  ui.setFilterGain(activeEngine.getFilterGain());
  ui.setADSR(activeEngine.getADSR());
  ui.setMasterVolume(activeEngine.getMasterVolume());
  ui.setChorusEnabled(activeEngine.getChorusEnabled ? activeEngine.getChorusEnabled() : false);
  ui.setChorusRate(activeEngine.getChorusRate ? activeEngine.getChorusRate() : 1.5);
  ui.setChorusDepth(activeEngine.getChorusDepth ? activeEngine.getChorusDepth() : 3);
  ui.setChorusMix(activeEngine.getChorusMix ? activeEngine.getChorusMix() : 50);
  ui.setChorusWidth(activeEngine.getChorusWidth ? activeEngine.getChorusWidth() : 50);
  ui.setChorusHPC(activeEngine.getChorusHPC ? activeEngine.getChorusHPC() : 200);
  ui.setReverbEnabled(activeEngine.getReverbEnabled ? activeEngine.getReverbEnabled() : false);
  ui.setReverbDecay(activeEngine.getReverbDecay ? activeEngine.getReverbDecay() : 2);
  ui.setReverbMix(activeEngine.getReverbMix ? activeEngine.getReverbMix() : 30);
  ui.setLFOWaveform(lfo.getWaveform());
  ui.setLFORate(lfo.getRate());
  ui.setOsc3Mode(activeEngine.getOsc3Mode());
  ui.setOsc3Volume(activeEngine.getOsc3Volume());
  ui.setOsc3Pitch(activeEngine.getOsc3Pitch());
  ui.setOsc3Octave(activeEngine.getOsc3Octave());
  buildSeqGrid();
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

  const patchSaveBtn = document.getElementById('patch-save');
  const patchNameInput = document.getElementById('patch-name');

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

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  ui.init();
  initMIDI();

  // Capture default values on all existing range sliders for dblclick-to-reset
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (!el.dataset.default) el.dataset.default = el.value;
  });

  // Global dblclick-to-reset for any range slider
  // Uses data-default if set, otherwise the HTML defaultValue
  document.addEventListener('dblclick', (e) => {
    const slider = e.target.closest('input[type="range"]');
    if (!slider) return;
    e.preventDefault();
    const def = slider.dataset.default !== undefined ? slider.dataset.default : slider.defaultValue;
    slider.value = def;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Keyboard shortcuts for MIDI step-edit
  window.addEventListener('keydown', (e) => {
    if (!_midiEditStep) return;
    if (e.key === 'Escape') { _clearMidiEditStep(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { _moveMidiEditStep(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { _moveMidiEditStep(-1); e.preventDefault(); }
  });

  // Init sequencer immediately
  seq.init(() => audio.context, samplePlayer);
  seq.onSynthNoteOn = (trackIdx, freq, midi, name, vel) => {
    ensureVisualizer();
    ui.showNote(name);
    ui.highlightKey(midi);
  };
  seq.onSynthNoteOff = (trackIdx, midi) => {
    ui.releaseKey(midi);
    const engine = seq.getTrackEngine(trackIdx);
    if (!engine || engine.activeVoiceCount === 0) ui.clearNote();
  };
  seq.setBPM(arp.getBPM());

  // Build UI
  buildSeqGrid();
  bindTransportControls();
  bindPageNav();
  bindMasterLength();
  bindSynthPanel();
  bindFxPopup();
  bindProjectPopup();
  bindProjectControls();

  // Track FX panel close button
  const fxCloseBtn = document.getElementById('track-fx-close');
  if (fxCloseBtn) fxCloseBtn.addEventListener('click', closeTrackFxPanel);

  // Register LFO modulation targets
  lfo.setTargets({
    'osc1-volume': {
      label: 'O1 Vol', min: 0, max: 1,
      get: () => activeEngine.getVolume(1),
      set: (v) => activeEngine.setVolume(1, v),
      bind: (eng) => ({ get: () => eng.getVolume(1), set: (v) => eng.setVolume(1, v) }),
    },
    'osc1-shape': {
      label: 'O1 Shp', min: 0, max: 1,
      get: () => activeEngine.getShape(1),
      set: (v) => activeEngine.setShape(1, v),
      bind: (eng) => ({ get: () => eng.getShape(1), set: (v) => eng.setShape(1, v) }),
    },
    'osc1-pitch': {
      label: 'O1 Pit', min: -7, max: 7,
      get: () => activeEngine.getPitch(1),
      set: (v) => activeEngine.setPitch(1, v),
      bind: (eng) => ({ get: () => eng.getPitch(1), set: (v) => eng.setPitch(1, v) }),
    },
    'osc2-volume': {
      label: 'O2 Vol', min: 0, max: 1,
      get: () => activeEngine.getVolume(2),
      set: (v) => activeEngine.setVolume(2, v),
      bind: (eng) => ({ get: () => eng.getVolume(2), set: (v) => eng.setVolume(2, v) }),
    },
    'osc2-shape': {
      label: 'O2 Shp', min: 0, max: 1,
      get: () => activeEngine.getShape(2),
      set: (v) => activeEngine.setShape(2, v),
      bind: (eng) => ({ get: () => eng.getShape(2), set: (v) => eng.setShape(2, v) }),
    },
    'osc2-pitch': {
      label: 'O2 Pit', min: -7, max: 7,
      get: () => activeEngine.getPitch(2),
      set: (v) => activeEngine.setPitch(2, v),
      bind: (eng) => ({ get: () => eng.getPitch(2), set: (v) => eng.setPitch(2, v) }),
    },
    'filter-cutoff': {
      label: 'Cutoff', min: 20, max: 20000, log: true,
      get: () => activeEngine.getFilterCutoff(),
      set: (v) => activeEngine.setFilterCutoff(v),
      bind: (eng) => ({ get: () => eng.getFilterCutoff(), set: (v) => eng.setFilterCutoff(v) }),
    },
    'filter-q': {
      label: 'Reso', min: 0.01, max: 30,
      get: () => activeEngine.getFilterQ(),
      set: (v) => activeEngine.setFilterQ(v),
      bind: (eng) => ({ get: () => eng.getFilterQ(), set: (v) => eng.setFilterQ(v) }),
    },
    'filter-gain': {
      label: 'Flt Gain', min: -24, max: 24,
      get: () => activeEngine.getFilterGain(),
      set: (v) => activeEngine.setFilterGain(v),
      bind: (eng) => ({ get: () => eng.getFilterGain(), set: (v) => eng.setFilterGain(v) }),
    },
    'osc3-volume': {
      label: 'O3 Vol', min: 0, max: 1,
      get: () => activeEngine.getOsc3Volume(),
      set: (v) => activeEngine.setOsc3Volume(v),
      bind: (eng) => ({ get: () => eng.getOsc3Volume(), set: (v) => eng.setOsc3Volume(v) }),
    },
    'osc3-pitch': {
      label: 'O3 Pit', min: -7, max: 7,
      get: () => activeEngine.getOsc3Pitch(),
      set: (v) => activeEngine.setOsc3Pitch(v),
      bind: (eng) => ({ get: () => eng.getOsc3Pitch(), set: (v) => eng.setOsc3Pitch(v) }),
    },
    'osc3-color': {
      label: 'O3 Clr', min: 0, max: 1,
      get: () => activeEngine.getOsc3Color(),
      set: (v) => activeEngine.setOsc3Color(v),
      bind: (eng) => ({ get: () => eng.getOsc3Color(), set: (v) => eng.setOsc3Color(v) }),
    },
    'osc3-damping': {
      label: 'O3 Dmp', min: 0, max: 1,
      get: () => activeEngine.getOsc3Damping(),
      set: (v) => activeEngine.setOsc3Damping(v),
      bind: (eng) => ({ get: () => eng.getOsc3Damping(), set: (v) => eng.setOsc3Damping(v) }),
    },
    'osc3-ratio': {
      label: 'O3 Rat', min: 0.5, max: 12,
      get: () => activeEngine.getOsc3Ratio(),
      set: (v) => activeEngine.setOsc3Ratio(v),
      bind: (eng) => ({ get: () => eng.getOsc3Ratio(), set: (v) => eng.setOsc3Ratio(v) }),
    },
    'osc3-index': {
      label: 'O3 Idx', min: 0, max: 20,
      get: () => activeEngine.getOsc3Index(),
      set: (v) => activeEngine.setOsc3Index(v),
      bind: (eng) => ({ get: () => eng.getOsc3Index(), set: (v) => eng.setOsc3Index(v) }),
    },
    'osc3-morph': {
      label: 'O3 Mph', min: 0, max: 1,
      get: () => activeEngine.getOsc3Morph(),
      set: (v) => activeEngine.setOsc3Morph(v),
      bind: (eng) => ({ get: () => eng.getOsc3Morph(), set: (v) => eng.setOsc3Morph(v) }),
    },
    'osc3-vibrato': {
      label: 'O3 Vib', min: 0, max: 1,
      get: () => activeEngine.getOsc3Vibrato(),
      set: (v) => activeEngine.setOsc3Vibrato(v),
      bind: (eng) => ({ get: () => eng.getOsc3Vibrato(), set: (v) => eng.setOsc3Vibrato(v) }),
    },
  });

  lfo.setOnRoutesChange(() => {
    const routes = lfo.getRoutes();
    const targets = lfo.getTargets();
    ui.renderLFORoutes(routes, targets);
    ui.updateLFORouteIndicators(routes);
  });

  // Set initial UI values
  ui.setActiveWaveform(1, activeEngine.getWaveform(1));
  ui.setActiveWaveform(2, activeEngine.getWaveform(2));
  ui.setVolume(1, activeEngine.getVolume(1));
  ui.setVolume(2, activeEngine.getVolume(2));
  ui.setShape(1, activeEngine.getShape(1));
  ui.setShape(2, activeEngine.getShape(2));
  ui.setPitch(1, activeEngine.getPitch(1));
  ui.setPitch(2, activeEngine.getPitch(2));
  ui.setOctave(1, activeEngine.getOctave(1));
  ui.setOctave(2, activeEngine.getOctave(2));
  ui.setFilterType(activeEngine.getFilterType());
  ui.setFilterModel(activeEngine.getFilterModel());
  ui.setFilterCutoff(activeEngine.getFilterCutoff());
  ui.setFilterQ(activeEngine.getFilterQ());
  ui.setFilterGain(activeEngine.getFilterGain());
  ui.setADSR(activeEngine.getADSR());
  ui.setPlayMode(playMode);
  ui.setTempo(arp.getBPM());
  ui.setMasterVolume(activeEngine.getMasterVolume());
  ui.setArpSettings({ division: arp.getDivision(), mode: arp.getMode(), quantize: arp.getQuantize() });
  ui.setOsc3Mode(activeEngine.getOsc3Mode());
  ui.setOsc3Volume(activeEngine.getOsc3Volume());
  ui.setOsc3Pitch(activeEngine.getOsc3Pitch());
  ui.setOsc3Octave(activeEngine.getOsc3Octave());
  keyboard.start();
});
