"""HKO weather poller — PRD §5.2 (S35–S40).

Sources (HKO open data, no key required; both verified against the live service):

* **Wind** — ``hko_data/regional-weather/latest_10min_wind.csv`` (every 10 min):
  ``Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),
  10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)``
  Live sample: ``202609272240,Chek Lap Kok,Southwest,19,23``.
* **Warnings** — ``weather.php?dataType=warnsum&lang=en``: a record keyed by warning code,
  each value ``{actionCode, code, name, type, issueTime, updateTime, expireTime}``. A
  typhoon signal appears as ``TC1`` / ``TC3`` / ``TC8NE|TC8SE|TC8SW|TC8NW`` / ``TC9`` /
  ``TC10`` — the **machine-readable code** is the primary path; prose is never matched.
* **Readings** — ``weather.php?dataType=rhrread&lang=en`` (temperature, humidity, rainfall)
  for the demo HUD. Optional: its absence never fails a refresh.

Cache (PRD §5.5 artifact): ``data/weather_cache.json`` — the snapshot plus its hash and
fetch timestamp. TTL 300 s (S35). When the cache is fresh it is served WITHOUT a network
call; when it is stale or missing a refresh is attempted. **A failed refresh never raises**
(S39): the last good snapshot is served with ``stale: true``, and if there has never been
one, a placeholder with ``stale: true`` and no wind is served. The mission proceeds — the
STALE flag is the honesty channel, not a crash.

Evidence rule (S37): the value handed to the negotiation engine's ``wind_kmh`` is *exactly*
the cached value; ``/api/weather`` exposes the same number plus ``cachedSnapshotHash``, and
``snapshot_hash()`` is the canonical hash used for the genesis ``WEATHER`` transaction (S40).

Offline/by-test overrides: ``BUSTARON_WEATHER_CACHE`` (path), ``BUSTARON_WEATHER_TTL_S``,
``BUSTARON_WEATHER_OFFLINE=1`` (never touch the network — the probe's deterministic mode).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger("bustaron.weather")

WIND_CSV_URL = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv"
WARNSUM_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en"
RHRREAD_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en"

#: PRD §5.5 names this artifact explicitly.
DEFAULT_CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "weather_cache.json"
DEFAULT_TTL_S = 300.0

#: Typhoon signal levels HKO uses. Anything ≥ 8 blocks dispatch (S38).
TYPHOON_CODES: dict[str, int] = {
    "TC1": 1,
    "TC3": 3,
    "TC8NE": 8,
    "TC8SE": 8,
    "TC8SW": 8,
    "TC8NW": 8,
    "TC9": 9,
    "TC10": 10,
}
DISPATCH_BLOCKING_SIGNAL = 8

#: Wind→cost model (S36). Uniform across a route, so it changes the quoted cost, not the
#: A* topology — see `wind_cost_factor`'s docstring. Capped at ×1.5 (60 km/h).
WIND_FACTOR_MAX_KMH = 60.0
WIND_FACTOR_MAX_BONUS = 0.5


class WeatherWarning(BaseModel):
    code: str
    name: str | None = None
    type: str | None = None


class HkoSnapshot(BaseModel):
    """One HKO observation, normalised. Every field is honest about what it is."""

    source: str = "HKO"
    fetchedAtMs: int = 0
    observedAt: str | None = None  # the CSV's own `Date time` (YYYYMMDDHHMM)
    stale: bool = False
    ageS: float = 0.0
    windKmh: float | None = None  # territory maximum 10-minute MEAN speed
    windGustKmh: float | None = None  # territory maximum gust at the same timestamp
    windStation: str | None = None  # the station that produced `windKmh`
    windDirection: str | None = None  # compass point at that station
    stationCount: int = 0
    temperatureC: float | None = None
    humidityPct: float | None = None
    typhoonSignal: int = 0
    typhoonCode: str | None = None
    warnings: list[WeatherWarning] = Field(default_factory=list)
    note: str | None = None  # why this snapshot is stale / empty, in prose for humans

    @property
    def dispatchBlocked(self) -> bool:
        """S38: Signal 8 or above refuses dispatch. A STALE snapshot blocks nothing."""
        return (not self.stale) and self.typhoonSignal >= DISPATCH_BLOCKING_SIGNAL

    @property
    def pathCostFactor(self) -> float:
        """S36: the wind penalty for the agent's path cost (1.0 when wind is unknown)."""
        return wind_cost_factor(self.windKmh)


def wind_cost_factor(wind_kmh: float | None) -> float:
    """Wind → multiplicative path-cost factor (S36).

    ``1 + min(wind, 60)/60 * 0.5``, i.e. ×1.0 calm → ×1.5 at 60 km/h. Deliberately UNIFORM
    across a route: wind raises the energy/credit cost of flying, but with a single scalar
    it cannot re-rank two paths of equal length, so the A* topology is unchanged by
    construction. Per-segment headwind/tailwind weighting is a follow-up, not a claim.
    """
    if wind_kmh is None:
        return 1.0
    bounded = max(0.0, min(float(wind_kmh), WIND_FACTOR_MAX_KMH))
    return round(1.0 + (bounded / WIND_FACTOR_MAX_KMH) * WIND_FACTOR_MAX_BONUS, 4)


# --------------------------------------------------------------------------- parsing
def parse_wind_csv(text: str) -> dict[str, Any]:
    """Parses the HKO 10-minute regional wind CSV into the territory extremes.

    Rows are ``datetime,station,compass,speed_kmh,gust_kmh``. Malformed rows are skipped,
    a header is skipped by name, and an empty/garbage document yields ``{}`` — a broken
    source must degrade to "wind unknown", never raise (S39's spirit).
    """
    rows: list[dict[str, Any]] = []
    observed_at: str | None = None
    for line in text.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        try:
            speed = float(parts[3])
            gust = float(parts[4])
        except ValueError:
            continue
        observed_at = parts[0]
        rows.append({"station": parts[1], "direction": parts[2], "speedKmh": speed, "gustKmh": gust})
    if not rows:
        return {}
    strongest = max(rows, key=lambda row: row["speedKmh"])
    return {
        "observedAt": observed_at,
        "windKmh": strongest["speedKmh"],
        "windStation": strongest["station"],
        "windDirection": strongest["direction"],
        "windGustKmh": max(row["gustKmh"] for row in rows),
        "stationCount": len(rows),
    }


def parse_warnsum(payload: Any) -> dict[str, Any]:
    """Extracts warnings and the typhoon signal from a `warnsum` document.

    ``{}`` (nothing in force — the live response when no warning is active) yields signal 0
    with no warnings. Codes are matched EXACTLY against `TYPHOON_CODES`; anything else is
    carried as a generic warning. Tolerant of a non-dict payload (never raises).
    """
    warnings: list[WeatherWarning] = []
    signal = 0
    signal_code: str | None = None
    if not isinstance(payload, dict):
        return {"typhoonSignal": 0, "typhoonCode": None, "warnings": []}
    for key, raw in payload.items():
        item = raw if isinstance(raw, dict) else {}
        code = str(item.get("code") or key).upper()
        warnings.append(WeatherWarning(code=code, name=item.get("name"), type=item.get("type")))
        level = TYPHOON_CODES.get(code)
        if level is not None and level > signal:
            signal, signal_code = level, code
    return {"typhoonSignal": signal, "typhoonCode": signal_code, "warnings": warnings}


def parse_rhrread(payload: Any) -> dict[str, Any]:
    """Temperature/humidity from `rhrread` (optional decoration; absent fields stay None)."""
    if not isinstance(payload, dict):
        return {}

    def first_value(field: str) -> float | None:
        block = payload.get(field)
        if not isinstance(block, dict):
            return None
        data = block.get("data")
        if not isinstance(data, list):
            return None
        for entry in data:
            if isinstance(entry, dict) and isinstance(entry.get("value"), (int, float)):
                return float(entry["value"])
        return None

    return {"temperatureC": first_value("temperature"), "humidityPct": first_value("humidity")}


# --------------------------------------------------------------------------- fetching
def _http_text(url: str, timeout_s: float = 8.0) -> str:
    with urllib.request.urlopen(url, timeout=timeout_s) as response:  # noqa: S310 (fixed HKO host)
        return response.read().decode("utf-8", "replace")


def _http_json(url: str, timeout_s: float = 8.0) -> Any:
    return json.loads(_http_text(url, timeout_s))


def fetch_live_snapshot(now_ms: int) -> HkoSnapshot:
    """One refresh against HKO. Raises only if the WIND source fails — wind is the datum the
    platform's cost model and evidence need; warnings/readings may be missing and are then
    simply absent."""
    wind = parse_wind_csv(_http_text(WIND_CSV_URL))
    if not wind:
        raise ValueError("HKO wind CSV returned no parseable rows")
    try:
        warnings = parse_warnsum(_http_json(WARNSUM_URL))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("HKO warnsum unavailable (%s) — proceeding without warning data", exc)
        warnings = {"typhoonSignal": 0, "typhoonCode": None, "warnings": []}
    try:
        readings = parse_rhrread(_http_json(RHRREAD_URL))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("HKO rhrread unavailable (%s) — proceeding without readings", exc)
        readings = {}
    return HkoSnapshot(
        fetchedAtMs=now_ms,
        stale=False,
        **wind,
        **warnings,
        **readings,
    )


# ----------------------------------------------------------------------- cache and TTL
def cache_path() -> Path:
    return Path(os.environ.get("BUSTARON_WEATHER_CACHE", DEFAULT_CACHE_PATH))


def ttl_s() -> float:
    try:
        return float(os.environ.get("BUSTARON_WEATHER_TTL_S", DEFAULT_TTL_S))
    except ValueError:
        return DEFAULT_TTL_S


def offline() -> bool:
    return os.environ.get("BUSTARON_WEATHER_OFFLINE", "") not in ("", "0", "false", "False")


def read_cache(path: Path | None = None) -> HkoSnapshot | None:
    """Reads the cache file. A corrupt file is REPORTED and ignored — never guessed at and
    never rewritten by this function (the same rule the ledger applies to its state file)."""
    target = path or cache_path()
    if not target.exists():
        return None
    try:
        return HkoSnapshot(**json.loads(target.read_text(encoding="utf-8")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.error("weather cache unreadable (%s) — ignoring it", exc)
        return None


def write_cache(snapshot: HkoSnapshot, path: Path | None = None) -> None:
    target = path or cache_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(snapshot.model_dump(), indent=2), encoding="utf-8")


def snapshot_hash(snapshot: HkoSnapshot | dict[str, Any]) -> str:
    """Canonical SHA-256 of a snapshot — the S40 anchor value and the S37 comparison key.

    `ageS`/`stale` are EXCLUDED: they describe how the snapshot is being served, not what
    HKO observed, so a later read of the same observation hashes identically.
    """
    body = snapshot.model_dump() if isinstance(snapshot, HkoSnapshot) else dict(snapshot)
    for volatile in ("ageS", "stale", "note"):
        body.pop(volatile, None)
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_weather(
    now_ms: int | None = None,
    path: Path | None = None,
    ttl: float | None = None,
    fetcher: Callable[[int], HkoSnapshot] | None = None,
) -> HkoSnapshot:
    """Returns the current snapshot, refreshing through HKO only when the cache is expired.

    * fresh cache (age ≤ TTL) → served as-is, `stale=False`, no network;
    * expired cache → one refresh attempt; success rewrites the cache, failure serves the
      last good snapshot with `stale=True` and the ORIGINAL `fetchedAtMs`/`ageS` (S39);
    * no cache at all + failed refresh → a placeholder (`stale=True`, `windKmh=None`) whose
      `note` says why. Never raises.
    """
    moment = int(time.time() * 1000) if now_ms is None else now_ms
    target = path or cache_path()
    effective_ttl = ttl_s() if ttl is None else ttl
    refresh = fetcher or fetch_live_snapshot
    cached = read_cache(target)
    if cached is not None:
        age_s = max(0.0, (moment - cached.fetchedAtMs) / 1000.0)
        cached.ageS = round(age_s, 1)
        if age_s <= effective_ttl:
            cached.stale = False
            cached.note = None
            return cached
    if offline():
        failure = "BUSTARON_WEATHER_OFFLINE is set — HKO not contacted"
    else:
        try:
            fresh = refresh(moment)
            write_cache(fresh, target)
            fresh.ageS = 0.0
            return fresh
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            failure = f"HKO refresh failed: {type(exc).__name__}: {exc}"
    if cached is not None:
        cached.stale = True
        cached.note = f"{failure}; serving the last good snapshot"
        logger.warning("weather STALE — %s", cached.note)
        return cached
    logger.warning("weather STALE and empty — %s", failure)
    return HkoSnapshot(fetchedAtMs=moment, stale=True, ageS=0.0, note=failure)


def cached_weather_for_evidence(now_ms: int | None = None, path: Path | None = None) -> HkoSnapshot:
    """Cache-only read for latency-critical callers (the negotiation path).

    NEVER touches the network: FR-N7 budgets 5 s for a whole exchange, and a cold HKO
    refresh could spend two 8 s timeouts inside that budget. A missing cache yields the
    stale placeholder, i.e. `weather_stale: true` — which is the honest answer, not an
    error.
    """
    moment = int(time.time() * 1000) if now_ms is None else now_ms
    cached = read_cache(path)
    if cached is None:
        return HkoSnapshot(fetchedAtMs=moment, stale=True, ageS=0.0, note="no weather cache yet")
    age_s = max(0.0, (moment - cached.fetchedAtMs) / 1000.0)
    cached.ageS = round(age_s, 1)
    cached.stale = age_s > ttl_s()
    return cached


def genesis_weather_record(path: Path | None = None) -> dict[str, Any]:
    """The `WEATHER` transaction payload anchored in the genesis block (S40).

    Reads the CACHE ONLY — a genesis mint must never wait on the network (it runs at
    import time, before the server can even bind). A missing cache is recorded honestly as
    `snapshotHash: null` rather than fabricated.
    """
    cached = read_cache(path)
    if cached is None:
        return {
            "snapshotHash": None,
            "source": "HKO",
            "note": "no weather cache existed when the genesis block was minted",
        }
    return {
        "snapshotHash": snapshot_hash(cached),
        "source": cached.source,
        "observedAt": cached.observedAt,
        "windKmh": cached.windKmh,
        "typhoonSignal": cached.typhoonSignal,
    }
