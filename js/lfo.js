/**
 * LFO module - low-frequency oscillator with drag-routable parameter modulation.
 *
 * Waveforms: sine, triangle, square, sawtooth, sample-and-hold.
 * Routes map the LFO output to any registered modulation target.
 * Uses requestAnimationFrame for ~60 fps modulation updates.
 */

export class LFO {
  constructor() {
    this._rate = 1;          // Hz
    this._waveform = 'sine'; // sine | triangle | square | sawtooth | snh
    this._phase = 0;
    this._lastTime = 0;
    this._running = false;
    this._routes = [];       // [{targetId, amount}]  amount: -100..100
    this._baseValues = {};   // targetId -> user-set base value
    this._targets = {};      // targetId -> {label, min, max, log?, get(), set(v)}
    this._snhValue = 0;
    this._snhLastPhase = 1;  // force first sample
    this._onRoutesChange = null;
  }

  /** Register modulation targets (called once after audio engine is ready). */
  setTargets(targets) { this._targets = targets; }

  /** Callback fired whenever routes are added/removed. */
  setOnRoutesChange(cb) { this._onRoutesChange = cb; }

  setRate(hz) { this._rate = Math.max(0.05, Math.min(20, hz)); }
  getRate() { return this._rate; }

  setWaveform(type) { this._waveform = type; }
  getWaveform() { return this._waveform; }

  getRoutes() { return this._routes.slice(); }
  getTargets() { return this._targets; }

  addRoute(targetId, amount, bindArg) {
    if (amount === undefined) amount = 50;
    const target = this._targets[targetId];
    if (!target) return;
    if (this._routes.some(r => r.targetId === targetId)) return;
    // If target has a bind() factory, create engine-specific get/set
    const bound = target.bind && bindArg ? target.bind(bindArg) : target;
    this._baseValues[targetId] = bound.get();
    this._routes.push({ targetId, amount, get: bound.get, set: bound.set });
    this._startIfNeeded();
    if (this._onRoutesChange) this._onRoutesChange();
  }

  removeRoute(targetId) {
    const idx = this._routes.findIndex(r => r.targetId === targetId);
    if (idx === -1) return;
    const route = this._routes[idx];
    if (route.set && this._baseValues[targetId] !== undefined) {
      route.set(this._baseValues[targetId]);
    }
    this._routes.splice(idx, 1);
    delete this._baseValues[targetId];
    this._stopIfEmpty();
    if (this._onRoutesChange) this._onRoutesChange();
  }

  setRouteAmount(targetId, amount) {
    const route = this._routes.find(r => r.targetId === targetId);
    if (route) route.amount = amount;
  }

  /** Update the stored base value when the user changes a routed parameter. */
  updateBase(targetId, value) {
    if (this._baseValues[targetId] !== undefined) {
      this._baseValues[targetId] = value;
    }
  }

  hasRoute(targetId) {
    return this._routes.some(r => r.targetId === targetId);
  }

  /* ── State serialization ── */

  getState() {
    return {
      rate: this._rate,
      waveform: this._waveform,
      routes: this._routes.map(r => ({ targetId: r.targetId, amount: r.amount })),
    };
  }

  loadState(s) {
    if (!s) return;
    if (s.rate !== undefined) this.setRate(s.rate);
    if (s.waveform !== undefined) this.setWaveform(s.waveform);
    // Routes are restored by caller after targets are registered
  }

  /* --- internal animation loop --- */

  _startIfNeeded() {
    if (this._running || this._routes.length === 0) return;
    this._running = true;
    this._lastTime = performance.now();
    requestAnimationFrame(t => this._tick(t));
  }

  _stopIfEmpty() {
    if (this._routes.length === 0) {
      this._running = false;
      this._phase = 0;
    }
  }

  _tick(time) {
    if (!this._running) return;
    const dt = (time - this._lastTime) / 1000;
    this._lastTime = time;
    this._phase = (this._phase + this._rate * dt) % 1;

    const lfoVal = this._compute(this._phase);

    for (const route of this._routes) {
      const target = this._targets[route.targetId];
      if (!target || !route.set) continue;
      const base = this._baseValues[route.targetId];
      const amt = route.amount / 100; // normalise to -1..1
      let value;
      if (target.log) {
        const logBase = Math.log(Math.max(base, target.min));
        const logRange = Math.log(target.max) - Math.log(target.min);
        value = Math.exp(logBase + lfoVal * amt * logRange * 0.5);
      } else {
        const range = target.max - target.min;
        value = base + lfoVal * amt * range * 0.5;
      }
      route.set(Math.max(target.min, Math.min(target.max, value)));
    }

    requestAnimationFrame(t => this._tick(t));
  }

  _compute(phase) {
    switch (this._waveform) {
      case 'sine':     return Math.sin(2 * Math.PI * phase);
      case 'triangle': return 1 - 4 * Math.abs(phase - 0.5);
      case 'square':   return phase < 0.5 ? 1 : -1;
      case 'sawtooth': return 2 * phase - 1;
      case 'snh': {
        if (phase < this._snhLastPhase) {
          this._snhValue = Math.random() * 2 - 1;
        }
        this._snhLastPhase = phase;
        return this._snhValue;
      }
      default: return 0;
    }
  }
}
