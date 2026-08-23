/**
 * Fetchers for poll-kind sources. Each returns { values, label }.
 */

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const hnState = { last: null };

export async function fetchPoll(type, settings = {}, prev = null) {
  switch (type) {
    case 'tube':
      return fetchTube();
    case 'sun':
      return fetchSun(settings);
    case 'kp':
      return fetchKp();
    case 'quake':
      return fetchQuake(settings);
    case 'marine':
      return fetchMarine(settings);
    case 'hn':
      return fetchHn(prev);
    case 'iss':
      return fetchIss();
    case 'crypto':
      return fetchCrypto();
    case 'rng':
      return fetchRng();
    case 'listens':
      return fetchListens();
    case 'gios':
      return fetchGios(settings);
    case 'uv':
      return fetchUv(settings);
    case 'roads':
      return fetchRoads();
    case 'moon':
      return fetchMoon();
    case 'xray':
      return fetchXray();
    case 'eonet':
      return fetchEonet();
    case 'gbif':
      return fetchGbif();
    case 'wiki':
      return fetchWiki(prev);
    case 'neo':
      return fetchNeo(settings);
    case 'fx':
      return fetchFx(settings);
    case 'mb':
      return fetchMb();
    case 'cards':
      return fetchCards();
    case 'imgw':
      return fetchImgw(settings);
    case 'owm':
      return fetchOwm(settings);
    case 'waqi':
      return fetchWaqi(settings);
    case 'tomtom':
      return fetchTomtom(settings);
    case 'here':
      return fetchHere(settings);
    case 'ipgeo':
      return fetchIpgeo(settings);
    case 'donki':
      return fetchDonki(settings);
    case 'apod':
      return fetchApod(settings);
    case 'randorg':
      return fetchRandorg(settings);
    case 'aq':
      return fetchAq(settings);
    case 'people':
      return fetchPeople();
    case 'aurora':
      return fetchAurora(settings);
    case 'solarwind':
      return fetchSolarwind();
    case 'tides':
      return fetchTides(settings);
    case 'flood':
      return fetchFlood(settings);
    case 'github':
      return fetchGithub(prev);
    case 'carbon':
      return fetchCarbon();
    case 'eth':
      return fetchEth();
    case 'fng':
      return fetchFng();
    case 'mempool':
      return fetchMempool();
    case 'joke':
      return fetchJoke();
    case 'yesno':
      return fetchYesno();
    case 'nbp':
      return fetchNbp(settings);
    default:
      throw new Error(`Unknown poll source ${type}`);
  }
}

async function fetchTube() {
  const rows = await getJson('https://api.tfl.gov.uk/Line/Mode/tube/Status');
  let closed = 0;
  let good = 0;
  let worst = 0;
  for (const line of rows || []) {
    const status = line?.lineStatuses?.[0]?.statusSeverity ?? 10;
    if (status <= 5) closed += 1;
    if (status >= 10) good += 1;
    worst = Math.max(worst, Math.max(0, 10 - status));
  }
  const n = (rows || []).length || 1;
  return {
    label: `${good}/${n} good service`,
    values: {
      disruption: clamp01(worst / 6),
      closed,
      good,
    },
  };
}

async function fetchSun({ lat = 52.23, lon = 21.01 } = {}) {
  const data = await getJson(
    `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`,
  );
  const res = data?.results || {};
  const rise = Date.parse(res.sunrise);
  const set = Date.parse(res.sunset);
  const now = Date.now();
  const isDay = Number.isFinite(rise) && Number.isFinite(set) && now >= rise && now <= set;
  let day01 = 0;
  if (Number.isFinite(rise) && Number.isFinite(set) && set > rise) {
    day01 = clamp01((now - rise) / (set - rise));
    if (!isDay) day01 = now < rise ? 0 : 1;
  }
  const noon = rise + (set - rise) / 2;
  const half = (set - rise) / 2 || 1;
  const altitude01 = isDay ? clamp01(1 - Math.abs(now - noon) / half) : 0;
  return {
    label: isDay ? 'Day' : 'Night',
    values: { day01, isDay: isDay ? 1 : 0, altitude01 },
  };
}

async function fetchKp() {
  const rows = await getJson('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
  const last = Array.isArray(rows) ? rows[rows.length - 1] : null;
  const kp = num(last?.kp_index ?? last?.kp);
  return {
    label: `Kp ${kp}`,
    values: { kp },
  };
}

async function fetchQuake({ minMag = 2.5 } = {}) {
  const feed =
    Number(minMag) >= 4.5
      ? 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson'
      : 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson';
  const data = await getJson(feed);
  const feats = (data?.features || []).filter((f) => num(f?.properties?.mag) >= Number(minMag || 0));
  let maxMag = 0;
  for (const f of feats) maxMag = Math.max(maxMag, num(f?.properties?.mag));
  return {
    label: `${feats.length} events / 1h`,
    values: {
      count: feats.length,
      maxMag,
    },
  };
}

async function fetchMarine({ lat = 54.5, lon = 18.7 } = {}) {
  const url =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&current=wave_height,wave_period,wave_direction`;
  const data = await getJson(url);
  const cur = data?.current || {};
  const wave = num(cur.wave_height);
  return {
    label: `${wave.toFixed(1)} m`,
    values: {
      wave,
      period: num(cur.wave_period),
    },
  };
}

async function fetchHn(prev) {
  const maxitem = num(await getJson('https://hacker-news.firebaseio.com/v0/maxitem.json'));
  const last = prev?.values?.maxitem;
  const delta = last != null ? Math.max(0, maxitem - last) : 0;
  return {
    label: delta ? `+${delta}` : 'idle',
    values: { delta, maxitem },
  };
}

async function fetchIss() {
  const data = await getJson('https://api.wheretheiss.at/v1/satellites/25544');
  const lat = num(data?.latitude);
  const lon = num(data?.longitude);
  return {
    label: `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`,
    values: {
      lat,
      lon,
    },
  };
}

async function fetchCrypto() {
  const data = await getJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
  );
  const row = data?.bitcoin || {};
  const price = num(row.usd);
  const change = num(row.usd_24h_change);
  return {
    label: `$${Math.round(price)}`,
    values: {
      price,
      change,
    },
  };
}

async function fetchListens() {
  const data = await getJson(
    'https://api.listenbrainz.org/1/stats/sitewide/listening-activity?range=this_week',
  );
  const rows = data?.payload?.listening_activity || [];
  const last = rows[rows.length - 1] || {};
  const prev = rows[rows.length - 2] || {};
  const listens = num(last.listen_count);
  const prior = num(prev.listen_count, listens);
  return {
    label: last.time_range || `${Math.round(listens / 1000)}k listens`,
    values: {
      listens,
      delta: listens - prior,
    },
  };
}

function fetchRng() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const value = buf[0] / 0xffffffff;
  return Promise.resolve({
    label: value.toFixed(3),
    values: { value: Math.round(value * 1000) / 1000 },
  });
}

async function fetchGios({ stationId = 52 } = {}) {
  const data = await getJson(`https://api.gios.gov.pl/pjp-api/rest/aqindex/getIndex/${stationId}`);
  const raw = data?.stIndexLevel?.id;
  const index = raw == null ? 0 : num(raw);
  return {
    label: data?.stIndexLevel?.indexLevelName || `Index ${index}`,
    values: {
      index,
    },
  };
}

async function fetchUv({ lat = 52.23, lon = 21.01 } = {}) {
  const data = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=uv_index,shortwave_radiation`,
  );
  const uv = num(data?.current?.uv_index);
  const solar = num(data?.current?.shortwave_radiation);
  return {
    label: `UV ${uv.toFixed(1)}`,
    values: {
      uv,
      solar,
    },
  };
}

async function fetchRoads() {
  const rows = await getJson('https://api.tfl.gov.uk/Road/all/Status');
  let good = 0;
  let serious = 0;
  for (const road of rows || []) {
    const sev = String(road?.statusSeverity || '').toLowerCase();
    if (sev === 'good') good += 1;
    if (sev === 'serious' || sev === 'severe' || sev === 'closure') serious += 1;
  }
  const n = (rows || []).length || 1;
  return {
    label: `${serious} serious / ${n}`,
    values: {
      disruption: clamp01(serious / Math.max(1, n * 0.35)),
      serious,
      good,
    },
  };
}

function fetchMoon() {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const days = (Date.now() - known) / 86400000;
  const phase = (((days % synodic) + synodic) % synodic) / synodic;
  const illum = 1 - Math.abs(phase * 2 - 1);
  return Promise.resolve({
    label: illum > 0.9 ? 'Full' : illum < 0.1 ? 'New' : `${Math.round(illum * 100)}%`,
    values: {
      phase: Math.round(phase * 1000) / 1000,
      illum: Math.round(illum * 1000) / 1000,
      full: illum > 0.9 ? 1 : 0,
    },
  });
}

async function fetchXray() {
  const rows = await getJson('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json');
  const long = (rows || []).filter((r) => r?.energy === '0.1-0.8nm');
  const last = long[long.length - 1] || {};
  const flux = num(last.flux);
  return {
    label: flux >= 1e-4 ? 'X-class' : flux >= 1e-5 ? 'M-class' : flux >= 1e-6 ? 'C-class' : 'Quiet',
    values: {
      flux,
      flare: flux >= 1e-6 ? 1 : 0,
    },
  };
}

async function fetchEonet() {
  const data = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
  const events = data?.events || [];
  const fires = events.filter((e) => (e.categories || []).some((c) => c.id === 'wildfires')).length;
  return {
    label: `${events.length} open events`,
    values: {
      count: events.length,
      fires,
    },
  };
}

async function fetchGbif() {
  const day = new Date().toISOString().slice(0, 10);
  const data = await getJson(`https://api.gbif.org/v1/occurrence/search?eventDate=${day}&limit=0`);
  const today = num(data?.count);
  return {
    label: `${today} today`,
    values: {
      today,
    },
  };
}

async function fetchWiki(prev) {
  const data = await getJson(
    'https://en.wikipedia.org/w/api.php?action=query&list=recentchanges&rclimit=1&format=json&origin=*',
  );
  const row = data?.query?.recentchanges?.[0] || {};
  const rcid = num(row.rcid);
  const last = prev?.values?.rcid;
  const delta = last ? Math.max(0, rcid - last) : 0;
  return {
    label: row.title || `rc ${rcid}`,
    values: {
      delta,
      rcid,
    },
  };
}

async function fetchNeo({ apiKey = 'DEMO_KEY' } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const key = encodeURIComponent(apiKey || 'DEMO_KEY');
  const data = await getJson(
    `https://api.nasa.gov/neo/rest/v1/feed?start_date=${day}&end_date=${day}&api_key=${key}`,
  );
  const list = data?.near_earth_objects?.[day] || [];
  const hazard = list.filter((o) => o?.is_potentially_hazardous_asteroid).length;
  return {
    label: `${list.length} NEO today`,
    values: {
      count: num(data?.element_count, list.length),
      hazard,
    },
  };
}

async function fetchFx({ pair = 'USD-PLN' } = {}) {
  const [base, quote] = String(pair || 'USD-PLN')
    .toUpperCase()
    .split(/[-_/]/);
  const from = base || 'USD';
  const to = quote || 'PLN';
  const data = await getJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
  const rate = num(data?.rates?.[to]);
  return {
    label: `1 ${from} = ${rate.toFixed(3)} ${to}`,
    values: {
      rate,
    },
  };
}

async function fetchMb() {
  const day = new Date().toISOString().slice(0, 10);
  const data = await getJson(`https://musicbrainz.org/ws/2/release?query=date:${day}&fmt=json&limit=1`);
  const count = num(data?.count);
  return {
    label: `${count} releases`,
    values: {
      count,
    },
  };
}

async function fetchCards() {
  const data = await getJson('https://deckofcardsapi.com/api/deck/new/draw/?count=1');
  const card = data?.cards?.[0] || {};
  const ranks = {
    ACE: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    JACK: 11,
    QUEEN: 12,
    KING: 13,
  };
  const suits = { SPADES: 0, HEARTS: 1, DIAMONDS: 2, CLUBS: 3 };
  const rank = ranks[card.value] || 1;
  const suit = suits[card.suit] ?? 0;
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS' ? 1 : 0;
  return {
    label: `${card.value || '?'} ${card.suit || ''}`.trim(),
    values: {
      rank,
      suit,
      red,
    },
  };
}

function requireKey(settings, label = 'API key') {
  const key = String(settings?.apiKey || '').trim();
  if (!key) throw new Error(`${label} required`);
  return key;
}

function utcDay(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function fetchOwm({ lat = 52.23, lon = 21.01, apiKey = '' } = {}) {
  const key = encodeURIComponent(requireKey({ apiKey }));
  const data = await getJson(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`,
  );
  const temp = num(data?.main?.temp);
  return {
    label: `${data?.name || 'OWM'} ${temp.toFixed(1)}°C`,
    values: {
      temp,
      humidity: num(data?.main?.humidity),
      wind: num(data?.wind?.speed),
      clouds: num(data?.clouds?.all),
    },
  };
}

async function fetchWaqi({ lat = 52.23, lon = 21.01, city = '', apiKey = '' } = {}) {
  const token = encodeURIComponent(requireKey({ apiKey }, 'WAQI token'));
  const citySlug = String(city || '').trim();
  const path = citySlug
    ? `feed/${encodeURIComponent(citySlug)}/`
    : `feed/geo:${lat};${lon}/`;
  const data = await getJson(`https://api.waqi.info/${path}?token=${token}`);
  if (data?.status !== 'ok') throw new Error(String(data?.data || 'WAQI error'));
  const aqi = num(data?.data?.aqi);
  const pm25 = num(data?.data?.iaqi?.pm25?.v);
  return {
    label: `${data?.data?.city?.name || citySlug || 'WAQI'} AQI ${aqi}`,
    values: {
      aqi,
      pm25,
    },
  };
}

async function fetchTomtom({ lat = 52.23, lon = 21.01, apiKey = '' } = {}) {
  const key = encodeURIComponent(requireKey({ apiKey }));
  const data = await getJson(
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${key}`,
  );
  const flow = data?.flowSegmentData || {};
  const speed = num(flow.currentSpeed);
  const freeFlow = num(flow.freeFlowSpeed, speed || 1);
  return {
    label: `${Math.round(speed)} / ${Math.round(freeFlow)} km/h`,
    values: {
      speed,
      freeFlow,
      jam: clamp01(1 - speed / Math.max(1, freeFlow)),
    },
  };
}

async function fetchHere({ lat = 52.23, lon = 21.01, apiKey = '' } = {}) {
  const key = encodeURIComponent(requireKey({ apiKey }));
  const data = await getJson(
    `https://data.traffic.hereapi.com/v7/flow?in=circle:${lat},${lon};r=1500&locationReferencing=none&apiKey=${key}`,
  );
  const rows = data?.results || [];
  let jam = 0;
  let speed = 0;
  let n = 0;
  for (const row of rows) {
    const flow = row?.currentFlow;
    if (!flow) continue;
    jam += num(flow.jamFactor);
    speed += num(flow.speed);
    n += 1;
  }
  if (!n) throw new Error('No HERE flow at this point');
  jam /= n;
  speed /= n;
  return {
    label: `Jam ${jam.toFixed(1)}`,
    values: {
      speed,
      jam,
    },
  };
}

async function fetchIpgeo({ lat = 52.23, lon = 21.01, apiKey = '' } = {}) {
  const key = encodeURIComponent(requireKey({ apiKey }));
  const data = await getJson(
    `https://api.ipgeolocation.io/astronomy?apiKey=${key}&lat=${lat}&long=${lon}`,
  );
  const sunAlt = num(data?.sun_altitude);
  const moonAlt = num(data?.moon_altitude);
  let illum = num(data?.moon_illumination);
  if (illum > 1) illum /= 100;
  const isDay = sunAlt > 0 ? 1 : 0;
  return {
    label: data?.moon_phase || (isDay ? 'Day' : 'Night'),
    values: {
      sunAlt,
      moonAlt,
      moonIllum: clamp01(illum),
      isDay,
    },
  };
}

async function fetchDonki({ apiKey = '' } = {}) {
  const key = encodeURIComponent(requireKey({ apiKey }));
  const start = utcDay(-7);
  const end = utcDay(0);
  const [flares, cmes] = await Promise.all([
    getJson(`https://api.nasa.gov/DONKI/FLR?startDate=${start}&endDate=${end}&api_key=${key}`),
    getJson(`https://api.nasa.gov/DONKI/CME?startDate=${start}&endDate=${end}&api_key=${key}`),
  ]);
  const flareN = Array.isArray(flares) ? flares.length : 0;
  const cmeN = Array.isArray(cmes) ? cmes.length : 0;
  return {
    label: `${flareN} flares / ${cmeN} CME`,
    values: {
      flares: flareN,
      cmes: cmeN,
    },
  };
}

async function fetchApod({ apiKey = 'DEMO_KEY' } = {}) {
  const key = encodeURIComponent(String(apiKey || '').trim() || 'DEMO_KEY');
  const data = await getJson(`https://api.nasa.gov/planetary/apod?api_key=${key}`);
  const video = String(data?.media_type || '') === 'video' ? 1 : 0;
  const hd = data?.hdurl ? 1 : 0;
  return {
    label: data?.title || 'APOD',
    values: { hd, video },
  };
}

async function fetchRandorg({ apiKey = '' } = {}) {
  const key = requireKey({ apiKey });
  const data = await postJson('https://api.random.org/json-rpc/4/invoke', {
    jsonrpc: '2.0',
    method: 'generateDecimalFractions',
    params: { apiKey: key, n: 1, decimalPlaces: 8 },
    id: 1,
  });
  if (data?.error) throw new Error(data.error.message || 'Random.org error');
  const value = num(data?.result?.random?.data?.[0]);
  return {
    label: value.toFixed(3),
    values: { value: Math.round(value * 1000) / 1000 },
  };
}

async function fetchImgw({ stationName = 'warszawa' } = {}) {
  const slug = String(stationName || 'warszawa')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const data = await getJson(`https://danepubliczne.imgw.pl/api/data/synop/station/${slug}`);
  const temp = num(data?.temperatura);
  return {
    label: `${data?.stacja || slug} ${temp.toFixed(1)}°C`,
    values: {
      temp,
      wind: num(data?.predkosc_wiatru),
      humidity: num(data?.wilgotnosc_wzgledna),
      precip: num(data?.suma_opadu),
    },
  };
}

async function fetchAq({ lat = 52.23, lon = 21.01 } = {}) {
  const data = await getJson(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=european_aqi,pm2_5,grass_pollen`,
  );
  const aqi = num(data?.current?.european_aqi);
  return {
    label: `EAQI ${aqi}`,
    values: {
      aqi,
      pm25: num(data?.current?.pm2_5),
      pollen: num(data?.current?.grass_pollen),
    },
  };
}

async function fetchPeople() {
  const data = await getJson(
    'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json',
  );
  const people = data?.people || [];
  const iss = people.filter((p) => p?.iss || String(p?.spacecraft || '').toUpperCase().includes('ISS')).length;
  const count = num(data?.number, people.length);
  return {
    label: `${count} in space`,
    values: {
      count,
      iss,
    },
  };
}

async function fetchAurora({ lat = 69.65, lon = 18.96 } = {}) {
  const data = await getJson('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
  const coords = data?.coordinates || [];
  const lo = Math.round(Number(lon));
  const la = Math.round(Number(lat));
  let local = 0;
  let max = 0;
  let best = 1e9;
  for (const row of coords) {
    const x = num(row?.[0]);
    const y = num(row?.[1]);
    const a = num(row?.[2]);
    if (a > max) max = a;
    const d = Math.abs(x - lo) + Math.abs(y - la);
    if (d < best) {
      best = d;
      local = a;
    }
  }
  return {
    label: `${Math.round(local)}% at ${la}°, ${lo}°`,
    values: {
      local,
      max,
    },
  };
}

async function fetchSolarwind() {
  const rows = await getJson('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json');
  const last = Array.isArray(rows) ? rows[rows.length - 1] : rows;
  const speed = num(last?.proton_speed ?? last?.Speed);
  return {
    label: `${Math.round(speed)} km/s`,
    values: {
      speed,
    },
  };
}

async function fetchTides({ stationId = 8518750 } = {}) {
  const id = encodeURIComponent(stationId || 8518750);
  const data = await getJson(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${id}` +
      `&product=water_level&datum=MLLW&time_zone=gmt&units=metric&format=json&application=oscgate`,
  );
  if (data?.error) throw new Error(data.error.message || 'NOAA tide error');
  const level = num(data?.data?.[0]?.v);
  const name = data?.metadata?.name || `Station ${stationId}`;
  return {
    label: `${name} ${level.toFixed(2)} m`,
    values: {
      level,
    },
  };
}

async function fetchFlood({ lat = 52.23, lon = 21.01 } = {}) {
  const data = await getJson(
    `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=1`,
  );
  const series = data?.daily?.river_discharge || [];
  const discharge = num(series[0]);
  return {
    label: `${discharge.toFixed(1)} m³/s`,
    values: {
      discharge,
    },
  };
}

async function fetchGithub(prev) {
  const rows = await getJson('https://api.github.com/events');
  const latest = num(rows?.[0]?.id);
  const last = prev?.values?.latest;
  const delta = last ? Math.max(0, latest - last) : 0;
  return {
    label: rows?.[0]?.type || `event ${latest}`,
    values: {
      delta,
      latest,
    },
  };
}

async function fetchCarbon() {
  const data = await getJson('https://api.carbonintensity.org.uk/intensity');
  const row = data?.data?.[0]?.intensity || {};
  const actual = num(row.actual, num(row.forecast));
  return {
    label: `${row.index || 'UK'} ${Math.round(actual)} g`,
    values: {
      actual,
      forecast: num(row.forecast),
    },
  };
}

async function fetchEth() {
  const data = await getJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true',
  );
  const row = data?.ethereum || {};
  const price = num(row.usd);
  const change = num(row.usd_24h_change);
  return {
    label: `$${Math.round(price)}`,
    values: {
      price,
      change,
    },
  };
}

async function fetchFng() {
  const data = await getJson('https://api.alternative.me/fng/?limit=1');
  const row = data?.data?.[0] || {};
  const value = num(row.value);
  return {
    label: row.value_classification || `F&G ${value}`,
    values: {
      value,
      greed: value >= 50 ? 1 : 0,
    },
  };
}

async function fetchMempool() {
  const data = await getJson('https://mempool.space/api/v1/fees/recommended');
  const fastest = num(data?.fastestFee);
  return {
    label: `${fastest} sat/vB`,
    values: {
      fastest,
      hour: num(data?.hourFee),
    },
  };
}

const JOKE_CATS = ['Programming', 'Misc', 'Dark', 'Pun', 'Spooky', 'Christmas'];

async function fetchJoke() {
  const data = await getJson('https://v2.jokeapi.dev/joke/Any?type=single');
  if (data?.error) throw new Error(data.message || 'JokeAPI error');
  const text = String(data?.joke || '');
  const cat = JOKE_CATS.indexOf(data?.category);
  return {
    label: text.slice(0, 48) || data?.category || 'joke',
    values: {
      length: text.length,
      category: cat < 0 ? 0 : cat,
      safe: data?.safe ? 1 : 0,
    },
  };
}

async function fetchYesno() {
  const data = await getJson('https://yesno.wtf/api');
  const yes = String(data?.answer || '').toLowerCase() === 'yes' ? 1 : 0;
  return {
    label: data?.answer || (yes ? 'yes' : 'no'),
    values: { yes },
  };
}

async function fetchNbp({ currency = 'USD' } = {}) {
  const code = encodeURIComponent(String(currency || 'USD').trim().toUpperCase());
  const data = await getJson(`https://api.nbp.pl/api/exchangerates/rates/a/${code}/?format=json`);
  const rate = num(data?.rates?.[0]?.mid);
  return {
    label: `1 ${data?.code || code} = ${rate.toFixed(3)} PLN`,
    values: {
      rate,
    },
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw httpError(res, url);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw httpError(res, url);
  return res.json();
}

function httpError(res, url) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (res.status === 401 || res.status === 403) return new Error(`Invalid API key (${host})`);
  return new Error(`${res.status} ${host}`);
}

void hnState;
