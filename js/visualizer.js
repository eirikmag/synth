/**
 * Oscilloscope — draws a real-time waveform from an AnalyserNode onto a <canvas>.
 */

export class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   */
  constructor(canvas, analyser) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._analyser = analyser;
    this._buffer = new Uint8Array(analyser.frequencyBinCount);
    this._running = false;
    this._frameId = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
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
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, w, h);

    // Centre line
    ctx.strokeStyle = '#0f3460';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Waveform
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const sliceWidth = w / buffer.length;
    let x = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 128.0;   // 0‥2, centred at 1
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }
}
