"""Check every NASA connection before running the app:  python test_apis.py"""
import sys
import time

from nasa_api import series

# Tubas is a handy local test point; the app rounds pins to the same grid.
TUBAS = (32.5, 35.5)          # snapped to the 0.5° grid, like the app does
CHECKS = [
    ("Global temperature (GISTEMP)", "temp", "global", 0, 0),
    ("CO₂ (NOAA Mauna Loa)",         "co2",  "global", 0, 0),
    ("Arctic sea ice (NSIDC)",       "ice",  "arctic", 78, -40),
    ("Tubas temperature (POWER)",    "temp", "pin", *TUBAS),
    ("Tubas rainfall (POWER)",       "rain", "pin", *TUBAS),
    ("Sea temp off Gaza (POWER TS)", "sst",  "pin", 31.5, 34.0),
    ("Tubas solar radiation (POWER)", "p_ALLSKY_SFC_SW_DWN", "pin", *TUBAS),
]

ok = 0
for name, layer, place, lat, lon in CHECKS:
    t = time.time()
    try:
        r = series(layer, place, lat, lon)
        yrs = r.get("years", {})
        if not yrs:
            raise RuntimeError("source returned no yearly values")
        last = max(yrs)
        print(f"OK   {name:32s} {min(yrs)}–{last}  last={yrs[last]:.3f} {r['unit']}  ({time.time() - t:.1f}s)")
        ok += 1
    except Exception as e:
        print(f"FAIL {name:32s} {type(e).__name__}: {e}")
print(f"\n{ok}/{len(CHECKS)} sources working")

# Extra Trend Lab parameters (one NASA POWER download for all of them)
from nasa_api import POWER_EXTRA, power_extra, _POWER_BAD
t = time.time()
got = power_extra(*TUBAS)
print(f"\nExtra POWER parameters at Tubas: {len(got)}/{len(POWER_EXTRA)} available ({time.time() - t:.1f}s)")
if _POWER_BAD:
    print("  not offered by POWER (skipped):", ", ".join(sorted(_POWER_BAD)))
if ok != len(CHECKS):
    sys.exit(1)
