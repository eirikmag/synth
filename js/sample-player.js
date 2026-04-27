/**
 * Sample Player — loads audio files into AudioBuffers and plays them as one-shots.
 */

export class SamplePlayer {
  constructor() {
    this._buffers = new Map(); // name -> AudioBuffer
  }

  async loadFile(ctx, file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    this._buffers.set(file.name, audioBuffer);
    return file.name;
  }

  play(ctx, dest, name, velocity = 1) {
    const buffer = this._buffers.get(name);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = velocity;
    source.connect(gain);
    gain.connect(dest);
    source.start();
  }

  getSampleNames() { return [...this._buffers.keys()]; }
  has(name) { return this._buffers.has(name); }
  delete(name) { this._buffers.delete(name); }
}
