"""EarthScope — your canvas design, running in Streamlit with live NASA data.

Run:  streamlit run app.py

How it works
- frontend/ holds the design pages exactly as exported from the canvas
  (*.dc.html) plus support.js, which draws them in the browser.
- The pages ask for data (layer + place) through the Streamlit component
  protocol; this file fetches it with nasa_api.py and sends it back.
"""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

import nasa_api

FRONTEND = Path(__file__).parent / "frontend"
SLOW_LAYERS = {"veg"}            # MODIS NDVI needs ~30 small requests per place

st.set_page_config(page_title="EarthScope · Earth System Trend Detection",
                   page_icon="🌍", layout="wide", initial_sidebar_state="collapsed")

# Hide Streamlit's own chrome and let the design fill the whole window.
st.markdown("""
<style>
header[data-testid="stHeader"], footer, #MainMenu, [data-testid="stToolbar"],
[data-testid="stDecoration"], [data-testid="stStatusWidget"] { display: none !important; }
.block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
iframe[data-testid="stCustomComponentV1"], iframe[title*="earth_portal"] {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  border: 0 !important; z-index: 1000; background: #F7F8F2;
}
</style>
""", unsafe_allow_html=True)

earth_portal = components.declare_component("earth_portal", path=str(FRONTEND))


@st.cache_data(persist="disk", show_spinner=False)
def fetch_series(layer, place, lat, lon):
    """Cached on disk, so each place/layer is downloaded from NASA only once."""
    return nasa_api.series(layer, place, lat, lon)


def snap(x):
    # Keep nearby pins on the same half-degree grid as the page and NASA cache.
    return round(float(x or 0) * 2) / 2


ss = st.session_state
ss.setdefault("results", {})
ss.setdefault("todo", [])
ss.setdefault("last_id", None)

request = earth_portal(results=ss["results"], key="portal", default=None)

# 1. New requests from the page → add to the to-do list.
if request and request.get("id") != ss["last_id"]:
    ss["last_id"] = request["id"]
    queued = {r["key"] for r in ss["todo"]}
    for r in request.get("requests", [])[:60]:
        if r.get("key") and r["key"] not in ss["results"] and r["key"] not in queued:
            ss["todo"].append(r)

# 2. Work through the list: all quick ones together, slow ones one at a time,
#    re-running after each batch so the page updates as soon as possible.
if ss["todo"]:
    quick = [r for r in ss["todo"] if r["layer"] not in SLOW_LAYERS]
    batch = quick or ss["todo"][:1]
    for r in batch:
        try:
            ss["results"][r["key"]] = fetch_series(r["layer"], r["place"], snap(r["lat"]), snap(r["lon"]))
        except Exception as e:                                   # network down, service changed…
            ss["results"][r["key"]] = {"error": f"{type(e).__name__}: {e}"[:300]}
            print(f"[nasa] {r['key']} failed: {e}")
    done = {r["key"] for r in batch}
    ss["todo"] = [r for r in ss["todo"] if r["key"] not in done]
    st.rerun()
