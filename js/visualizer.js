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

    // CST drawing state
    this._drawMode = false;      // true when CST model is active
    this._drawing = false;       // true while mouse/touch is down
    this._cstGains = null;       // Float32Array of per-band dB gains
    this._cstFreqs = null;       // Float32Array of band center frequencies
    this._cstBandCount = 0;
    this._onCSTDraw = null;      // callback(gains) when drawing updates

    this._initDrawEvents();

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
    if (this._drawMode && this._cstGains) {
      this._drawCSTCurve(ctx, w, h);
    } else if (this._refFilters && this._refFilters.length > 0) {
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

  /* --- CST drawing mode --- */

  /** Enable/disable draw mode for CST custom filter. */
  setDrawMode(enabled, cstFreqs, cstBandCount, gains) {
    this._drawMode = enabled;
    this._cstFreqs = cstFreqs || null;
    this._cstBandCount = cstBandCount || 0;
    this._cstGains = gains ? new Float32Array(gains) : null;
    this._canvas.style.cursor = enabled ? 'crosshair' : '';
  }

  setOnCSTDraw(cb) { this._onCSTDraw = cb; }

  /** Convert canvas pixel x to frequency (log scale). */
  _xToFreq(x) {
    const t = x / this._canvas.width;
    return Math.pow(10, Math.log10(20) + t * (Math.log10(20000) - Math.log10(20)));
  }

  /** Convert canvas pixel y to gain in dB (-24 to +24). */
  _yToGain(y) {
    const norm = 1 - y / this._canvas.height; // 0=bottom, 1=top
    return (norm - 0.5) * 48; // map to -24..+24
  }

  /** Find the nearest CST band index for a given frequency. */
  _freqToBand(freq) {
    if (!this._cstFreqs) return -1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this._cstBandCount; i++) {
      const d = Math.abs(Math.log(freq) - Math.log(this._cstFreqs[i]));
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  /** Set gain for the band nearest to pixel x, and interpolate to neighbours. */
  _paintGain(canvasX, canvasY) {
    if (!this._cstGains) return;
    const freq = this._xToFreq(canvasX);
    const gain = this._yToGain(canvasY);
    const band = this._freqToBand(freq);
    if (band < 0) return;
    this._cstGains[band] = Math.max(-24, Math.min(24, gain));
    if (this._onCSTDraw) this._onCSTDraw(Array.from(this._cstGains));
  }

  _initDrawEvents() {
    const getPos = (e) => {
      const rect = this._canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onStart = (e) => {
      if (!this._drawMode) return;
      e.preventDefault();
      this._drawing = true;
      const pos = getPos(e);
      this._paintGain(pos.x, pos.y);
    };

    const onMove = (e) => {
      if (!this._drawing || !this._drawMode) return;
      e.preventDefault();
      const pos = getPos(e);
      this._paintGain(pos.x, pos.y);
    };

    const onEnd = () => {
      this._drawing = false;
    };

    this._canvas.addEventListener('mousedown', onStart);
    this._canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    this._canvas.addEventListener('touchstart', onStart, { passive: false });
    this._canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  /** Draw the CST custom filter curve (called from _draw when drawMode is active). */
  _drawCSTCurve(ctx, w, h) {
    if (!this._cstGains || !this._cstFreqs) return;

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);

    // Filled area
    ctx.fillStyle = 'rgba(235, 155, 52, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < this._cstBandCount; i++) {
      const t = (Math.log10(this._cstFreqs[i]) - logMin) / (logMax - logMin);
      const x = t * w;
      const norm = (this._cstGains[i] + 24) / 48; // -24..+24 -> 0..1
      const y = h - norm * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Curve line
    ctx.strokeStyle = '#eb9b34';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this._cstBandCount; i++) {
      const t = (Math.log10(this._cstFreqs[i]) - logMin) / (logMax - logMin);
      const x = t * w;
      const norm = (this._cstGains[i] + 24) / 48;
      const y = h - norm * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Band dots
    ctx.fillStyle = 'rgba(235, 155, 52, 0.5)';
    for (let i = 0; i < this._cstBandCount; i++) {
      const t = (Math.log10(this._cstFreqs[i]) - logMin) / (logMax - logMin);
      const x = t * w;
      const norm = (this._cstGains[i] + 24) / 48;
      const y = h - norm * h;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 0 dB reference line
    ctx.strokeStyle = 'rgba(235, 155, 52, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
