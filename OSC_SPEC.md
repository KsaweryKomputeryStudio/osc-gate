# DualSense OSC Spec

All **outbound** values are **floats in `[0.0, 1.0]`**.  
All **inbound** control floats are also expected in `[0.0, 1.0]` unless noted.

Architecture:

```
DualSense ──WebHID──▶ Browser ──WebSocket──▶ OSC Gateway ──UDP──▶ your app
                              ◀───────────── OSC Gateway ◀──UDP── your app
```

| Role | Default | Env |
|------|---------|-----|
| OSC send (controller → world) | `127.0.0.1:9000` | `OSC_OUT_HOST` / `OSC_OUT_PORT` |
| OSC receive (world → controller) | `0.0.0.0:9001` | `OSC_IN_PORT` |
| WebSocket bridge | `ws://127.0.0.1:8081` | `WS_PORT` |

Address prefix: `/ds`

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
| `/ds/stick/left/y` | f | 0=up, 0.5=center, 1=down |
| `/ds/stick/right/x` | f | |
| `/ds/stick/right/y` | f | |

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

## Inbound (your app → gateway `:9001` → controller)

Send OSC UDP to the gateway **in** port. Values are floats `0..1` unless noted.

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
npm run gateway          # OSC + WebSocket bridge
npm run dev              # WebHID UI
```

1. Start gateway, then open `http://localhost:5173`
2. Connect DualSense
3. OSC tab → set **Out IP / Port** → **Connect gateway** → enable **Stream OSC**
4. Listen on `udp://IP:PORT` (default `127.0.0.1:9000`)
5. Send feedback to `udp://127.0.0.1:9001`

### Example: TouchDesigner / Max / Resolume

- Listen UDP **9000** for `/ds/...`
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
