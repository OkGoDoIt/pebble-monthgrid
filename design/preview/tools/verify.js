#!/usr/bin/env node
'use strict';
// Renders the face for each reference screenshot's settings and data and
// counts the pixels that differ from the emulator's PNG.
//
//   node tools/verify.js            # table of every reference
//   node tools/verify.js th_classic --diff /tmp/out   # also writes ref|ours|diff PNGs
//
// The references are SDK-emulator screenshots, which pebble-tool colour-
// corrects, so the face is rendered with opts.corrected = true.

const path = require('path');
const fs = require('fs');
const Face = require('../monthgrid-face.js');
const { readPNG, writePNG } = require('./png.js');

const APP = path.resolve(__dirname, '../../..');
const SETTINGS_DIR = path.join(APP, 'screenshots/settings');
const PLUGINS_DIR = path.join(APP, 'docs/mockups/plugins');
const STORE_DIR = path.join(APP, 'screenshots/storefront/emery');
const M = Face.METRIC;

// The settings gallery was shot on 2026-08-30 with the emulator's clock set
// to Thursday 2026-08-27 12:13 PM: battery 90%, 68°F clear.
const AUG = {
  now: new Date(2026, 7, 27, 12, 13, 37),
  battery: { percent: 90, charging: false },
  weather: { temp_dc: 200, cond: Face.COND.CLEAR },
};

// The gallery predates the 2026-09-01 icon work (commits 6d50200..43d991e):
// the battery bar was the theme foreground with no third-width floor, and
// steps were two rounded soles. Drawn the old way only for these shots.
function iconsAug30(sf, metric, x, y, z, fg, bg, state) {
  if (metric === M.BATTERY && !(state.battery && state.battery.charging)) {
    const bw = Math.trunc(z * 13 / 10), bh = Math.trunc(z / 2) + 1, by = y + Math.trunc((z - bh) / 2);
    Face.drawRect(sf, Face.rect(x, by, bw, bh), fg);
    Face.fillRect(sf, Face.rect(x + bw, by + Math.trunc(bh / 3), 2, bh - Math.trunc(2 * bh / 3)), fg);
    const fw = Math.trunc((bw - 4) * state.battery.percent / 100);
    if (fw > 0) { Face.fillRect(sf, Face.rect(x + 2, by + 2, fw, bh - 4), fg); }
    return;
  }
  if (metric === M.STEPS) {
    const w = Math.trunc(z * 3 / 10) + 1, h = Math.trunc(z * 45 / 100);
    Face.fillRect(sf, Face.rect(x + Math.trunc(z / 8), y + Math.trunc(z / 10), w, h), fg, Math.trunc(w / 2));
    Face.fillRect(sf, Face.rect(x + Math.trunc(z * 55 / 100), y + Math.trunc(z * 45 / 100), w, h), fg,
                  Math.trunc(w / 2));
    return;
  }
  if (metric === M.CONNECTION) {   // phone outline, crossed out
    Face.drawRect(sf, Face.rect(x + Math.trunc(z / 4), y + Math.trunc(z / 10), Math.trunc(z / 2),
                                z - Math.trunc(z / 5)), fg);
    Face.drawLine(sf, x, y, x + z - 1, y + z - 1, fg);
    Face.drawLine(sf, x + z - 1, y, x, y + z - 1, fg);
    return;
  }
  Face.drawIcon(sf, metric, x, y, z, fg, bg, state);
}

const aug = (settings, extra) => ({ settings, data: Object.assign({}, AUG, extra || {}), opts: { drawIcon: iconsAug30 } });

// September 2026 for the marker shots (today = Thursday the 3rd). Counts per
// calendar for each day, read off the reference.
const SEP_DOTS = [];
[[4, 1, 0, 0], [8, 0, 1, 0], [11, 1, 0, 0], [12, 0, 0, 1], [16, 1, 1, 0], [18, 1, 0, 0],
 [24, 0, 1, 0], [25, 1, 0, 1]].forEach(([day, a, b, c]) => { SEP_DOTS[day - 1] = [a, b, c]; });

const FEB_DOTS = [];
[[3, 1, 0, 0], [6, 0, 1, 0], [10, 0, 0, 1], [14, 1, 1, 0], [20, 0, 1, 0], [24, 1, 0, 0],
 [27, 0, 0, 1]].forEach(([day, a, b, c]) => { FEB_DOTS[day - 1] = [a, b, c]; });

const CASES = {
  th_classic: aug({}),
  th_paper: aug({ THEME: 1 }),
  th_amber: aug({ THEME: 2 }),
  th_ice: aug({ THEME: 3 }),
  th_crimson: aug({ THEME: 4 }),
  th_midnight: aug({ THEME: 5 }),
  th_terminal: aug({ THEME: 6 }),
  th_sunset: aug({ THEME: 7 }),
  th_violet: aug({ THEME: 8 }),
  th_newsprint: aug({ THEME: 9 }),
  th_custom: aug({ THEME: 10 }),
  font_digital: aug({ TIME_FONT: 1 }),
  font_pixel: aug({ TIME_FONT: 2 }),
  font_bithamb: aug({ TIME_FONT: 3 }),
  font_bithaml: aug({ TIME_FONT: 4 }),
  size_medium: aug({ TIME_SIZE: 1 }),
  size_small: aug({ TIME_SIZE: 2 }),
  bs_plain: aug({ BANNER_STYLE: 1 }),
  bs_ruled: aug({ BANNER_STYLE: 2 }),
  bc_month_day: aug({ BANNER_CONTENT: 1 }),
  bc_wd_md: aug({ BANNER_CONTENT: 2 }),
  bc_md_year: aug({ BANNER_CONTENT: 3 }),
  bc_wd_md_year: aug({ BANNER_CONTENT: 4 }),
  bc_numeric: aug({ BANNER_CONTENT: 5 }),
  grid_on: aug({ GRID_LINES: 1 }),
  grid_adj: aug({ GRID_LINES: 1, SHOW_ADJACENT: 1 }),
  grid_color: aug({ GRID_LINES: 1, GRID_COLOR: '0x00AAFF' }),
  grid_paper: aug({ GRID_LINES: 1, THEME: 1 }),
  adj_on: aug({ SHOW_ADJACENT: 1 }),
  hdr_one: aug({ HEADER_LABEL: 1 }),
  start_monday: aug({ START_DAY: 1 }),
  start_saturday: aug({ START_DAY: 2 }),
  secs_on: aug({ SHOW_SECONDS: 1 }),
  fmt_24h: aug({ TIME_FORMAT: 2, TEMP_UNIT: 0 }, { now: new Date(2026, 7, 27, 17, 30) }),
  status_five: aug({ METRIC3: M.STEPS, METRIC4: M.HEART_RATE, METRIC5: M.DISTANCE },
                   { health: { steps: 8432 } }),
  mk_underline: aug({ DOTS_ENABLED: 1 }, { now: new Date(2026, 8, 3, 12, 13), dots: { days: SEP_DOTS } }),
  mk_squares: aug({ DOTS_ENABLED: 1, DOTS_STYLE: 1 },
                  { now: new Date(2026, 8, 3, 12, 13), dots: { days: SEP_DOTS } }),

  // Store screenshots (screenshots/storefront/README.md), shot 2026-08-30.
  '1_ice_overview': Object.assign(aug({ THEME: 3, BANNER_CONTENT: 3, METRIC2: M.HEART_RATE, METRIC3: M.WEATHER },
                                      { health: { heartRate: 72 } }), { dir: STORE_DIR }),
  '2_events_dots': Object.assign(aug(
    { DOTS_ENABLED: 1, DOTS_STYLE: 1, SHOW_ADJACENT: 1, BANNER_STYLE: 2, BANNER_CONTENT: 2, TIME_FONT: 1,
      METRIC1: M.CONNECTION, METRIC2: M.BATTERY, METRIC3: M.NEXT_ALARM, METRIC4: M.DISTANCE },
    { now: new Date(2026, 8, 3, 16, 20), connected: false, battery: { percent: 69 },
      nextAlarm: new Date(2026, 8, 4, 9, 30), health: { distanceM: 6100 }, dots: { days: SEP_DOTS } }),
    { dir: STORE_DIR }),
  '3_international': Object.assign(aug(
    { THEME: 1, TIME_FORMAT: 2, TIME_FONT: 3, START_DAY: 1, BANNER_STYLE: 1, TEMP_UNIT: 0, DIST_UNIT: 0,
      METRIC1: M.DISTANCE, METRIC2: M.STEPS, METRIC3: M.WEATHER, METRIC4: M.HEART_RATE },
    { now: new Date(2026, 8, 20, 17, 30), weather: { temp_dc: 230, cond: Face.COND.PARTLY },
      health: { distanceM: 7800, steps: 8432, heartRate: 81 } }),
    { dir: STORE_DIR }),
  '4_events_lines': Object.assign(aug(
    { THEME: 9, DOTS_ENABLED: 1, BANNER_CONTENT: 5, TIME_FONT: 4, SHOW_SECONDS: 1,
      CAL1_COLOR: '0xAA00FF', CAL2_COLOR: '0x00AAAA', CAL3_COLOR: '0xFF5500',
      METRIC1: M.BATTERY, METRIC2: M.WEATHER, METRIC3: M.HEART_RATE },
    { now: new Date(2027, 1, 13, 9, 45, 52), battery: { percent: 84 },
      weather: { temp_dc: 50, cond: Face.COND.CLOUDY }, health: { heartRate: 64 },
      dots: { days: FEB_DOTS } }),
    { dir: STORE_DIR }),

  // Plugin mockups (README beside them): Tuesday 2026-10-28 21:13, 24-hour
  // emulator; Next event, Reading 1, Phone battery, Battery, Weather.
  'emery-slots-a-text-only': {
    dir: PLUGINS_DIR,
    settings: { METRIC1: M.NEXT_EVENT, METRIC2: M.READING_1, METRIC3: M.PHONE_BATTERY,
                METRIC4: M.BATTERY, METRIC5: M.WEATHER },
    data: {
      now: new Date(2026, 9, 28, 21, 13), system24h: true,
      battery: { percent: 80 }, weather: { tempF: 56, cond: Face.COND.PARTLY },
      event: { name: 'Standup', start: new Date(2026, 9, 28, 21, 36) },
      phoneBattery: 82, readings: [{ label: 'AAPL', text: '$232.14' }],
    },
  },
};

CASES['emery-check-long-event-name'] = {
  dir: PLUGINS_DIR,
  settings: CASES['emery-slots-a-text-only'].settings,
  data: Object.assign({}, CASES['emery-slots-a-text-only'].data, {
    now: new Date(2026, 9, 28, 21, 15),
    event: { name: 'Quarterly planning review', start: new Date(2026, 9, 28, 21, 38) },
    readings: [],
  }),
};

function compare(name, c, diffDir) {
  const ref = readPNG(path.join(c.dir || SETTINGS_DIR, name + '.png'));
  const out = Face.render(c.settings, c.data, Object.assign({ corrected: true }, c.opts || {}));
  let bad = 0;
  const diff = new Uint8ClampedArray(out.pixels.length);
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let i = 0; i < out.pixels.length; i += 4) {
    const same = out.pixels[i] === ref.pixels[i] && out.pixels[i + 1] === ref.pixels[i + 1] &&
        out.pixels[i + 2] === ref.pixels[i + 2];
    const v = same ? Math.round((ref.pixels[i] + ref.pixels[i + 1] + ref.pixels[i + 2]) / 12) : 255;
    diff[i] = v; diff[i + 1] = same ? v : 0; diff[i + 2] = same ? v : 0; diff[i + 3] = 255;
    if (!same) {
      bad++;
      const p = i / 4, x = p % out.width, y = Math.floor(p / out.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (diffDir) {
    const W = out.width, H = out.height, strip = new Uint8ClampedArray(W * 3 * H * 4);
    [ref.pixels, out.pixels, diff].forEach((src, k) => {
      for (let y = 0; y < H; y++) {
        strip.set(src.subarray(y * W * 4, (y + 1) * W * 4), (y * W * 3 + k * W) * 4);
      }
    });
    fs.mkdirSync(diffDir, { recursive: true });
    writePNG(path.join(diffDir, name + '.png'), W * 3, H, strip);
  }
  return { bad, box: bad ? `x${minX}-${maxX} y${minY}-${maxY}` : '', layout: out.layout };
}

function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--diff');
  const diffDir = di >= 0 ? args[di + 1] : null;
  const names = args.filter((a, i) => !a.startsWith('--') && (di < 0 || i !== di + 1));
  const list = names.length ? names : Object.keys(CASES);
  let total = 0;
  for (const name of list) {
    const r = compare(name, CASES[name], diffDir);
    total += r.bad;
    console.log(`${name.padEnd(26)} ${String(r.bad).padStart(6)}  ${r.box}`);
  }
  console.log(`${'total'.padEnd(26)} ${String(total).padStart(6)}`);
}

if (require.main === module) { main(); }
module.exports = { CASES, compare };
