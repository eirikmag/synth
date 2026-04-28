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

  /** Flash the filter response curve for 1.5s (call on filter param edits). */
  flashFilterResponse() {
    this._showFilterResponse = true;
    clearTimeout(this._filterResponseTimer);
    this._filterResponseTimer = setTimeout(() => { this._showFilterResponse = false; }, 1500);
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

  setAnalyser(analyser) {
    this._analyser = analyser;
    this._buffer = new Uint8Array(analyser.frequencyBinCount);
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

    // Filter frequency response curve (only on edit)
    if (this._drawMode && this._cstGains) {
      this._drawCSTCurve(ctx, w, h);
    } else if (this._showFilterResponse && this._refFilters && this._refFilters.length > 0) {
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

    // Oscillator waveform preview overlay
    if (this._oscPreview) {
      this._drawOscPreview(ctx, w, h);
    }

    // Envelope preview overlay
    if (this._envPreview) {
      this._drawEnvPreview(ctx, w, h);
    }
  }

  _drawFilterResponse(ctx, w, h) {
    // Combine magnitude responses of all cascaded stages (multiply)
    this._combinedMag.fill(1);

    for (const filter of this._refFilters) {
      if (!filter.getFrequencyResponse) continue; // skip non-BiquadFilter nodes (e.g. comb)
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

  /* --- Oscillator waveform preview --- */

  /**
   * Show a computed waveform preview overlay for the given oscillator configs.
   * Each config: { waveform, volume, shape } for osc1/osc2,
   * osc3: { mode, volume, ratio, index, color, damping, morph }
   * Call with null to clear.
   */
  showOscPreview(osc1, osc2, osc3) {
    if (!osc1 && !osc2 && !osc3) {
      this._oscPreview = null;
      return;
    }
    const N = 512;
    const buf = new Float32Array(N);
    if (osc1 && osc1.volume > 0) this._addWave(buf, osc1);
    if (osc2 && osc2.volume > 0) this._addWave(buf, osc2);
    if (osc3 && osc3.volume > 0) this._addAltWave(buf, osc3);
    this._oscPreview = buf;

    // Auto-clear after 1.5s of no updates
    clearTimeout(this._oscPreviewTimer);
    this._oscPreviewTimer = setTimeout(() => { this._oscPreview = null; }, 1500);
  }

  /** Generate one cycle of a waveform, apply waveshaper, scale by volume, add into buf. */
  _addWave(buf, cfg) {
    const N = buf.length;
    const raw = new Float32Array(N);

    // Generate raw waveform
    for (let i = 0; i < N; i++) {
      const t = i / N; // 0..1 over one cycle
      switch (cfg.waveform) {
        case 'sine':
          raw[i] = Math.sin(2 * Math.PI * t);
          break;
        case 'square':
          raw[i] = t < 0.5 ? 1 : -1;
          break;
        case 'sawtooth':
          raw[i] = 2 * t - 1;
          break;
        case 'triangle':
          raw[i] = t < 0.5 ? (4 * t - 1) : (3 - 4 * t);
          break;
        default:
          raw[i] = Math.sin(2 * Math.PI * t);
      }
    }

    // Apply waveshaper (same algorithm as audio.js makeShapeCurve)
    if (cfg.shape > 0) {
      const k = cfg.shape * 50;
      for (let i = 0; i < N; i++) {
        const x = raw[i];
        raw[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
    }

    // Mix into buffer scaled by volume
    for (let i = 0; i < N; i++) {
      buf[i] += raw[i] * cfg.volume;
    }
  }

  /** Generate one cycle of an alt-engine waveform and add into buf. */
  _addAltWave(buf, cfg) {
    const N = buf.length;
    const vol = cfg.volume;

    switch (cfg.mode) {
      case 'fm': {
        // 2-op FM: carrier = sin(2πt + index × sin(2πt × ratio))
        const ratio = cfg.ratio || 2;
        const index = cfg.index || 3;
        for (let i = 0; i < N; i++) {
          const t = i / N;
          const mod = Math.sin(2 * Math.PI * t * ratio);
          buf[i] += Math.sin(2 * Math.PI * t + index * mod) * vol;
        }
        break;
      }
      case 'string': {
        // Karplus-Strong approximation: sawtooth filtered by damping
        // High damping = more filtering = rounder wave
        const damping = cfg.damping !== undefined ? cfg.damping : 0.5;
        const raw = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          raw[i] = 2 * (i / N) - 1; // sawtooth base
        }
        // Simple moving-average filter passes (simulates loop filter)
        const passes = Math.round(1 + damping * 12);
        for (let p = 0; p < passes; p++) {
          for (let i = N - 1; i > 0; i--) {
            raw[i] = raw[i] * 0.5 + raw[i - 1] * 0.5;
          }
          raw[0] = raw[0] * 0.5 + raw[N - 1] * 0.5;
        }
        for (let i = 0; i < N; i++) buf[i] += raw[i] * vol;
        break;
      }
      case 'formant': {
        // Sawtooth through approximate formant filters (vowel blend)
        const morph = cfg.morph !== undefined ? cfg.morph : 0;
        // Simplified: generate sawtooth harmonics weighted by formant peaks
        const VOWELS = [
          { f: [730, 1090, 2440] },  // A
          { f: [530, 1840, 2480] },  // E
          { f: [270, 2290, 3010] },  // I
          { f: [570,  840, 2410] },  // O
          { f: [300,  870, 2240] },  // U
        ];
        const pos = morph * 4;
        const idx = Math.min(Math.floor(pos), 3);
        const t = pos - idx;
        const va = VOWELS[idx], vb = VOWELS[idx + 1];
        const formants = va.f.map((f, j) => f + (vb.f[j] - f) * t);
        // Base freq for preview (A3 = 220 Hz)
        const baseFreq = 220;
        for (let i = 0; i < N; i++) {
          const phase = i / N;
          let sample = 0;
          // Add harmonics with formant-shaped amplitude
          for (let h = 1; h <= 32; h++) {
            const hFreq = baseFreq * h;
            let amp = 1 / h; // sawtooth harmonic amplitude
            // Boost near formant frequencies
            for (const ff of formants) {
              const dist = Math.abs(hFreq - ff) / ff;
              amp *= 1 + 3 * Math.exp(-dist * dist * 20);
            }
            sample += Math.sin(2 * Math.PI * phase * h) * amp;
          }
          buf[i] += sample * vol * 0.15; // normalize roughly
        }
        break;
      }
    }
  }

  /** Draw the oscillator preview waveform (called from _draw). */
  _drawOscPreview(ctx, w, h) {
    const buf = this._oscPreview;
    const N = buf.length;

    // Find peak for normalization
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    if (peak === 0) return;

    // Filled area (subtle glow)
    ctx.fillStyle = 'rgba(91, 192, 235, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = h / 2 - (buf[i] / peak) * (h * 0.4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h / 2);
    ctx.closePath();
    ctx.fill();

    // Waveform line
    ctx.strokeStyle = 'rgba(91, 192, 235, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = h / 2 - (buf[i] / peak) * (h * 0.4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* --- Envelope ADSR preview --- */

  /**
   * Show envelope shape preview overlay.
   * @param {object|null} ampEnv  - { attack, decay, sustain, release } or null
   * @param {object|null} filtEnv - { attack, decay, sustain, release, amount } or null
   * Call with both null to clear.
   */
  showEnvPreview(ampEnv, filtEnv) {
    if (!ampEnv && !filtEnv) {
      this._envPreview = null;
      return;
    }
    this._envPreview = { amp: ampEnv, filt: filtEnv };

    clearTimeout(this._envPreviewTimer);
    this._envPreviewTimer = setTimeout(() => { this._envPreview = null; }, 1500);
  }

  /**
   * Build an array of {t, v} points for a normalised ADSR shape.
   * Total duration is fitted to the display width with a fixed hold segment.
   */
  _envPoints(env) {
    const a = env.attack;
    const d = env.decay;
    const s = env.sustain;
    const r = env.release;
    const hold = 0.15; // fraction of total for sustain hold
    const total = a + d + r + hold * (a + d + r); // add sustain hold proportional
    if (total <= 0) return [];
    const pts = [];
    pts.push({ t: 0, v: 0 });
    pts.push({ t: a / total, v: 1 });
    pts.push({ t: (a + d) / total, v: s });
    const sustainEnd = (a + d) / total + hold;
    pts.push({ t: sustainEnd, v: s });
    pts.push({ t: 1, v: 0 });
    return pts;
  }

  /** Draw envelope preview curves. */
  _drawEnvPreview(ctx, w, h) {
    const { amp, filt } = this._envPreview;
    const margin = 8;
    const top = margin;
    const bot = h - margin;
    const range = bot - top;

    const drawCurve = (pts, strokeColor, fillColor) => {
      if (!pts || pts.length < 2) return;

      // Filled area
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.moveTo(pts[0].t * w, bot);
      for (const p of pts) {
        ctx.lineTo(p.t * w, bot - p.v * range);
      }
      ctx.lineTo(pts[pts.length - 1].t * w, bot);
      ctx.closePath();
      ctx.fill();

      // Line
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i].t * w;
        const y = bot - pts[i].v * range;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Dots at ADSR transition points
      ctx.fillStyle = strokeColor;
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].t * w, bot - pts[i].v * range, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // Draw amp envelope (cyan)
    if (amp) {
      const pts = this._envPoints(amp);
      drawCurve(pts, 'rgba(91, 192, 235, 0.8)', 'rgba(91, 192, 235, 0.08)');
    }

    // Draw filter envelope (orange) — always show shape for preview
    if (filt) {
      const pts = this._envPoints(filt);
      drawCurve(pts, 'rgba(235, 155, 52, 0.8)', 'rgba(235, 155, 52, 0.08)');
    }

    // Labels
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    if (amp) {
      ctx.fillStyle = 'rgba(91, 192, 235, 0.6)';
      ctx.fillText('AMP', 4, top + 10);
    }
    if (filt) {
      ctx.fillStyle = 'rgba(235, 155, 52, 0.6)';
      ctx.fillText('FILT', 4, top + (amp ? 22 : 10));
    }
  }
}
