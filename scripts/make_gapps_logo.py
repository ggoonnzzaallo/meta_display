#!/usr/bin/env python3
"""Render the G-Apps logo: bold G on a rounded blue rectangle."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLUE = (0, 163, 199)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def write_png(path: Path, width: int, height: int, rgb: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + rgb[y * width * 3 : (y + 1) * width * 3] for y in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def in_rounded_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float, radius: float) -> bool:
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = x0 + radius if x < x0 + radius else x1 - radius if x > x1 - radius else x
    cy = y0 + radius if y < y0 + radius else y1 - radius if y > y1 - radius else y
    if cx == x or cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def in_g(x: float, y: float, cx: float, cy: float, scale: float) -> bool:
    dx = (x - cx) / scale
    dy = (y - cy) / scale
    r = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    r_out = 1.0
    r_in = 0.52
    opening = abs(ang) < 0.62
    on_ring = r_in <= r <= r_out and not opening
    bar = dx >= -0.08 and dx <= r_out - 0.02 and abs(dy) <= 0.20
    spur = dx >= r_out - 0.50 and dx <= r_out and dy >= -0.20 and dy <= 0.62
    return on_ring or bar or spur


def render(size: int) -> bytes:
    ss = 3
    big = size * ss
    pad = big * 0.06
    x0, y0 = pad, pad
    x1, y1 = big - 1 - pad, big - 1 - pad
    radius = (x1 - x0) * 0.22
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2 + big * 0.01
    g_scale = (x1 - x0) * 0.28
    acc = [0] * (size * size * 3)
    for y in range(big):
        for x in range(big):
            px = x // ss
            py = y // ss
            i = (py * size + px) * 3
            if in_g(x + 0.5, y + 0.5, cx, cy, g_scale):
                color = WHITE
            elif in_rounded_rect(x + 0.5, y + 0.5, x0, y0, x1, y1, radius):
                color = BLUE
            else:
                color = BLACK
            acc[i] += color[0]
            acc[i + 1] += color[1]
            acc[i + 2] += color[2]
    area = ss * ss
    return bytes(v // area for v in acc)


def main() -> None:
    master = render(192)
    write_png(ROOT / "logo.png", 192, 192, master)
    write_png(ROOT / "favicon.png", 192, 192, master)

    def down(src: bytes, src_size: int, dst_size: int) -> bytes:
        scale = src_size / dst_size
        out = bytearray(dst_size * dst_size * 3)
        for y in range(dst_size):
            for x in range(dst_size):
                r = g = b = n = 0
                x0 = int(x * scale)
                y0 = int(y * scale)
                x1 = max(x0 + 1, int((x + 1) * scale))
                y1 = max(y0 + 1, int((y + 1) * scale))
                for yy in range(y0, min(src_size, y1)):
                    for xx in range(x0, min(src_size, x1)):
                        j = (yy * src_size + xx) * 3
                        r += src[j]
                        g += src[j + 1]
                        b += src[j + 2]
                        n += 1
                k = (y * dst_size + x) * 3
                out[k] = r // n
                out[k + 1] = g // n
                out[k + 2] = b // n
        return bytes(out)

    write_png(ROOT / "icon-96.png", 96, 96, down(master, 192, 96))
    write_png(ROOT / "icon-128.png", 128, 128, down(master, 192, 128))
    write_png(ROOT / "apple-touch-icon.png", 180, 180, down(master, 192, 180))
    print("wrote logo.png, favicon.png, icon-96.png, icon-128.png, apple-touch-icon.png")


if __name__ == "__main__":
    main()
