# EarthScope: Earth System Trend Detection

**Team:** Nova Mind  
**Project type:** Student project  
**Topic:** Exploring changes in Earth's climate and environment

## Team members

- Samira Qais (سميرة قيس)
- Maysam Omran (ميسم عمران)
- Tulin Al-Zaher (تولين الظاهر)
- Layan Moataz (ليان معتز)
- Layan Qais (ليان قيس)

## About the project

EarthScope is an interactive website for exploring environmental trends. It brings together charts and map views for topics such as temperature, rainfall, carbon dioxide, vegetation, sea surface temperature, and sea ice.

The website uses a visual design exported from a canvas project, runs through Streamlit, and can request real observations from public NASA, NOAA, and NSIDC data services. If real data is not available for a chart or location, the page may show its built-in example values instead.

### What we aim to learn

- How environmental measurements can change over time.
- How to read yearly charts and compare locations or data layers.
- How public science data can be connected to an interactive website.
- Why it is important to identify the source and limitations of data.

## Requirements

- Python installed on your computer.
- An internet connection for installing packages and requesting live data.
- A web browser to view the website.

## Run on Windows

Open PowerShell in the project folder and run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

Streamlit will print a local address, usually `http://localhost:8501`. Open it in your browser.

To check the data connections before starting the website, run:

```powershell
python test_apis.py
```

This check needs internet access and may report a failure if a public data service is temporarily unavailable. It exits with an error code if a check fails or returns no yearly values.

## Build map data (optional)

The Explore Map can use a prepared data file. To download and build it, run:

```powershell
python build_map_data.py
```

The first run can take several minutes because it requests data for many map cells. Progress is saved in `.cache\grid\`, so running the script again continues with cells that have not yet been saved. When complete, the script writes `frontend\map_data.json`.

## Data sources and coverage

| Topic | Source used by the project | Notes |
|---|---|---|
| Global temperature | NASA GISS GISTEMP v4 | Global yearly temperature anomaly, relative to 1951–1980. |
| Local temperature | NASA POWER T2M | Point data; displayed as an anomaly relative to 1991–2020. |
| Carbon dioxide | NOAA Global Monitoring Laboratory, Mauna Loa | The same long-running record is used for different locations because atmospheric CO₂ is well mixed. |
| Rainfall | NASA POWER PRECTOTCORR | Point data; annual mean of monthly precipitation values. |
| Sea surface temperature | NASA POWER TS | Surface skin temperature is used as an approximation over sea areas. |
| Arctic sea ice | NSIDC Sea Ice Index | September Arctic sea-ice extent. |
| Vegetation | Built-in design values | Live MODIS NDVI data is not currently connected. |

The Explore Map uses the generated `frontend/map_data.json` for temperature, rainfall, sea surface temperature, and CO₂. Vegetation and sea ice still use the design's built-in values there. In charts, labels distinguish a real data record from built-in model/example values.

## Project files

- `app.py` — starts the Streamlit app and handles data requests from the website.
- `nasa_api.py` — requests and prepares data from the supported public data sources.
- `test_apis.py` — checks whether the configured data sources return yearly values.
- `build_map_data.py` — builds the optional Explore Map data file.
- `frontend\*.dc.html` — website pages exported from the canvas design.
- `frontend\support.js` — renders the exported pages in the browser.
- `frontend\nasa-bridge.js` — connects the charts to the Python data service.
- `requirements.txt` — Python packages needed by the project.

## Important note

EarthScope is an educational project for exploring historical data. It is not a weather forecast, a scientific publication, or an emergency-warning service. Some layers or locations may show built-in example values when a live source is not connected or does not provide data.
