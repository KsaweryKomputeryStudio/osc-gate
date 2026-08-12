# pad-to-osc

DualSense WebHID tester with OSC gateway — browser-based PS5 controller testing and normalized OSC output.

## macOS / Linux

```bash
chmod +x scripts/*.sh   # first time only
./scripts/install.sh    # npm install
./scripts/run.sh        # gateway + web UI
```

Or via npm:

```bash
npm run install:mac
npm run run:mac
```

Use **Chrome** or **Edge** on desktop. Connect DualSense via USB or Bluetooth, then open the OSC tab to configure output.

See `OSC_SPEC.md` for the full OSC address list.
