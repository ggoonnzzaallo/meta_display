#!/usr/bin/env python3
"""Build a Markets terminal feed: big movers, earnings, and wire headlines.

Quotes use Yahoo Finance screeners/charts (not RSS). Headlines come from WSJ,
CNBC, Seeking Alpha, and BBC. Earnings prefer Nasdaq's calendar, with CNBC/SA
RSS as fallback. Do not scrape Finviz. Do not call these hosts from the glasses.
"""

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

YAHOO_UA = (
    "Mozilla/5.0 (compatible; meta-display-markets/1.2; "
    "+https://github.com/ggoonnzzaallo/meta_display)"
)
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TIMEOUT_S = 20
NASDAQ_TIMEOUT_S = 25
MAX_ITEMS = 55
MIN_PRICE = 5.0
MIN_VOLUME = 250_000
MIN_MARKET_CAP = 1_000_000_000

SCREENERS = [
    ("day_gainers", "up", "UP", 5),
    ("day_losers", "down", "DN", 5),
    ("most_actives", "vol", "VOL", 4),
]

INDEX_CHARTS = [
    ("%5EGSPC", "SPX"),
    ("%5EDJI", "DJI"),
    ("%5EIXIC", "IXIC"),
]

NEWS_FEEDS = [
    ("WSJ", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("SA", "https://seekingalpha.com/market_currents.xml"),
    ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
]

EARNINGS_NEWS_FEEDS = [
    ("CNBC", "https://www.cnbc.com/id/15839135/device/rss/rss.html"),
    ("SA", "https://seekingalpha.com/tag/earnings.xml"),
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_bytes(url: str, ua: str = YAHOO_UA, timeout: int = TIMEOUT_S) -> bytes:
    req = Request(
        url,
        headers={
            "User-Agent": ua,
            "Accept": "application/json, application/xml, text/xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_json(url: str, ua: str = YAHOO_UA, timeout: int = TIMEOUT_S) -> Any:
    return json.loads(fetch_bytes(url, ua=ua, timeout=timeout).decode("utf-8"))


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
        return float(str(value).replace(",", "").replace("%", "").replace("$", ""))
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


def fmt_cap(cap: float | None) -> str:
    if cap is None:
        return ""
    if cap >= 1_000_000_000_000:
        return f"{cap / 1_000_000_000_000:.1f}T"
    if cap >= 1_000_000_000:
        return f"{cap / 1_000_000_000:.1f}B"
    if cap >= 1_000_000:
        return f"{cap / 1_000_000:.1f}M"
    return f"{cap:.0f}"


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value.strip())
    except (TypeError, ValueError, IndexError):
        return None


def local_tag(name: str) -> str:
    return name.rsplit("}", 1)[-1] if "}" in name else name


def text_of(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def is_liquid(quote: dict[str, Any]) -> bool:
    price = raw_num(quote.get("regularMarketPrice"))
    vol = raw_num(quote.get("regularMarketVolume"))
    cap = raw_num(quote.get("marketCap"))
    if price is not None and price < MIN_PRICE:
        return False
    if vol is not None and vol < MIN_VOLUME:
        return False
    if cap is not None and cap < MIN_MARKET_CAP:
        return False
    return True


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
        time.sleep(0.5)
    return items


def fetch_screener(scr_id: str, kind: str, tag: str, count: int) -> list[dict[str, Any]]:
    qs = urlencode(
        {
            "formatted": "false",
            "lang": "en-US",
            "region": "US",
            "scrIds": scr_id,
            "count": "20",
        }
    )
    url = f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?{qs}"
    payload = fetch_json(url)
    quotes = payload["finance"]["result"][0]["quotes"]
    now = to_iso(utc_now())
    items: list[dict[str, Any]] = []
    for quote in quotes:
        if not is_liquid(quote):
            continue
        symbol = str(quote.get("symbol") or "")
        if not symbol:
            continue
        name = str(quote.get("shortName") or quote.get("longName") or symbol)
        last = raw_num(quote.get("regularMarketPrice"))
        pct = raw_num(quote.get("regularMarketChangePercent"))
        vol = raw_num(quote.get("regularMarketVolume"))
        cap = raw_num(quote.get("marketCap"))
        items.append(
            {
                "id": f"{kind}:{symbol}",
                "ts": now,
                "kind": kind,
                "category": tag,
                "symbol": symbol,
                "source": "YF",
                "headline": f"{symbol}  {fmt_pct(pct)}  {fmt_price(last)}",
                "summary": (
                    f"{name}. Last {fmt_price(last)}. Volume {fmt_vol(vol) or 'n/a'}. "
                    f"Mkt cap {fmt_cap(cap) or 'n/a'}."
                ),
                "change_pct": pct,
                "last": last,
            }
        )
        if len(items) >= count:
            break
    return items


def session_label(raw: str) -> str:
    text = (raw or "").strip().lower().replace("_", "-")
    if "pre" in text:
        return "BMO"
    if "after" in text or "post" in text:
        return "AMC"
    if "not-supplied" in text or not text:
        return ""
    return raw.strip()


def fetch_nasdaq_earnings() -> list[dict[str, Any]]:
    today = utc_now().strftime("%Y-%m-%d")
    url = f"https://api.nasdaq.com/api/calendar/earnings?date={today}"
    payload = fetch_json(url, ua=BROWSER_UA, timeout=NASDAQ_TIMEOUT_S)
    rows = (
        payload.get("data", {}).get("rows")
        or payload.get("data", {}).get("earnings", {}).get("rows")
        or []
    )
    now = to_iso(utc_now())
    timed: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for row in rows[:40]:
        symbol = str(row.get("symbol") or row.get("ticker") or "").strip().upper()
        if not symbol or len(symbol) > 6:
            continue
        timing = session_label(str(row.get("time") or row.get("timeOfDay") or ""))
        name = strip_html(str(row.get("name") or symbol))
        eps = str(row.get("epsForecast") or row.get("consensusEPS") or "").strip()
        headline = f"{symbol}  earnings" + (f"  {timing}" if timing else "")
        item = {
            "id": f"earn:{today}:{symbol}",
            "ts": now,
            "kind": "earn",
            "category": "ERN",
            "symbol": symbol,
            "source": "NDQ",
            "headline": headline,
            "summary": (
                f"{name} reports today"
                + (f" {timing}" if timing else "")
                + f". Consensus EPS {eps or 'n/a'}."
            ),
            "change_pct": None,
            "last": None,
        }
        if timing in ("BMO", "AMC"):
            timed.append(item)
        else:
            rest.append(item)
    return (timed + rest)[:6]


def parse_rss(xml_bytes: bytes, source: str, kind: str, category: str) -> list[dict[str, Any]]:
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
                "id": item_id(kind, source, link or title),
                "ts": to_iso(ts or utc_now()),
                "kind": kind,
                "category": category,
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


def fetch_rss_block(
    feeds: list[tuple[str, str]], kind: str, category: str, limit: int
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source, url in feeds:
        try:
            batch = parse_rss(fetch_bytes(url, ua=BROWSER_UA), source, kind, category)
        except (HTTPError, URLError, TimeoutError, ET.ParseError, OSError) as exc:
            print(f"{kind} skip {source}: {exc}", file=sys.stderr)
            continue
        added = 0
        for item in batch:
            key = item["headline"].lower()
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
            added += 1
            if added >= 5:
                break
        time.sleep(0.35)
    items.sort(key=lambda row: row["ts"], reverse=True)
    return items[:limit]


def fetch_earnings() -> list[dict[str, Any]]:
    stories = fetch_rss_block(EARNINGS_NEWS_FEEDS, "earn", "ERN", 10)
    print(f"earnings headlines: {len(stories)}", file=sys.stderr)
    calendar: list[dict[str, Any]] = []
    try:
        calendar = fetch_nasdaq_earnings()
        print(f"nasdaq earnings: {len(calendar)}", file=sys.stderr)
    except (HTTPError, URLError, TimeoutError, KeyError, TypeError, OSError) as exc:
        print(f"nasdaq earnings skip: {exc}", file=sys.stderr)
    return merge_unique([stories, calendar])[:12]


def merge_unique(blocks: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    for block in blocks:
        for item in block:
            title_key = str(item.get("headline") or "").lower()
            if item["id"] in seen_ids or (title_key and title_key in seen_titles):
                continue
            seen_ids.add(item["id"])
            if title_key:
                seen_titles.add(title_key)
            items.append(item)
    return items


def build_feed() -> dict[str, Any]:
    indices = fetch_indices()
    print(f"indices: {len(indices)}", file=sys.stderr)

    movers: list[list[dict[str, Any]]] = []
    for scr_id, kind, tag, count in SCREENERS:
        try:
            rows = fetch_screener(scr_id, kind, tag, count)
            print(f"{scr_id}: {len(rows)}", file=sys.stderr)
            movers.append(rows)
        except (HTTPError, URLError, TimeoutError, KeyError, IndexError, OSError) as exc:
            print(f"screener skip {scr_id}: {exc}", file=sys.stderr)
        time.sleep(0.6)

    earnings = fetch_earnings()
    headlines = fetch_rss_block(NEWS_FEEDS, "news", "NEWS", 18)
    print(f"headlines: {len(headlines)}", file=sys.stderr)

    items = merge_unique([indices, *movers, earnings, headlines])
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
