# Synth — Agent Instructions

## Overview

Browser-based synthesizer. Pure vanilla JavaScript with ES modules — no bundler, no framework, no npm packages. Dark MiniFreak-inspired UI.

## Serving

ES modules require HTTP. Serve locally:

```
npx serve
```

Then open `http://localhost:3000` (or whatever port `serve` chooses).

**Do NOT open `index.html` via `file://`** — modules will fail to load.

## Project Structure

```
synth/
├── index.html              # Single page — all HTML structure
├── css/
│   └── style.css           # All styles. Dark theme (#111118 bg, #1c1c26 panels, #5bc0eb accent cyan)
└── js/
    ├── main.js             # Entry point. Wires all modules, manages play modes (mono/poly/arp), Web MIDI
    ├── audio.js            # AudioEngine class — dual oscillators, cascaded filters, ADSR, voice management
    ├── ui.js               # UIManager class — DOM bindings for all controls, callbacks to main.js
    ├── keyboard.js         # QWERTY → MIDI mapping (two octaves C4–B5), KeyboardManager class
    ├── arpeggiator.js      # Arpeggiator class — up/down/random modes, BPM + division control
    └── visualizer.js       # Oscilloscope + filter frequency response overlay (Canvas 2D)
```

## Audio Signal Chain

Per-voice routing:

```
OSC1 → WaveShaper → osc1Gain ─┐
                                ├→ envGain (ADSR) → filters[] (cascaded BiquadFilterNodes) → masterGain → analyser → destination
OSC2 → WaveShaper → osc2Gain ─┘
```

- **masterGain** is a shared post-filter node — the natural place to insert global effects (between masterGain and analyser)
- **analyser** feeds the oscilloscope visualizer
- Filters use cascaded BiquadFilterNodes with per-stage Q multipliers for different filter models (SVF12, SVF24, RD3, MG, OB12, OB24)
- Filter cutoff uses logarithmic mapping (slider 0–1000 → 20–20000 Hz exponentially)

## Architecture Conventions

- **Module pattern**: Each `js/*.js` file exports a single class. `main.js` imports and wires them.
- **Callback-based**: UI and keyboard pass events via callback objects (e.g., `onWaveformChange`, `onNoteOn`). Main.js is the mediator.
- **Lazy AudioContext**: `_ensureContext()` creates the AudioContext on first user interaction (required by browser autoplay policies).
- **No build step**: Everything is plain ES modules loaded directly by the browser.

## Key Implementation Details

### audio.js (AudioEngine)
- Constructor sets defaults only — no AudioContext created until `_ensureContext()`
- Voice management via `Map<midi, voiceObject>` where voiceObject contains all nodes for that voice
- Filter models defined in `FILTER_MODELS` constant — each has `stages` count and `qFactors` array
- `_rebuildAllFilters()` disconnects/reconnects when stage count changes; `_updateAllFilters()` for param-only changes
- `getRefFilters()` returns disconnected reference filters for visualizer frequency response display

### ui.js (UIManager)
- Constructor takes a `callbacks` object with all event handlers
- `init()` must be called after DOM is ready
- Handles both programmatic state setting (e.g., `setFilterCutoff(hz)`) and user input events
- Filter visibility: `_updateFilterVisibility(type)` shows/hides Q, gain, and model controls depending on filter type
- Piano visual is built dynamically from the KEY_TO_MIDI mapping

### main.js
- Creates `audio`, `ui`, `keyboard`, `arp` instances at module level
- `DOMContentLoaded` handler calls `ui.init()`, then sets all initial values from audio engine state
- MIDI input via `navigator.requestMIDIAccess()` with auto-reconnect on state change
- Play modes: mono (last-note priority with retrigger), poly (unlimited voices), arp (delegates to Arpeggiator)

### visualizer.js
- Draws real-time waveform (cyan) and filter frequency response curve (orange)
- Combined response multiplies magnitudes across cascaded filter stages
- 256-point log-scale frequency array from 20 Hz to 20 kHz
- Auto-resizes canvas to parent element

## CSS Conventions

- Color palette: bg `#111118`, panels `#1c1c26` / `#22222e`, accent `#5bc0eb`, filter curve `#eb9b34`
- Button pattern: `.some-btn` with `.active` class for selected state (cyan bg)
- Hidden elements: `.hidden` class sets `display: none`
- Sliders: `.adsr-slider` for vertical, `.knob-slider` for horizontal
- Sections: `.section` with `.section-label` (cyan uppercase) and `.section-body` (flex row)

## Adding New Features

### Adding a new control section
1. Add HTML to `index.html` inside `.panel-sections`
2. Add CSS for the new section in `style.css`
3. Add DOM binding methods in `ui.js` (bind in `init()`, add setter for programmatic updates)
4. Add callback(s) to the callbacks object in `main.js`
5. Add engine logic in `audio.js` if it touches audio

### Adding effects (insert point)
Effects should be inserted as global post-filter processing in the signal chain:

```
masterGain → [effects chain] → analyser → destination
```

When adding effects:
- Add effect node creation/management in `audio.js`
- Re-route: `masterGain → effectInput`, `effectOutput → analyser`
- Each effect needs enable/disable (bypass = disconnect effect, connect masterGain directly to analyser)
- Keep the analyser as the final node before destination so the oscilloscope shows post-effect signal

## Known Gotchas

1. **`create_file` tool appending bug**: On this workspace, the VS Code `create_file` tool sometimes appends to existing files instead of replacing them, even after deletion. For reliable full-file replacement, use terminal:
   ```powershell
   Remove-Item "path\to\file.js" -Force
   # Then use Set-Content or Out-File via terminal, NOT create_file
   ```
   Always verify with `(Get-Content "file.js").Count` and a node import test after replacing files.

2. **AudioContext autoplay policy**: The context must be created/resumed from a user gesture. `_ensureContext()` handles this, but new code paths that touch the context must go through it.

3. **Module load errors are silent in browser**: If any JS file has a syntax error, the entire module tree fails to load with no visible error on the page. Always test with:
   ```
   node -e "import('./js/audio.js').then(() => console.log('OK')).catch(e => console.log(e.message))"
   ```

4. **Filter type changes**: Switching filter type can change stage count (lowpass uses model-defined stages, all others use 1). This requires `_rebuildAllFilters()` which disconnects and reconnects all voice filter chains.
