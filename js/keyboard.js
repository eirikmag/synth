/**
 * Keyboard handling — maps computer keys to musical notes.
 *
 * Layout (two octaves, piano-style):
 *
 *  Black:  S  D     G  H  J     2  3     5  6  7
 *  White: Z  X  C  V  B  N  M  Q  W  E  R  T  Y  U
 *         C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5
 */

/* ---------- note / frequency helpers ---------- */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert a MIDI note number to frequency (A4 = MIDI 69 = 440 Hz). */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Build a note name string like "C4" from a MIDI number. */
export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

/* ---------- key → MIDI mapping ---------- */

// Lower octave (C4 = MIDI 60)
// Upper octave (C5 = MIDI 72)
const KEY_TO_MIDI = {
  // -- lower octave white keys --
  'z': 60,  // C4
  'x': 62,  // D4
  'c': 64,  // E4
  'v': 65,  // F4
  'b': 67,  // G4
  'n': 69,  // A4
  'm': 71,  // B4
  // -- lower octave black keys --
  's': 61,  // C#4
  'd': 63,  // D#4
  'g': 66,  // F#4
  'h': 68,  // G#4
  'j': 70,  // A#4
  // -- upper octave white keys --
  'q': 72,  // C5
  'w': 74,  // D5
  'e': 76,  // E5
  'r': 77,  // F5
  't': 79,  // G5
  'y': 81,  // A5
  'u': 83,  // B5
  // -- upper octave black keys --
  '2': 73,  // C#5
  '3': 75,  // D#5
  '5': 78,  // F#5
  '6': 80,  // G#5
  '7': 82,  // A#5
};

export { KEY_TO_MIDI };

/* ---------- KeyboardManager ---------- */

export class KeyboardManager {
  /**
   * @param {object} callbacks
   * @param {function(frequency: number, midi: number, noteName: string)} callbacks.onNoteOn
   * @param {function(midi: number)} callbacks.onNoteOff
   */
  constructor(callbacks) {
    this._callbacks = callbacks;
    this._heldKeys = new Set(); // prevents key-repeat re-triggers

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  start() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  stop() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._heldKeys.clear();
  }

  /* --- event handlers --- */

  _onKeyDown(e) {
    const key = e.key.toLowerCase();
    if (!(key in KEY_TO_MIDI)) return;
    if (this._heldKeys.has(key)) return; // ignore key repeat

    this._heldKeys.add(key);
    const midi = KEY_TO_MIDI[key];
    this._callbacks.onNoteOn(midiToFreq(midi), midi, midiToName(midi));
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();
    if (!(key in KEY_TO_MIDI)) return;

    this._heldKeys.delete(key);
    const midi = KEY_TO_MIDI[key];
    this._callbacks.onNoteOff(midi);
  }
}
