/**
 * Preset Manager -- project serialization, patch bank, kit bank.
 *
 * Project schema:
 *   { version, name, bpm, swing,
 *     patches: { id: patchState, ... },
 *     kits:    { id: kitState, ... },
 *     patterns: [ { name, sequencer: { rows }, drums: { kitId, tracks } } ] }
 *
 * Patches are synth sound definitions (osc1/2/3, filter, ADSR, effects, LFO).
 * Kits are drum instrument banks (synth-based or sample-based).
 * Patterns hold note/step data referencing patches and kits by ID.
 */

const CURRENT_VERSION = 1;
const STORAGE_PREFIX = 'synth-project-';

export class PresetManager {
  constructor() {
    this._patches = {};  // id -> patch state (audio.getState() + lfo)
    this._kits = {};     // id -> kit state (drums.getState() minus pattern)
    this._currentPatchId = null;
    this._currentKitId = null;
  }

  /* ── Patch bank ── */

  getPatchIds() { return Object.keys(this._patches); }
  getPatch(id) { return this._patches[id] ? structuredClone(this._patches[id]) : null; }
  get currentPatchId() { return this._currentPatchId; }

  savePatch(id, audioEngine, lfo) {
    this._patches[id] = {
      synth: audioEngine.getState(),
      lfo: lfo.getState(),
    };
    this._currentPatchId = id;
  }

  loadPatch(id, audioEngine, lfo) {
    const p = this._patches[id];
    if (!p) return false;
    if (p.synth) audioEngine.loadState(p.synth);
    if (p.lfo) {
      lfo.loadState(p.lfo);
      // Restore LFO routes if targets are registered
      if (p.lfo.routes && Array.isArray(p.lfo.routes)) {
        // Clear existing routes
        lfo.getRoutes().forEach(r => lfo.removeRoute(r.targetId));
        // Re-add saved routes
        p.lfo.routes.forEach(r => {
          lfo.addRoute(r.targetId, r.amount);
        });
      }
    }
    this._currentPatchId = id;
    return true;
  }

  deletePatch(id) {
    delete this._patches[id];
    if (this._currentPatchId === id) this._currentPatchId = null;
  }

  renamePatch(oldId, newId) {
    if (!this._patches[oldId] || this._patches[newId]) return false;
    this._patches[newId] = this._patches[oldId];
    delete this._patches[oldId];
    if (this._currentPatchId === oldId) this._currentPatchId = newId;
    return true;
  }

  /* ── Kit bank ── */

  getKitIds() { return Object.keys(this._kits); }
  getKit(id) { return this._kits[id] ? structuredClone(this._kits[id]) : null; }
  get currentKitId() { return this._currentKitId; }

  saveKit(id, drumMachine) {
    const state = drumMachine.getState();
    // Kit stores sound settings only, not pattern
    this._kits[id] = {
      type: 'synth',
      base: state.kit,
      masterVolume: state.masterVolume,
      tracks: {},
    };
    for (const [trackId, ts] of Object.entries(state.tracks)) {
      this._kits[id].tracks[trackId] = {
        params: { ...ts.params },
        volume: ts.volume,
      };
    }
    this._currentKitId = id;
  }

  loadKit(id, drumMachine) {
    const k = this._kits[id];
    if (!k) return false;
    // Load base synth kit first for defaults
    if (k.base) drumMachine.loadKit(k.base);
    if (k.masterVolume !== undefined) drumMachine.setMasterVolume(k.masterVolume);
    // Apply per-track overrides
    if (k.tracks) {
      for (const [trackId, ts] of Object.entries(k.tracks)) {
        if (ts.volume !== undefined) drumMachine.setTrackVolume(trackId, ts.volume);
        if (ts.params) {
          for (const [paramId, value] of Object.entries(ts.params)) {
            drumMachine.setTrackParam(trackId, paramId, value);
          }
        }
      }
    }
    this._currentKitId = id;
    return true;
  }

  deleteKit(id) {
    delete this._kits[id];
    if (this._currentKitId === id) this._currentKitId = null;
  }

  /* ── Project serialization ── */

  serializeProject(name, bpm, swing, sequencer, drumMachine, audioEngine, lfo) {
    // Auto-save current sound as patch if none exists
    if (this.getPatchIds().length === 0) {
      this.savePatch('default', audioEngine, lfo);
    }
    // Auto-save current kit if none exists
    if (this.getKitIds().length === 0) {
      this.saveKit('default', drumMachine);
    }

    const patterns = [{
      name: 'Pattern 1',
      sequencer: sequencer.getState(),
      drums: {
        kitId: this._currentKitId || 'default',
        ...drumMachine.getState(),
      },
    }];

    return {
      version: CURRENT_VERSION,
      name: name || 'Untitled',
      bpm,
      swing,
      patches: structuredClone(this._patches),
      kits: structuredClone(this._kits),
      patterns,
    };
  }

  deserializeProject(data, sequencer, drumMachine, audioEngine, lfo, setBPM, setSwing) {
    if (!data || !data.version) return false;

    // Global
    if (data.bpm !== undefined && setBPM) setBPM(data.bpm);
    if (data.swing !== undefined && setSwing) setSwing(data.swing);

    // Patches
    this._patches = {};
    if (data.patches) {
      for (const [id, p] of Object.entries(data.patches)) {
        this._patches[id] = structuredClone(p);
      }
    }

    // Kits
    this._kits = {};
    if (data.kits) {
      for (const [id, k] of Object.entries(data.kits)) {
        this._kits[id] = structuredClone(k);
      }
    }

    // Load first patch as active synth sound
    const patchIds = this.getPatchIds();
    if (patchIds.length > 0) {
      this.loadPatch(patchIds[0], audioEngine, lfo);
    }

    // Load first pattern
    if (Array.isArray(data.patterns) && data.patterns.length > 0) {
      const pat = data.patterns[0];

      // Sequencer
      if (pat.sequencer) {
        sequencer.loadState(pat.sequencer);
      }

      // Drums
      if (pat.drums) {
        // Load kit first
        if (pat.drums.kitId && this._kits[pat.drums.kitId]) {
          this.loadKit(pat.drums.kitId, drumMachine);
        }
        // Then load pattern data
        drumMachine.loadState(pat.drums);
      }
    }

    return true;
  }

  /* ── localStorage ── */

  saveToStorage(name, bpm, swing, sequencer, drumMachine, audioEngine, lfo) {
    const data = this.serializeProject(name, bpm, swing, sequencer, drumMachine, audioEngine, lfo);
    const key = STORAGE_PREFIX + (name || 'Untitled');
    localStorage.setItem(key, JSON.stringify(data));
    return key;
  }

  loadFromStorage(name, sequencer, drumMachine, audioEngine, lfo, setBPM, setSwing) {
    const key = STORAGE_PREFIX + name;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      return this.deserializeProject(data, sequencer, drumMachine, audioEngine, lfo, setBPM, setSwing);
    } catch (e) {
      console.warn('Failed to parse project:', e);
      return false;
    }
  }

  deleteFromStorage(name) {
    localStorage.removeItem(STORAGE_PREFIX + name);
  }

  listStoredProjects() {
    const projects = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(STORAGE_PREFIX)) {
        projects.push(key.slice(STORAGE_PREFIX.length));
      }
    }
    return projects.sort();
  }

  /* ── File export/import ── */

  exportJSON(name, bpm, swing, sequencer, drumMachine, audioEngine, lfo) {
    const data = this.serializeProject(name, bpm, swing, sequencer, drumMachine, audioEngine, lfo);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'synth-project') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  importJSON(file, sequencer, drumMachine, audioEngine, lfo, setBPM, setSwing) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const ok = this.deserializeProject(data, sequencer, drumMachine, audioEngine, lfo, setBPM, setSwing);
          resolve(ok ? data.name : false);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }
}
