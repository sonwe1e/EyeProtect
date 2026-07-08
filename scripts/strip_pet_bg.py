"""Strip the near-black background from EyeProtect pet artwork.

Reads I:/WorkStations/EyeProtect/Pics/statu_{stable,eye,fu,sleep}.png,
turns the near-black background (RGB ~ 30,30,31) into transparent alpha,
and writes RGBA results back to both Pics/ and public/assets/pet/.

The background is identified by an edge-connected flood fill over a tolerant
mask, so dark areas that are fully enclosed by the foreground (e.g. enclosed
shading) stay opaque. A soft alpha ramp on the boundary kills the dark halo
left by the original anti-aliasing against black.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "Pics"
DST_DIR = ROOT / "public" / "assets" / "pet"
NAMES = ("stable", "eye", "fu", "sleep")

BG_RGB = np.array([30, 30, 31], dtype=np.int16)
HARD_BG = 12     # dist <= HARD_BG => definitely background
SOFT_BG = 24     # dist >= SOFT_BG => definitely foreground; in-between => ramp


def edge_connected_bg_mask(candidate: np.ndarray) -> np.ndarray:
    """4-connected flood fill from every edge pixel of `candidate`."""
    h, w = candidate.shape
    visited = np.zeros_like(candidate, dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and candidate[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while q:
        y, x = q.popleft()
        push(y - 1, x)
        push(y + 1, x)
        push(y, x - 1)
        push(y, x + 1)

    return visited


def strip_one(src_path: Path) -> Image.Image:
    rgb = np.asarray(Image.open(src_path).convert("RGB"), dtype=np.int16)
    diff = np.abs(rgb - BG_RGB).max(axis=-1)

    candidate = diff <= SOFT_BG
    bg = edge_connected_bg_mask(candidate)

    alpha = np.full(diff.shape, 255, dtype=np.int16)
    # only ramp the alpha for pixels that flood-fill identifies as real bg
    near_band = bg & (diff > HARD_BG)
    alpha[bg & ~near_band] = 0
    ramp = ((diff - HARD_BG) * 255 // (SOFT_BG - HARD_BG)).clip(0, 255)
    alpha[near_band] = ramp[near_band]
    alpha = alpha.clip(0, 255).astype(np.uint8)

    rgba = np.dstack([rgb.astype(np.uint8), alpha])
    total = diff.size
    print(
        f"{src_path.name}: size={rgb.shape[1]}x{rgb.shape[0]} "
        f"bg={int(bg.sum())}/{total} ({bg.sum() / total:.1%}) "
        f"ramp={int(near_band.sum())}"
    )
    return Image.fromarray(rgba, mode="RGBA")


def main() -> None:
    DST_DIR.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        src = SRC_DIR / f"statu_{name}.png"
        if not src.exists():
            raise FileNotFoundError(src)
        out = strip_one(src)
        out.save(DST_DIR / f"pet-{name}.png", "PNG")
        out.save(src, "PNG")


if __name__ == "__main__":
    main()
