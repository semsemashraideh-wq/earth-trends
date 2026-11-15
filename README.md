# EarthScope: Earth System Trend Detection

**Team:** Nova Mind  
**Project type:** Student project  
**Topic:** Looking at how Earth's climate and environment are changing

## Team members

- Samira Qais (سميرة قيس)
- Maysam Omran (ميسم عمران)
- Tulin Al-Zaher (تولين الظاهر)
- Layan Moataz (ليان معتز)
- Layan Qais (ليان قيس)

## About the project

EarthScope is a website we made to look at changes in the environment. It has charts and maps for six topics: temperature, rainfall, carbon dioxide, vegetation, sea surface temperature and sea ice.

We made the design of the pages in a canvas project and exported it. The website runs with Streamlit. It can ask for real data from the public services of NASA, NOAA and NSIDC. Sometimes real data is not available for a chart or a place. In this case the page may show the example values that are saved inside the design.

### What we want to learn

- How measurements of the environment change with time.
- How to read a yearly chart, and how to compare between places or data layers.
- How to connect public science data to a website.
- Why we must always say where the data comes from and what its limits are.

## What you need

- Python installed on your computer.
- Internet connection, to install the packages and to get the live data.
- A web browser to open the website.

## How to run it on Windows

Open PowerShell in the project folder and write these commands:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

Streamlit will print a local address. Usually it is `http://localhost:8501`. Open this address in your browser.

If you want to check the data connections before you start the website, run:

```powershell
python test_apis.py
```

This check needs the internet. It may fail if one of the public data services is down for some time. If a check fails, or if it gives no yearly values, the script exits with an error code.

## Build the map data (optional)

The Explore Map can use a data file that is prepared before. To download the data and build this file, run:

```powershell
python build_map_data.py
```

The first run can take several minutes. This is because the script asks for data for many map cells. The progress is saved in `.cache\grid\`, so if you run the script again it continues with the cells that are not saved yet. When it finishes, it writes the file `frontend\map_data.json`.

## Data sources and coverage

| Topic | Source we use | Notes |
|---|---|---|
| Global temperature | NASA GISS GISTEMP v4 | Yearly global temperature anomaly, compared with 1951–1980. |
| Local temperature | NASA POWER T2M | Data for one point. We show it as an anomaly compared with 1991–2020. |
| Carbon dioxide | NOAA Global Monitoring Laboratory, Mauna Loa | We use the same long record for all places, because CO₂ is well mixed in the atmosphere. |
| Rainfall | NASA POWER PRECTOTCORR | Data for one point. Yearly mean of the monthly rainfall values. |
| Sea surface temperature | NASA POWER TS | We use the surface skin temperature as an approximation over the sea. |
| Arctic sea ice | NSIDC Sea Ice Index | Arctic sea ice extent in September. |
| Vegetation | Values saved in the design | Live MODIS NDVI data is not connected yet. |

The Explore Map uses the file `frontend/map_data.json` for temperature, rainfall, sea surface temperature and CO₂. Vegetation and sea ice in the map still use the values saved in the design. In the charts, the label tells you if the line is a real data record or example values.

## Project files

- `app.py`: starts the Streamlit app and answers the data requests from the website.
- `nasa_api.py`: asks for the data from the public sources and prepares it.
- `test_apis.py`: checks if the data sources give yearly values.
- `build_map_data.py`: builds the optional data file for the Explore Map.
- `frontend\*.dc.html`: the website pages exported from the canvas design.
- `frontend\support.js`: shows the exported pages in the browser.
- `frontend\nasa-bridge.js`: connects the charts with the Python data service.
- `requirements.txt`: the Python packages that the project needs.

## Important note

EarthScope is an educational project to look at historical data. It is not a weather forecast, not a scientific publication, and not an emergency warning service. Some layers or places may show example values when the live source is not connected or does not give data.
