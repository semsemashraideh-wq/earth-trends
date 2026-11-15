"""Load and prepare environmental data for the EarthScope project.

This file connects to public data sources, including NASA POWER, NASA GISS,
NOAA, and NSIDC. Each data function returns yearly values together with the
unit and source name, so the website can display the data with useful context.

If a real record is not available for a layer or location, the function returns
{"none": True}. The website can then keep showing its built-in example values.
"""
import csv
import datetime as dt
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path

import pandas as pd
import requests

UA = {"User-Agent": "EarthScope-student-project/1.0"}
THIS_YEAR = dt.date.today().year


def _get(url, **kw):
    kw.setdefault("timeout", 90)
    headers = dict(UA, **kw.pop("headers", {}))
    r = requests.get(url, headers=headers, **kw)
    r.raise_for_status()
    return r


# ---------------------------------------------------------------- NASA POWER
POWER_URL = "https://power.larc.nasa.gov/api/temporal/{res}/point"


def get_power(lat, lon, start, end, params=("T2M", "PRECTOTCORR"),
              res="daily", community="AG"):
    """NASA POWER as a table. daily: start/end = 'YYYYMMDD'. monthly: 'YYYY'."""
    if res == "monthly":
        start, end = str(start)[:4], str(end)[:4]
    r = _get(POWER_URL.format(res=res),
             params={"parameters": ",".join(params), "community": community,
                     "latitude": lat, "longitude": lon,
                     "start": start, "end": end, "format": "JSON"})
    df = pd.DataFrame(r.json()["properties"]["parameter"])
    if res == "monthly":
        df = df[~df.index.str.endswith("13")]   # drop the yearly-average row
    df.index = pd.to_datetime(df.index, format="%Y%m%d" if res == "daily" else "%Y%m")
    return df.replace(-999, pd.NA)


@lru_cache(maxsize=256)
def power_monthly(lat, lon, params=("T2M", "PRECTOTCORR", "TS")):
    """Monthly POWER values 1981 → last full year: {param: {(year, month): value}}.
    POWER publishes monthly means with a delay, so if the last year is not
    ready yet we step back a year."""
    last_err = None
    for end in (THIS_YEAR - 1, THIS_YEAR - 2):
        try:
            r = _get(POWER_URL.format(res="monthly"),
                     params={"parameters": ",".join(params), "community": "AG",
                             "latitude": lat, "longitude": lon,
                             "start": 1981, "end": end, "format": "JSON"})
            break
        except requests.HTTPError as e:
            last_err = e
    else:
        raise last_err
    out = {}
    for p, series in r.json()["properties"]["parameter"].items():
        out[p] = {(int(k[:4]), int(k[4:])): v for k, v in series.items()
                  if not k.endswith("13") and v is not None and v > -990}
    return out


def _annual(monthly, min_months=10):
    """Average each year, skipping partial years that have fewer than 10 months."""
    by_year = {}
    for (y, _m), v in monthly.items():
        by_year.setdefault(y, []).append(v)
    return {y: sum(v) / len(v) for y, v in sorted(by_year.items()) if len(v) >= min_months}


def _anomaly(years, base=(1991, 2020)):
    ref = [v for y, v in years.items() if base[0] <= y <= base[1]]
    if not ref:
        return years
    m = sum(ref) / len(ref)
    return {y: v - m for y, v in years.items()}


def series_temp_point(lat, lon):
    yrs = _anomaly(_annual(power_monthly(lat, lon)["T2M"]))
    return {"years": yrs, "unit": "°C",
            "src": "NASA POWER · T2M air temperature (MERRA-2) · anomaly vs 1991–2020"}


def series_sst_point(lat, lon):
    yrs = _anomaly(_annual(power_monthly(lat, lon)["TS"]))
    return {"years": yrs, "unit": "°C",
            "src": "NASA POWER · TS surface skin temperature (over sea ≈ SST) · anomaly vs 1991–2020"}


def series_rain_point(lat, lon):
    yrs = _annual(power_monthly(lat, lon)["PRECTOTCORR"])
    return {"years": yrs, "unit": "mm/d",
            "src": "NASA POWER · PRECTOTCORR precipitation (MERRA-2, bias-corrected) · annual mean"}


# ---------------------------------------------------------------- extra POWER parameters (Trend Lab)
POWER_EXTRA = (
    "T2M_MAX", "T2M_MIN", "T2M_RANGE", "T2MDEW", "T2MWET", "T10M", "PS", "CLOUD_AMT",
    "RH2M", "QV2M", "PRECSNOLAND", "EVLAND", "EVPTRNS",
    "TS", "GWETTOP", "GWETROOT", "GWETPROF", "SNODP", "FRSNO",
    "WS2M", "WS2M_MAX", "WS10M", "WS10M_MAX", "WS50M",
    "ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN", "ALLSKY_KT", "ALLSKY_SFC_LW_DWN",
    "ALLSKY_SFC_UV_INDEX", "ALLSKY_SFC_PAR_TOT", "TOA_SW_DWN",
)
_POWER_BAD = set()      # names POWER rejected, so we stop asking for them


def _power_request(lat, lon, params):
    """One monthly POWER call → (values, metadata). Steps back a year if the last
    year is not published yet."""
    last_err = None
    for end in (THIS_YEAR - 1, THIS_YEAR - 2):
        try:
            j = _get(POWER_URL.format(res="monthly"),
                     params={"parameters": ",".join(params), "community": "AG",
                             "latitude": lat, "longitude": lon,
                             "start": 1981, "end": end, "format": "JSON"}).json()
            return j["properties"]["parameter"], j.get("parameters", {})
        except requests.HTTPError as e:
            last_err = e
            if e.response is not None and e.response.status_code == 422 and len(params) > 1:
                raise                                   # a bad name in the batch: caller splits it
    raise last_err


@lru_cache(maxsize=128)
def power_extra(lat, lon):
    """All POWER_EXTRA parameters at one point: {name: {"monthly": {...}, "unit", "name"}}.
    Asked in batches of 15 (POWER allows up to 20); a batch that fails because of
    an unknown name is retried one parameter at a time, and unknown ones are skipped."""
    wanted = [p for p in POWER_EXTRA if p not in _POWER_BAD]
    out = {}

    def keep(values, meta):
        for p, series in values.items():
            monthly = {(int(k[:4]), int(k[4:])): v for k, v in series.items()
                       if not k.endswith("13") and v is not None and v > -990}
            m = meta.get(p, {})
            out[p] = {"monthly": monthly, "unit": m.get("units", ""), "name": m.get("longname", p)}

    for i in range(0, len(wanted), 15):
        batch = wanted[i:i + 15]
        try:
            keep(*_power_request(lat, lon, batch))
        except requests.HTTPError:
            for p in batch:
                try:
                    keep(*_power_request(lat, lon, [p]))
                except requests.HTTPError:
                    _POWER_BAD.add(p)
    return out


UNIT_FIX = {"C": "°C", "kPa": "kPa", "%": "%", "g/kg": "g/kg", "m/s": "m/s", "mm/day": "mm/d",
            "kW-hr/m^2/day": "kWh/m²/d", "MJ/m^2/day": "MJ/m²/d", "W m-2": "W/m²", "W/m^2": "W/m²",
            "cm": "cm", "1": ""}


def series_power_param(param, lat, lon):
    info = power_extra(lat, lon).get(param)
    if not info:
        return {"none": True}
    yrs = _annual(info["monthly"])
    vals = list(yrs.values())
    if not vals or max(vals) - min(vals) < 1e-9:      # e.g. snow depth where it never snows
        return {"none": True}
    unit = UNIT_FIX.get(info["unit"], info["unit"])
    return {"years": yrs, "unit": unit,
            "src": f"NASA POWER · {param} ({info['name']}) · annual mean of monthly values"}


# ---------------------------------------------------------------- NASA GISS
GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"


def get_gistemp():
    """NASA GISTEMP v4 global temperature anomaly (°C) as a table."""
    r = _get(GISTEMP_URL)
    df = pd.read_csv(io.StringIO(r.text), skiprows=1, na_values="***")
    return df[["Year", "J-D"]].rename(columns={"J-D": "anomaly_C"})


def series_gistemp_global():
    r = _get(GISTEMP_URL)
    rows = list(csv.reader(io.StringIO(r.text)))[1:]          # first line is a title
    head = rows[0]
    iy, ia = head.index("Year"), head.index("J-D")
    yrs = {}
    for row in rows[1:]:
        try:
            yrs[int(row[iy])] = float(row[ia])
        except (ValueError, IndexError):
            pass                                             # '***' = year not finished
    return {"years": yrs, "unit": "°C",
            "src": "NASA GISS · GISTEMP v4 (global annual mean, vs 1951–1980)"}


# ---------------------------------------------------------------- NOAA CO₂
CO2_MONTHLY_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"
CO2_ANNUAL_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.csv"


def get_co2():
    """Monthly CO₂ at Mauna Loa (ppm), from NOAA GML, as a table."""
    r = _get(CO2_MONTHLY_URL)
    return pd.read_csv(io.StringIO(r.text), comment="#")


def series_co2_global():
    r = _get(CO2_ANNUAL_URL)
    lines = [ln for ln in r.text.splitlines() if ln.strip() and not ln.startswith("#")]
    yrs = {}
    for row in csv.DictReader(lines):
        try:
            yrs[int(row["year"])] = float(row["mean"])
        except (ValueError, KeyError):
            pass
    return {"years": yrs, "unit": "ppm",
            "src": "NOAA GML · Mauna Loa annual mean CO₂ (well mixed, same for every place)"}


# ---------------------------------------------------------------- NSIDC sea ice
NSIDC_URLS = [
    "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv",
    "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v3.0.csv",
]


def series_arctic_ice():
    last_err = None
    for url in NSIDC_URLS:
        try:
            r = _get(url)
            break
        except requests.HTTPError as e:
            last_err = e
    else:
        raise last_err
    rd = csv.reader(io.StringIO(r.text), skipinitialspace=True)
    head = [h.strip().lower() for h in next(rd)]
    iy, ie = head.index("year"), head.index("extent")
    yrs = {}
    for row in rd:
        try:
            v = float(row[ie])
            if v > 0:
                yrs[int(row[iy])] = v
        except (ValueError, IndexError):
            pass
    return {"years": yrs, "unit": "M km²",
            "src": "NSIDC Sea Ice Index (NOAA/NASA) · September Arctic extent"}


# ---------------------------------------------------------------- MODIS NDVI (ORNL DAAC)
ORNL = "https://modis.ornl.gov/rst/api/v1/"
JSON_H = {"Accept": "application/json"}


# ORNL serves these MODIS vegetation products (MOD13A3 is not offered there).
NDVI_PRODUCTS = [("MOD13Q1", "250m_16_days_NDVI", "250 m, 16-day"),
                 ("MOD13A2", "1_km_16_days_NDVI", "1 km, 16-day"),
                 ("MOD13A1", "500m_16_days_NDVI", "500 m, 16-day")]


def _ndvi_product():
    """Pick the first NDVI product ORNL answers for, and its exact band name."""
    last_err = None
    for product, band, label in NDVI_PRODUCTS:
        try:
            bands = _get(f"{ORNL}{product}/bands", headers=JSON_H, timeout=30).json().get("bands", [])
            names = [b.get("band", "") for b in bands]
            band = next((n for n in names if "NDVI" in n), band)
            return product, band, label
        except requests.RequestException as e:
            last_err = e
    raise last_err


NDVI_CACHE = Path(__file__).parent / ".cache"


def series_ndvi_point(lat, lon, progress=print):
    """MODIS Terra NDVI at a point, averaged per year.
    ORNL returns at most 10 dates per request (~58 requests for 2000-today),
    so we ask in parallel chunks, retry slow ones, show progress, and save the
    result to .cache/ so each place is only downloaded once."""
    NDVI_CACHE.mkdir(exist_ok=True)
    cache = NDVI_CACHE / f"ndvi_{lat:+.2f}_{lon:+.2f}.json"
    if cache.exists():
        out = json.loads(cache.read_text(encoding="utf-8"))
        out["years"] = {int(k): v for k, v in out["years"].items()}
        return out

    product, band, label = _ndvi_product()
    dates = _get(f"{ORNL}{product}/dates", headers=JSON_H, timeout=40,
                 params={"latitude": lat, "longitude": lon}).json()["dates"]
    md = [d["modis_date"] for d in dates]
    chunks = [md[i:i + 10] for i in range(0, len(md), 10)]

    def fetch(chunk):
        for attempt in range(3):
            try:
                j = _get(f"{ORNL}{product}/subset", headers=JSON_H, timeout=40,
                         params={"latitude": lat, "longitude": lon, "band": band,
                                 "startDate": chunk[0], "endDate": chunk[-1],
                                 "kmAboveBelow": 0, "kmLeftRight": 0}).json()
                break
            except requests.RequestException:
                if attempt == 2:
                    return None                              # give up on this chunk only
                time.sleep(2 * (attempt + 1))
        out = []
        for s in j.get("subset", []):
            raw = (s.get("data") or [None])[0]
            if raw is None or raw <= -2000:                 # -3000 = fill value
                continue
            scale = float(s.get("scale") or j.get("scale") or (0.0001 if abs(raw) > 1.5 else 1))
            out.append((int(s["calendar_date"][:4]), raw * scale))
        return out

    by_year, done, failed = {}, 0, 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(fetch, c) for c in chunks]
        for f in as_completed(futures):
            part = f.result()
            done += 1
            if part is None:
                failed += 1
            else:
                for y, v in part:
                    by_year.setdefault(y, []).append(v)
            if progress and (done % 5 == 0 or done == len(chunks)):
                progress(f"     NDVI download {done}/{len(chunks)}" + (f" ({failed} failed)" if failed else ""))
    yrs = {y: sum(v) / len(v) for y, v in sorted(by_year.items()) if len(v) >= 15}   # 23 images a year
    if not yrs:
        raise RuntimeError(f"ORNL MODIS returned no usable NDVI ({failed}/{len(chunks)} requests failed)")
    out = {"years": yrs, "unit": "",
           "src": f"NASA MODIS Terra NDVI ({product}, {label}, via ORNL DAAC) · annual mean"}
    if failed == 0:                                          # only cache complete downloads
        cache.write_text(json.dumps(out), encoding="utf-8")
    return out


# ---------------------------------------------------------------- router used by app.py
def series(layer, place, lat, lon):
    """Pick the real record for a layer at a place. Layers come from the design:
    temp, co2, rain, veg, sst, ice."""
    if layer.startswith("p_"):                         # extra NASA POWER parameter
        return {"none": True} if place == "global" else series_power_param(layer[2:], lat, lon)
    if layer == "co2":
        return series_co2_global()
    if place == "global":
        return series_gistemp_global() if layer == "temp" else {"none": True}
    if layer == "ice":
        return series_arctic_ice() if place == "arctic" else {"none": True}
    if layer == "temp":
        return series_temp_point(lat, lon)
    if layer == "sst":
        return series_sst_point(lat, lon)
    if layer == "rain":
        return series_rain_point(lat, lon)
    if layer == "veg":
        return {"none": True}   # skipped for now: ORNL MODIS service not answering (404)
    return {"none": True}
