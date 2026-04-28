"""Scan all subfolders under samples/ and generate manifest.json."""

import json
from pathlib import Path

AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".webm", ".aac", ".m4a"}

def build_manifest():
    samples_dir = Path(__file__).parent
    categories = []

    for cat_dir in sorted(samples_dir.iterdir()):
        if not cat_dir.is_dir():
            continue
        # Check for audio files directly in category folder
        direct_files = sorted(
            f.name for f in cat_dir.iterdir()
            if f.is_file() and f.suffix.lower() in AUDIO_EXTS
        )
        if direct_files:
            categories.append({
                "name": cat_dir.name,
                "path": cat_dir.name,
                "samples": direct_files,
            })
        # Check for sub-folders (e.g. kits/909/)
        for sub_dir in sorted(cat_dir.iterdir()):
            if not sub_dir.is_dir():
                continue
            files = sorted(
                f.name for f in sub_dir.iterdir()
                if f.is_file() and f.suffix.lower() in AUDIO_EXTS
            )
            if files:
                categories.append({
                    "name": f"{cat_dir.name}/{sub_dir.name}",
                    "path": f"{cat_dir.name}/{sub_dir.name}",
                    "samples": files,
                })

    manifest = samples_dir / "manifest.json"
    manifest.write_text(json.dumps({"folders": categories}, indent=2) + "\n", encoding="utf-8")
    total = sum(len(c["samples"]) for c in categories)
    print(f"Wrote {manifest} — {len(categories)} folder(s), {total} sample(s)")

if __name__ == "__main__":
    build_manifest()
