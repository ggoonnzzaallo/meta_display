#!/usr/bin/env python3
"""Generate Leaf's install icons using only the Python standard library."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "leaf"
BLACK = (0, 0, 0)
SURFACE = (18, 29, 25)
LEAF = (120, 239, 189)
INK = (242, 250, 246)


def write_png(path: Path, size: int, rgb: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    rows = b"".join(b"\x00" + rgb[y * size * 3 : (y + 1) * size * 3] for y in range(size))
    body = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(body)


def rounded_rect(x: float, y: float, lo: float, hi: float, radius: float) -> bool:
    if x < lo or x > hi or y < lo or y > hi:
        return False
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if not length:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size: int) -> bytes:
    scale = size / 192
    pixels = bytearray(size * size * 3)
    for y in range(size):
        for x in range(size):
            sx, sy = (x + 0.5) / scale, (y + 0.5) / scale
            color = BLACK
            if rounded_rect(sx, sy, 8, 184, 40):
                color = SURFACE

            # Open book: two gently bowed pages with a bright center gutter.
            left_page = 34 <= sx <= 94 and 42 <= sy <= 151 and sx >= 30 + 0.0018 * (sy - 98) ** 2
            right_page = 98 <= sx <= 158 and 42 <= sy <= 151 and sx <= 162 - 0.0018 * (sy - 98) ** 2
            if left_page or right_page:
                color = INK

            # A leaf rises from the book's gutter.
            leaf_shape = ((sx - 112) / 28) ** 2 + ((sy - 75) / 42) ** 2 <= 1 and sx >= 90
            if leaf_shape and sy <= 112:
                color = LEAF
            if segment_distance(sx, sy, 96, 121, 119, 45) <= 2.2:
                color = SURFACE
            if segment_distance(sx, sy, 109, 77, 129, 66) <= 1.4:
                color = SURFACE
            if segment_distance(sx, sy, 105, 91, 91, 81) <= 1.4:
                color = SURFACE

            # Center gutter and baseline keep the mark readable at 52px.
            if segment_distance(sx, sy, 96, 49, 96, 153) <= 2.1:
                color = LEAF
            if segment_distance(sx, sy, 36, 153, 156, 153) <= 2.3:
                color = LEAF

            index = (y * size + x) * 3
            pixels[index : index + 3] = bytes(color)
    return bytes(pixels)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for filename, size in (
        ("favicon.png", 192),
        ("logo.png", 192),
        ("apple-touch-icon.png", 180),
        ("icon-128.png", 128),
        ("icon-96.png", 96),
    ):
        write_png(OUT / filename, size, render(size))
        print(f"wrote {OUT / filename}")


if __name__ == "__main__":
    main()
