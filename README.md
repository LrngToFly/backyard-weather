# Backyard Weather

A personal iPhone and iPad web app that shows live readings from a Weather Underground backyard weather station next to model forecast maps styled after Tropical Tidbits. Currently set up for a station in Hopkinton, MA (KMAHOPKI22).

Live copy: https://lrngtofly.github.io/backyard-weather/

- Station data: Weather Underground personal weather station API (your own free API key, stored only on each device).
- Model data: [Open-Meteo](https://open-meteo.com/) open data (ECMWF IFS, NOAA GFS, ECMWF AIFS, NOAA AIGFS, RRFS), CC BY 4.0.
- Alerts: National Weather Service (api.weather.gov). Air quality: AirNow (optional free key) or an Open-Meteo estimate.
- Runs entirely in the browser. No server, no accounts, nothing to host except static files.

Not for safety-critical decisions.

## What's in it

- **Weather alerts**: active NWS watches, warnings and advisories for the station's location, at the top of the page. Tap one for the full text.
- **Your station**: live temperature, wind, rain, pressure and more, today's high and low, rain totals for the last 7 days, this month and this year, and air quality (with tomorrow's forecast when AirNow is set up).
- **Live radar**: the last 50 minutes of the NWS NEXRAD radar mosaic in 5-minute steps (from the Iowa Environmental Mesonet, free, no key), over the same area and county lines as the forecast maps, with play and slider controls.
- **Daylight**: dawn, sunrise, solar peak, sunset, dusk and day length, to the minute, computed on the device for the station's exact coordinates.
- **Forecast maps** (Euro, GFS, EC-AIFS, AIGFS, RRFS): MSLP & precip, Rain / Frozen, total precip, total snow (10:1 or Kuchera ratio), 2m temp, 2m dewpoint, 10m wind. Time slider and play button. The note under the map names the model run (for example "18z run").
- **Forecast at your backyard**: 7-day chart and table with a Euro / GFS / AI Euro / AI GFS selector. Tap the chart to read it.
- **Model scorecard**: how far off each model's daily highs and lows were at your station, 1, 3 and 5 days ahead, over the last 30 days, and whether each one runs warm or cold. A Rain view shows how often each model called rain days and dry days right (0.05 in or more counts as rain) and its 30-day rain total next to your gauge's. The gauge isn't heated, so snow days (Euro or GFS forecast 0.2 in of snow or more, or the gauge reports rain on a day that stays at or below 33°F) and the days after them, up to the first day reaching 36°F, are left out of the rain score. Uses Open-Meteo's archive of past forecasts, so it works even if the app wasn't opened on those days.
- **Station charts**: temperature & dew point, wind & gust, precipitation, pressure, with a Day / Week / Month / Year switch that works like wunderground.com. Day is 5-minute readings (‹ › step back up to 14 days). Week is a calendar week, Sunday to Saturday, of hourly readings, Month a calendar month and Year a calendar year; ‹ › step back up to 3 years, and the current week, month or year runs to today. Month and Year show one point per day: high/low band, peak gust, daily rain with a running total, and the pressure range. Tap or slide to read values, tap again to hide.
- **Models on Tropical Tidbits**: one-tap links to the matching Tropical Tidbits page for any model and map.
- Phone and iPad layouts (automatic, or choose in Settings).

## Deployment guide

The app is plain static files, so "deploying" it means publishing the folder with GitHub Pages (free) and then adding the page to your devices.

### 1. Publish the site (once)

1. Create a GitHub account if you need one, then fork or copy this repository, or create a new public repository and upload these files to its `main` branch.
2. In the repository: **Settings, Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute or two the site is live at `https://<your-user>.github.io/<repo>/`. The `.nojekyll` file keeps GitHub from processing the files.
4. Open that address in Safari to confirm it loads.

### 2. Point it at your station (only if it isn't KMAHOPKI22 in Hopkinton)

Edit the constants at the top of `js/core.js`: `HOME` (your latitude and longitude), `HOME_TZ`, `HOME_NAME`, `DOM` (the map area, about 7 by 4.5 degrees), and the default `stationId` in the settings object. The city title is in `index.html`.

### 3. Set up each device (iPhone, iPad)

1. **Get a Weather Underground API key** (free): sign in at https://www.wunderground.com/member/api-keys and copy the key for your station. Keep it private; do not paste it into this repo, an issue, or a chat.
2. Open the site in Safari, tap Share, then **Add to Home Screen**.
3. Open it from the Home Screen icon, tap the gear (Settings), paste the API key, confirm the Station ID, and tap Save. The key is stored only on that device, so repeat on each device.
4. Optional: an **AirNow API key** (free at https://docs.airnowapi.org, "Request an AirNow API Account") for official air quality readings and tomorrow's air quality forecast. Paste it in Settings the same way. Without it the app shows an Open-Meteo estimate.
5. Optional in Settings: Screen layout (Automatic / phone / iPad), Map detail (Standard / Fine), Animation speed. "Run checks" tests every data source.

### 4. Publishing updates

1. Change the files, then commit and push to `main`. GitHub Pages republishes in a minute or two.
2. Nothing to bump: the app keeps an offline copy of its own files (`sw.js`) and checks for newer ones each time it opens. When it finds some, a bar says "A new version of the app is ready"; tap **Reload**.
3. If you add a new file to the app, add it to the `SHELL` list in `sw.js` so it is part of the offline copy.

## Notes and limits

- Open-Meteo's free tier is for non-commercial use and rate limited (about 600 location-calls a minute; each map grid point counts as one). The app keeps each model's map data on the device and downloads it again only when Open-Meteo reports a newer model run. Map data is 3-hourly and covers only the 7 days shown. The refresh button and pull-to-refresh always reload the station, but the maps only when a new run is out. Downloads pace themselves to stay under the per-minute limit.
- Wind is shaded in mph using Tropical Tidbits' knot break points; wind barbs are in knots. AIGFS does not provide dewpoint. Station wind and gust readings above 60 mph are treated as sensor glitches and ignored (`MAX_WIND_MPH` in `js/core.js`).
- Snowfall uses a 10:1 snow-to-water ratio, or the Kuchera ratio (from the warmest temperature between the ground and 500 mb) when chosen under Total Snow. Kuchera downloads upper-air temperatures (about 150 more calls) the first time it's shown for each run.
- Rain totals, the scorecard and the Month and Year charts use past daily station summaries. The app loads them a calendar month per request (Weather Underground allows up to 31 days per request), so this year fills in within a minute of the first visit; older months load when you open them. Daily summaries are kept on the device for about 4 years, past weeks of hourly readings as you view them, and past days of 5-minute readings for 14 days.
- County, state, coast and border lines are bundled (`geo.js`).

## Files

Plain HTML/CSS/JavaScript, no build step. The scripts share one set of names and load in this order:

| File | What's in it |
|---|---|
| `index.html`, `style.css` | Page and styles |
| `geo.js` | County, state, coast and border lines |
| `js/core.js` | Place, data sources, model list, settings, storage, helpers |
| `js/colors.js` | Map color tables |
| `js/demo.js` | Made-up data for demo mode |
| `js/mapdata.js` | Map downloads, new-run check, per-frame fields, Kuchera |
| `js/mapdraw.js` | Map drawing, legend, map controls |
| `js/point.js` | Backyard forecast |
| `js/station.js` | Station readings, rain totals, station charts |
| `js/extras.js` | NWS alerts, air quality, model scorecard |
| `js/daylight.js` | Sun times |
| `js/app.js` | Layout, settings, refreshing, start-up |
| `sw.js` | Offline copy and update check |

To test locally: `python3 -m http.server` in the folder, then open `http://localhost:8000/?demo=1` for made-up demo data. Add `&ptr=1` to try pull-to-refresh outside the Home Screen app.
