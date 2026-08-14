#!/usr/bin/env python3
"""Build a Finviz-style markets snapshot for the glasses terminal."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT = (
    "Mozilla/5.0 (compatible; meta-display-markets/1.0; "
    "+https://github.com/ggoonnzzaallo/meta_display)"
)
TIMEOUT_S = 20
MAX_ITEMS = 50

SCREENERS = [
    ("day_gainers", "up", "UP", 6),
    ("day_losers", "down", "DN", 6),
    ("most_actives", "vol", "VOL", 4),
]

INDEX_CHARTS = [
    ("%5EGSPC", "SPX"),
    ("%5EDJI", "DJI"),
    ("%5EIXIC", "IXIC"),
]

NEWS_FEEDS = [
    ("CNBC", "https://www.cnbc.com/id/10001147/device/rss/rss.html"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("YF", "https://finance.yahoo.com/news/rssindex"),
    ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_bytes(url: str) -> bytes:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, application/xml, text/xml, */*",
        },
    )
    with urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.read()


def fetch_json(url: str) -> Any:
    return json.loads(fetch_bytes(url).decode("utf-8"))


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def item_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def raw_num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("raw", value.get("fmt"))
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except ValueError:
        return None


def fmt_pct(pct: float | None) -> str:
    if pct is None:
        return "—"
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.1f}%"


def fmt_price(price: float | None) -> str:
    if price is None:
        return "—"
    if abs(price) >= 1000:
        return f"{price:,.0f}"
    if abs(price) >= 10:
        return f"{price:.2f}"
    return f"{price:.4f}"


def fmt_vol(vol: float | None) -> str:
    if vol is None:
        return ""
    if vol >= 1_000_000_000:
        return f"{vol / 1_000_000_000:.1f}B"
    if vol >= 1_000_000:
        return f"{vol / 1_000_000:.1f}M"
    if vol >= 1_000:
        return f"{vol / 1_000:.1f}K"
    return f"{vol:.0f}"


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        pass
    return None


def local_tag(name: str) -> str:
    return name.rsplit("}", 1)[-1] if "}" in name else name


def fetch_indices() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    now = to_iso(utc_now())
    for symbol, label in INDEX_CHARTS:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=2d"
        try:
            payload = fetch_json(url)
            meta = payload["chart"]["result"][0]["meta"]
            last = raw_num(meta.get("regularMarketPrice"))
            prev = raw_num(meta.get("chartPreviousClose") or meta.get("previousClose"))
            pct = None
            if last is not None and prev:
                pct = (last - prev) / prev * 100
            items.append(
                {
                    "id": f"idx:{label}",
                    "ts": now,
                    "kind": "idx",
                    "category": "IDX",
                    "symbol": label,
                    "source": "YF",
                    "headline": f"{label}  {fmt_pct(pct)}  {fmt_price(last)}",
                    "summary": f"{label} last {fmt_price(last)}, change {fmt_pct(pct)}.",
                    "change_pct": pct,
                    "last": last,
                }
            )
        except (HTTPError, URLError, TimeoutError, KeyError, IndexError, TypeError, OSError) as exc:
            print(f"index skip {label}: {exc}", file=sys.stderr)
        time.sleep(0.4)
    return items


def fetch_screener(scr_id: str, kind: str, tag: str, count: int) -> list[dict[str, Any]]:
    qs = urlencode(
        {
            "formatted": "false",
            "lang": "en-US",
            "region": "US",
            "scrIds": scr_id,
            "count": str(count),
        }
    )
    url = f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?{qs}"
    payload = fetch_json(url)
    quotes = payload["finance"]["result"][0]["quotes"]
    now = to_iso(utc_now())
    items: list[dict[str, Any]] = []
    for quote in quotes[:count]:
        symbol = str(quote.get("symbol") or "")
        if not symbol:
            continue
        name = str(quote.get("shortName") or quote.get("longName") or symbol)
        last = raw_num(quote.get("regularMarketPrice"))
        pct = raw_num(quote.get("regularMarketChangePercent"))
        vol = raw_num(quote.get("regularMarketVolume"))
        items.append(
            {
                "id": f"{kind}:{symbol}",
                "ts": now,
                "kind": kind,
                "category": tag,
                "symbol": symbol,
                "source": "YF",
                "headline": f"{symbol}  {fmt_pct(pct)}",
                "summary": f"{name}. Last {fmt_price(last)}. Volume {fmt_vol(vol) or 'n/a'}. {tag}.",
                "change_pct": pct,
                "last": last,
            }
        )
    return items


def fetch_earnings() -> list[dict[str, Any]]:
    today = utc_now().strftime("%Y-%m-%d")
    url = f"https://api.nasdaq.com/api/calendar/earnings?date={today}"
    payload = fetch_json(url)
    rows = (
        payload.get("data", {}).get("rows")
        or payload.get("data", {}).get("earnings", {}).get("rows")
        or []
    )
    now = to_iso(utc_now())
    items: list[dict[str, Any]] = []
    for row in rows[:8]:
        symbol = str(row.get("symbol") or row.get("ticker") or "").strip()
        if not symbol:
            continue
        name = strip_html(str(row.get("name") or symbol))
        timing = str(row.get("time") or row.get("timeOfDay") or "").strip()
        eps = str(row.get("epsForecast") or row.get("consensusEPS") or "").strip()
        headline = f"{symbol}  earnings {timing}".strip()
        items.append(
            {
                "id": f"earn:{today}:{symbol}",
                "ts": now,
                "kind": "earn",
                "category": "ERN",
                "symbol": symbol,
                "source": "NDQ",
                "headline": headline,
                "summary": f"{name} reports today {timing or 'unspecified session'}. Consensus EPS {eps or 'n/a'}.",
                "change_pct": None,
                "last": None,
            }
        )
    return items


def parse_rss(xml_bytes: bytes, source: str) -> list[dict[str, Any]]:
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
        items.append(
            {
                "id": item_id("news", source, link or title),
                "ts": to_iso(ts or utc_now()),
                "kind": "news",
                "category": "NEWS",
                "symbol": "",
                "source": source,
                "headline": title,
                "summary": (summary[:500] if summary != title else ""),
                "change_pct": None,
                "last": None,
                "url": link,
            }
        )
    return items


def text_of(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def fetch_news() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source, url in NEWS_FEEDS:
        try:
            batch = parse_rss(fetch_bytes(url), source)
        except (HTTPError, URLError, TimeoutError, ET.ParseError, OSError) as exc:
            print(f"news skip {source}: {exc}", file=sys.stderr)
            continue
        for item in batch:
            key = item["headline"].lower()
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
        time.sleep(0.3)
    items.sort(key=lambda row: row["ts"], reverse=True)
    return items[:18]


def build_feed() -> dict[str, Any]:
    blocks: list[list[dict[str, Any]]] = []

    indices = fetch_indices()
    print(f"indices: {len(indices)}", file=sys.stderr)
    blocks.append(indices)

    for scr_id, kind, tag, count in SCREENERS:
        try:
            rows = fetch_screener(scr_id, kind, tag, count)
            print(f"{scr_id}: {len(rows)}", file=sys.stderr)
            blocks.append(rows)
        except (HTTPError, URLError, TimeoutError, KeyError, IndexError, OSError) as exc:
            print(f"screener skip {scr_id}: {exc}", file=sys.stderr)
        time.sleep(0.5)

    try:
        earnings = fetch_earnings()
        print(f"earnings: {len(earnings)}", file=sys.stderr)
        blocks.append(earnings)
    except (HTTPError, URLError, TimeoutError, KeyError, TypeError, OSError) as exc:
        print(f"earnings skip: {exc}", file=sys.stderr)

    news = fetch_news()
    print(f"news: {len(news)}", file=sys.stderr)
    blocks.append(news)

    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for block in blocks:
        for item in block:
            if item["id"] in seen_ids:
                continue
            seen_ids.add(item["id"])
            items.append(item)
    return {"updated_at": to_iso(utc_now()), "items": items[:MAX_ITEMS]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Markets terminal feed.json")
    parser.add_argument("--out", required=True)
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
