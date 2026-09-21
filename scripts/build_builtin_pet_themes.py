"""Assemble independent built-in pet theme GIFs from generated character stills.

Transparency notes (dark-theme safe):
- Background is flood-filled from the image border only, so interior pixels that
  happen to share the pale backdrop color are NOT punched out.
- The alpha mask is morphologically closed to seal small holes.
- Edge fringe is kept OPAQUE (GIF transparency is binary); soft edges would
  otherwise show the desktop through the character on dark backgrounds.

Input:  assets/pet-themes-src/<theme>-<action>.png
Output: public/assets/pet-themes/<theme>/{idle,click,fidget,sleep}.gif
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "pet-themes-src"
OUT = ROOT / "public" / "assets" / "pet-themes"
SIZE = 320

THEMES = ("shiba", "bunny", "hamster")
ACTIONS = ("idle", "click", "fidget", "sleep")


def flood_fill_background(im: Image.Image, tol: int = 42) -> Image.Image:
    """Mark only border-connected background as transparent."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba, dtype=np.uint8)
    h, w, _ = arr.shape
    samples = [arr[1, 1, :3], arr[1, w - 2, :3], arr[h - 2, 1, :3], arr[h - 2, w - 2, :3]]
    bg = np.median(np.stack(samples).astype(np.float32), axis=0)
    dist = np.linalg.norm(arr[:, :, :3].astype(np.float32) - bg, axis=2)
    is_bg_color = dist <= tol

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg_color[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg_color[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg_color[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    alpha = arr[:, :, 3].copy()
    alpha[visited] = 0
    # Seal tiny interior holes that the color key may have opened.
    alpha_img = Image.fromarray(alpha, mode="L")
    closed = alpha_img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    closed = closed.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    arr[:, :, 3] = np.array(closed)
    # Keep remaining semi-transparent edge pixels fully opaque so GIF cannot
    # punch a hole through the silhouette on dark chrome.
    arr[:, :, 3] = np.where(arr[:, :, 3] > 0, 255, 0).astype(np.uint8)
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
    # BOX keeps silhouette mass; NEAREST can reintroduce jagged alpha holes.
    resized = im.resize((nw, nh), Image.Resampling.BOX)
    canvas.paste(resized, ((size - nw) // 2, size - nh // 2), resized)
    # Re-binarize alpha after resample.
    arr = np.array(canvas)
    arr[:, :, 3] = np.where(arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def bob_frames(base: Image.Image, offsets: list[int]) -> list[Image.Image]:
    frames = []
    for dy in offsets:
        frame = Image.new("RGBA", base.size, (0, 0, 0, 0))
        frame.paste(base, (0, dy), base)
        frames.append(frame)
    return frames


def to_gif(frames: list[Image.Image], path: Path, duration: int) -> None:
    """Export GIF with a single reserved transparent index, no interior holes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    prepared = []
    for frame in frames:
        arr = np.array(frame.convert("RGBA"))
        alpha = arr[:, :, 3]
        rgb = arr[:, :, :3].copy()
        # Opaque subject pixels only; transparent stays out of the palette.
        opaque_mask = alpha >= 128
        if not opaque_mask.any():
            prepared.append(Image.new("P", frame.size, 0))
            continue
        # Flatten transparent to a color far from the subject so adaptive
        # palette rarely assigns it to body pixels.
        rgb[~opaque_mask] = (255, 0, 255)
        base = Image.fromarray(rgb, "RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        pal = np.array(base.getpalette(), dtype=np.uint8).reshape(-1, 3)
        # Find a free-ish palette slot for transparency: pick the magenta-like entry.
        distances = np.linalg.norm(pal.astype(np.int16) - np.array([255, 0, 255], dtype=np.int16), axis=1)
        trans_index = int(np.argmin(distances))
        indexed = np.array(base, dtype=np.uint8)
        indexed[~opaque_mask] = trans_index
        # If magenta leaked into the subject palette, reassign those subject
        # pixels to the nearest non-transparent palette color.
        if np.any(opaque_mask & (indexed == trans_index)):
            subject = rgb[opaque_mask].astype(np.int16)
            # cheap fix: use previous pixel palette quantization via second pass
            safe = Image.fromarray(rgb, "RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
            safe_arr = np.array(safe, dtype=np.uint8)
            safe_pal = np.array(safe.getpalette(), dtype=np.uint8).reshape(-1, 3)
            safe_dist = np.linalg.norm(safe_pal.astype(np.int16) - np.array([255, 0, 255], dtype=np.int16), axis=1)
            safe_trans = int(np.argmin(safe_dist))
            safe_arr[~opaque_mask] = safe_trans
            out = Image.fromarray(safe_arr, mode="P")
            out.putpalette(safe.getpalette())
            out.info["transparency"] = safe_trans
            prepared.append(out)
            continue
        out = Image.fromarray(indexed, mode="P")
        out.putpalette(base.getpalette())
        out.info["transparency"] = trans_index
        prepared.append(out)

    prepared[0].save(
        path,
        save_all=True,
        append_images=prepared[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=prepared[0].info.get("transparency", 0),
    )


def load_action(theme: str, action: str) -> Image.Image | None:
    name = f"{theme}-{action}.png"
    path = SRC / name
    if not path.exists() and action == "fidget":
        path = SRC / f"{theme}-idle.png"
    if not path.exists():
        return None
    im = Image.open(path)
    return fit(crop_content(flood_fill_background(im)))


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
