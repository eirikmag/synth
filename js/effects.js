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
    this._rate = 1.5;
    this._depth = 0.002;
    this._mix = 0.5;

    this._input = ctx.createGain();
    this._output = ctx.createGain();
    this._dry = ctx.createGain();
    this._wet = ctx.createGain();
    this._delay = ctx.createDelay(0.05);
    this._lfo = ctx.createOscillator();
    this._lfoGain = ctx.createGain();

    this._delay.delayTime.value = 0.012;
    this._lfo.type = 'sine';
    this._lfo.frequency.value = this._rate;
    this._lfoGain.gain.value = this._depth;

    this._lfo.connect(this._lfoGain);
    this._lfoGain.connect(this._delay.delayTime);
    this._lfo.start();

    this._input.connect(this._dry);
    this._input.connect(this._delay);
    this._delay.connect(this._wet);
    this._dry.connect(this._output);
    this._wet.connect(this._output);

    this._updateMix();
  }

  get input() { return this._input; }
  get output() { return this._output; }

  setEnabled(on) { this._enabled = on; this._updateMix(); }

  setRate(hz) {
    this._rate = Math.max(0.1, Math.min(10, hz));
    this._lfo.frequency.setTargetAtTime(this._rate, this._ctx.currentTime, 0.01);
  }

  setDepth(value) {
    this._depth = Math.max(0, Math.min(0.01, value));
    this._lfoGain.gain.setTargetAtTime(this._depth, this._ctx.currentTime, 0.01);
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
    return { enabled: this._enabled, rate: this._rate, depth: this._depth, mix: this._mix };
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
