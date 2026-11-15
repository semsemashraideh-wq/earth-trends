"""Build real NASA data for the Explore Map — run once:   python build_map_data.py

The map in the design is a 60 × 30 grid of 6° cells. For every cell centre we
ask NASA POWER for monthly values 1981 → last full year (one request gives
temperature, rainfall and surface temperature together), turn them into yearly
values, and save everything to frontend/map_data.json, which the map reads.

- About 1,800 requests: roughly 5–10 minutes the first time.
- Progress is saved in .cache/grid/, so if it stops (internet, Ctrl+C) just run
  it again and it continues where it left off.
- CO₂ comes from NOAA Mauna Loa (one value per year: CO₂ is well mixed).
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import nasa_api

ROOT = Path(__file__).parent
CELL_DIR = ROOT / ".cache" / "grid"
OUT = ROOT / "frontend" / "map_data.json"
GW, GH, STEP = 60, 30, 6          # must match the design's map grid
WORKERS = 3                       # be polite to NASA's servers (too fast = blocked)
PAUSE = 0.4                       # seconds each worker waits between requests
GIVE_UP_AFTER = 25                # this many failures in a row = NASA is refusing for now


def cell_centre(i):
    # The map stores cells in row order, so split the flat index into row and column.
    y, x = divmod(i, GW)
    return 90 - (y + 0.5) * STEP, -180 + (x + 0.5) * STEP


def fetch_cell(i):
    """Returns (i, data or None, error text or None)."""
    path = CELL_DIR / f"{i}.json"
    if path.exists():
        return i, json.loads(path.read_text(encoding="utf-8")), "cached"
    lat, lon = cell_centre(i)
    err = None
    for attempt in range(3):
        try:
            time.sleep(PAUSE)
            m = nasa_api.power_monthly(round(lat, 2), round(lon, 2))
            break
        except Exception as e:
            err = f"{type(e).__name__}: {e}"[:200]
            code = getattr(getattr(e, "response", None), "status_code", None)
            time.sleep(30 if code == 429 else 5 * (attempt + 1))   # 429 = "too many requests"
    else:
        return i, None, err
    data = {p: {str(y): round(v, 3) for y, v in nasa_api._annual(m.get(p, {})).items()}
            for p in ("T2M", "PRECTOTCORR", "TS")}
    path.write_text(json.dumps(data), encoding="utf-8")
    return i, data, None


def anomalies(years):
    """Value minus the cell's own 1991–2020 mean (what the map's colour scale expects)."""
    ref = [v for y, v in years.items() if 1991 <= int(y) <= 2020]
    if not ref:
        return {}
    m = sum(ref) / len(ref)
    return {y: v - m for y, v in years.items()}


def main():
    CELL_DIR.mkdir(parents=True, exist_ok=True)
    n = GW * GH
    done_before = len(list(CELL_DIR.glob("*.json")))
    print(f"{done_before}/{n} cells already saved; downloading the rest from NASA POWER...")
    cells, failed, streak, last_err, t0, new = [None] * n, 0, 0, None, time.time(), 0
    ex = ThreadPoolExecutor(max_workers=WORKERS)
    futures = [ex.submit(fetch_cell, i) for i in range(n)]
    stopped = False
    for k, f in enumerate(as_completed(futures), 1):
        i, data, err = f.result()
        cells[i] = data
        if data is None:
            failed += 1; streak += 1; last_err = err
        else:
            streak = 0
            if err != "cached":
                new += 1
        if k % 50 == 0 or k == n:
            rate = max(new, 1) / max(1e-6, time.time() - t0)
            left = max(0, n - done_before - new)
            print(f"  {k}/{n} cells  ({failed} failed)  ~{left / rate / 60:.1f} min left", flush=True)
        if streak >= GIVE_UP_AFTER:
            stopped = True
            break
    ex.shutdown(wait=False, cancel_futures=True)

    saved = len(list(CELL_DIR.glob("*.json")))
    if stopped or saved < n:
        print(f"\nNASA POWER is not answering right now. Last error:\n  {last_err}")
        print(f"Progress is saved: {saved}/{n} cells. Wait 20–30 minutes, then run this script again;")
        print("it only downloads the missing cells. The map file is written once all cells are in.", flush=True)
        os._exit(1)                      # don't wait for requests still sleeping in the background
    cells = [json.loads((CELL_DIR / f"{i}.json").read_text(encoding="utf-8")) for i in range(n)]
    failed = 0

    years = sorted({int(y) for c in cells if c for y in c["T2M"]})
    first, last = years[0], years[-1]
    layers = {}
    for layer, param, anom, unit, src in [
        ("temp", "T2M", True, "°C", "NASA POWER · T2M air temperature · anomaly vs 1991–2020"),
        ("sst", "TS", True, "°C", "NASA POWER · TS surface skin temperature (sea cells) · anomaly vs 1991–2020"),
        ("rain", "PRECTOTCORR", False, "mm/d", "NASA POWER · PRECTOTCORR precipitation · annual mean"),
    ]:
        per_cell = [(anomalies(c[param]) if anom else c[param]) if c else {} for c in cells]
        values = {str(y): [None if str(y) not in pc else round(pc[str(y)], 2) for pc in per_cell] for y in years}
        layers[layer] = {"unit": unit, "src": src, "first": first, "last": last, "values": values}

    co2 = nasa_api.series_co2_global()
    cy = {str(y): v for y, v in co2["years"].items() if y >= 1980}
    layers["co2"] = {"unit": "ppm", "src": co2["src"], "first": min(map(int, cy)), "last": max(map(int, cy)),
                     "values": cy, "uniform": True}

    OUT.write_text(json.dumps({"grid": {"w": GW, "h": GH, "step": STEP}, "built": time.strftime("%Y-%m-%d"),
                               "missingCells": failed, "layers": layers}, separators=(",", ":")),
                   encoding="utf-8")
    print(f"\nSaved {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1e6:.1f} MB, years {first}–{last}, "
          f"{failed} cells missing)")
    if failed:
        print("Some cells failed: run the script again to fill them in.")


if __name__ == "__main__":
    main()
