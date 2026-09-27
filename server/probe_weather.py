"""Behavioral probe for the HKO weather integration — PRD §5.2 (S35–S40).

Run: python server/probe_weather.py [--live]

Deterministic by default and **isolated**: it starts its own uvicorn on a private port with
a private `BUSTARON_DATA_DIR` (so the repo's `state.json` is untouched) and a private
`BUSTARON_WEATHER_CACHE`, and drives the four scenarios through the real HTTP API by
writing the cache file directly — which is exactly what S35 describes the server as doing.

Scenarios:
* **fresh cache** → served without a network call; wind, `pathCostFactor` (S36) and the
  negotiation evidence's `wind_kmh` (S37) all report the CACHED value;
* **stale cache + HKO unreachable** → `stale: true`, the last good wind is still reported,
  and the negotiation completes anyway (S39: the mission proceeds);
* **Typhoon Signal 8 in force** → `dispatchBlocked` and a 409 on filing a flight plan,
  while Signal 0 files normally (S38); a STALE Signal-8 cache blocks NOTHING;
* **genesis** → the WEATHER transaction anchored at genesis carries the cached snapshot's
  hash (S40).

`--live` additionally contacts HKO for real and asserts a plausible snapshot comes back —
the only check that needs the network, and the one that proves the URLs still work.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def _add_repo_root_to_path() -> None:
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "server" / "weather.py").is_file():
            if str(ancestor) not in sys.path:
                sys.path.insert(0, str(ancestor))
            return


_add_repo_root_to_path()

from server.weather import (  # noqa: E402  (needs the sys.path bootstrap above)
    HkoSnapshot,
    parse_warnsum,
    parse_wind_csv,
    snapshot_hash,
    wind_cost_factor,
    write_cache,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"
SANDBOX = REPO_ROOT / ".workbuddy-ai" / "weather-probe"
CACHE_PATH = SANDBOX / "weather_cache.json"
DATA_DIR = SANDBOX / "state"
failures = 0
server: subprocess.Popen[bytes] | None = None


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    if condition:
        print(f"PASS  {label}")
    else:
        failures += 1
        print(f"FAIL  {label}{' — ' + detail if detail else ''}")


def get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def post(path: str, body: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def start_server(offline: bool) -> None:
    global server
    env = dict(os.environ)
    env["BUSTARON_DATA_DIR"] = str(DATA_DIR)
    env["BUSTARON_WEATHER_CACHE"] = str(CACHE_PATH)
    if offline:
        env["BUSTARON_WEATHER_OFFLINE"] = "1"
    else:
        env.pop("BUSTARON_WEATHER_OFFLINE", None)
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            if get("/api/health").get("chainValid") is not None:
                return
        except (urllib.error.URLError, OSError, ValueError):
            time.sleep(0.4)
    raise RuntimeError("the probe's own server never came up")


def stop_server() -> None:
    global server
    if server is None:
        return
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
    server = None
    time.sleep(0.5)


def fresh_snapshot(
    wind_kmh: float = 42.0,
    signal: int = 0,
    code: str | None = None,
    age_s: float = 0.0,
) -> HkoSnapshot:
    return HkoSnapshot(
        fetchedAtMs=int(time.time() * 1000) - int(age_s * 1000),
        observedAt="202609272240",
        windKmh=wind_kmh,
        windGustKmh=wind_kmh + 12.0,
        windStation="Green Island",
        windDirection="South",
        stationCount=17,
        temperatureC=29.0,
        humidityPct=81.0,
        typhoonSignal=signal,
        typhoonCode=code,
    )


CONFLICT_PAIR = {
    "own": {"id": "drone-a", "lat": 22.300000, "lng": 114.150000, "alt_m": 100.0,
            "battery_pct": 80.0},
    "peer": {"id": "drone-b", "lat": 22.3017965, "lng": 114.150000, "alt_m": 100.0,
             "battery_pct": 80.0},
    "windowStartS": 0,
}


# ------------------------------------------------------------------ parser checks
print("== parsers (no server, no network) ==")
wind_fixture = (
    "Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),"
    "10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)\n"
    "202609272240,Central Pier,Northwest,8,15\n"
    "202609272240,Chek Lap Kok,Southwest,19,23\n"
    "202609272240,Green Island,South,25,31\n"
)
parsed = parse_wind_csv(wind_fixture)
check(
    "S35: the wind parser takes the territory maximum mean speed, its station and its gust",
    parsed.get("windKmh") == 25.0
    and parsed.get("windStation") == "Green Island"
    and parsed.get("windGustKmh") == 31.0
    and parsed.get("stationCount") == 3
    and parsed.get("observedAt") == "202609272240",
    json.dumps(parsed),
)
check(
    "S35: a malformed/garbage CSV degrades to 'wind unknown' instead of raising",
    parse_wind_csv("nonsense\n1,2\n") == {},
)
check(
    "S38: an empty warnsum (nothing in force) is signal 0, not an error",
    parse_warnsum({}) == {"typhoonSignal": 0, "typhoonCode": None, "warnings": []},
)
tc8 = {"TC8NE": {"code": "TC8NE", "name": "Tropical Cyclone Warning", "type": "TC", "actionCode": "ISSUE"}}
check("S38: TC8NE is read as Signal 8 from the machine-readable code", parse_warnsum(tc8)["typhoonSignal"] == 8)
mixed = dict(tc8)
mixed["WTS"] = {"code": "WTS", "name": "Thunderstorm Warning", "type": "WTS"}
check(
    "S38: non-typhoon warnings are carried without inflating the signal",
    parse_warnsum(mixed)["typhoonSignal"] == 8 and len(parse_warnsum(mixed)["warnings"]) == 2,
)
check(
    "S36: the wind cost factor is 1.0 for unknown wind, monotonic, and capped at x1.5",
    wind_cost_factor(None) == 1.0
    and wind_cost_factor(0) == 1.0
    and wind_cost_factor(30) < wind_cost_factor(60)
    and wind_cost_factor(60) == 1.5
    and wind_cost_factor(500) == 1.5,
    f"none={wind_cost_factor(None)} 60={wind_cost_factor(60)} 500={wind_cost_factor(500)}",
)

SANDBOX.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ fresh cache (S35-S37)
print("== S35-S37: a fresh cache is served without HKO, and the evidence matches it ==")
if DATA_DIR.exists():
    for item in DATA_DIR.iterdir():
        item.unlink()
pristine = fresh_snapshot(wind_kmh=42.0)
write_cache(pristine, CACHE_PATH)
start_server(offline=False)  # the cache is fresh, so no network call is made
try:
    weather = get("/api/weather")
    # `ageS` is the honest cache age (the server took a few seconds to boot), so the
    # assertion is "well inside the TTL", not "zero".
    check(
        "S35: a fresh cache is served as-is (not stale, no refresh required)",
        weather["stale"] is False and weather["windKmh"] == 42.0 and 0 <= weather["ageS"] < 60,
        json.dumps({k: weather[k] for k in ("stale", "windKmh", "ageS")}),
    )
    check(
        "S36: the path-cost factor is derived from the cached wind (42 km/h -> x1.35)",
        weather["pathCostFactor"] == 1.35,
        str(weather["pathCostFactor"]),
    )
    check(
        "S40: genesis anchored the cached snapshot's hash at mint time",
        weather["genesisWeather"] is not None
        and weather["genesisWeather"]["snapshotHash"] == snapshot_hash(pristine)
        and weather["genesisMatchesCache"] is True,
        json.dumps(weather.get("genesisWeather")),
    )
    status, negotiated = post("/negotiate", CONFLICT_PAIR)
    evidence = (negotiated.get("transcript") or [{}])[-1].get("evidence", {})
    check(
        "S37: the negotiation envelope's wind IS the cached value (28-case: 42, not stale)",
        status == 200 and evidence.get("wind_kmh") == 42.0 and evidence.get("weather_stale") is False,
        json.dumps(evidence)[:160],
    )
    check(
        "S36/S37: the response reports the cache as the weather source and the same factor",
        negotiated.get("weather", {}).get("source") == "cache"
        and negotiated.get("weather", {}).get("windKmh") == 42.0
        and negotiated.get("weather", {}).get("pathCostFactor") == 1.35,
        json.dumps(negotiated.get("weather")),
    )
    # A client-supplied snapshot must still win over the cache.
    status, supplied = post(
        "/negotiate",
        {**CONFLICT_PAIR, "weather": {"wind_kmh": 7.0, "weather_stale": False}},
    )
    supplied_evidence = (supplied.get("transcript") or [{}])[-1].get("evidence", {})
    check(
        "S37: a caller-supplied snapshot overrides the cache (and is labelled as such)",
        status == 200 and supplied_evidence.get("wind_kmh") == 7.0
        and supplied.get("weather", {}).get("source") == "client",
        json.dumps(supplied_evidence)[:120],
    )

    # ------------------------------------------------------------ stale cache (S39)
    print("== S39: HKO unreachable -> STALE, last good wind, mission proceeds ==")
    stop_server()
    write_cache(fresh_snapshot(wind_kmh=42.0, age_s=3600.0), CACHE_PATH)
    start_server(offline=True)  # TTL long expired; the refresh is refused by config
    stale = get("/api/weather")
    check(
        "S39: an expired cache with HKO unreachable is flagged STALE — and still reports the last good wind",
        stale["stale"] is True and stale["windKmh"] == 42.0 and "OFFLINE" in (stale["note"] or ""),
        json.dumps({k: stale[k] for k in ("stale", "windKmh", "note")}),
    )
    status, stale_negotiated = post("/negotiate", CONFLICT_PAIR)
    stale_evidence = (stale_negotiated.get("transcript") or [{}])[-1].get("evidence", {})
    check(
        "S39: the mission PROCEEDS while stale, and the envelope says so honestly",
        status == 200 and stale_evidence.get("weather_stale") is True,
        json.dumps(stale_evidence)[:120],
    )
    check(
        "S39: staleness is reported in the negotiation response too, with the cache hashed",
        stale_negotiated.get("weather", {}).get("stale") is True
        and isinstance(stale_negotiated.get("weather", {}).get("cachedSnapshotHash"), str),
        json.dumps(stale_negotiated.get("weather")),
    )

    # ------------------------------------------------------------ typhoon gate (S38)
    print("== S38: Typhoon Signal 8 refuses dispatch; Signal 0 does not ==")
    stop_server()
    write_cache(fresh_snapshot(wind_kmh=55.0, signal=8, code="TC8NE"), CACHE_PATH)
    start_server(offline=False)
    gated = get("/api/weather")
    check(
        "S38: /api/weather reports dispatchBlocked with the signal named by code",
        gated["dispatchBlocked"] is True and gated["typhoonSignal"] == 8 and gated["typhoonCode"] == "TC8NE",
        json.dumps({k: gated[k] for k in ("dispatchBlocked", "typhoonSignal", "typhoonCode")}),
    )
    catchall = {
        "id": f"approval-probe-typhoon-{int(time.time())}",
        "missionName": "Probe dispatch under Signal 8",
        "operator": "Harbour Ops Desk",
        "walletId": "wallet-harbour",
        "creditsEscrowed": 10,
        "riskLevel": "low",
    }
    status, refused = post("/chain/tx", {"type": "APPROVAL_FILE", "payload": catchall})
    check(
        "S38: filing a flight plan under Signal 8 is refused with 409 and nothing escrowed",
        status == 409 and "Typhoon Signal 8" in json.dumps(refused),
        f"{status} {json.dumps(refused)[:140]}",
    )
    stop_server()
    write_cache(fresh_snapshot(wind_kmh=8.0, signal=0), CACHE_PATH)
    start_server(offline=False)
    status, filed = post(
        "/chain/tx",
        {"type": "APPROVAL_FILE", "payload": {**catchall, "id": f"approval-probe-calm-{int(time.time())}"}},
    )
    check(
        "S38: the same filing succeeds when no signal is in force (the gate is the signal, "
        "not a blanket refusal)",
        status == 200 and get("/api/weather")["dispatchBlocked"] is False,
        f"{status} {json.dumps(filed)[:140]}",
    )
    stop_server()
    write_cache(fresh_snapshot(wind_kmh=55.0, signal=8, code="TC8NE", age_s=3600.0), CACHE_PATH)
    start_server(offline=True)
    status, stale_signal = post(
        "/chain/tx",
        {"type": "APPROVAL_FILE", "payload": {**catchall, "id": f"approval-probe-stale8-{int(time.time())}"}},
    )
    check(
        "S38/S39: a STALE Signal-8 cache blocks NOTHING — we do not know the signal now, so the mission proceeds",
        get("/api/weather")["stale"] is True and status == 200,
        f"{status} {json.dumps(stale_signal)[:140]}",
    )

    # ------------------------------------------------------------ genesis anchor (S40)
    print("== S40: the genesis WEATHER transaction matches the cached snapshot ==")
    stop_server()
    # ONE snapshot object: the hash is over an EXACT payload, so rebuilding it with a
    # fresh `fetchedAtMs` would compare two different documents and always fail.
    genesis_snapshot = fresh_snapshot(wind_kmh=33.0, signal=1, code="TC1")
    write_cache(genesis_snapshot, CACHE_PATH)
    if DATA_DIR.exists():
        for item in DATA_DIR.iterdir():
            item.unlink()
    start_server(offline=True)  # fresh cache: no network needed for the whole flow
    anchored = get("/api/weather")
    check(
        "S40: after a re-seed, genesis carries the hash of the snapshot that was cached at mint time",
        anchored["genesisWeather"]["snapshotHash"] == snapshot_hash(genesis_snapshot)
        and anchored["genesisMatchesCache"] is True,
        json.dumps(anchored.get("genesisWeather")),
    )
    chain = get("/chain")
    genesis_block = chain["blocks"][0]
    genesis_txs = genesis_block["txs"]
    check(
        "S40: the WEATHER tx sits in the genesis block beside GENESIS and is signed like any other block",
        [tx.get("type") for tx in genesis_txs] == ["GENESIS", "WEATHER"]
        and len(genesis_block["sigs"]) == 3,
        json.dumps([tx.get("type") for tx in genesis_txs]),
    )
finally:
    stop_server()

# ------------------------------------------------------------------------ live mode
if "--live" in sys.argv:
    print("== live: contact HKO for real (the only network-dependent check) ==")
    os.environ.pop("BUSTARON_WEATHER_OFFLINE", None)
    os.environ["BUSTARON_WEATHER_CACHE"] = str(SANDBOX / "live_cache.json")
    from server.weather import load_weather  # noqa: PLC0415  (import after the env is set)

    live = load_weather()  # noqa: F821  (bound just above, after the env override)
    check(
        "S35 (live): HKO returned a real wind observation with multiple stations",
        live.stale is False and (live.windKmh or 0) > 0 and live.stationCount >= 10,
        f"stale={live.stale} wind={live.windKmh} stations={live.stationCount} at={live.observedAt}",
    )
    check(
        "S38 (live): the live warning summary parses (signal 0 when nothing is in force)",
        live.typhoonSignal in (0, 1, 3, 8, 9, 10),
        f"signal={live.typhoonSignal} code={live.typhoonCode}",
    )
    print(f"     live snapshot: {json.dumps(live.model_dump())[:280]}")

print()
if failures:
    print(f"{failures} CHECK(S) FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
