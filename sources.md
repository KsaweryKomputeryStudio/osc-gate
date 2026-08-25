# DATA-DRIVER sources

Living inventory. Research notes stay in `sources_v1.md` and `sources_v2.md`.

- **Implemented** — everything in the picker today (65 types + incoming OSC passthrough).
- **Todo** — leftover from v1 plus new v2 feeds, duplicates merged, dead ends parked.

---

## Implemented

Addresses use instance slots: `/prefix/1/…`, `/prefix/2/…`.

### Hardware (view)

| Source | Type | OSC | Notes |
| --- | --- | --- | --- |
| DualSense | `controller` | `/ds` | USB / Bluetooth WebHID |
| MIDI | `midi` | `/midi` | Web MIDI, learn CC/note, clock |
| Gamepad | `gamepad` | `/pad` | Generic pad (not DualSense) |
| Garmin HR | `garmin` | `/garmin` | BLE broadcast heart rate |
| MacBook | `macbook` | `/mac` | Lid via gateway; IMU if present |
| Microphone | `mic` | `/mic` | Input level / peak 0–1 |
| Human count | `human` | `/human` | Webcam + YOLOv8n |

### Time (view)

| Source | Type | OSC | Notes |
| --- | --- | --- | --- |
| Time | `time` | `/time` | Local hour / day / week / month / year 0–1 |

### Weather / UV / Environment (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Weather (Open-Meteo) | `weather` | `/weather` | no |
| UV / Solar (Open-Meteo) | `uv` | `/uv` | no |
| Air quality (Open-Meteo) | `aq` | `/aq` | no |
| OpenWeatherMap | `owm` | `/owm` | yes |
| WAQI | `waqi` | `/waqi` | yes |

### Traffic / Transit (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| London Tube (TfL) | `tube` | `/tube` | no |
| London Roads (TfL) | `roads` | `/roads` | no |
| TomTom traffic | `tomtom` | `/tomtom` | yes |
| HERE traffic | `here` | `/here` | yes |
| Tricity transit | `gtfs` | `/gtfs` | no |

### Astronomy / Natural Cycles (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Sun (sunrise-sunset.org) | `sun` | `/sun` | no |
| Moon (local) | `moon` | `/moon` | no |
| Astronomy (IPGeolocation) | `ipgeo` | `/ipgeo` | yes |
| People in space | `people` | `/people` | no |

### Space Weather (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| NOAA Kp-index | `kp` | `/kp` | no |
| NOAA GOES X-ray | `xray` | `/xray` | no |
| NASA DONKI | `donki` | `/donki` | yes |
| NOAA OVATION aurora | `aurora` | `/aurora` | no |
| NOAA solar wind | `solarwind` | `/solarwind` | no |

### Seismic / Disaster (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| USGS Earthquakes | `quake` | `/quake` | no |
| NASA EONET | `eonet` | `/eonet` | no |
| GDACS | `gdacs` | `/gdacs` | no |

### Ocean / Nature (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Open-Meteo Marine | `marine` | `/marine` | no |
| GBIF observations today | `gbif` | `/gbif` | no |
| iNaturalist nearby | `inat` | `/inat` | no |
| AIS ships | `ais` | `/ais` | yes (AISStream) |
| IMGW hydro | `hydro` | `/hydro` | no |
| NOAA Tides (US coast) | `tides` | `/tides` | no |
| Open-Meteo river flood | `flood` | `/flood` | no |

### Networks / Internet Pulse (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Hacker News live | `hn` | `/hn` | no (Firebase SSE) |
| Bluesky Jetstream | `bsky` | `/bsky` | no (WebSocket) |
| Mastodon public | `masto` | `/masto` | no (poll; default fosstodon.org) |
| Wikipedia recent-change | `wiki` | `/wiki` | no |
| Wiki firehose | `wiki-live` | `/wikilive` | no (EventStreams) |
| GitHub Events | `github` | `/github` | no |
| UK carbon intensity | `carbon` | `/carbon` | no |

### Space (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| ISS (wheretheiss.at) | `iss` | `/iss` | no |
| Satellite look angles | `sat` | `/sat` | no (Celestrak TLE + SGP4) |
| NASA NEO | `neo` | `/neo` | DEMO_KEY |
| NASA APOD | `apod` | `/apod` | DEMO_KEY |

### Finance / Crypto (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Bitcoin (CoinGecko) | `crypto` | `/crypto` | no |
| Ethereum (CoinGecko) | `eth` | `/eth` | no |
| Frankfurter FX | `fx` | `/fx` | no |
| Fear & Greed | `fng` | `/fng` | no |
| Bitcoin mempool fees | `mempool` | `/mempool` | no |

### Music / Culture (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| ListenBrainz sitewide | `listens` | `/lb` | no |
| MusicBrainz releases today | `mb` | `/mb` | no |
| Last.fm now-playing | `lastfm` | `/lastfm` | yes + username |

### Weird / Novelty (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| Browser crypto random | `rng` | `/rng` | no |
| Deck of Cards | `cards` | `/cards` | no |
| Random.org | `randorg` | `/randorg` | yes |
| JokeAPI | `joke` | `/joke` | no |
| Yes / No | `yesno` | `/yesno` | no |

### Poland / EU (poll)

| Source | Type | OSC | Key |
| --- | --- | --- | --- |
| GIOŚ air quality | `gios` | `/gios` | no |
| IMGW synop | `imgw` | `/imgw` | no |
| NBP FX | `nbp` | `/nbp` | no |
| PL holidays (Nager.Date) | `holiday` | `/holiday` | no |

### Also in the app (not a picker type)

Incoming UDP OSC — bottom dock monitor, rename/delete senders, passthrough to routed destinations.

---

## Todo

Merged from v1 leftovers and v2. One row per source. Closest existing source is noted so we do not rebuild it.

Suggested prefixes are placeholders until the type is wired.

### Stage 1 — reactive / push (do first)

| Source | From | Suggested OSC | Auth | Why / how | Overlap |
| --- | --- | --- | --- | --- | --- |
| [x] **Bluesky Jetstream** | v2 | `/bsky` | none (WebSocket) | JSON post firehose. Click Start (not auto). | New. |
| [x] **Mastodon public stream** | v2 | `/masto` | none | mastodon.social public timeline now requires auth (422). Polls `fosstodon.org` public REST instead. | New. |
| [x] **Wikipedia EventStreams** | v1 | `/wikilive` | none (SSE) | Wikimedia recent-change firehose. Sibling of the Wikipedia poll. | Not the existing `/wiki`. |
| [x] **Hacker News live** | v2 | `/hn` | none (SSE) | Firebase `/v0/maxitem.json` EventSource. Same type as before. | Upgrade of existing HN. |

### Stage 2 — Gdynia / personal identity

| Source | From | Suggested OSC | Auth | Why / how | Overlap |
| --- | --- | --- | --- | --- | --- |
| [x] **AISStream.io** | v2 | `/ais` | free key | Browser WebSocket, Gdynia harbour bbox from lat/lon + radius. Needs your key. | New. |
| [x] **Tricity GTFS-Realtime** | v1 + v2 | `/gtfs` | none | Otwarty Gdańsk JSON GPS (`gpsPositions?v=2`). | Replaces v1 generic GTFS. |
| [x] **Last.fm now-playing** | v2 | `/lastfm` | free key + user | `user.getRecentTracks`. | New. |

### Stage 3 — slow / poetic texture

| Source | From | Suggested OSC | Auth | Why / how | Overlap |
| --- | --- | --- | --- | --- | --- |
| [x] **Celestrak + local SGP4** | v1 + v2 | `/sat` | none | GP TLE + satellite.js v5. Default ISS look angles from Gdynia. Cache ≥2 h. | Replaces Heavens-Above. |
| [ ] **N2YO** (optional) | v2 | `/n2yo` | free key | Skip unless Celestrak fails. | Same job as `/sat`. |
| [x] **GDACS** | v2 | `/gdacs` | none | Disaster alerts. | Distinct from EONET. |
| [ ] **eBird** | v2 | `/ebird` | free key | | iNaturalist shipped instead. |
| [x] **iNaturalist** | v2 | `/inat` | none (read) | Nearby observations. | Picked over eBird. |
| [x] **Nager.Date PL holidays** | v2 | `/holiday` | none | Days until next PL holiday. | New. |
| [x] **IMGW hydro** | v2 | `/hydro` | none | River gauge, Gdańska Głowa default. | Not IMGW synop. |
| [ ] **OpenAQ v3** | v1 | `/openaq` | key | | Lowest priority. |

### Stage 4 — Baltic water (only if needed)

| Source | From | Suggested OSC | Auth | Why / how | Overlap |
| --- | --- | --- | --- | --- | --- |
| [ ] **CMEMS Baltic physics** | v2 | `/cmems` | free login | `copernicusmarine` toolbox, twice-daily NetCDF. Interpolate locally. **Model, not sensors.** | Distinct from Open-Meteo Marine (`/marine`) and NOAA Tides (`/tides`, US-only). |
| [ ] **Urząd Morski PNG** | v2 | `/umgdy` | scrape/OCR | Observed Gdynia/Hel water level every 30 min as PNG. Fragile. Last resort. | Only if observed Gulf level is required. |

### Still open from v1 (low / awkward)

| Source | From | Suggested OSC | Auth | Why / how | Overlap |
| --- | --- | --- | --- | --- | --- |
| [ ] **Overpass / OSM roads** | v1 | `/osm` | none | Static geometry, not live traffic. Heavy. | We already have TfL / TomTom / HERE flow. |
| [ ] **USNO Astronomical Applications** | v1 | — | — | No public CORS JSON. | Sun/Moon/IPGeo already cover this. |
| [ ] **Spotify currently-playing** | v1 + v2 | `/spotify` | OAuth | `/me/player/currently-playing` still works. Audio features / tempo / valence are **dead** for new apps (403 after 27 Nov 2024). | Prefer Last.fm. Do not build audio-features. |
| [ ] **Reddit listing poll** | v2 | `/reddit` | OAuth, manual app approval | Self-serve registration closed; 2–4 week ticket, possible silent rejection. Poll only. | Skip unless a key is already approved. Bluesky + Mastodon cover the firehose. |

---

## Skip (do not implement)

| Item | Why |
| --- | --- |
| Spotify audio-features / analysis / recommendations | Permanently 403 for new apps |
| Open Notify ISS HTTP | Mixed content from HTTPS page; ISS already via wheretheiss.at |
| Numbers API | HTTPS cert broken (v1) |
| AISHub | Cooperative: need your own AIS receiver |
| VesselFinder / MarineTraffic free tiers | Credit-metered / trial — not continuous free |
| CoinDesk / CryptoCompare free tier | Retired (v1); CoinGecko already covers BTC/ETH |
| Second Hacker News type | Upgrade the existing `/hn` instead |
| Second Wikipedia poll | Add EventStreams or leave the poll |
| Second GBIF / Random.org / sunrise-sunset / NOAA OVATION / NOAA tides / MusicBrainz | Already shipped |

---

## Suggested build order

1. Bluesky Jetstream, then Mastodon (push, no signup).
2. Wikipedia EventStreams and/or HN Firebase upgrade.
3. AISStream (Gdynia box) + Tricity GTFS-RT.
4. Last.fm if a personal-music channel is wanted.
5. Celestrak+SGP4 (one satellite source), GDACS, Nager.Date, IMGW hydro.
6. eBird *or* iNaturalist (not both unless needed).
7. CMEMS only if Baltic sea-level/currents are part of the piece.
8. Leave Overpass, USNO, OpenAQ, Spotify, Reddit, Urząd Morski PNG until something else fails.
