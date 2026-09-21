"""Assemble independent built-in pet theme GIFs from generated character stills.

Input:  assets/pet-themes-src/<theme>-<action>.png
Output: public/assets/pet-themes/<theme>/{idle,click,fidget,sleep}.gif
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "pet-themes-src"
OUT = ROOT / "public" / "assets" / "pet-themes"
SIZE = 320

THEMES = ("shiba", "bunny", "hamster")
ACTIONS = ("idle", "click", "fidget", "sleep")


def key_background(im: Image.Image, tol: int = 36) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    h, w, _ = arr.shape
    samples = [arr[2, 2, :3], arr[2, w - 3, :3], arr[h - 3, 2, :3], arr[h - 3, w - 3, :3]]
    bg = np.median(np.stack(samples), axis=0)
    dist = np.linalg.norm(arr[:, :, :3].astype(np.int16) - bg.astype(np.int16), axis=2)
    arr[dist <= tol, 3] = 0
    # tighten near-bg fringe
    arr[(dist > tol) & (dist <= tol + 18) & (arr[:, :, 3] < 255), 3] = 0
    return Image.fromarray(arr, "RGBA")


def crop_content(im: Image.Image, pad: int = 8) -> Image.Image:
    alpha = np.array(im)[:, :, 3]
    ys, xs = np.where(alpha > 12)
    if len(xs) == 0:
        return im
    box = (
        max(0, xs.min() - pad),
        max(0, ys.min() - pad),
        min(im.width, xs.max() + 1 + pad),
        min(im.height, ys.max() + 1 + pad),
    )
    return im.crop(box)


def fit(im: Image.Image, size: int = SIZE) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min(size / im.width, size / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    resized = im.resize((nw, nh), Image.Resampling.NEAREST)
    canvas.paste(resized, ((size - nw) // 2, size - nh // 2), resized)
    return canvas


def bob_frames(base: Image.Image, offsets: list[int]) -> list[Image.Image]:
    frames = []
    for dy in offsets:
        frame = Image.new("RGBA", base.size, (0, 0, 0, 0))
        frame.paste(base, (0, dy), base)
        frames.append(frame)
    return frames


def to_gif(frames: list[Image.Image], path: Path, duration: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    prepared = []
    for frame in frames:
        alpha = frame.split()[3]
        rgb = frame.convert("RGB")
        # place subject on transparent index using adaptive palette
        quant = rgb.convert("P", palette=Image.ADAPTIVE, colors=255)
        mask = Image.eval(alpha, lambda a: 255 if a < 128 else 0)
        quant.paste(255, mask)
        quant.info["transparency"] = 255
        prepared.append(quant)
    prepared[0].save(
        path,
        save_all=True,
        append_images=prepared[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=255,
    )


def load_action(theme: str, action: str) -> Image.Image | None:
    # fidget falls back to idle art when no dedicated still exists
    name = f"{theme}-{action}.png"
    path = SRC / name
    if not path.exists() and action == "fidget":
        path = SRC / f"{theme}-idle.png"
    if not path.exists():
        return None
    im = Image.open(path)
    return fit(crop_content(key_background(im)))


def main() -> None:
    durations = {"idle": 140, "click": 120, "fidget": 130, "sleep": 160}
    offsets = {
        "idle": [0, -2, 0, 1],
        "click": [0, -6, -2, 0],
        "fidget": [0, 2, 0, -2],
        "sleep": [0, 1, 0, 0],
    }
    for theme in THEMES:
        print(f"Building {theme}...")
        for action in ACTIONS:
            base = load_action(theme, action)
            if base is None:
                print(f"  skip {action} (missing source)")
                continue
            frames = bob_frames(base, offsets[action])
            out = OUT / theme / f"{action}.gif"
            to_gif(frames, out, durations[action])
            print(f"  wrote {out.relative_to(ROOT)} ({len(frames)} frames)")
    print("Done.")


if __name__ == "__main__":
    main()
