/**
 * Oscilloscope + filter frequency-response visualiser.
 *
 * Draws:
 *  1. Real-time waveform (cyan) from AnalyserNode
 *  2. Combined filter magnitude response curve (orange) from cascaded BiquadFilterNodes
 */

export class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   * @param {BiquadFilterNode[]} [refFilters] — array of reference filters for freq-response
   */
  constructor(canvas, analyser, refFilters = null) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._analyser = analyser;
    this._refFilters = refFilters;
    this._buffer = new Uint8Array(analyser.frequencyBinCount);
    this._running = false;
    this._frameId = null;

    // Pre-allocate freq-response arrays (log scale, 256 points from 20 Hz to 20 kHz)
    this._numPoints = 256;
    this._freqArray = new Float32Array(this._numPoints);
    this._magResponse = new Float32Array(this._numPoints);
    this._phaseResponse = new Float32Array(this._numPoints);
    this._combinedMag = new Float32Array(this._numPoints);
    this._buildFreqArray();

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  setRefFilters(filters) {
    this._refFilters = filters;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._draw();
  }

  stop() {
    this._running = false;
    if (this._frameId) cancelAnimationFrame(this._frameId);
  }

  _buildFreqArray() {
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    for (let i = 0; i < this._numPoints; i++) {
      const t = i / (this._numPoints - 1);
      this._freqArray[i] = Math.pow(10, logMin + t * (logMax - logMin));
    }
  }

  _resize() {
    const rect = this._canvas.parentElement.getBoundingClientRect();
    this._canvas.width = rect.width;
    this._canvas.height = this._canvas.clientHeight;
  }

  _draw() {
    if (!this._running) return;
    this._frameId = requestAnimationFrame(() => this._draw());

    const { _canvas: canvas, _ctx: ctx, _analyser: analyser, _buffer: buffer } = this;
    const w = canvas.width;
    const h = canvas.height;

    analyser.getByteTimeDomainData(buffer);

    // Background
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, w, h);

    // Centre line
    ctx.strokeStyle = '#1a1a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Filter frequency response curve
    if (this._refFilters && this._refFilters.length > 0) {
      this._drawFilterResponse(ctx, w, h);
    }

    // Waveform
    ctx.strokeStyle = '#5bc0eb';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const sliceWidth = w / buffer.length;
    let x = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  _drawFilterResponse(ctx, w, h) {
    // Combine magnitude responses of all cascaded stages (multiply)
    this._combinedMag.fill(1);

    for (const filter of this._refFilters) {
      filter.getFrequencyResponse(
        this._freqArray, this._magResponse, this._phaseResponse
      );
      for (let i = 0; i < this._numPoints; i++) {
        this._combinedMag[i] *= this._magResponse[i];
      }
    }

    // Filled area (subtle)
    ctx.fillStyle = 'rgba(235, 155, 52, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, h);

    for (let i = 0; i < this._numPoints; i++) {
      const x = (i / (this._numPoints - 1)) * w;
      const dB = 20 * Math.log10(Math.max(this._combinedMag[i], 0.0001));
      const norm = (dB + 60) / 84;
      const y = h - Math.max(0, Math.min(1, norm)) * h;
      ctx.lineTo(x, y);
    }

    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Curve line
    ctx.strokeStyle = '#eb9b34';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < this._numPoints; i++) {
      const x = (i / (this._numPoints - 1)) * w;
      const dB = 20 * Math.log10(Math.max(this._combinedMag[i], 0.0001));
      const norm = (dB + 60) / 84;
      const y = h - Math.max(0, Math.min(1, norm)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }
}
