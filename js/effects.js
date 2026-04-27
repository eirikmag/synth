/**
 * Effects module — Chorus and Reverb for the global signal chain.
 *
 * Each effect provides input/output GainNodes and wet/dry mixing.
 * When disabled, signal passes through dry (bypass).
 */

export class ChorusEffect {
  constructor(ctx) {
    this._ctx = ctx;
    this._enabled = false;
    this._rate = 1.5;      // LFO Hz
    this._depth = 3.0;     // modulation depth in ms
    this._mix = 0.5;       // wet/dry 0-1
    this._width = 0.5;     // stereo spread 0-1
    this._hpc = 200;       // high-pass cutoff on wet signal, Hz

    this._input = ctx.createGain();
    this._output = ctx.createGain();
    this._dry = ctx.createGain();
    this._wetMerge = ctx.createGain();

    // Stereo split: two delayed voices panned L/R
    this._splitter = ctx.createChannelSplitter(2);
    this._merger = ctx.createChannelMerger(2);

    // Left voice
    this._delayL = ctx.createDelay(0.05);
    this._delayL.delayTime.value = 0.012;
    this._lfoL = ctx.createOscillator();
    this._lfoL.type = 'sine';
    this._lfoL.frequency.value = this._rate;
    this._lfoGainL = ctx.createGain();
    this._lfoGainL.gain.value = this._depth / 1000;
    this._lfoL.connect(this._lfoGainL);
    this._lfoGainL.connect(this._delayL.delayTime);
    this._lfoL.start();

    // Right voice — phase-offset LFO for stereo width
    this._delayR = ctx.createDelay(0.05);
    this._delayR.delayTime.value = 0.012;
    this._lfoR = ctx.createOscillator();
    this._lfoR.type = 'sine';
    this._lfoR.frequency.value = this._rate;
    this._lfoGainR = ctx.createGain();
    this._lfoGainR.gain.value = this._depth / 1000;
    // Invert the R LFO for stereo spread
    this._lfoInvert = ctx.createGain();
    this._lfoInvert.gain.value = -1;
    this._lfoR.connect(this._lfoInvert);
    this._lfoInvert.connect(this._lfoGainR);
    this._lfoGainR.connect(this._delayR.delayTime);
    this._lfoR.start();

    // Width crossfade gains (mono->stereo blend)
    this._gainLL = ctx.createGain(); // left delay -> left out
    this._gainLR = ctx.createGain(); // left delay -> right out
    this._gainRL = ctx.createGain(); // right delay -> left out
    this._gainRR = ctx.createGain(); // right delay -> right out

    // High-pass filter on wet signal
    this._hpf = ctx.createBiquadFilter();
    this._hpf.type = 'highpass';
    this._hpf.frequency.value = this._hpc;
    this._hpf.Q.value = 0.7;

    // Routing: input -> delayL/delayR -> width matrix -> merger -> hpf -> wetMerge
    this._input.connect(this._delayL);
    this._input.connect(this._delayR);

    this._delayL.connect(this._gainLL);
    this._delayL.connect(this._gainLR);
    this._delayR.connect(this._gainRL);
    this._delayR.connect(this._gainRR);

    this._gainLL.connect(this._merger, 0, 0);
    this._gainLR.connect(this._merger, 0, 1);
    this._gainRL.connect(this._merger, 0, 0);
    this._gainRR.connect(this._merger, 0, 1);

    this._merger.connect(this._hpf);
    this._hpf.connect(this._wetMerge);

    this._input.connect(this._dry);
    this._dry.connect(this._output);
    this._wetMerge.connect(this._output);

    this._updateWidth();
    this._updateMix();
  }

  get input() { return this._input; }
  get output() { return this._output; }

  setEnabled(on) { this._enabled = on; this._updateMix(); }

  setRate(hz) {
    this._rate = Math.max(0.1, Math.min(10, hz));
    const t = this._ctx.currentTime;
    this._lfoL.frequency.setTargetAtTime(this._rate, t, 0.01);
    this._lfoR.frequency.setTargetAtTime(this._rate, t, 0.01);
  }

  setDepth(ms) {
    this._depth = Math.max(0, Math.min(10, ms));
    const t = this._ctx.currentTime;
    const val = this._depth / 1000;
    this._lfoGainL.gain.setTargetAtTime(val, t, 0.01);
    this._lfoGainR.gain.setTargetAtTime(val, t, 0.01);
  }

  setWidth(value) {
    this._width = Math.max(0, Math.min(1, value));
    this._updateWidth();
  }

  setHPC(freq) {
    this._hpc = Math.max(20, Math.min(2000, freq));
    this._hpf.frequency.setTargetAtTime(this._hpc, this._ctx.currentTime, 0.01);
  }

  setMix(value) {
    this._mix = Math.max(0, Math.min(1, value));
    this._updateMix();
  }

  _updateWidth() {
    // width=0: mono (both delays equal to both channels)
    // width=1: full stereo (L delay -> L only, R delay -> R only)
    const t = this._ctx.currentTime;
    const w = this._width;
    const same = 0.5 + 0.5 * w;  // same-side gain
    const cross = 0.5 - 0.5 * w; // cross-side gain
    this._gainLL.gain.setTargetAtTime(same, t, 0.01);
    this._gainRR.gain.setTargetAtTime(same, t, 0.01);
    this._gainLR.gain.setTargetAtTime(cross, t, 0.01);
    this._gainRL.gain.setTargetAtTime(cross, t, 0.01);
  }

  _updateMix() {
    const t = this._ctx.currentTime;
    if (!this._enabled) {
      this._dry.gain.setTargetAtTime(1, t, 0.01);
      this._wetMerge.gain.setTargetAtTime(0, t, 0.01);
    } else {
      this._dry.gain.setTargetAtTime(1 - this._mix * 0.5, t, 0.01);
      this._wetMerge.gain.setTargetAtTime(this._mix, t, 0.01);
    }
  }

  getState() {
    return {
      enabled: this._enabled, rate: this._rate, depth: this._depth,
      mix: this._mix, width: this._width, hpc: this._hpc
    };
  }
}

export class ReverbEffect {
  constructor(ctx) {
    this._ctx = ctx;
    this._enabled = false;
    this._decay = 2.0;
    this._mix = 0.3;

    this._input = ctx.createGain();
    this._output = ctx.createGain();
    this._dry = ctx.createGain();
    this._wet = ctx.createGain();
    this._convolver = ctx.createConvolver();

    this._input.connect(this._dry);
    this._input.connect(this._convolver);
    this._convolver.connect(this._wet);
    this._dry.connect(this._output);
    this._wet.connect(this._output);

    this._buildIR();
    this._updateMix();
  }

  get input() { return this._input; }
  get output() { return this._output; }

  _buildIR() {
    const rate = this._ctx.sampleRate;
    const length = Math.floor(rate * this._decay);
    const ir = this._ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    this._convolver.buffer = ir;
  }

  setEnabled(on) { this._enabled = on; this._updateMix(); }

  setDecay(seconds) {
    this._decay = Math.max(0.1, Math.min(10, seconds));
    this._buildIR();
  }

  setMix(value) {
    this._mix = Math.max(0, Math.min(1, value));
    this._updateMix();
  }

  _updateMix() {
    const t = this._ctx.currentTime;
    if (!this._enabled) {
      this._dry.gain.setTargetAtTime(1, t, 0.01);
      this._wet.gain.setTargetAtTime(0, t, 0.01);
    } else {
      this._dry.gain.setTargetAtTime(1 - this._mix * 0.3, t, 0.01);
      this._wet.gain.setTargetAtTime(this._mix, t, 0.01);
    }
  }

  getState() {
    return { enabled: this._enabled, decay: this._decay, mix: this._mix };
  }
}

/**
 * DistortionEffect — WaveShaper-based distortion with tone control.
 * Signal: input → preGain → waveshaper → toneFilter → wet / dry → output
 */
export class DistortionEffect {
  constructor(ctx) {
    this._ctx = ctx;
    this._enabled = false;
    this._drive = 4;       // 1–50, distortion intensity
    this._tone = 4000;     // Hz, post-distortion lowpass
    this._mix = 0.5;       // 0–1

    this._input = ctx.createGain();
    this._output = ctx.createGain();
    this._dry = ctx.createGain();
    this._wet = ctx.createGain();
    this._preGain = ctx.createGain();
    this._shaper = ctx.createWaveShaper();
    this._shaper.oversample = '4x';
    this._toneFilter = ctx.createBiquadFilter();
    this._toneFilter.type = 'lowpass';
    this._toneFilter.frequency.value = this._tone;
    this._toneFilter.Q.value = 0.7;
    this._postGain = ctx.createGain();

    // Routing
    this._input.connect(this._dry);
    this._input.connect(this._preGain);
    this._preGain.connect(this._shaper);
    this._shaper.connect(this._toneFilter);
    this._toneFilter.connect(this._postGain);
    this._postGain.connect(this._wet);
    this._dry.connect(this._output);
    this._wet.connect(this._output);

    this._buildCurve();
    this._updateMix();
  }

  get input() { return this._input; }
  get output() { return this._output; }

  _buildCurve() {
    const k = this._drive;
    const samples = 8192;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
    }
    this._shaper.curve = curve;
    // Compensate volume boost from drive
    const t = this._ctx.currentTime;
    this._preGain.gain.setTargetAtTime(1 + k * 0.1, t, 0.01);
    this._postGain.gain.setTargetAtTime(1 / (1 + k * 0.08), t, 0.01);
  }

  setEnabled(on) { this._enabled = on; this._updateMix(); }

  setDrive(value) {
    this._drive = Math.max(1, Math.min(50, value));
    this._buildCurve();
  }

  setTone(freq) {
    this._tone = Math.max(200, Math.min(12000, freq));
    const t = this._ctx.currentTime;
    this._toneFilter.frequency.setTargetAtTime(this._tone, t, 0.01);
  }

  setMix(value) {
    this._mix = Math.max(0, Math.min(1, value));
    this._updateMix();
  }

  _updateMix() {
    const t = this._ctx.currentTime;
    if (!this._enabled) {
      this._dry.gain.setTargetAtTime(1, t, 0.01);
      this._wet.gain.setTargetAtTime(0, t, 0.01);
    } else {
      this._dry.gain.setTargetAtTime(1 - this._mix * 0.5, t, 0.01);
      this._wet.gain.setTargetAtTime(this._mix, t, 0.01);
    }
  }

  getState() {
    return { enabled: this._enabled, drive: this._drive, tone: this._tone, mix: this._mix };
  }
}
