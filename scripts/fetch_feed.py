#!/usr/bin/env python3
"""Merge Monitor the Situation events and public RSS into feed.json."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

USER_AGENT = "meta-display-situation/1.0 (+https://github.com/ggoonnzzaallo/meta_display)"
TIMEOUT_S = 20
MAX_ITEMS = 120
MTS_URL = "https://monitor-the-situation.com/api/events"
MTS_PAGE = "https://monitor-the-situation.com/"

RSS_FEEDS = [
    {
        "name": "BBC",
        "category": "world",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
        "role": "world",
    },
    {
        "name": "AJ",
        "category": "world",
        "url": "https://www.aljazeera.com/xml/rss/all.xml",
        "role": "world",
    },
    {
        "name": "GDN",
        "category": "world",
        "url": "https://www.theguardian.com/world/rss",
        "role": "world",
    },
    {
        "name": "NPR",
        "category": "world",
        "url": "https://feeds.npr.org/1001/rss.xml",
        "role": "world",
    },
    {
        "name": "RW",
        "category": "disaster",
        "url": "https://reliefweb.int/updates/rss.xml",
        "role": "world",
    },
    {
        "name": "BBC",
        "category": "markets",
        "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
        "role": "markets",
    },
    {
        "name": "CNBC",
        "category": "markets",
        "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        "role": "markets",
    },
    {
        "name": "CNBC",
        "category": "markets",
        "url": "https://www.cnbc.com/id/10001147/device/rss/rss.html",
        "role": "markets",
    },
    {
        "name": "YF",
        "category": "markets",
        "url": "https://finance.yahoo.com/news/rssindex",
        "role": "markets",
    },
    {
        "name": "FED",
        "category": "markets",
        "url": "https://www.federalreserve.gov/feeds/press_all.xml",
        "role": "markets",
    },
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_bytes(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.read()


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_headline(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


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
            dt = datetime.strptime(raw.replace("Z", "+0000") if fmt.endswith("%z") and raw.endswith("Z") else raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def local_tag(name: str) -> str:
    if "}" in name:
        return name.rsplit("}", 1)[-1]
    return name


def text_of(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def parse_rss_or_atom(xml_bytes: bytes, source: str, category: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    items: list[dict[str, Any]] = []
    for node in root.iter():
        tag = local_tag(node.tag).lower()
        if tag not in ("item", "entry"):
            continue
        title = ""
        link = ""
        summary = ""
        ts = None
        for child in list(node):
            ctag = local_tag(child.tag).lower()
            if ctag == "title":
                title = strip_html(text_of(child) or "".join(child.itertext()))
            elif ctag == "link":
                href = child.attrib.get("href") or text_of(child)
                if href:
                    link = href
            elif ctag in ("description", "summary", "content", "encoded"):
                if not summary:
                    summary = strip_html(text_of(child) or "".join(child.itertext()))
            elif ctag in ("pubdate", "published", "updated", "date"):
                ts = parse_time(text_of(child)) or ts
        if not title:
            continue
        if not ts:
            ts = utc_now()
        if summary == title:
            summary = ""
        items.append(
            {
                "id": item_id(source, link or title),
                "ts": to_iso(ts),
                "source": source,
                "category": category,
                "severity": None,
                "headline": title,
                "summary": summary[:500],
                "location": "",
                "url": link,
            }
        )
    return items


def fetch_rss(feed: dict[str, str]) -> list[dict[str, Any]]:
    try:
        body = fetch_bytes(feed["url"])
        return parse_rss_or_atom(body, feed["name"], feed["category"])
    except (HTTPError, URLError, TimeoutError, ET.ParseError, OSError) as exc:
        print(f"rss skip {feed['name']} {feed['url']}: {exc}", file=sys.stderr)
        return []


def parse_mts_time(value: str | None) -> datetime:
    dt = parse_time(value)
    return dt if dt else utc_now()


def fetch_mts() -> list[dict[str, Any]]:
    body = fetch_bytes(MTS_URL)
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("MTS payload is not a list")
    items: list[dict[str, Any]] = []
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
    return items


def merge_items(batches: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    seen_headlines: set[str] = set()
    merged: list[dict[str, Any]] = []
    for batch in batches:
        for item in batch:
            hid = item["id"]
            headline_key = normalize_headline(item["headline"])
            if hid in seen_ids:
                continue
            if headline_key and headline_key in seen_headlines:
                continue
            seen_ids.add(hid)
            if headline_key:
                seen_headlines.add(headline_key)
            merged.append(item)
    merged.sort(key=lambda row: row["ts"], reverse=True)
    return merged[:MAX_ITEMS]


def build_feed() -> dict[str, Any]:
    mts_items: list[dict[str, Any]] = []
    try:
        mts_items = fetch_mts()
        print(f"mts events: {len(mts_items)}", file=sys.stderr)
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        print(f"mts failed, using world RSS: {exc}", file=sys.stderr)

    rss_batches: list[list[dict[str, Any]]] = []
    for feed in RSS_FEEDS:
        if mts_items and feed["role"] == "world":
            continue
        rss_batches.append(fetch_rss(feed))

    items = merge_items([mts_items, *rss_batches])
    return {"updated_at": to_iso(utc_now()), "items": items}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Situation terminal feed.json")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    feed = build_feed()
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
