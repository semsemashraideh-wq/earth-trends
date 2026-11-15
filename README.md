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

EarthScope is a website we made to look at how the Earth is changing. You choose any place on the map, and the website shows you charts and maps of its temperature, rainfall, sea surface temperature and many other measurements, year by year since 1981.

The data is real. The website takes it live from the NASA POWER API, which gives measurements for any point on Earth. For the global records we also use NASA GISS (global temperature), NOAA (carbon dioxide) and NSIDC (Arctic sea ice). The website runs with Streamlit, and every chart shows the name of its data source.

## The story behind the project

Our idea started from the olive trees. In Palestine, the olive harvest is the most important income for many families, but one year the trees are full and the next year they give very little. Our farmers call the good year "masiyeh" and the weak year "shaltouneh".

**Everybody knows that the weather is the reason. But nobody knows how, when and where.** Some say it is the rain of the winter, others say the humidity or the heat in spring. To be honest, these are guesses.

NASA has measured the weather of our villages for more than forty years, and the data is free. So we built EarthScope, where anyone can choose his own place on the map and see what really changed there, year after year. It does not solve the olive question. But when people know the reasons, they can think about the next season in a better way. It is a first step from "I think" to "the data shows".

## Best features and added value

- **Real NASA data for any place on Earth.** The user is not limited to a list of cities. Any point on the map can be chosen, and the website asks the NASA POWER API for its record from 1981 until the last full year.
- **One website for three levels of users.** Junior Detective is for kids (ages 8–13) and teaches with missions, pictures and stickers. Earth Explorer is for school students. Earth Expert is for university students and researchers. The same data is explained in a different way for each level.
- **It answers the question "is the change real?"** The Trend Lab does not only draw a line. It tests the trend with the Mann-Kendall test and Sen's slope, and it tells the user if the change is significant or if it can be only chance.
- **More than 30 extra measurements.** In the Trend Lab the user can also study wind, humidity, soil wetness, snow, clouds, solar radiation and UV index, all from NASA POWER.
- **A world map built from real data.** The Explore Map is made of 1,800 cells that cover the whole planet. The user can play the years and watch how the colours change.
- **English and Arabic.** Every page works in both languages, and the Arabic pages are written from right to left.
- **The source is always shown.** Each chart is labelled with the dataset it comes from, so the user learns to ask "where does this number come from?"
- **Tools for real study.** The expert level gives change-point detection, comparison between variables, and download of the data as a CSV file.
- **Fast after the first visit.** Data that was downloaded once is saved on the computer, so the same place opens quickly the next time.

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
