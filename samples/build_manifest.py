"""Scan samples/kits/ and generate manifest.json."""

import json
from pathlib import Path

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".webm", ".aac", ".m4a"}

def build_manifest():
    kits_dir = Path(__file__).parent / "kits"
    kits = []
    for folder in sorted(kits_dir.iterdir()):
        if not folder.is_dir():
            continue
        samples = sorted(
            f.name for f in folder.iterdir()
            if f.is_file() and f.suffix.lower() in AUDIO_EXTS
        )
        if samples:
            kits.append({"name": folder.name, "samples": samples})

    manifest = kits_dir / "manifest.json"
    manifest.write_text(json.dumps({"kits": kits}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest} — {len(kits)} kit(s), {sum(len(k['samples']) for k in kits)} sample(s)")

if __name__ == "__main__":
    build_manifest()
