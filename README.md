# DATA-DRIVER

Multipurpose **data → OSC** gateway. Browser sources (DualSense, Garmin heart rate, …) stream to UDP OSC through a local WebSocket gateway.

## macOS / Linux

```bash
chmod +x run scripts/*.sh   # first time only
./scripts/install.sh        # npm install
./run                       # gateway + web UI
```

Use **Chrome** or **Edge** on desktop.

## Raspberry Pi

Run the gateway on the Pi (same `./run`). Add **Encoder** from the Raspberry category and set BCM GPIO for CLK, DT, SW (KY-040: also 3V3 and GND). The first GPIO backend is Raspberry Pi OS `pinctrl`; if that is missing, `npm i onoff` is a fallback. You may need:

```bash
sudo usermod -aG gpio $USER
```

Then log out and back in. Restart the gateway after install so it picks up GPIO.

- **Controller** — DualSense via USB or Bluetooth (WebHID). Ignore IMU lives here.
- **Garmin HR** — watch Broadcast Heart Rate over Bluetooth LE (standard Heart Rate service). Disconnect Garmin Connect / the phone first.
- **MacBook** — lid angle via the local gateway (fast). Chrome WebHID is a slow fallback (~1 Hz). 2019+ MacBooks.
- **Weather** — click a point on the map (or search). Current conditions from Open-Meteo; pick which `/weather/…` addresses to send.
- **Microphone** — selected input volume as `/mic/level` and `/mic/peak` (0–1).
- **Soundcard** (beta) — multi-channel input via the local gateway. `/soundcard/ch/1` … level and peak. Restart `./run` after install.
- **Time** — local hour / day / week / month / year progress as 0–1 (`/time/hour`, `/time/day`, `/time/week`, …).
- **Human count** — webcam + YOLOv8n person detector. Sends `/human/count` (raw, auto 0–1, or manual 0–1) and `/human/present`.
- **Hands** — webcam + MediaPipe. Left/right palm, pinch, grab, fingertips, and gestures as 0–1 (`/hands/left/…`, `/hands/right/…`).
- **Encoder** (Raspberry Pi) — KY-040-style rotary encoder + switch on BCM GPIO (`CLK` / `DT` / `SW`). RAW: CW / CCW / switch triggers. MODESELECTOR: switch cycles named signals, rotation sets 0–1. Run the gateway on the Pi.
- **Sessions** — New / Open / Save in the header. A new session starts empty. Press **1** (or **+**) to add sources. Copies of the same type get OSC ids (`/weather/1/…`). The last session reloads on startup.
- **Output** — right panel charts the selected source’s outgoing signals.
- **OSC** — start/stop streaming from the header. **Edit** sets the UDP input port, destinations, and a routing matrix (sources × destinations; default all → all). Incoming UDP is shown in the bottom dock and passed through to routed destinations.

Settings are stored in the browser and restored on reload.

See `OSC_SPEC.md` for addresses (`/ds/…`, `/garmin/…`, `/mac/…`, `/weather/…`, `/mic/…`, `/soundcard/…`, `/encoder/…`, `/time/…`, `/human/…`, `/hands/…`).
