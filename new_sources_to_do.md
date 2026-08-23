# New sources — todo

One source per category is implemented first. The rest wait until session / picker / instance OSC ids / output charts are confirmed.

## Session & UI (mechanisms)

- [x] Save / open session files; last session restores on startup (localStorage)
- [x] New session starts with an empty source list
- [x] `+` and keyboard `1` open the source picker (type to filter)
- [x] Multiple copies of a type get OSC ids (`/weather/1/temp`, `/weather/2/temp`)
- [x] Right-hand panel charts outgoing signals of the selected source

## Weather / UV / Environment

- [x] **Open-Meteo** weather (existing Weather source)
- [x] **Open-Meteo UV / solar** (`/uv/1/…`)
- [x] **Open-Meteo air quality** (`/aq/1/…`)
- [x] **OpenWeatherMap** (`/owm/1/…`, key)
- [x] **WAQI** (`/waqi/1/…`, token)
- [ ] OpenAQ (v3 needs a key)

## Traffic / Transit

- [x] **TfL London Tube** status (`/tube/1/…`)
- [x] **TfL London Roads** (`/roads/1/…`)
- [x] **TomTom Traffic** (`/tomtom/1/…`, key)
- [x] **HERE Traffic** (`/here/1/…`, key)
- [ ] Overpass / OSM static roads
- [ ] GTFS-realtime (city feeds)

## Astronomy / Natural Cycles

- [x] **Sunrise–Sunset.org** daylight (`/sun/1/…`)
- [x] **Moon phase** (local, `/moon/1/…`)
- [x] **IPGeolocation Astronomy** (`/ipgeo/1/…`, key)
- [ ] USNO Astronomical Applications
- [x] **People in space** (`/people/1/…`, HTTPS roster)
- [ ] Heavens-Above satellite passes

## Space Weather

- [x] **NOAA Kp-index** (`/kp/1/…`)
- [x] **NOAA GOES X-ray** (`/xray/1/…`)
- [x] **NASA DONKI** (`/donki/1/…`, key)
- [x] **NOAA OVATION aurora** (`/aurora/1/…`)
- [x] **NOAA solar wind** (`/solarwind/1/…`)

## Seismic / Geophysical / Disaster

- [x] **USGS Earthquakes** (`/quake/1/…`)
- [x] **NASA EONET** (`/eonet/1/…`)

## Ocean / Nature

- [x] **Open-Meteo Marine** waves (`/marine/1/…`)
- [x] **GBIF** observations today (`/gbif/1/…`)
- [x] **NOAA Tides** (`/tides/1/…`, Battery NYC default)
- [x] **Open-Meteo river flood** (`/flood/1/…`)

## Networks / Internet Pulse

- [x] **Hacker News** maxitem pulse (`/hn/1/…`)
- [x] **Wikipedia** recent-change pulse (`/wiki/1/…`)
- [ ] Wikipedia EventStreams (SSE firehose)
- [x] **GitHub Events** (`/github/1/…`)
- [x] **UK carbon intensity** (`/carbon/1/…`)

## Space (broader)

- [x] **ISS position** via wheretheiss.at (`/iss/1/…`)
- [x] **NASA NEO** today (`/neo/1/…`, DEMO_KEY)
- [x] **NASA APOD** (`/apod/1/…`, key / DEMO_KEY)
- [ ] Open Notify ISS (HTTP)

## Finance / Crypto

- [x] **CoinGecko Bitcoin** (`/crypto/1/…`)
- [x] **Frankfurter** FX (`/fx/1/…`)
- [x] **Ethereum** (`/eth/1/…`)
- [x] **Fear & Greed** (`/fng/1/…`)
- [x] **Bitcoin mempool fees** (`/mempool/1/…`)

## Music / Culture

- [x] **ListenBrainz** sitewide pulse (`/lb/1/…`)
- [x] **MusicBrainz** releases today (`/mb/1/…`)
- [ ] Spotify Web API (OAuth, currently-playing)

## Weird / Human / Novelty

- [x] **Browser crypto random** (`/rng/1/value`)
- [x] **Deck of Cards** (`/cards/1/…`)
- [ ] Numbers API (HTTPS cert currently broken)
- [x] **JokeAPI** (`/joke/1/…`)
- [x] **Yes / No** (`/yesno/1/yes`)
- [x] **Random.org** (`/randorg/1/value`, key)

## Poland / EU

- [x] **GIOŚ air quality** (`/gios/1/…`, Warsaw station default)
- [x] **IMGW** synop (`/imgw/1/…`, Warsaw default)
- [x] **NBP FX** (`/nbp/1/…`, USD default)

---

Most robust for a live install (no key, generous limits): Open-Meteo, USGS, NOAA Kp, Sunrise-Sunset.org.

Looked up, not added yet: OpenAQ v3 (key), Overpass / GTFS (heavy / city-specific), USNO + Heavens-Above (no public CORS JSON), Wikipedia SSE (needs an event stream, not poll), Open Notify HTTP (mixed content from this HTTPS page), Spotify OAuth, Numbers API (broken cert).
