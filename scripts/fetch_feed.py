#!/usr/bin/env python3
"""Build Situation feed.json from Monitor the Situation events only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

USER_AGENT = "meta-display-situation/1.1 (+https://github.com/ggoonnzzaallo/meta_display)"
TIMEOUT_S = 20
MAX_ITEMS = 120
MTS_URL = "https://monitor-the-situation.com/api/events"
MTS_PAGE = "https://monitor-the-situation.com/"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_bytes(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*"})
    with urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.read()


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def item_id(*parts: str) -> str:
    blob = "|".join(parts).encode("utf-8")
    return hashlib.sha1(blob).hexdigest()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        pass
    for fmt in (
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            parsed = raw.replace("Z", "+0000") if fmt.endswith("%z") and raw.endswith("Z") else raw
            dt = datetime.strptime(parsed, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def parse_mts_time(value: str | None) -> datetime:
    dt = parse_time(value)
    return dt if dt else utc_now()


def fetch_mts() -> list[dict[str, Any]]:
    body = fetch_bytes(MTS_URL)
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("MTS payload is not a list")
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for event in payload:
        if not isinstance(event, dict):
            continue
        if event.get("is_active") is False:
            continue
        title = strip_html(str(event.get("title") or ""))
        if not title:
            continue
        ts = parse_mts_time(str(event.get("updated_at") or event.get("created_at") or ""))
        category = strip_html(str(event.get("category") or "world")).lower() or "world"
        location = strip_html(str(event.get("location_name") or event.get("country") or ""))
        severity = event.get("severity")
        try:
            severity_n = int(severity) if severity is not None else None
        except (TypeError, ValueError):
            severity_n = None
        event_id = str(event.get("id") or item_id("MTS", title, location))
        if event_id in seen:
            continue
        seen.add(event_id)
        items.append(
            {
                "id": event_id,
                "ts": to_iso(ts),
                "source": "MTS",
                "category": category,
                "severity": severity_n,
                "headline": title,
                "summary": strip_html(str(event.get("summary") or ""))[:500],
                "location": location,
                "url": MTS_PAGE,
            }
        )
    items.sort(key=lambda row: row["ts"], reverse=True)
    return items[:MAX_ITEMS]


def build_feed() -> dict[str, Any]:
    items = fetch_mts()
    print(f"mts events: {len(items)}", file=sys.stderr)
    return {"updated_at": to_iso(utc_now()), "items": items}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Situation terminal feed.json")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    try:
        feed = build_feed()
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        print(f"mts failed, keeping existing feed: {exc}", file=sys.stderr)
        return 1

    if not feed["items"]:
        print("no items fetched", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    tmp_path = args.out + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(feed, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp_path, args.out)
    print(f"wrote {len(feed['items'])} items to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
