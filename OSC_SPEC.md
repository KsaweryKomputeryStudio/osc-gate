# osc-gate OSC Spec

Multipurpose data → OSC. All **DualSense outbound** values are **floats in `[0.0, 1.0]`**.  
Garmin HR is **bpm** by default, or **0–1** when Normalize HR is on. Trend is always **0–1**.  
Inbound DualSense control floats are expected in `[0.0, 1.0]` unless noted.

Architecture:

```
DualSense ──WebHID─────────▶┐
Garmin HR ──Web Bluetooth──▶┤
MacBook  ──WebHID/sensors──▶┼─ Browser ──WebSocket──▶ OSC Gateway ──UDP──▶ your app
Weather ──Open-Meteo──────▶┤         ◀───────────── OSC Gateway ◀──UDP── your app
Microphone ──Web Audio────▶┤
Time ──local clock────────▶┤
Human ──YOLO + camera─────▶┘
```

| Role | Default | Env |
|------|---------|-----|
| OSC send (browser → world) | `127.0.0.1:57121` (add more in UI) | `OSC_OUT_HOST` / `OSC_OUT_PORT` (first dest until UI connects) |
| OSC receive (world → browser) | `0.0.0.0:9001` (configurable in UI) | `OSC_IN_PORT` (until UI connects) |
| WebSocket bridge | `ws://127.0.0.1:8081` | `WS_PORT` |

Routing: each source (`controller` `/ds`, `garmin` `/garmin`, `macbook` `/mac`, `weather` `/weather`, `mic` `/mic`, `time` `/time`, `human` `/human`, plus auto-detected incoming UDP senders) can be toggled per destination. Missing cells are **on** (everything goes everywhere). Incoming packets on `:inPort` (default 9001) appear in the bottom monitor and are **passed through** to routed destinations. Rename or delete a sender in the monitor Sources row (default name is `IP:PORT`).

Address prefixes: `/ds` (DualSense), `/garmin` (heart rate), `/mac` (MacBook sensors), `/weather`, `/mic`, `/time`, `/human`, plus poll sources (`/tube`, `/roads`, `/sun`, `/moon`, `/kp`, `/xray`, `/quake`, `/eonet`, `/marine`, `/gbif`, `/hn`, `/wiki`, `/iss`, `/neo`, `/apod`, `/crypto`, `/fx`, `/lb`, `/mb`, `/rng`, `/cards`, `/gios`, `/imgw`, `/uv`, `/owm`, `/waqi`, `/tomtom`, `/here`, `/ipgeo`, `/donki`, `/randorg`, `/aq`, `/people`, `/aurora`, `/solarwind`, `/tides`, `/flood`, `/github`, `/carbon`, `/eth`, `/fng`, `/mempool`, `/joke`, `/yesno`, `/nbp`).

Each source **instance** in a session gets a numeric id: `/weather/1/temp`, `/weather/2/temp`. Sessions are saved/opened as JSON; the last session is restored on startup.

---

## Outbound (gateway → your IP:PORT)

Sent every HID input report as one OSC **bundle** (immediate time tag).

### Buttons — `0` or `1`

| Address | Meaning |
|---------|---------|
| `/ds/button/cross` | ✕ |
| `/ds/button/circle` | ○ |
| `/ds/button/square` | □ |
| `/ds/button/triangle` | △ |
| `/ds/button/l1` | L1 |
| `/ds/button/r1` | R1 |
| `/ds/button/l2` | L2 digital click |
| `/ds/button/r2` | R2 digital click |
| `/ds/button/l3` | Left stick click |
| `/ds/button/r3` | Right stick click |
| `/ds/button/create` | Create |
| `/ds/button/options` | Options |
| `/ds/button/ps` | PS |
| `/ds/button/touchpad` | Touchpad click |
| `/ds/button/mute` | Mute |

### D-pad

| Address | Args | Meaning |
|---------|------|---------|
| `/ds/dpad/up` | f | 0\|1 |
| `/ds/dpad/down` | f | 0\|1 |
| `/ds/dpad/left` | f | 0\|1 |
| `/ds/dpad/right` | f | 0\|1 |
| `/ds/dpad/hat` | f | hat index / 8 (0=N … 7=NW, 1.0≈rest/8) |

### Sticks — `0..1`, center ≈ `0.5` (deadzone applied at rest)

| Address | Args | Meaning |
|---------|------|---------|
| `/ds/stick/left/x` | f | 0=left, 0.5=center, 1=right |
| `/ds/stick/left/y` | f | 1=up, 0.5=center, 0=down |
| `/ds/stick/right/x` | f | |
| `/ds/stick/right/y` | f | 1=up, 0.5=center, 0=down |

### Analog triggers — `0..1`

| Address | Args |
|---------|------|
| `/ds/trigger/l2/value` | f (analog pressure) |
| `/ds/trigger/r2/value` | f (analog pressure) |

### Touchpad

| Address | Args | Meaning |
|---------|------|---------|
| `/ds/touch/0/active` | f | finger 1 down |
| `/ds/touch/0/x` | f | only while active |
| `/ds/touch/0/y` | f | only while active |
| `/ds/touch/1/*` | | same for finger 2 |

### Motion — disabled when **Ignore IMU** is on

| Address | Args |
|---------|------|
| `/ds/gyro/x` `/ds/gyro/y` `/ds/gyro/z` | f |
| `/ds/accel/x` `/ds/accel/y` `/ds/accel/z` | f |

> Gyro/accel noise changes every HID report. Leave **Ignore IMU** enabled unless you need motion — otherwise the receiver floods and latency builds.

### Battery / meta

| Address | Args |
|---------|------|
| `/ds/battery/level` | f 0..1 |
| `/ds/battery/charging` | f 0\|1 |
| `/ds/connected` | f always 1 while streaming |

Gateway packs each frame into **one OSC #bundle UDP packet** (like Data OSC). For discrete per-address packets set `OSC_DISCRETE=1`.

---

## Garmin HR — `/garmin`

Requires **Broadcast Heart Rate** on the watch (Sensors → Heart Rate → Broadcast) and a BLE connection from the browser. Disconnect Garmin Connect / the phone first.

| Address | Args | Meaning |
|---------|------|---------|
| `/garmin/hr` | f | Heart rate. **bpm** by default, or **0–1** if Normalize HR is on (mapped through configurable min/max, default 40–200). |
| `/garmin/trend` | f | Change over the trend window, **always 0–1**. `0.5` = no change, `0` = falling by the configured ±bpm range, `1` = rising by that range. Window is configurable (default 30 s, range ±20 bpm). Optional **Smooth trend** eases the float toward the window value over a time constant (default 2 s) so it does not jump with each BPM update. |
| `/garmin/push_beat` | f | Beat trigger: `1` on each beat, then `0` (~40 ms). Uses RR-intervals when the sensor provides them, otherwise a clock from current BPM. |

---

## MacBook sensors — `/mac`

Chrome **WebHID** on this sensor is limited to about **1 Hz**. osc-gate reads the hinge in the **local gateway** with hidapi (same path as the native lid-angle demos) and streams samples to the UI over WebSocket. Keep `./run` going, then Connect MacBook.

Internal accelerometer / gyro (AppleSPU) are usually **not** exposed to the browser (macOS keeps them for the Sensor Processing Unit; native tools need admin). If Chrome or the Generic Sensor API does expose motion or ambient light, those addresses are sent too.

| Address | Args | Meaning |
|---------|------|---------|
| `/mac/lid/angle` | f | Hinge angle in **degrees** (~0 closed, ~90 laptop, ~180 flat back). |
| `/mac/lid/open` | f | `0` closed (below the closed-threshold, default 12°), `1` open. |
| `/mac/lid/norm` | f | Angle mapped **0–1** through configurable max (default 180°). |
| `/mac/accel/x` `/mac/accel/y` `/mac/accel/z` | f | Linear acceleration in **g**, only if the browser can see an IMU. |
| `/mac/gyro/x` `/mac/gyro/y` `/mac/gyro/z` | f | Angular velocity, only if available. |
| `/mac/als` | f | Ambient light (lux), only if available. |

---

## Weather — `/weather`

Pick a point on the map (or search). Current conditions come from [Open-Meteo](https://open-meteo.com) (no API key). Enable which addresses to send in the sidebar. Values refresh on each fetch (default 60 s) and are re-sent about once a second while Fetch is running.

| Address | Args | Meaning |
|---------|------|---------|
| `/weather/temp` | f | Air temperature °C |
| `/weather/feels` | f | Apparent temperature °C |
| `/weather/humidity` | f | Relative humidity **0–100** |
| `/weather/humidity/norm` | f | Humidity **0–1** |
| `/weather/wind/speed` | f | Wind speed km/h |
| `/weather/wind/dir` | f | Wind direction **0–360** |
| `/weather/wind/dir/norm` | f | Wind direction **0–1** |
| `/weather/wind/gust` | f | Wind gusts km/h |
| `/weather/clouds` | f | Cloud cover **0–100** |
| `/weather/pressure` | f | Mean sea-level pressure hPa |
| `/weather/precip` | f | Precipitation mm |
| `/weather/code` | f | WMO weather code |
| `/weather/is_day` | f | `1` day, `0` night |
| `/weather/lat` | f | Selected latitude |
| `/weather/lon` | f | Selected longitude |

---

## Microphone — `/mic`

Browser input via Web Audio. Level is RMS × sensitivity, clamped to **0–1**. Peak is a short hold of the instantaneous peak.

| Address | Args | Meaning |
|---------|------|---------|
| `/mic/level` | f | Smoothed volume **0–1** |
| `/mic/peak` | f | Peak hold **0–1** |

---

## Time — `/time`

Local-timezone calendar progress as **0–1**. `0` is the start of the period, `1` is the next boundary. Week starts Monday by default (Sunday optional). Enable which addresses to send in the sidebar.

| Address | Args | Meaning |
|---------|------|---------|
| `/time/hour` | f | Start of hour → next hour |
| `/time/day` | f | Midnight → next midnight |
| `/time/week` | f | Start of week 00:00 → next week |
| `/time/month` | f | 1st 00:00 → next month |
| `/time/year` | f | Jan 1 00:00 → next year |

---

## Human count — `/human`

Webcam + **YOLOv8n** (COCO person class) in the browser via ONNX Runtime. First connect downloads the model. Confidence is adjustable.

| Address | Args | Meaning |
|---------|------|---------|
| `/human/count` | f | People in frame. Raw integer, or 0–1 when Auto/Manual normalize is on |
| `/human/present` | f | `1` if raw count ≥ 1, else `0` (not scaled) |

---

## Inbound (your app → gateway `:9001` → controller)

Send OSC UDP to the gateway **in** port (default **9001**, set in OSC Configuration). Values are floats `0..1` unless noted.
The bottom **Incoming OSC** dock shows these packets (raw log or compact per-address list + sparkline). New senders are added as sources (`IP:PORT`, rename / delete). Routed destinations receive a **passthrough** copy of the same packet.

### Haptics / rumble

| Address | Args | Effect |
|---------|------|--------|
| `/ds/rumble` | f f | left, right motor intensity |
| `/ds/haptics` | f f | alias of `/ds/rumble` |
| `/ds/rumble/left` | f | left only |
| `/ds/rumble/right` | f | right only |
| `/ds/rumble/stop` | — | both motors off |
| `/ds/haptics/stop` | — | alias |

`1.0` → full rumble (HID byte 255).

### Adaptive triggers

| Address | Args | Effect |
|---------|------|--------|
| `/ds/trigger/l2/preset` | s | `"off"` \| `"rigid"` \| `"pulse"` \| `"vibration"` \| `"feedback"` |
| `/ds/trigger/r2/preset` | s | same |
| `/ds/trigger/l2` | s | same as preset (string arg) |
| `/ds/trigger/l2` | f | `0` = off; `>0` = rigid with strength = f |
| `/ds/trigger/r2` | s\|f | same for R2 |
| `/ds/trigger/l2/effect` | f×8 | mode, p1..p7 → bytes (values `>1` treated as raw 0..255) |
| `/ds/trigger/r2/effect` | f×8 | same |

**Preset examples**

```
/ds/trigger/l2/preset rigid
/ds/trigger/r2/preset pulse
/ds/trigger/l2/preset off
```

**Custom effect** (mode + 7 params as 0..1):

```
/ds/trigger/r2/effect 0.149 0.564 0.627 1.0 0 0 0 0.039
```

(`0.149≈0x26`, etc.)

### Lightbar / LEDs

| Address | Args | Effect |
|---------|------|--------|
| `/ds/lightbar` | f f f | R, G, B |
| `/ds/lightbar/r` | f | red only |
| `/ds/lightbar/g` | f | green only |
| `/ds/lightbar/b` | f | blue only |
| `/ds/playerleds` | f | bitmask 0..1 → 0..31 |
| `/ds/playerleds` | f f f f f | five LED on/off (≥0.5 = on) |
| `/ds/mute` | f | ≥0.5 mute LED on |

---

## Quick start

```bash
./run                    # OSC gateway + web UI
```

1. Open `http://localhost:5173`
2. Header → **Edit** destinations / routing → click the IP to start streaming
3. Connect DualSense and/or Garmin HR from the left menu
4. Listen on `udp://IP:PORT` (default `127.0.0.1:57121`)
5. Send DualSense feedback to `udp://127.0.0.1:9001`

### Example: TouchDesigner / Max / Resolume

- Listen UDP **57121** for `/ds/...`, `/garmin/...`, `/weather/...`, `/mic/...`, `/time/...`, `/human/...`
- Send UDP **9001** e.g. `/ds/rumble 0.5 0.2`

### Example: Python (python-osc)

```python
from pythonosc import udp_client, dispatcher, osc_server

client = udp_client.SimpleUDPClient("127.0.0.1", 9001)
client.send_message("/ds/rumble", [0.8, 0.3])
client.send_message("/ds/trigger/l2/preset", "rigid")
client.send_message("/ds/lightbar", [0.0, 0.3, 1.0])
```

---

## Normalization reference

| Source | Formula |
|--------|---------|
| Button | `pressed ? 1 : 0` |
| Stick axis | `raw / 255` |
| Trigger | `raw / 255` |
| Touch X | `x / 1919` |
| Touch Y | `y / 1079` |
| Gyro/Accel | `(int16 + 32768) / 65535` |
| Battery | `percent / 100` |
| Adaptive state | `state / 15` |
| Inbound rumble/color | `round(f * 255)` → HID byte |
