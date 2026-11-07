# Backyard Weather

A personal iPhone and iPad web app that shows live readings from a Weather Underground backyard weather station next to model forecast maps styled after Tropical Tidbits. Currently set up for a station in Hopkinton, MA (KMAHOPKI22).

Live copy: https://lrngtofly.github.io/backyard-weather/

- Station data: Weather Underground personal weather station API (your own free API key, stored only on each device).
- Model data: [Open-Meteo](https://open-meteo.com/) open data (ECMWF IFS, NOAA GFS, ECMWF AIFS, NOAA AIGFS, RRFS), CC BY 4.0.
- Runs entirely in the browser. No server, no accounts, nothing to host except static files.

Not for safety-critical decisions.

## What's in it

- **Your station**: live temperature, wind, rain, pressure and more.
- **Daylight**: dawn, sunrise, solar peak, sunset, dusk and day length, to the minute, computed on the device for the station's exact coordinates.
- **Forecast maps** (Euro, GFS, EC-AIFS, AIGFS, RRFS): MSLP & precip, Rain / Frozen, total precip, total snow, 2m temp, 2m dewpoint, 10m wind. Time slider and play button.
- **Forecast at your backyard**: 7-day chart and table with a Euro / GFS / AI Euro / AI GFS selector.
- **Station charts**: temperature & dew point, wind & gust, precipitation, pressure. Tap or slide to read values, tap again to hide.
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

Edit the constants at the top of `app.js`: `HOME` (your latitude and longitude), `DOM` (the map area, about 7 by 4.5 degrees), the default `stationId` in the settings object, and `HOME_TZ` for the daylight card. The city title is in `index.html`.

### 3. Set up each device (iPhone, iPad)

1. **Get a Weather Underground API key** (free): sign in at https://www.wunderground.com/member/api-keys and copy the key for your station. Keep it private; do not paste it into this repo, an issue, or a chat.
2. Open the site in Safari, tap Share, then **Add to Home Screen**.
3. Open it from the Home Screen icon, tap the gear (Settings), paste the API key, confirm the Station ID, and tap Save. The key is stored only on that device, so repeat on each device.
4. Optional in Settings: Screen layout (Automatic / phone / iPad), Map detail (Standard / Fine), Animation speed.

### 4. Publishing updates

1. Change the files and bump the `?v=` number on the script and stylesheet tags in `index.html` so devices fetch the new versions.
2. Commit and push to `main`. GitHub Pages republishes in a minute or two.
3. On each device, close the app completely (swipe it away in the app switcher) and open it again. The refresh button in the app only reloads data, not the app itself. If something still looks old, Settings has "Clear saved maps".

## Notes and limits

- Open-Meteo's free tier is for non-commercial use and rate limited. The app spreads its requests, retries after a pause when the limit is hit, and caches each model's data for 2 hours on the device.
- Wind is shaded in mph using Tropical Tidbits' knot break points; wind barbs are in knots. AIGFS does not provide dewpoint. The first load of each model after an update downloads fresh data.
- Snowfall is estimated at a 10:1 snow-to-water ratio.
- County, state, coast and border lines are bundled (`geo.js`).

## Files

`index.html`, `style.css`, `app.js`, `geo.js`, `manifest.webmanifest`, icons. Plain HTML/CSS/JavaScript, no build step. To test locally: `python3 -m http.server` in the folder, then open `http://localhost:8000/?demo=1` for made-up demo data.
