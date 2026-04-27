/**
 * Preset Manager — project serialization and patch bank.
 *
 * Project schema (v2):
 *   { version, name,
 *     patches: { id: { synth, lfo } },
 *     sequencer: { bpm, swing, tracks: [...] } }
 *
 * Patches = synth sound definitions (audio + LFO state).
 * Sequencer = unified track data (synth/drum/sample tracks + step patterns).
 */

const CURRENT_VERSION = 2;
const STORAGE_PREFIX = 'taktlite-project-';

export class PresetManager {
  constructor() {
    this._patches = {};
    this._currentPatchId = null;
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
      if (p.lfo.routes && Array.isArray(p.lfo.routes)) {
        lfo.getRoutes().forEach(r => lfo.removeRoute(r.targetId));
        p.lfo.routes.forEach(r => lfo.addRoute(r.targetId, r.amount));
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

  /* ── Project serialization ── */

  serializeProject(name, sequencer, audioEngine, lfo) {
    if (this.getPatchIds().length === 0) {
      this.savePatch('default', audioEngine, lfo);
    }
    return {
      version: CURRENT_VERSION,
      name: name || 'Untitled',
      patches: structuredClone(this._patches),
      sequencer: sequencer.getState(),
    };
  }

  deserializeProject(data, sequencer, audioEngine, lfo, setBPM, setSwing) {
    if (!data || !data.version) return false;

    // Patches
    this._patches = {};
    if (data.patches) {
      for (const [id, p] of Object.entries(data.patches)) {
        this._patches[id] = structuredClone(p);
      }
    }

    // Load first patch
    const patchIds = this.getPatchIds();
    if (patchIds.length > 0) {
      this.loadPatch(patchIds[0], audioEngine, lfo);
    }

    // Sequencer (includes bpm, swing, all tracks)
    if (data.sequencer) {
      sequencer.loadState(data.sequencer);
      if (data.sequencer.bpm !== undefined && setBPM) setBPM(data.sequencer.bpm);
      if (data.sequencer.swing !== undefined && setSwing) setSwing(data.sequencer.swing);
    }

    return true;
  }

  /* ── localStorage ── */

  saveToStorage(name, sequencer, audioEngine, lfo) {
    const data = this.serializeProject(name, sequencer, audioEngine, lfo);
    const key = STORAGE_PREFIX + (name || 'Untitled');
    localStorage.setItem(key, JSON.stringify(data));
    return key;
  }

  loadFromStorage(name, sequencer, audioEngine, lfo, setBPM, setSwing) {
    const key = STORAGE_PREFIX + name;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      return this.deserializeProject(data, sequencer, audioEngine, lfo, setBPM, setSwing);
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

  exportJSON(name, sequencer, audioEngine, lfo) {
    const data = this.serializeProject(name, sequencer, audioEngine, lfo);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'taktlite-project') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  importJSON(file, sequencer, audioEngine, lfo, setBPM, setSwing) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const ok = this.deserializeProject(data, sequencer, audioEngine, lfo, setBPM, setSwing);
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
