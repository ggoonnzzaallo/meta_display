#!/usr/bin/env python3
"""Build per-app PNG icons so a direct Web App URL installs with its own logo.

Glasses and the Meta AI app look at the page <link> tags and the Web App
manifest (not only favicon.ico). Relative icon URLs 404 on the custom domain,
so every app gets 96 / 128 / 180 / 192 PNGs at /meta_display/apps/<name>/.
"""

from __future__ import annotations

import json
import math
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPS_DIR = ROOT / "apps"
PREFIX = "/meta_display/apps"
BLACK = (0, 0, 0)
INK = (28, 30, 33)
TRACE_MAGENTA = (225, 29, 116)

ICON_LINK_RE = re.compile(
    r"(?:  <link rel=\"(?:icon|apple-touch-icon|manifest)\"[^>]*>\n)+",
)


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


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path: Path) -> tuple[int, int, bytes]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type, comp, filt, inter = struct.unpack(
                ">IIBBBBB", chunk
            )
            if bit_depth != 8 or comp != 0 or filt != 0 or inter != 0:
                raise ValueError(f"unsupported PNG: {path}")
            if color_type not in (2, 6):
                raise ValueError(f"unsupported color type {color_type}: {path}")
        elif tag == b"IDAT":
            idat.extend(chunk)
        elif tag == b"IEND":
            break
    if width is None:
        raise ValueError(f"no IHDR: {path}")
    channels = 3 if color_type == 2 else 4
    stride = width * channels
    raw = zlib.decompress(bytes(idat))
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _y in range(height):
        ftype = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if ftype == 1:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + left) & 255
        elif ftype == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif ftype == 3:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif ftype == 4:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                up = prev[x]
                ul = prev[x - channels] if x >= channels else 0
                row[x] = (row[x] + paeth(left, up, ul)) & 255
        elif ftype != 0:
            raise ValueError(f"bad filter {ftype}: {path}")
        rows.append(row)
        prev = row
    out = bytearray(width * height * 3)
    for y, row in enumerate(rows):
        for x in range(width):
            o = (y * width + x) * 3
            s = x * channels
            r, g, b = row[s], row[s + 1], row[s + 2]
            if channels == 4:
                a = row[s + 3]
                r = (r * a) // 255
                g = (g * a) // 255
                b = (b * a) // 255
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
    return width, height, bytes(out)


def unique_colors(rgb: bytes) -> int:
    return len({rgb[i : i + 3] for i in range(0, len(rgb), 3)})


def resize(src: bytes, src_size: int, dst_size: int, nearest: bool) -> bytes:
    if src_size == dst_size:
        return src
    out = bytearray(dst_size * dst_size * 3)
    scale = src_size / dst_size
    for y in range(dst_size):
        for x in range(dst_size):
            k = (y * dst_size + x) * 3
            if nearest or dst_size > src_size:
                if nearest:
                    sx = min(src_size - 1, int((x + 0.5) * scale))
                    sy = min(src_size - 1, int((y + 0.5) * scale))
                    j = (sy * src_size + sx) * 3
                    out[k : k + 3] = src[j : j + 3]
                    continue
                # bilinear upscale
                fx = (x + 0.5) * scale - 0.5
                fy = (y + 0.5) * scale - 0.5
                x0 = max(0, min(src_size - 1, int(math.floor(fx))))
                y0 = max(0, min(src_size - 1, int(math.floor(fy))))
                x1 = min(src_size - 1, x0 + 1)
                y1 = min(src_size - 1, y0 + 1)
                tx = fx - x0
                ty = fy - y0
                def samp(xx: int, yy: int) -> tuple[int, int, int]:
                    j = (yy * src_size + xx) * 3
                    return src[j], src[j + 1], src[j + 2]

                c00, c10, c01, c11 = samp(x0, y0), samp(x1, y0), samp(x0, y1), samp(x1, y1)
                for c in range(3):
                    top = c00[c] * (1 - tx) + c10[c] * tx
                    bot = c01[c] * (1 - tx) + c11[c] * tx
                    out[k + c] = int(top * (1 - ty) + bot * ty)
            else:
                x0 = int(x * scale)
                y0 = int(y * scale)
                x1 = max(x0 + 1, int((x + 1) * scale))
                y1 = max(y0 + 1, int((y + 1) * scale))
                r = g = b = n = 0
                for yy in range(y0, min(src_size, y1)):
                    for xx in range(x0, min(src_size, x1)):
                        j = (yy * src_size + xx) * 3
                        r += src[j]
                        g += src[j + 1]
                        b += src[j + 2]
                        n += 1
                out[k] = r // n
                out[k + 1] = g // n
                out[k + 2] = b // n
    return bytes(out)


def in_rounded_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float, radius: float) -> bool:
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = x0 + radius if x < x0 + radius else x1 - radius if x > x1 - radius else x
    cy = y0 + radius if y < y0 + radius else y1 - radius if y > y1 - radius else y
    if cx == x or cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def render_trace(size: int) -> bytes:
    """Magenta tile with a dark outline ring and a start-dot — not Stack's bars."""
    ss = 3
    big = size * ss
    pad = big * 0.06
    x0, y0 = pad, pad
    x1, y1 = big - 1 - pad, big - 1 - pad
    radius = (x1 - x0) * 0.22
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    ring_r = (x1 - x0) * 0.28
    ring_w = big * 0.055
    dot_ang = -0.85
    dot_r = ring_r
    start_r = big * 0.055
    acc = [0] * (size * size * 3)
    for y in range(big):
        for x in range(big):
            px = x // ss
            py = y // ss
            i = (py * size + px) * 3
            sx, sy = x + 0.5, y + 0.5
            dx, dy = sx - cx, sy - cy
            r = math.hypot(dx, dy)
            on_ring = abs(r - ring_r) <= ring_w
            gap = math.atan2(dy, dx)
            in_gap = abs(((gap - dot_ang + math.pi) % (2 * math.pi)) - math.pi) < 0.42
            on_ring = on_ring and not in_gap
            ddx = sx - (cx + math.cos(dot_ang) * dot_r)
            ddy = sy - (cy + math.sin(dot_ang) * dot_r)
            on_dot = ddx * ddx + ddy * ddy <= start_r * start_r
            if on_ring or on_dot:
                color = INK
            elif in_rounded_rect(sx, sy, x0, y0, x1, y1, radius):
                color = TRACE_MAGENTA
            else:
                color = BLACK
            acc[i] += color[0]
            acc[i + 1] += color[1]
            acc[i + 2] += color[2]
    area = ss * ss
    return bytes(v // area for v in acc)


def pick_master(app_dir: Path) -> tuple[int, bytes]:
    candidates = []
    for name in ("favicon.png", "logo.png", "icon-128.png", "apple-touch-icon.png", "icon-96.png"):
        path = app_dir / name
        if path.is_file():
            w, h, rgb = read_png(path)
            if w == h:
                candidates.append((w, rgb))
    if not candidates:
        raise FileNotFoundError(f"no square PNG in {app_dir}")
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0]


def icon_head(app: str) -> str:
    base = f"{PREFIX}/{app}"
    return (
        f'  <link rel="icon" type="image/png" href="{base}/favicon.png">\n'
        f'  <link rel="icon" type="image/png" sizes="96x96" href="{base}/icon-96.png">\n'
        f'  <link rel="icon" type="image/png" sizes="128x128" href="{base}/icon-128.png">\n'
        f'  <link rel="icon" type="image/png" sizes="192x192" href="{base}/favicon.png">\n'
        f'  <link rel="apple-touch-icon" href="{base}/apple-touch-icon.png">\n'
        f'  <link rel="apple-touch-icon" sizes="180x180" href="{base}/apple-touch-icon.png">\n'
        f'  <link rel="manifest" href="{base}/manifest.webmanifest">\n'
    )


def png_side(path: Path) -> int | None:
    if not path.is_file():
        return None
    width, height = struct.unpack(">II", path.read_bytes()[16:24])
    return width if width == height else None


def write_if_missing(path: Path, size: int, rgb: bytes) -> None:
    if png_side(path) == size:
        return
    write_png(path, size, size, rgb)


def write_sizes(app_dir: Path, master: bytes, master_size: int, nearest: bool) -> None:
    sized = {
        192: resize(master, master_size, 192, nearest) if master_size != 192 else master,
        180: resize(master, master_size, 180, nearest),
        128: resize(master, master_size, 128, nearest),
        96: resize(master, master_size, 96, nearest),
    }
    write_if_missing(app_dir / "logo.png", 192, sized[192])
    write_if_missing(app_dir / "favicon.png", 192, sized[192])
    write_if_missing(app_dir / "icon-128.png", 128, sized[128])
    write_if_missing(app_dir / "icon-96.png", 96, sized[96])
    write_if_missing(app_dir / "apple-touch-icon.png", 180, sized[180])


def patch_html(app_dir: Path, app: str) -> None:
    path = app_dir / "index.html"
    text = path.read_text()
    match = ICON_LINK_RE.search(text)
    if not match:
        raise RuntimeError(f"could not find icon links in {path}")
    block = icon_head(app)
    if match.group(0) == block:
        return
    path.write_text(text[: match.start()] + block + text[match.end() :])


def patch_manifest(app_dir: Path, app: str) -> None:
    path = app_dir / "manifest.webmanifest"
    data = json.loads(path.read_text())
    base = f"{PREFIX}/{app}"
    start = f"{base}/"
    icons = [
        {"src": f"{base}/icon-96.png", "sizes": "96x96", "type": "image/png", "purpose": "any"},
        {"src": f"{base}/icon-128.png", "sizes": "128x128", "type": "image/png", "purpose": "any"},
        {
            "src": f"{base}/apple-touch-icon.png",
            "sizes": "180x180",
            "type": "image/png",
            "purpose": "any",
        },
        {"src": f"{base}/favicon.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    ]
    icon_json = ",\n".join(
        "    { "
        + ", ".join(f"{json.dumps(key)}: {json.dumps(value)}" for key, value in icon.items())
        + " }"
        for icon in icons
    )
    body = (
        "{\n"
        f'  "name": {json.dumps(data["name"])},\n'
        f'  "short_name": {json.dumps(data["short_name"])},\n'
        f'  "description": {json.dumps(data["description"])},\n'
        f'  "id": {json.dumps(start)},\n'
        f'  "start_url": {json.dumps(start)},\n'
        f'  "scope": {json.dumps(start)},\n'
        f'  "icons": [\n{icon_json}\n  ],\n'
        f'  "background_color": {json.dumps(data.get("background_color", "#000000"))},\n'
        f'  "theme_color": {json.dumps(data.get("theme_color", "#000000"))},\n'
        f'  "display": {json.dumps(data.get("display", "standalone"))}\n'
        "}\n"
    )
    path.write_text(body)


def main() -> None:
    apps = sorted(p.name for p in APPS_DIR.iterdir() if p.is_dir())
    for app in apps:
        app_dir = APPS_DIR / app
        if app == "trace":
            master = render_trace(192)
            master_size = 192
            nearest = False
        else:
            master_size, master = pick_master(app_dir)
            nearest = unique_colors(master) <= 24
        write_sizes(app_dir, master, master_size, nearest)
        patch_html(app_dir, app)
        patch_manifest(app_dir, app)
        print(f"wrote icons for {app} (master {master_size}px, nearest={nearest})")

    seen: dict[bytes, str] = {}
    for app in apps:
        digest = (APPS_DIR / app / "favicon.png").read_bytes()
        other = seen.get(digest)
        if other:
            raise RuntimeError(f"{app} and {other} share the same favicon")
        seen[digest] = app


if __name__ == "__main__":
    main()
