/**
 * SamplePlayer — sample engine with Oneshot and Slicer modes.
 *
 * Oneshot: plays sample with start/length/root note. Chromatic play detunes via playbackRate.
 * Slicer:  user-defined slices, each mapped to a MIDI note starting at rootNote.
 */

export class SamplePlayer {
  constructor() {
    /** @type {Map<string, AudioBuffer>} name -> decoded AudioBuffer */
    this._buffers = new Map();

    /** @type {Map<string, SampleConfig>} name -> per-sample config */
    this._configs = new Map();

    /** Active voices for stop-on-retrigger: Map<string, {src, gain}[]> keyed by "name:midi" */
    this._voices = new Map();
  }

  /** Default config for a newly loaded sample. */
  static defaultConfig() {
    return {
      mode: 'oneshot',  // 'oneshot' | 'slicer'
      rootNote: 60,     // C4 — base MIDI note for original pitch
      start: 0,         // 0-1 normalised start position
      length: 1,        // 0-1 normalised length from start
      slices: [],       // array of { start: 0-1, end: 0-1 } normalised positions
    };
  }

  async loadFile(ctx, file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    this._buffers.set(file.name, audioBuffer);
    if (!this._configs.has(file.name)) {
      this._configs.set(file.name, SamplePlayer.defaultConfig());
    }
    return file.name;
  }

  async loadUrl(ctx, url, name) {
    if (this._buffers.has(name)) return name;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load sample: ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    this._buffers.set(name, audioBuffer);
    if (!this._configs.has(name)) {
      this._configs.set(name, SamplePlayer.defaultConfig());
    }
    return name;
  }

  async fetchKitManifest() {
    if (this._kitManifest) return this._kitManifest;
    try {
      const resp = await fetch('samples/manifest.json');
      if (!resp.ok) return [];
      this._kitManifest = (await resp.json()).folders || [];
    } catch {
      this._kitManifest = [];
    }
    return this._kitManifest;
  }

  getBuffer(name) { return this._buffers.get(name) || null; }
  getConfig(name) { return this._configs.get(name) || null; }

  setConfig(name, cfg) {
    if (!this._configs.has(name)) return;
    Object.assign(this._configs.get(name), cfg);
  }

  /** Play a sample. midi determines pitch (oneshot) or slice index (slicer). */
  play(ctx, dest, name, velocity = 1, midi = 60) {
    const buffer = this._buffers.get(name);
    const config = this._configs.get(name);
    if (!buffer || !config) return null;

    if (config.mode === 'slicer') {
      return this._playSlicer(ctx, dest, buffer, config, velocity, midi);
    }
    return this._playOneshot(ctx, dest, buffer, config, velocity, midi);
  }

  /** Stop any active voices for a given sample + midi combination. */
  stop(name, midi) {
    const key = name + ':' + midi;
    const voices = this._voices.get(key);
    if (!voices) return;
    const now = voices[0]?.gain.context.currentTime || 0;
    for (const v of voices) {
      try {
        v.gain.gain.setTargetAtTime(0, now, 0.02);
        v.src.stop(now + 0.05);
      } catch {}
    }
    this._voices.delete(key);
  }

  _trackVoice(name, midi, src, gain) {
    const key = name + ':' + midi;
    if (!this._voices.has(key)) this._voices.set(key, []);
    this._voices.get(key).push({ src, gain });
    src.onended = () => {
      const arr = this._voices.get(key);
      if (arr) {
        const i = arr.indexOf(arr.find(v => v.src === src));
        if (i >= 0) arr.splice(i, 1);
        if (arr.length === 0) this._voices.delete(key);
      }
    };
  }

  _playOneshot(ctx, dest, buffer, config, velocity, midi) {
    const dur = buffer.duration;
    const startSec = config.start * dur;
    const lenSec = config.length * dur;

    // Pitch shift: semitone difference from root note
    const rate = Math.pow(2, (midi - config.rootNote) / 12);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const gain = ctx.createGain();
    gain.gain.value = velocity;
    src.connect(gain);
    gain.connect(dest);

    src.start(0, startSec, lenSec);
    this._trackVoice(config._name || '', midi, src, gain);
    return { src, gain };
  }

  _playSlicer(ctx, dest, buffer, config, velocity, midi) {
    if (!config.slices.length) return null;

    // Map MIDI notes starting from rootNote to slice indices
    const sliceIdx = midi - config.rootNote;
    if (sliceIdx < 0 || sliceIdx >= config.slices.length) return null;

    const slice = config.slices[sliceIdx];
    const dur = buffer.duration;
    const startSec = slice.start * dur;
    const endSec = slice.end * dur;
    const lenSec = endSec - startSec;
    if (lenSec <= 0) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Slices play at original pitch (no detuning)
    src.playbackRate.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = velocity;
    src.connect(gain);
    gain.connect(dest);

    src.start(0, startSec, lenSec);
    this._trackVoice(config._name || '', midi, src, gain);
    return { src, gain };
  }

  /** Auto-slice into N equal parts. */
  autoSlice(name, count) {
    const config = this._configs.get(name);
    if (!config) return;
    config.slices = [];
    for (let i = 0; i < count; i++) {
      config.slices.push({ start: i / count, end: (i + 1) / count });
    }
  }

  /** Add a manual slice point (splits existing region or appends). */
  addSlicePoint(name, pos) {
    const config = this._configs.get(name);
    if (!config) return;
    // Find which slice this point falls in and split it
    for (let i = 0; i < config.slices.length; i++) {
      const s = config.slices[i];
      if (pos > s.start && pos < s.end) {
        config.slices.splice(i, 1, { start: s.start, end: pos }, { start: pos, end: s.end });
        return;
      }
    }
    // If no slices yet, create the first split
    if (config.slices.length === 0) {
      config.slices.push({ start: 0, end: pos }, { start: pos, end: 1 });
    }
  }

  /** Remove a slice by index (merges with the next slice). */
  removeSlice(name, idx) {
    const config = this._configs.get(name);
    if (!config || idx < 0 || idx >= config.slices.length) return;
    if (config.slices.length <= 1) { config.slices = []; return; }
    // Merge with next slice (or previous if last)
    if (idx < config.slices.length - 1) {
      config.slices[idx + 1].start = config.slices[idx].start;
    } else {
      config.slices[idx - 1].end = config.slices[idx].end;
    }
    config.slices.splice(idx, 1);
  }

  getSampleNames() { return [...this._buffers.keys()]; }
  has(name) { return this._buffers.has(name); }
  delete(name) { this._buffers.delete(name); this._configs.delete(name); }
}
