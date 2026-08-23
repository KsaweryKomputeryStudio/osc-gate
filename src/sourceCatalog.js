/**
 * Available source types, grouped for the picker.
 * `kind: 'view'` uses a dedicated main view; `kind: 'poll'` uses the generic poll view.
 */

export const SOURCE_CATEGORIES = [
  {
    id: 'hardware',
    label: 'Hardware',
    types: [
      { id: 'controller', label: 'DualSense', icon: 'DS', prefix: '/ds', kind: 'view', hint: 'DualSense via USB or Bluetooth.' },
      {
        id: 'midi',
        label: 'MIDI',
        icon: 'MD',
        prefix: '/midi',
        kind: 'view',
        hint: 'Notes, CC, velocity, and clock via Web MIDI.',
        defaults: { inputId: '', channel: 0, learned: [], autoConnect: false },
      },
      {
        id: 'gamepad',
        label: 'Gamepad',
        icon: 'GP',
        prefix: '/pad',
        kind: 'view',
        hint: 'Any USB or Bluetooth gamepad (not DualSense).',
        defaults: { gamepadId: '', gamepadIndex: -1, deadzone: 0.08, autoConnect: false, buttonCount: 17, axisCount: 4 },
      },
      { id: 'garmin', label: 'Garmin HR', icon: 'HR', prefix: '/garmin', kind: 'view', hint: 'Watch broadcast heart rate over Bluetooth LE.' },
      { id: 'macbook', label: 'MacBook', icon: 'MB', prefix: '/mac', kind: 'view', hint: 'Lid angle via the local gateway.' },
      { id: 'mic', label: 'Microphone', icon: 'MC', prefix: '/mic', kind: 'view', hint: 'Input volume as 0–1.' },
      { id: 'human', label: 'Human count', icon: 'YO', prefix: '/human', kind: 'view', hint: 'Webcam + YOLOv8n person count.' },
    ],
  },
  {
    id: 'time',
    label: 'Time',
    types: [{ id: 'time', label: 'Time', icon: 'TM', prefix: '/time', kind: 'view', hint: 'Local hour / day / week / month / year as 0–1.' }],
  },
  {
    id: 'weather',
    label: 'Weather / UV / Environment',
    types: [
      { id: 'weather', label: 'Weather', icon: 'WX', prefix: '/weather', kind: 'view', hint: 'Open-Meteo current conditions. No API key.' },
      {
        id: 'uv',
        label: 'UV / Solar',
        icon: 'UV',
        prefix: '/uv',
        kind: 'poll',
        hint: 'Open-Meteo UV index and shortwave radiation. No key.',
        hero: 'uv',
        heroUnit: 'UV index',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01 },
        fields: [
          { id: 'uv', label: 'UV index' },
          { id: 'solar', label: 'Solar W/m²' },
        ],
      },
      {
        id: 'owm',
        label: 'OpenWeather',
        icon: 'OW',
        prefix: '/owm',
        kind: 'poll',
        needsKey: true,
        hint: 'OpenWeatherMap current conditions. Free tier, API key required.',
        hero: 'temp',
        heroUnit: '°C',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01, apiKey: '' },
        fields: [
          { id: 'temp', label: 'Temp °C' },
          { id: 'humidity', label: 'Humidity %' },
          { id: 'wind', label: 'Wind m/s' },
          { id: 'clouds', label: 'Clouds %' },
        ],
      },
      {
        id: 'waqi',
        label: 'WAQI',
        icon: 'WQ',
        prefix: '/waqi',
        kind: 'poll',
        needsKey: true,
        hint: 'World Air Quality Index. Token required. Uses lat/lon, or a city name if set.',
        hero: 'aqi',
        heroUnit: 'AQI',
        defaults: { intervalSec: 120, lat: 52.23, lon: 21.01, city: '', apiKey: '' },
        fields: [
          { id: 'aqi', label: 'AQI' },
          { id: 'pm25', label: 'PM2.5' },
        ],
      },
      {
        id: 'aq',
        label: 'Air quality',
        icon: 'A+',
        prefix: '/aq',
        kind: 'poll',
        hint: 'Open-Meteo European AQI, PM2.5, and grass pollen. No key.',
        hero: 'aqi',
        heroUnit: 'EAQI',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01 },
        fields: [
          { id: 'aqi', label: 'European AQI' },
          { id: 'pm25', label: 'PM2.5' },
          { id: 'pollen', label: 'Grass pollen' },
        ],
      },
    ],
  },
  {
    id: 'traffic',
    label: 'Traffic / Transit',
    types: [
      {
        id: 'tube',
        label: 'London Tube',
        icon: 'TF',
        prefix: '/tube',
        kind: 'poll',
        hint: 'TfL line status. Free, no key. Disruption 0–1.',
        hero: 'disruption',
        heroUnit: 'Disruption 0–1',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'disruption', label: 'Disruption 0–1' },
          { id: 'closed', label: 'Lines closed' },
          { id: 'good', label: 'Good service' },
        ],
      },
      {
        id: 'roads',
        label: 'London Roads',
        icon: 'RD',
        prefix: '/roads',
        kind: 'poll',
        hint: 'TfL road corridor status. Free, no key. Disruption 0–1.',
        hero: 'disruption',
        heroUnit: 'Disruption 0–1',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'disruption', label: 'Disruption 0–1' },
          { id: 'serious', label: 'Serious / severe' },
          { id: 'good', label: 'Clear roads' },
        ],
      },
      {
        id: 'tomtom',
        label: 'TomTom traffic',
        icon: 'TT',
        prefix: '/tomtom',
        kind: 'poll',
        needsKey: true,
        hint: 'TomTom flow at a point. API key required.',
        hero: 'jam',
        heroUnit: 'Jam 0–1',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01, apiKey: '' },
        fields: [
          { id: 'speed', label: 'Speed km/h' },
          { id: 'freeFlow', label: 'Free-flow km/h' },
          { id: 'jam', label: 'Jam 0–1' },
        ],
      },
      {
        id: 'here',
        label: 'HERE traffic',
        icon: 'HE',
        prefix: '/here',
        kind: 'poll',
        needsKey: true,
        hint: 'HERE traffic flow around a point. API key required.',
        hero: 'jam',
        heroUnit: 'Jam factor',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01, apiKey: '' },
        fields: [
          { id: 'speed', label: 'Speed m/s' },
          { id: 'jam', label: 'Jam factor' },
        ],
      },
    ],
  },
  {
    id: 'astronomy',
    label: 'Astronomy / Natural Cycles',
    types: [
      {
        id: 'sun',
        label: 'Sun',
        icon: 'SU',
        prefix: '/sun',
        kind: 'poll',
        hint: 'Sunrise–Sunset.org. Daylight progress 0–1. No key.',
        hero: 'day01',
        heroUnit: 'Daylight 0–1',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01 },
        fields: [
          { id: 'day01', label: 'Daylight 0–1' },
          { id: 'isDay', label: 'Is day' },
          { id: 'altitude01', label: 'Sun altitude 0–1' },
        ],
      },
      {
        id: 'moon',
        label: 'Moon',
        icon: 'MN',
        prefix: '/moon',
        kind: 'poll',
        hint: 'Local moon phase and illumination 0–1. No API.',
        hero: 'illum',
        heroUnit: 'Illumination 0–1',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'phase', label: 'Phase 0–1' },
          { id: 'illum', label: 'Illumination 0–1' },
          { id: 'full', label: 'Near full' },
        ],
      },
      {
        id: 'ipgeo',
        label: 'Astronomy',
        icon: 'AS',
        prefix: '/ipgeo',
        kind: 'poll',
        needsKey: true,
        hint: 'IPGeolocation sun / moon position. Free tier, API key required.',
        hero: 'moonIllum',
        heroUnit: 'Moon 0–1',
        defaults: { intervalSec: 60, lat: 52.23, lon: 21.01, apiKey: '' },
        fields: [
          { id: 'sunAlt', label: 'Sun altitude °' },
          { id: 'moonAlt', label: 'Moon altitude °' },
          { id: 'moonIllum', label: 'Moon illum 0–1' },
          { id: 'isDay', label: 'Is day' },
        ],
      },
      {
        id: 'people',
        label: 'People in space',
        icon: 'PS',
        prefix: '/people',
        kind: 'poll',
        hint: 'How many humans are in orbit right now. No key.',
        hero: 'count',
        heroUnit: 'People',
        defaults: { intervalSec: 300 },
        fields: [
          { id: 'count', label: 'People in space' },
          { id: 'iss', label: 'On ISS' },
        ],
      },
    ],
  },
  {
    id: 'spaceweather',
    label: 'Space Weather',
    types: [
      {
        id: 'kp',
        label: 'Kp index',
        icon: 'KP',
        prefix: '/kp',
        kind: 'poll',
        hint: 'NOAA planetary Kp. Geomagnetic activity 0–9. No key.',
        hero: 'kp',
        heroUnit: 'Kp',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'kp', label: 'Kp' },
        ],
      },
      {
        id: 'xray',
        label: 'Solar X-ray',
        icon: 'XR',
        prefix: '/xray',
        kind: 'poll',
        hint: 'NOAA GOES X-ray flux. No key. Good for flare / aurora states.',
        hero: 'flux',
        heroUnit: 'Flux',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'flux', label: 'Flux (0.1–0.8nm)' },
          { id: 'flare', label: 'C-class or above' },
        ],
      },
      {
        id: 'donki',
        label: 'DONKI',
        icon: 'DK',
        prefix: '/donki',
        kind: 'poll',
        needsKey: true,
        hint: 'NASA DONKI flares and CMEs (last 7 days). API key required.',
        hero: 'flares',
        heroUnit: 'Flares (7d)',
        defaults: { intervalSec: 300, apiKey: '' },
        fields: [
          { id: 'flares', label: 'Flares (7d)' },
          { id: 'cmes', label: 'CMEs (7d)' },
        ],
      },
      {
        id: 'aurora',
        label: 'Aurora',
        icon: 'AU',
        prefix: '/aurora',
        kind: 'poll',
        hint: 'NOAA OVATION aurora forecast at your point. No key.',
        hero: 'local',
        heroUnit: 'Local %',
        defaults: { intervalSec: 300, lat: 69.65, lon: 18.96 },
        fields: [
          { id: 'local', label: 'Local aurora %' },
          { id: 'max', label: 'Global max %' },
        ],
      },
      {
        id: 'solarwind',
        label: 'Solar wind',
        icon: 'SW',
        prefix: '/solarwind',
        kind: 'poll',
        hint: 'NOAA solar-wind proton speed. No key.',
        hero: 'speed',
        heroUnit: 'km/s',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'speed', label: 'Speed km/s' },
        ],
      },
    ],
  },
  {
    id: 'seismic',
    label: 'Seismic / Disaster',
    types: [
      {
        id: 'quake',
        label: 'Earthquakes',
        icon: 'EQ',
        prefix: '/quake',
        kind: 'poll',
        hint: 'USGS last-hour events. Free, no key.',
        hero: 'maxMag',
        heroUnit: 'Max magnitude',
        defaults: { intervalSec: 60, minMag: 2.5 },
        fields: [
          { id: 'count', label: 'Count (1h)' },
          { id: 'maxMag', label: 'Max mag' },
        ],
      },
      {
        id: 'eonet',
        label: 'EONET',
        icon: 'EO',
        prefix: '/eonet',
        kind: 'poll',
        hint: 'NASA EONET open natural events. Fires, storms, volcanoes. No key.',
        hero: 'count',
        heroUnit: 'Open events',
        defaults: { intervalSec: 120 },
        fields: [
          { id: 'count', label: 'Open events' },
          { id: 'fires', label: 'Wildfires' },
        ],
      },
    ],
  },
  {
    id: 'ocean',
    label: 'Ocean / Nature',
    types: [
      {
        id: 'marine',
        label: 'Marine',
        icon: 'WV',
        prefix: '/marine',
        kind: 'poll',
        hint: 'Open-Meteo marine waves. No API key.',
        hero: 'wave',
        heroUnit: 'Wave m',
        defaults: { intervalSec: 60, lat: 54.5, lon: 18.7 },
        fields: [
          { id: 'wave', label: 'Wave height m' },
          { id: 'period', label: 'Period s' },
        ],
      },
      {
        id: 'gbif',
        label: 'GBIF',
        icon: 'GB',
        prefix: '/gbif',
        kind: 'poll',
        hint: 'GBIF species observations recorded today. No key.',
        hero: 'today',
        heroUnit: 'Today',
        defaults: { intervalSec: 120 },
        fields: [
          { id: 'today', label: 'Observations today' },
        ],
      },
      {
        id: 'tides',
        label: 'NOAA tides',
        icon: 'TD',
        prefix: '/tides',
        kind: 'poll',
        hint: 'NOAA CO-OPS water level. US coast. Station 8518750 = The Battery, NYC. No key.',
        hero: 'level',
        heroUnit: 'm',
        defaults: { intervalSec: 60, stationId: 8518750 },
        fields: [
          { id: 'level', label: 'Water level m' },
        ],
      },
      {
        id: 'flood',
        label: 'River flood',
        icon: 'FL',
        prefix: '/flood',
        kind: 'poll',
        hint: 'Open-Meteo GloFAS river discharge. No key.',
        hero: 'discharge',
        heroUnit: 'm³/s',
        defaults: { intervalSec: 3600, lat: 52.23, lon: 21.01 },
        fields: [
          { id: 'discharge', label: 'Discharge m³/s' },
        ],
      },
    ],
  },
  {
    id: 'networks',
    label: 'Networks / Internet Pulse',
    types: [
      {
        id: 'hn',
        label: 'Hacker News',
        icon: 'HN',
        prefix: '/hn',
        kind: 'poll',
        hint: 'HN maxitem pulse. New posts per poll. No key.',
        hero: 'delta',
        heroUnit: 'New items',
        defaults: { intervalSec: 30 },
        fields: [
          { id: 'delta', label: 'New items' },
          { id: 'maxitem', label: 'Max item' },
        ],
      },
      {
        id: 'wiki',
        label: 'Wikipedia',
        icon: 'WK',
        prefix: '/wiki',
        kind: 'poll',
        hint: 'English Wikipedia recent-change pulse. No key.',
        hero: 'delta',
        heroUnit: 'New edits',
        defaults: { intervalSec: 15 },
        fields: [
          { id: 'delta', label: 'New edits' },
          { id: 'rcid', label: 'Latest rcid' },
        ],
      },
      {
        id: 'github',
        label: 'GitHub',
        icon: 'GH',
        prefix: '/github',
        kind: 'poll',
        hint: 'Public GitHub events pulse. No key (60 req/hr).',
        hero: 'delta',
        heroUnit: 'New events',
        defaults: { intervalSec: 30 },
        fields: [
          { id: 'delta', label: 'New events' },
          { id: 'latest', label: 'Latest id' },
        ],
      },
      {
        id: 'carbon',
        label: 'UK carbon',
        icon: 'CO',
        prefix: '/carbon',
        kind: 'poll',
        hint: 'GB electricity carbon intensity. No key.',
        hero: 'actual',
        heroUnit: 'gCO₂/kWh',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'actual', label: 'Actual' },
          { id: 'forecast', label: 'Forecast' },
        ],
      },
    ],
  },
  {
    id: 'space',
    label: 'Space',
    types: [
      {
        id: 'iss',
        label: 'ISS',
        icon: 'IS',
        prefix: '/iss',
        kind: 'poll',
        hint: 'ISS position (wheretheiss.at). No key.',
        hero: 'lat',
        heroUnit: 'Latitude',
        defaults: { intervalSec: 10 },
        fields: [
          { id: 'lat', label: 'Latitude' },
          { id: 'lon', label: 'Longitude' },
        ],
      },
      {
        id: 'neo',
        label: 'Near-Earth',
        icon: 'NE',
        prefix: '/neo',
        kind: 'poll',
        hint: 'NASA NEO feed for today. DEMO_KEY works; your key raises the limit.',
        needsKey: true,
        hero: 'count',
        heroUnit: 'Objects today',
        defaults: { intervalSec: 3600, apiKey: 'DEMO_KEY' },
        fields: [
          { id: 'count', label: 'Count today' },
          { id: 'hazard', label: 'Hazardous' },
        ],
      },
      {
        id: 'apod',
        label: 'APOD',
        icon: 'AP',
        prefix: '/apod',
        kind: 'poll',
        needsKey: true,
        hint: 'NASA Astronomy Picture of the Day. API key required (DEMO_KEY ok).',
        hero: 'hd',
        heroUnit: 'HD image',
        defaults: { intervalSec: 3600, apiKey: 'DEMO_KEY' },
        fields: [
          { id: 'hd', label: 'Has HD' },
          { id: 'video', label: 'Is video' },
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance / Crypto',
    types: [
      {
        id: 'crypto',
        label: 'Bitcoin',
        icon: 'BT',
        prefix: '/crypto',
        kind: 'poll',
        hint: 'CoinGecko BTC price + 24h change. No key.',
        hero: 'price',
        heroUnit: 'USD',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'price', label: 'Price USD' },
          { id: 'change', label: '24h %' },
        ],
      },
      {
        id: 'fx',
        label: 'FX rates',
        icon: 'FX',
        prefix: '/fx',
        kind: 'poll',
        hint: 'Frankfurter currency rates. No key. Pair like USD-PLN.',
        hero: 'rate',
        heroUnit: 'Rate',
        defaults: { intervalSec: 120, pair: 'USD-PLN' },
        fields: [
          { id: 'rate', label: 'Rate' },
        ],
      },
      {
        id: 'eth',
        label: 'Ethereum',
        icon: 'ET',
        prefix: '/eth',
        kind: 'poll',
        hint: 'CoinGecko ETH price + 24h change. No key.',
        hero: 'price',
        heroUnit: 'USD',
        defaults: { intervalSec: 60 },
        fields: [
          { id: 'price', label: 'Price USD' },
          { id: 'change', label: '24h %' },
        ],
      },
      {
        id: 'fng',
        label: 'Fear & Greed',
        icon: 'FG',
        prefix: '/fng',
        kind: 'poll',
        hint: 'Crypto Fear & Greed index 0–100. No key.',
        hero: 'value',
        heroUnit: 'Index',
        defaults: { intervalSec: 300 },
        fields: [
          { id: 'value', label: 'Index 0–100' },
          { id: 'greed', label: 'Greed' },
        ],
      },
      {
        id: 'mempool',
        label: 'Mempool',
        icon: 'MP',
        prefix: '/mempool',
        kind: 'poll',
        hint: 'Bitcoin recommended fees (mempool.space). No key.',
        hero: 'fastest',
        heroUnit: 'sat/vB',
        defaults: { intervalSec: 30 },
        fields: [
          { id: 'fastest', label: 'Fastest sat/vB' },
          { id: 'hour', label: '1h sat/vB' },
        ],
      },
    ],
  },
  {
    id: 'music',
    label: 'Music / Culture',
    types: [
      {
        id: 'listens',
        label: 'ListenBrainz',
        icon: 'LB',
        prefix: '/lb',
        kind: 'poll',
        hint: 'Sitewide ListenBrainz listens this week. No key.',
        hero: 'listens',
        heroUnit: 'Listens',
        defaults: { intervalSec: 120 },
        fields: [
          { id: 'listens', label: 'Listens (latest day)' },
          { id: 'delta', label: 'Vs previous day' },
        ],
      },
      {
        id: 'mb',
        label: 'MusicBrainz',
        icon: 'MZ',
        prefix: '/mb',
        kind: 'poll',
        hint: 'MusicBrainz releases dated today. No key.',
        hero: 'count',
        heroUnit: 'Today',
        defaults: { intervalSec: 120 },
        fields: [
          { id: 'count', label: 'Releases today' },
        ],
      },
    ],
  },
  {
    id: 'novelty',
    label: 'Weird / Novelty',
    types: [
      {
        id: 'rng',
        label: 'Random',
        icon: 'RN',
        prefix: '/rng',
        kind: 'poll',
        hint: 'Cryptographic random 0–1 in the browser.',
        hero: 'value',
        heroUnit: 'Random 0–1',
        defaults: { intervalSec: 2 },
        fields: [{ id: 'value', label: 'Value 0–1' }],
      },
      {
        id: 'cards',
        label: 'Cards',
        icon: 'CD',
        prefix: '/cards',
        kind: 'poll',
        hint: 'Deck of Cards API. Rank, suit, and red/black. No key.',
        hero: 'rank',
        heroUnit: 'Rank',
        defaults: { intervalSec: 5 },
        fields: [
          { id: 'rank', label: 'Rank 1–13' },
          { id: 'suit', label: 'Suit 0–3' },
          { id: 'red', label: 'Red' },
        ],
      },
      {
        id: 'randorg',
        label: 'Random.org',
        icon: 'R.',
        prefix: '/randorg',
        kind: 'poll',
        needsKey: true,
        hint: 'True random 0–1 from Random.org. API key required.',
        hero: 'value',
        heroUnit: 'Random 0–1',
        defaults: { intervalSec: 10, apiKey: '' },
        fields: [{ id: 'value', label: 'Value 0–1' }],
      },
      {
        id: 'joke',
        label: 'Joke',
        icon: 'JK',
        prefix: '/joke',
        kind: 'poll',
        hint: 'JokeAPI random joke as length and category. No key.',
        hero: 'length',
        heroUnit: 'Chars',
        defaults: { intervalSec: 15 },
        fields: [
          { id: 'length', label: 'Length' },
          { id: 'category', label: 'Category' },
          { id: 'safe', label: 'Safe' },
        ],
      },
      {
        id: 'yesno',
        label: 'Yes / No',
        icon: 'YN',
        prefix: '/yesno',
        kind: 'poll',
        hint: 'yesno.wtf random yes or no as 0/1. No key.',
        hero: 'yes',
        heroUnit: 'Yes',
        defaults: { intervalSec: 5 },
        fields: [{ id: 'yes', label: 'Yes' }],
      },
    ],
  },
  {
    id: 'poland',
    label: 'Poland / EU',
    types: [
      {
        id: 'gios',
        label: 'GIOŚ air',
        icon: 'AQ',
        prefix: '/gios',
        kind: 'poll',
        hint: 'Polish air quality index (Warsaw default). No key.',
        hero: 'index',
        heroUnit: 'Index 0–5',
        defaults: { intervalSec: 120, stationId: 52 },
        fields: [
          { id: 'index', label: 'Index 0–5' },
        ],
      },
      {
        id: 'imgw',
        label: 'IMGW',
        icon: 'IM',
        prefix: '/imgw',
        kind: 'poll',
        hint: 'IMGW Polish synop station. No key. Station name without diacritics.',
        hero: 'temp',
        heroUnit: '°C',
        defaults: { intervalSec: 120, stationName: 'warszawa' },
        fields: [
          { id: 'temp', label: 'Temp °C' },
          { id: 'wind', label: 'Wind m/s' },
          { id: 'humidity', label: 'Humidity %' },
          { id: 'precip', label: 'Precip mm' },
        ],
      },
      {
        id: 'nbp',
        label: 'NBP FX',
        icon: 'NB',
        prefix: '/nbp',
        kind: 'poll',
        hint: 'NBP table A mid rate vs PLN. No key. Currency like USD.',
        hero: 'rate',
        heroUnit: 'PLN',
        defaults: { intervalSec: 300, currency: 'USD' },
        fields: [
          { id: 'rate', label: 'PLN per unit' },
        ],
      },
    ],
  },
];

const TYPES = SOURCE_CATEGORIES.flatMap((c) => c.types.map((t) => ({ ...t, category: c.id, categoryLabel: c.label })));

export function allSourceTypes() {
  return TYPES;
}

export function sourceType(id) {
  return TYPES.find((t) => t.id === id) || null;
}

export function typeNeedsKey(spec) {
  return !!spec?.needsKey;
}

export function viewTypeIds() {
  return TYPES.filter((t) => t.kind === 'view').map((t) => t.id);
}

export function newSourceId() {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextSlot(sources, type) {
  const used = new Set((sources || []).filter((s) => s.type === type).map((s) => Number(s.slot) || 0));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export function instancePrefix(inst) {
  const spec = sourceType(inst?.type);
  if (!spec) return '/src';
  return `${spec.prefix}/${inst.slot || 1}`;
}

export function instanceAddress(inst, tail) {
  const t = String(tail || '');
  const path = t.startsWith('/') ? t : `/${t}`;
  return `${instancePrefix(inst)}${path}`;
}

/** Rewrite a legacy type-prefixed address (/weather/temp) onto this instance (/weather/1/temp). */
export function rewriteAddress(inst, address) {
  const spec = sourceType(inst?.type);
  if (!spec || !address) return address;
  const prefixed = `${spec.prefix}/${inst.slot || 1}`;
  if (address === prefixed || address.startsWith(`${prefixed}/`)) return address;
  if (address === spec.prefix || address.startsWith(`${spec.prefix}/`)) {
    return `${prefixed}${address.slice(spec.prefix.length)}`;
  }
  return instanceAddress(inst, address);
}

export function instanceLabel(inst) {
  const spec = sourceType(inst?.type);
  const name = inst?.name || '';
  if (inst?.type === 'controller' && /^Controller( \d+)?$/.test(name)) {
    return defaultInstanceName('controller', inst.slot);
  }
  return name || spec?.label || inst?.type || 'Source';
}

export function defaultInstanceName(type, slot) {
  const spec = sourceType(type);
  const label = spec?.label || type;
  return slot > 1 ? `${label} ${slot}` : label;
}
