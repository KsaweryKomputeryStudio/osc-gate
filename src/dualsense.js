export const VENDOR_ID_SONY = 0x054c;
export const PRODUCT_IDS = {
  DUALSENSE: 0x0ce6,
  DUALSENSE_EDGE: 0x0df2,
};

export const USAGE_PAGE_GENERIC_DESKTOP = 0x0001;
export const USAGE_ID_GD_GAME_PAD = 0x0005;

export const USB_INPUT_REPORT_SIZE = 63;
export const BT_INPUT_REPORT_01_SIZE = 9;
export const BT_INPUT_REPORT_31_SIZE = 77;

const TRIGGER_EFFECT_PRESETS = {
  off: { mode: 0x00, params: [0, 0, 0, 0, 0, 0, 0] },
  rigid: { mode: 0x01, params: [0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00] },
  pulse: { mode: 0x26, params: [0x90, 0xa0, 0xff, 0x00, 0x00, 0x00, 0x0a] },
  vibration: { mode: 0x26, params: [0x02, 0x90, 0xa0, 0xff, 0x00, 0x00, 0x0a] },
  feedback: { mode: 0x21, params: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
};

function makeCrcTable() {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

let crcTable;

function crc32(prefixBytes, dataView) {
  if (!crcTable) crcTable = makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of prefixBytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  for (let i = 0; i < dataView.byteLength; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ dataView.getUint8(i)) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fillDualSenseChecksum(reportId, reportData) {
  const crc = crc32([0xa2, reportId], new DataView(reportData.buffer, 0, reportData.byteLength - 4));
  reportData[reportData.byteLength - 4] = crc & 0xff;
  reportData[reportData.byteLength - 3] = (crc >>> 8) & 0xff;
  reportData[reportData.byteLength - 2] = (crc >>> 16) & 0xff;
  reportData[reportData.byteLength - 1] = (crc >>> 24) & 0xff;
}

function int16(lo, hi) {
  let v = (hi << 8) | lo;
  if (v > 0x7fff) v -= 0x10000;
  return v;
}

function parseTouch(touchBytes) {
  const [b0, b1, b2, b3] = touchBytes;
  return {
    active: !(b0 & 0x80),
    id: b0 & 0x7f,
    x: ((b2 & 0x0f) << 8) | b1,
    y: (b3 << 4) | ((b2 & 0xf0) >> 4),
  };
}

function parseButtons(buttons0, buttons1, buttons2) {
  const dpad = buttons0 & 0x0f;
  return {
    dpad: {
      up: dpad === 0 || dpad === 1 || dpad === 7,
      down: dpad === 3 || dpad === 4 || dpad === 5,
      left: dpad === 5 || dpad === 6 || dpad === 7,
      right: dpad === 1 || dpad === 2 || dpad === 3,
      value: dpad,
    },
    square: !!(buttons0 & 0x10),
    cross: !!(buttons0 & 0x20),
    circle: !!(buttons0 & 0x40),
    triangle: !!(buttons0 & 0x80),
    l1: !!(buttons1 & 0x01),
    r1: !!(buttons1 & 0x02),
    l2: !!(buttons1 & 0x04),
    r2: !!(buttons1 & 0x08),
    create: !!(buttons1 & 0x10),
    options: !!(buttons1 & 0x20),
    l3: !!(buttons1 & 0x40),
    r3: !!(buttons1 & 0x80),
    ps: !!(buttons2 & 0x01),
    touchpad: !!(buttons2 & 0x02),
    mute: !!(buttons2 & 0x04),
  };
}

function parseFullReport(report, offset = 0) {
  const g = (i) => report.getUint8(offset + i);
  const buttons = parseButtons(g(7), g(8), g(9));
  const l2Feedback = g(42);
  const r2Feedback = g(41);
  const battery0 = g(52);
  const battery1 = g(53);

  return {
    sticks: {
      left: { x: g(0), y: g(1) },
      right: { x: g(2), y: g(3) },
    },
    triggers: { l2: g(4), r2: g(5) },
    seqNumber: g(6),
    buttons,
    gyro: {
      x: int16(g(15), g(16)),
      y: int16(g(17), g(18)),
      z: int16(g(19), g(20)),
    },
    accel: {
      x: int16(g(21), g(22)),
      y: int16(g(23), g(24)),
      z: int16(g(25), g(26)),
    },
    sensorTimestamp: (g(27) | (g(28) << 8) | (g(29) << 16) | (g(30) << 24)) >>> 0,
    touch: [
      parseTouch([g(32), g(33), g(34), g(35)]),
      parseTouch([g(36), g(37), g(38), g(39)]),
    ],
    adaptiveTriggers: {
      l2: { force: !!(l2Feedback & 0x10), state: l2Feedback & 0x0f },
      r2: { force: !!(r2Feedback & 0x10), state: r2Feedback & 0x0f },
    },
    battery: {
      level: ((battery0 & 0x0f) * 100) / 8,
      full: !!(battery0 & 0x20),
      charging: !!(battery1 & 0x08),
      raw: [battery0, battery1],
    },
  };
}

function parseBtMinimalReport(report) {
  const g = (i) => report.getUint8(i);
  const buttons = parseButtons(g(4), g(5), g(6));
  return {
    sticks: {
      left: { x: g(0), y: g(1) },
      right: { x: g(2), y: g(3) },
    },
    triggers: { l2: g(7), r2: g(8) },
    buttons,
    gyro: null,
    accel: null,
    touch: null,
    adaptiveTriggers: null,
    battery: null,
    minimal: true,
  };
}

export function detectConnectionType(collections) {
  for (const c of collections) {
    if (c.usagePage !== USAGE_PAGE_GENERIC_DESKTOP || c.usage !== USAGE_ID_GD_GAME_PAD) {
      continue;
    }
    const maxBits = c.inputReports.reduce((max, report) => {
      return Math.max(
        max,
        report.items.reduce((sum, item) => sum + item.reportSize * item.reportCount, 0),
      );
    }, 0);
    if (maxBits === 504) return 'usb';
    if (maxBits === 616) return 'bluetooth';
  }
  return 'unknown';
}

export function parseInputReport(reportId, data, connectionType) {
  if (connectionType === 'usb' && reportId === 0x01 && data.byteLength === USB_INPUT_REPORT_SIZE) {
    return { ...parseFullReport(data), reportId, connectionType };
  }
  if (connectionType === 'bluetooth') {
    if (reportId === 0x01 && data.byteLength === BT_INPUT_REPORT_01_SIZE) {
      return { ...parseBtMinimalReport(data), reportId, connectionType };
    }
    if (reportId === 0x31 && data.byteLength === BT_INPUT_REPORT_31_SIZE) {
      return { ...parseFullReport(data, 1), reportId, connectionType };
    }
  }
  return null;
}

export function normalizeStick(value) {
  return (2 * value) / 0xff - 1;
}

export function normalizeTrigger(value) {
  return value / 0xff;
}

export class DualSenseDevice {
  constructor(hidDevice) {
    this.device = hidDevice;
    this.connectionType = detectConnectionType(hidDevice.collections);
    this.outputSeq = 0;
    this.output = {
      lightbar: { r: 0, g: 80, b: 255 },
      playerLeds: 0x0a,
      muteLed: false,
      motorLeft: 0,
      motorRight: 0,
      l2Effect: { ...TRIGGER_EFFECT_PRESETS.off, side: 'l2' },
      r2Effect: { ...TRIGGER_EFFECT_PRESETS.off, side: 'r2' },
    };
    this.onInput = null;
    this.onDisconnect = null;
    this._outputLoop = null;
  }

  static filters() {
    return Object.values(PRODUCT_IDS).map((productId) => ({
      vendorId: VENDOR_ID_SONY,
      productId,
      usagePage: USAGE_PAGE_GENERIC_DESKTOP,
      usage: USAGE_ID_GD_GAME_PAD,
    }));
  }

  static isDualSense(device) {
    return (
      device.vendorId === VENDOR_ID_SONY &&
      Object.values(PRODUCT_IDS).includes(device.productId)
    );
  }

  async open() {
    if (!this.device.opened) {
      await this.device.open();
    }
    if (this.connectionType === 'bluetooth') {
      try {
        await this.device.receiveFeatureReport(0x05);
      } catch {
        // Another client may have already enabled full BT reports.
      }
    }
    this.device.addEventListener('inputreport', (event) => {
      const state = parseInputReport(event.reportId, event.data, this.connectionType);
      if (state && this.onInput) {
        this.onInput(state, event);
      }
    });
    this.startOutputLoop();
  }

  async close() {
    this.stopOutputLoop();
    if (this.device.opened) {
      await this.device.close();
    }
  }

  setLightbar(r, g, b) {
    this.output.lightbar = { r, g, b };
  }

  setPlayerLeds(mask) {
    this.output.playerLeds = mask;
  }

  setMuteLed(on) {
    this.output.muteLed = on;
  }

  setRumble(left, right) {
    this.output.motorLeft = left;
    this.output.motorRight = right;
  }

  setTriggerEffect(side, presetName) {
    const preset = TRIGGER_EFFECT_PRESETS[presetName] ?? TRIGGER_EFFECT_PRESETS.off;
    const target = side === 'l2' ? 'l2Effect' : 'r2Effect';
    this.output[target] = { ...preset, side };
  }

  setTriggerEffectCustom(side, mode, params) {
    const target = side === 'l2' ? 'l2Effect' : 'r2Effect';
    this.output[target] = { mode, params: [...params], side };
  }

  startOutputLoop(intervalMs = 16) {
    this.stopOutputLoop();
    this._outputLoop = setInterval(async () => {
      try {
        await this.sendOutputReport();
      } catch {
        this.onDisconnect?.();
      }
    }, intervalMs);
  }

  stopOutputLoop() {
    if (this._outputLoop) {
      clearInterval(this._outputLoop);
      this._outputLoop = null;
    }
  }

  buildOutputReport() {
    const { output, connectionType } = this;
    let reportId;
    let reportData;
    let common;
    let l2Effect;
    let r2Effect;

    if (connectionType === 'bluetooth') {
      reportId = 0x31;
      reportData = new Uint8Array(77);
      reportData[0] = this.outputSeq << 4;
      this.outputSeq = (this.outputSeq + 1) % 16;
      reportData[1] = 0x10;
      common = new DataView(reportData.buffer, 2, 47);
      r2Effect = new DataView(common.buffer, 12, 8);
      l2Effect = new DataView(common.buffer, 23, 8);
    } else {
      reportId = 0x02;
      reportData = new Uint8Array(47);
      common = new DataView(reportData.buffer, 0, 47);
      r2Effect = new DataView(common.buffer, 10, 8);
      l2Effect = new DataView(common.buffer, 21, 8);
    }

    common.setUint8(0, 0xff);
    common.setUint8(1, 0xf7);
    common.setUint8(2, output.motorRight);
    common.setUint8(3, output.motorLeft);
    common.setUint8(8, output.muteLed ? 0x01 : 0x00);
    common.setUint8(9, output.muteLed ? 0x00 : 0x10);

    const writeEffect = (view, effect) => {
      view.setUint8(0, effect.mode);
      for (let i = 0; i < 7; i++) {
        view.setUint8(i + 1, effect.params[i] ?? 0);
      }
    };

    writeEffect(r2Effect, output.r2Effect);
    writeEffect(l2Effect, output.l2Effect);

    common.setUint8(39, 0x02);
    common.setUint8(41, 0x02);
    common.setUint8(43, output.playerLeds);
    common.setUint8(44, output.lightbar.r);
    common.setUint8(45, output.lightbar.g);
    common.setUint8(46, output.lightbar.b);

    if (connectionType === 'bluetooth') {
      fillDualSenseChecksum(reportId, reportData);
    }

    return { reportId, reportData };
  }

  async sendOutputReport() {
    if (!this.device.opened) return false;
    const { reportId, reportData } = this.buildOutputReport();
    await this.device.sendReport(reportId, reportData);
    return reportData;
  }

  async readFeatureReport(id) {
    return this.device.receiveFeatureReport(id);
  }
}

export { TRIGGER_EFFECT_PRESETS };
