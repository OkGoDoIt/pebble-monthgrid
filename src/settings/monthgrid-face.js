// MonthGrid watchface renderer for the settings-page live preview.
//
// A straight port of src/c (layout.c, draw_time.c, draw_status.c,
// draw_calendar.c, icons.c, settings.c) for emery (Pebble Time 2, 200x228),
// drawing into its own 64-colour pixel buffer with the firmware's own font
// bitmaps (monthgrid-fonts.js) and the firmware's non-antialiased primitives,
// so the output matches the watch pixel for pixel where the port is exact.
//
// Plain script with no dependencies: a `MonthGridFace` global in the browser
// (load monthgrid-fonts.js first), module.exports in Node.
//
//   MonthGridFace.render(settings, data, opts) -> {width, height, pixels, layout, surface}
//   MonthGridFace.toCanvas(canvas, settings, data, opts)   // canvas at native 200x228
//
// settings: Clay message keys (THEME, TIME_FONT, METRIC1..8, CUSTOM_BG as
//   0xRRGGBB, ...); missing keys take the watch defaults from settings.c.
// data: {now, system24h, locale, battery: {percent, charging}, connected,
//   weather: {tempF | tempC | temp_dc, cond}, health: {steps, distanceM,
//   heartRate, activeSec, activeKcal, restingKcal, sleepSec}, nextAlarm,
//   phoneBattery, readings: [{label, text}] x5, event: {name, start, end,
//   allDay}, dots: {days: [[n1, n2, n3] per day of this month], failed}}.
//   Anything absent is "no data" and its status item hides, as on the watch.
// layout: zone rects {x, y, w, h} (time, status, extra, banner, header, grid,
//   todayBox, inlineBanner; null when hidden), cells [{day, inMonth, today,
//   row, col, x, y, w, h}], rowPitch, cellW, stage (compression stage),
//   statusItems [{slot, metric, x, w, text}] as drawn, statusSkipped
//   [{slot, metric, reason: 'no-data' | 'no-room' | 'duplicate'}], theme.
//
// Drawing primitives work on a surface ({width, height, data}: one GColor8
// value 0..63 per pixel): fillRect, drawRect, drawLine, fillCircle,
// drawPixel, drawText, drawIcon. Use opts.draw to add to a render.

(function (root) {
  'use strict';

  var FONT_SRC = (typeof module === 'object' && module.exports)
      ? require('./monthgrid-fonts.js') : root.MonthGridFonts;

  function idiv(a, b) { return Math.trunc(a / b); }   // C integer division
  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  // -------------------------------------------------------------------------
  // Colours: GColor8 without the alpha bits, 0bRRGGBB (0..63).

  var C = {
    Black: 0, OxfordBlue: 1, DarkGreen: 4, BlueMoon: 7, IslamicGreen: 8,
    VividCerulean: 11, Green: 12, DarkGray: 21, Liberty: 22, DarkCandyAppleRed: 32,
    VividViolet: 35, WindsorTan: 36, LightGray: 42, MintGreen: 46, Red: 48,
    Orange: 52, ChromeYellow: 56, Yellow: 60, White: 63,
  };

  // GColorFromHEX: each channel keeps its top two bits.
  function colorFromHex(v) {
    if (typeof v === 'string') { v = parseInt(v.replace(/^#/, '0x'), 16); }
    return (((v >> 16) & 0xff) >> 6) << 4 | (((v >> 8) & 0xff) >> 6) << 2 | ((v & 0xff) >> 6);
  }

  // pebble-tool's screenshot colour correction (how the SDK emulator's
  // screenshots, and so the store shots, show the 64 colours).
  var CORRECTED = '000000001e410043870068ca2b4a2c27514f16638d007dce5e98605c9b7257a5a24cb4db' +
      '8ee3918ee69e8aebc084f5f14a161b48274840488a2f6bcc564e365454544f67904180d0759a64759d7671a6a4' +
      '69b5dd9ee5949de7a09becc295f6f299353f983e5a9556948f74d29d5b4d9d60649a70999587d5afa072aea382' +
      'abababa7bae2c9e89dc9eaa7c7f0c8c3f9f7e35462e25874e16aa3de83dce66e6be6727ce37fa7e194dff1aa86' +
      'f1ad93efb5b8ecc3ebffeeabfff1b5fff6d3ffffff';

  function colorToRGB(c, corrected) {
    if (corrected) {
      var h = CORRECTED.substr(c * 6, 6);
      return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }
    return [((c >> 4) & 3) * 85, ((c >> 2) & 3) * 85, (c & 3) * 85];
  }

  function colorToCSS(c, corrected) {
    var rgb = colorToRGB(c, corrected);
    return 'rgb(' + rgb.join(',') + ')';
  }

  // -------------------------------------------------------------------------
  // Surface + the firmware's non-antialiased primitives (graphics.c,
  // graphics_line.c, graphics_circle.c). Everything clips to the surface.

  function createSurface(w, h, bg) {
    var data = new Uint8Array(w * h);
    if (bg) { data.fill(bg); }
    return { width: w, height: h, data: data };
  }

  function hline(s, y, x0, x1, c) {     // [x0, x1)
    if (y < 0 || y >= s.height) { return; }
    x0 = Math.max(x0, 0);
    x1 = Math.min(x1, s.width);
    for (var x = x0; x < x1; x++) { s.data[y * s.width + x] = c; }
  }

  function drawPixel(s, x, y, c) {
    if (x >= 0 && y >= 0 && x < s.width && y < s.height) { s.data[y * s.width + x] = c; }
  }

  // prv_fill_rect_legacy2: corner insets per row, packed 4 bits each.
  var ROUND_TOP = [0x0, 0x01, 0x01, 0x12, 0x113, 0x123, 0x1234, 0x11235, 0x112346];
  var ROUND_BOTTOM = [0x0, 0x01, 0x10, 0x210, 0x3110, 0x32100, 0x432100, 0x5321100, 0x64321100];
  var CORNER = { TL: 1, TR: 2, BL: 4, BR: 8, ALL: 15 };

  // fillRect(s, {x,y,w,h}, color, radius = 0, corners = all when radius > 0)
  function fillRect(s, r, c, radius, corners) {
    var x = r.x, y = r.y, w = r.w, h = r.h;
    radius = radius || 0;
    corners = corners === undefined ? (radius ? CORNER.ALL : 0) : corners;
    if (w < 0) { x += w; w = -w; }     // grect_standardize
    if (h < 0) { y += h; h = -h; }
    if (!corners) { radius = 0; } else if (Math.min(w, h) < 2 * radius) { radius = idiv(Math.min(w, h), 2); }
    radius = Math.min(radius, 8);      // larger radii take a quadrant path we don't need
    var cx0 = Math.max(x, 0), cy0 = Math.max(y, 0);
    var cx1 = Math.min(x + w, s.width), cy1 = Math.min(y + h, s.height);
    if (cx1 <= cx0 || cy1 <= cy0) { return; }
    var cw = cx1 - cx0;
    var leftCrop = cx0 - x, rightCrop = Math.max(0, w - cw - leftCrop);
    var insL = (corners & CORNER.TL) ? ROUND_TOP[radius] : 0;
    var insR = (corners & CORNER.TR) ? ROUND_TOP[radius] : 0;
    var top = cy0 - y;
    if (top >= 8) { insL = insR = 0; } else { insL >>>= 4 * top; insR >>>= 4 * top; }
    for (var yy = cy0; yy < cy1; yy++) {
      if (yy === y + h - radius && (corners & (CORNER.BL | CORNER.BR))) {
        if (corners & CORNER.BL) { insL = ROUND_BOTTOM[radius]; }
        if (corners & CORNER.BR) { insR = ROUND_BOTTOM[radius]; }
      }
      var ls = Math.max((insL & 0xf) - leftCrop, 0), rs = Math.max((insR & 0xf) - rightCrop, 0);
      var width = ls + rs < cw ? cw - ls - rs : 0;
      hline(s, yy, cx0 + ls, cx0 + ls + width, c);
      insL >>>= 4;
      insR >>>= 4;
    }
  }

  function drawRect(s, r, c) {       // stroke width 1
    fillRect(s, rect(r.x, r.y, r.w, 1), c);
    fillRect(s, rect(r.x, r.y + r.h - 1, r.w, 1), c);
    fillRect(s, rect(r.x, r.y + 1, 1, r.h - 2), c);
    fillRect(s, rect(r.x + r.w - 1, r.y + 1, 1, r.h - 2), c);
  }

  function drawLine(s, x0, y0, x1, y1, c) {   // graphics_line_draw_1px_non_aa
    var steep = Math.abs(y1 - y0) > Math.abs(x1 - x0), t;
    if (steep) { t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    var dx = x1 - x0, dy = Math.abs(y1 - y0), err = idiv(dx, 2), ystep = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; x0++) {
      if (steep) { drawPixel(s, y0, x0, c); } else { drawPixel(s, x0, y0, c); }
      err -= dy;
      if (err < 0) { y0 += ystep; err += dx; }
    }
  }

  function fillCircle(s, cx, cy, r, c) {      // graphics_circle_fill_non_aa
    if (r === 0) { drawPixel(s, cx, cy, c); return; }
    fillRect(s, rect(cx - r, cy, 2 * r + 1, 1), c);
    var f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      fillRect(s, rect(cx - x, cy + y, 2 * x + 1, 1), c);
      fillRect(s, rect(cx - y, cy + x, 2 * y + 1, 1), c);
      fillRect(s, rect(cx - x, cy - y, 2 * x + 1, 1), c);
      fillRect(s, rect(cx - y, cy - x, 2 * y + 1, 1), c);
    }
  }

  // -------------------------------------------------------------------------
  // Fonts and text (text_layout.c / text_render.c, left-to-right scripts).

  var fontCache = {};

  function b64bytes(str) {
    if (typeof atob === 'function') {
      var bin = atob(str), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
      return out;
    }
    return new Uint8Array(Buffer.from(str, 'base64'));
  }

  function font(key) {
    if (fontCache[key]) { return fontCache[key]; }
    var src = FONT_SRC[key];
    if (!src) { throw new Error('MonthGridFace: no font ' + key); }
    var bytes = b64bytes(src.g), glyphs = {}, p = 0;
    var cps = Array.from(src.cp);
    var sb = function (v) { return v > 127 ? v - 256 : v; };    // int8
    for (var i = 0; i < cps.length; i++) {
      var w = bytes[p], h = bytes[p + 1];
      var n = (w * h + 7) >> 3;
      glyphs[cps[i].codePointAt(0)] = {
        w: w, h: h, left: sb(bytes[p + 2]), top: sb(bytes[p + 3]), adv: sb(bytes[p + 4]),
        bits: bytes.subarray(p + 5, p + 5 + n),
      };
      p += 5 + n;
    }
    fontCache[key] = { key: key, height: src.h, glyphs: glyphs };
    return fontCache[key];
  }

  // A codepoint the font lacks draws as the font's wildcard box, else space
  // (text_resources.c; the system fallback font is not modelled).
  function glyph(f, cp) {
    return f.glyphs[cp] || f.glyphs[0x25AF] || f.glyphs[0x20] || null;
  }

  function advance(f, cp) {
    if (cp === 0x200B || cp === 0x2060) { return 0; }
    var g = glyph(f, cp);
    return g ? Math.max(g.adv, 0) : 0;
  }

  function codepoints(text) {
    return Array.from(String(text)).map(function (ch) { return ch.codePointAt(0); })
      .filter(function (cp) {
        return !((cp < 0x20 && cp !== 10) || (cp >= 0x80 && cp <= 0x9f) || cp === 0x7f ||
                 (cp >= 0x200c && cp <= 0x200f) || cp === 0xfe0f || cp === 0xfeff);
      });
  }

  var END_OF_WORD = { 0: 1, 10: 1, 32: 1, 45: 1, 0x200B: 1 };
  var ELLIPSIS = 0x2026, HYPHEN = 0x2d;

  // walk_line: the characters from `start` that fit in `avail` along with a
  // suffix glyph. Like the firmware, it then trims trailing spaces, starting
  // at the character that stopped the walk (so a space that did NOT fit is
  // subtracted too, which moves an ellipsis left). -> {end, width}
  function walkLine(cps, f, start, avail, suffixW) {
    var w = 0, i = start, last = -1;
    if (cps[start] === 10) { return { end: start, width: 0 }; }
    while (i < cps.length && w + advance(f, cps[i]) + suffixW <= avail) {
      w += advance(f, cps[i]);
      last = i;
      if (i + 1 >= cps.length) { break; }
      i++;
      if (cps[i] === 10) { break; }
    }
    if (last >= 0) {
      for (var k = i; k >= 0 && (cps[k] === 32 || cps[k] === 10); k--) {
        var sub = cps[k] === 10 ? 0 : advance(f, 32);
        if (w < sub) { break; }
        w -= sub;
      }
    }
    return { end: last >= 0 ? last + 1 : start, width: w };
  }

  // Line layout as graphics_draw_text does it: a word is one character plus
  // the run up to the next space/hyphen; a word too long for an empty line is
  // broken with a hyphen; in 'fill' / 'ellipsis' mode the last line that fits
  // the box ends in an ellipsis (cut mid-word) when text remains; lines are
  // aligned by integer halves. Returns [{x, y, start, width, suffix}].
  function layoutText(text, f, box, overflow, align) {
    var cps = codepoints(text);
    if (overflow === 'fill') { cps = cps.map(function (c) { return c === 10 ? 32 : c; }); }
    var lh = f.height, lines = [], pos = 0, y = box.y, truncating = overflow !== 'wrap';
    if (box.w <= 0 || box.h <= 0 || !cps.length) { return { cps: cps, lines: lines }; }

    function wordAt(p) {
      var e = p + 1, w = 0;
      if (cps[p] !== 10) { while (e < cps.length && !END_OF_WORD[cps[e]]) { e++; } }
      for (var i = p; i < e; i++) { w += cps[i] === 10 ? 0 : advance(f, cps[i]); }
      return { end: e, w: w };
    }

    while (pos < cps.length) {
      if (lines.length && (truncating ? y + lh > box.y + box.h : y > box.y + box.h)) { break; }
      var line = { start: pos, width: 0, suffix: 0 }, remaining = true;
      for (;;) {
        if (pos >= cps.length) { remaining = false; break; }
        if (cps[pos] === 10) { pos++; break; }                       // hard break
        var word = wordAt(pos);
        if (line.width + word.w <= box.w) { line.width += word.w; pos = word.end; continue; }
        if (line.width === 0) {                                      // hyphenate
          var hw = advance(f, HYPHEN), cut = walkLine(cps, f, pos, box.w, hw);
          line.width = cut.width + hw;
          line.suffix = HYPHEN;
          pos = Math.max(cut.end, pos + 1);
        } else {
          while (pos < cps.length && cps[pos] === 32) { pos++; }     // wrap
        }
        remaining = pos < cps.length;
        break;
      }
      if (truncating && remaining && y + 2 * lh > box.y + box.h) {
        var ew = advance(f, ELLIPSIS);
        line.width = walkLine(cps, f, line.start, box.w, ew).width + ew;
        line.suffix = ELLIPSIS;
        remaining = false;
      }
      var slack = Math.max(0, box.w - line.width);
      line.x = box.x + (align === 'center' ? idiv(slack, 2) : align === 'right' ? slack : 0);
      line.y = y;
      lines.push(line);
      if (!remaining) { break; }
      y += lh;
    }
    return { cps: cps, lines: lines };
  }

  function drawGlyph(s, g, x, y, c) {
    for (var i = 0, n = g.w * g.h; i < n; i++) {
      if (g.bits[i >> 3] & (1 << (i & 7))) {
        drawPixel(s, x + g.left + (i % g.w), y + g.top + ((i / g.w) | 0), c);
      }
    }
  }

  // graphics_draw_text(text, font, box, overflow, alignment). Glyphs clip to
  // the screen, not to the box. overflow: 'fill' (default), 'ellipsis', 'wrap'.
  function drawText(s, text, fontKey, box, c, align, overflow) {
    var f = font(fontKey);
    if (Math.min(box.y + box.h, s.height) - Math.max(box.y, 0) <= 0) { return; }
    var lay = layoutText(text, f, box, overflow || 'fill', align || 'left'), cps = lay.cps;
    for (var li = 0; li < lay.lines.length; li++) {
      var line = lay.lines[li];
      var sw = line.suffix ? advance(f, line.suffix) : 0;
      var walk = walkLine(cps, f, line.start, line.width, sw), x = line.x;
      for (var i = line.start; i < walk.end; i++) {
        if (cps[i] !== 32 && cps[i] !== 10) { drawGlyph(s, glyph(f, cps[i]), x, line.y, c); }
        x += advance(f, cps[i]);
      }
      if (line.suffix) { drawGlyph(s, glyph(f, line.suffix), line.x + walk.width, line.y, c); }
      if (line.y + f.height > s.height) { break; }
    }
  }

  // graphics_text_layout_get_content_size with an unbounded box.
  function measureText(text, fontKey, maxW) {
    var f = font(fontKey);
    var lines = layoutText(text, f, rect(0, 0, maxW || 32767, 32767), 'fill', 'left').lines;
    if (!lines.length) { return { w: 0, h: 0 }; }
    return {
      w: Math.max.apply(null, lines.map(function (l) { return l.width; })),
      h: lines[lines.length - 1].y + f.height,
    };
  }

  // -------------------------------------------------------------------------
  // Settings (settings.c defaults, Clay message keys) and themes.

  var M = {
    NONE: 0, BATTERY: 1, WEATHER: 2, STEPS: 3, DISTANCE: 4, HEART_RATE: 5, ACTIVE_MIN: 6,
    CALORIES: 7, SLEEP: 8, WEEK_NUM: 9, CONNECTION: 10, NEXT_ALARM: 11, CALORIES_TOTAL: 12,
    NEXT_EVENT: 13, PHONE_BATTERY: 14, READING_1: 15, READING_2: 16, READING_3: 17,
    READING_4: 18, READING_5: 19,
  };
  var COND = { UNKNOWN: 0, CLEAR: 1, PARTLY: 2, CLOUDY: 3, FOG: 4, RAIN: 5, SNOW: 6, THUNDER: 7, WIND: 8 };

  var DEFAULTS = {
    THEME: 0, BANNER_STYLE: 0, HEADER_LABEL: 0, TIME_FORMAT: 0, TIME_SIZE: 0, TIME_FONT: 0,
    SHOW_SECONDS: 0, START_DAY: 0, BANNER_CONTENT: 0, GRID_LINES: 0, SHOW_ADJACENT: 0,
    METRIC1: 1, METRIC2: 2, METRIC3: 0, METRIC4: 0, METRIC5: 0, METRIC6: 0, METRIC7: 0, METRIC8: 0,
    TEMP_UNIT: 1, DIST_UNIT: 1, DOTS_ENABLED: 0, DOTS_STYLE: 0,
  };
  var COLOR_DEFAULTS = {
    CUSTOM_BG: C.Black, CUSTOM_FG: C.White, CUSTOM_ACCENT: C.VividCerulean,
    GRID_COLOR: C.DarkGray, CAL1_COLOR: C.Red, CAL2_COLOR: C.BlueMoon, CAL3_COLOR: C.IslamicGreen,
  };

  function num(v) {
    if (typeof v === 'boolean') { return v ? 1 : 0; }
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  // Message-key settings -> the watch's Settings struct, sanitized as
  // settings_sanitize does. Colours arrive as 0xRRGGBB (number or string).
  function normalizeSettings(input) {
    input = input || {};
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      s[k] = input[k] === undefined || input[k] === null || input[k] === '' ? DEFAULTS[k] : num(input[k]);
    });
    Object.keys(COLOR_DEFAULTS).forEach(function (k) {
      s[k] = input[k] === undefined || input[k] === null || input[k] === ''
          ? COLOR_DEFAULTS[k] : colorFromHex(input[k]);
    });
    function clamp(k, max, dflt) { if (s[k] < 0 || s[k] > max) { s[k] = dflt; } }
    clamp('THEME', 10, 0); clamp('BANNER_STYLE', 2, 0); clamp('HEADER_LABEL', 1, 0);
    clamp('TIME_FORMAT', 2, 0); clamp('TIME_SIZE', 2, 0); clamp('TIME_FONT', 4, 0);
    clamp('START_DAY', 2, 0); clamp('DOTS_STYLE', 1, 0); clamp('BANNER_CONTENT', 5, 0);
    s.metrics = [];
    if (Array.isArray(input.METRICS)) {
      // The whole list, as the settings page sends it (no slot limit).
      input.METRICS.forEach(function (m) { m = num(m); if (m > 0 && m <= 19) { s.metrics.push(m); } });
    } else {
      for (var i = 1; i <= 8; i++) {
        clamp('METRIC' + i, 19, 0);
        s.metrics.push(s['METRIC' + i]);
      }
    }
    ['SHOW_SECONDS', 'SHOW_ADJACENT', 'DOTS_ENABLED', 'GRID_LINES', 'TEMP_UNIT', 'DIST_UNIT']
      .forEach(function (k) { s[k] = s[k] ? 1 : 0; });
    return s;
  }

  // bg, fg, accent, on_accent, dim (settings.c g_themes)
  var THEMES = [
    [C.Black, C.White, C.White, C.Black, C.DarkGray],                     // Classic
    [C.White, C.Black, C.Black, C.White, C.LightGray],                    // Paper
    [C.Black, C.ChromeYellow, C.Orange, C.Black, C.WindsorTan],           // Amber
    [C.Black, C.White, C.VividCerulean, C.Black, C.DarkGray],             // Ice
    [C.Black, C.White, C.Red, C.White, C.DarkGray],                       // Crimson
    [C.OxfordBlue, C.White, C.ChromeYellow, C.Black, C.Liberty],          // Midnight
    [C.Black, C.Green, C.IslamicGreen, C.MintGreen, C.DarkGreen],         // Terminal
    [C.Black, C.White, C.Orange, C.Black, C.DarkGray],                    // Sunset
    [C.Black, C.White, C.VividViolet, C.White, C.DarkGray],               // Violet
    [C.White, C.Black, C.DarkCandyAppleRed, C.White, C.LightGray],        // Newsprint
  ];
  var THEME_NAMES = ['Classic', 'Paper', 'Amber', 'Ice', 'Crimson', 'Midnight', 'Terminal',
                     'Sunset', 'Violet', 'Newsprint', 'Custom'];

  function chan(c) { return [(c >> 4) & 3, (c >> 2) & 3, c & 3]; }

  // gcolor_legible_over
  function legibleOver(c) {
    var k = chan(c);
    return (2126 * k[0] + 7152 * k[1] + 722 * k[2]) / 3 >= 4510 ? C.Black : C.White;
  }

  // theme_spec(): accepts raw message-key settings or normalized ones.
  function themeColors(settings) {
    var s = settings && settings.metrics ? settings : normalizeSettings(settings);
    if (s.THEME === 10) {
      var k = chan(s.CUSTOM_BG);
      return { bg: s.CUSTOM_BG, fg: s.CUSTOM_FG, accent: s.CUSTOM_ACCENT,
               onAccent: legibleOver(s.CUSTOM_ACCENT),
               dim: k[0] + k[1] + k[2] >= 5 ? C.LightGray : C.DarkGray };
    }
    var t = THEMES[s.THEME] || THEMES[0];
    return { bg: t[0], fg: t[1], accent: t[2], onAccent: t[3], dim: t[4] };
  }

  // -------------------------------------------------------------------------
  // Platform constants. Only emery is built; the structure leaves room for
  // the others (each would bring its own fonts and numbers from the #ifs).

  var PLATFORMS = {
    emery: {
      width: 200, height: 228,
      STATUS_H: 22, BANNER_H: 20, HEADER_H: 15, PITCH_MIN: 13, PITCH_MAX: 20, SECTION_GAP: 3,
      PITCH_COMFORT: 14, TOP_INSET: 2, BOTTOM_INSET: 2,
      SMALL_DIGIT_H: 11, SMALL_TOP_PAD: 7, SIDE_GAP: 4,
      ICON_S: 13, ITEM_GAP: 10, ICON_TEXT_GAP: 3, TEXT_BOX_SLACK: 12,
      DOT_SQ_W: 3, DOT_SQ_H: 3, DOT_GAP: 2, HEADER_TOP_PAD: 3, BANNER_TEXT_LIFT: 3,
      fonts: { small: 'GOTHIC_18', smallBold: 'GOTHIC_18_BOLD', header: 'GOTHIC_14',
               banner: 'GOTHIC_18_BOLD' },
      // TIME_FONTS[family][size] = [font, zone height, trim]
      timeFonts: [
        [['ROBOTO_BOLD_SUBSET_49', 40, 13], ['GOTHIC_28_BOLD', 24, 10], ['GOTHIC_24_BOLD', 21, 8]],
        [['LECO_60_BOLD_NUMBERS_AM_PM', 48, 17], ['LECO_42_NUMBERS', 34, 12], ['LECO_36_BOLD_NUMBERS', 30, 10]],
        [['SILKTIME_48', 34, 17], ['SILKTIME_32', 24, 11], ['SILKTIME_24', 19, 8]],
        [['BITHAM_42_BOLD', 35, 12], ['BITHAM_42_BOLD', 35, 12], ['BITHAM_34_MEDIUM_NUMBERS', 28, 9]],
        [['BITHAM_42_LIGHT', 35, 12], ['BITHAM_42_LIGHT', 35, 12], ['BITHAM_34_MEDIUM_NUMBERS', 28, 9]],
      ],
    },
  };

  // -------------------------------------------------------------------------
  // Calendar arithmetic (util.c).

  function daysInMonth(year, month0) { return new Date(year, month0 + 1, 0).getDate(); }
  function startWday(s) { return s.START_DAY === 1 ? 1 : s.START_DAY === 2 ? 6 : 0; }
  function monthLead(now, sw) {
    var wday1 = (now.getDay() - ((now.getDate() - 1) % 7) + 7) % 7;
    return (wday1 - sw + 7) % 7;
  }
  function monthRows(now, sw) {
    return idiv(monthLead(now, sw) + daysInMonth(now.getFullYear(), now.getMonth()) + 6, 7);
  }

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    var firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  }

  // -------------------------------------------------------------------------
  // Layout (layout.c, rectangular branch). extraH is a caller-reserved band
  // under the status line that travels with it through the cascade.

  var STAGES = [[1, 0, 1, 0], [0, 0, 1, 0], [0, 1, 1, 0], [0, 1, 1, 1], [0, 1, 0, 1], [0, 2, 0, 1], [0, 2, 0, 2]];

  function computeLayout(P, s, now, extra, obstruction, h24) {
    var ub = rect(0, 0, P.width, P.height - (obstruction || 0));
    var wantStatus = s.metrics.some(function (m) { return m !== M.NONE; });
    var extraH = extra ? extra.height + (extra.gap || 0) : 0;
    var avail = ub.h - P.TOP_INSET - P.BOTTOM_INSET;
    var sw = startWday(s);
    var rows = s.SHOW_ADJACENT ? 6 : monthRows(now, sw);
    var family = P.timeFonts[s.TIME_FONT];
    var canInline = !s.SHOW_ADJACENT && monthLead(now, sw) >= 5;
    var l = {};

    function apply(st) {
      l.headerVisible = !!st[0];
      l.bannerInline = st[1] === 1 && canInline;
      l.bannerVisible = st[1] === 0 || (st[1] === 1 && !canInline);
      l.timeIdx = Math.min(s.TIME_SIZE + st[3], 2);
      l.statusVisible = wantStatus && !!st[2];
      l.extraVisible = !!extra && !!st[2];
    }
    function statusBlockH() {
      return (l.statusVisible ? P.STATUS_H : 0) + (l.extraVisible ? extraH : 0);
    }
    function fixedH(timeH) {
      var h = timeH + P.SECTION_GAP;
      if (statusBlockH()) { h += statusBlockH() + P.SECTION_GAP; }
      if (l.bannerVisible) { h += P.BANNER_H + P.SECTION_GAP; }
      if (l.headerVisible) { h += P.HEADER_H; }
      return h;
    }

    var chosen = -1, fallback = -1;
    for (var i = 0; i < STAGES.length && chosen < 0; i++) {
      apply(STAGES[i]);
      var fh = fixedH(family[l.timeIdx][1]);
      if (fh + P.PITCH_MIN * rows > avail) { continue; }
      if (fallback < 0) { fallback = i; }
      if (idiv(avail - fh, rows) < P.PITCH_COMFORT && i < STAGES.length - 1) { continue; }
      chosen = i;
    }
    if (chosen < 0) { chosen = fallback >= 0 ? fallback : STAGES.length - 1; }
    apply(STAGES[chosen]);

    // In 12-hour mode a size whose "12:00" leaves AM/PM no room steps down
    // one, all day (layout.c prv_size_with_ampm).
    if (!h24) {
      var ampm = measureText('PM', P.fonts.smallBold).w;
      while (l.timeIdx < 2 && measureText('12:00', family[l.timeIdx][0]).w + P.SIDE_GAP + ampm > P.width - 2) {
        l.timeIdx++;
      }
    }
    var spec = family[l.timeIdx];
    l.timeFont = spec[0];
    l.timeFontH = spec[1];
    l.timeTrim = spec[2];
    var pitch = idiv(avail - fixedH(spec[1]), rows);
    pitch = Math.max(P.PITCH_MIN, Math.min(P.PITCH_MAX, pitch));
    l.rowPitch = pitch;
    l.rows = rows;
    l.cellW = idiv(P.width - 4, 7);
    l.gridX = ub.x + idiv(ub.w - l.cellW * 7, 2);

    // Slack spread evenly over the flexible seams (screen top -> time ->
    // status -> calendar block); banner + header + grid stay one unit.
    var blockH = pitch * rows + (l.headerVisible ? P.HEADER_H : 0) +
        (l.bannerVisible ? P.BANNER_H + P.SECTION_GAP : 0);
    var stackMin = spec[1] + statusBlockH() + blockH;
    var nseams = 2 + (statusBlockH() ? 1 : 0);
    var slack = Math.max(0, ub.h - P.BOTTOM_INSET - stackMin);
    var gap = idiv(slack, nseams);
    var y = ub.y + gap + (slack % nseams);
    l.time = rect(ub.x, y, ub.w, spec[1]);
    y += spec[1];
    l.status = null;
    l.extra = null;
    if (statusBlockH()) {
      y += gap;
      if (l.statusVisible) { l.status = rect(ub.x, y, ub.w, P.STATUS_H); y += P.STATUS_H; }
      if (l.extraVisible) {
        y += extra.gap || 0;
        l.extra = rect(ub.x, y, ub.w, extra.height);
        y += extra.height;
      }
    }
    y += gap;
    l.banner = null;
    l.header = null;
    if (l.bannerVisible) { l.banner = rect(ub.x, y, ub.w, P.BANNER_H); y += P.BANNER_H + P.SECTION_GAP; }
    if (l.headerVisible) { l.header = rect(l.gridX, y, l.cellW * 7, P.HEADER_H); y += P.HEADER_H; }
    l.grid = rect(l.gridX, y, l.cellW * 7, pitch * rows);
    l.stage = chosen;
    return l;
  }

  // -------------------------------------------------------------------------
  // Time (draw_time.c, rectangular branch).

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function use24h(s, data) { return s.TIME_FORMAT === 2 || (s.TIME_FORMAT === 0 && !!data.system24h); }

  function drawTime(P, sf, l, s, data, th) {
    var now = data.now, zone = l.time;
    var timeBuf, ampm = '', sec = '';
    if (use24h(s, data)) {
      timeBuf = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    } else {
      timeBuf = ((now.getHours() % 12) || 12) + ':' + pad2(now.getMinutes());
      ampm = now.getHours() < 12 ? 'AM' : 'PM';
    }
    if (s.SHOW_SECONDS) { sec = pad2(now.getSeconds()); }
    var bold = P.fonts.smallBold;
    var tw = measureText(timeBuf, l.timeFont).w;
    var ampmW = ampm ? measureText(ampm, bold).w : 0;
    var secW = sec ? measureText(sec, bold).w : 0;
    var sideW = Math.max(ampmW, secW);
    var x0 = zone.x + idiv(zone.w - tw, 2);
    if (sideW > 0) {
      var over = (x0 + tw + P.SIDE_GAP + sideW) - (zone.x + zone.w - 2);
      if (over > 0) { x0 -= over; }
    }
    x0 = Math.max(x0, zone.x);
    drawText(sf, timeBuf, l.timeFont,
             rect(x0, zone.y - l.timeTrim, tw + 2, zone.h + l.timeTrim + 16), th.fg, 'left');
    var sideX = Math.min(x0 + tw + P.SIDE_GAP, zone.x + zone.w - 2 - sideW);
    var D = P.SMALL_DIGIT_H, sideH = D + P.SMALL_TOP_PAD + 8;
    var ampmTop = zone.y + 1;
    var secTop = ampm ? zone.y + zone.h - D - 1 : zone.y + idiv(zone.h - D, 2);
    if (ampm && sec && secTop < ampmTop + D + 2) { secTop = ampmTop + D + 2; }
    if (sec && secTop + D > zone.y + zone.h + 6) { sec = ''; }
    if (ampm) { drawText(sf, ampm, bold, rect(sideX, ampmTop - P.SMALL_TOP_PAD, ampmW + 2, sideH), th.fg); }
    if (sec) { drawText(sf, sec, bold, rect(sideX, secTop - P.SMALL_TOP_PAD, secW + 2, sideH), th.fg); }
    l.timeText = { x: x0, w: tw, text: timeBuf, ampm: ampm, seconds: sec };
  }

  // -------------------------------------------------------------------------
  // Status icons (icons.c).

  var BOLT_L = [0x70, 0x38, 0x1C, 0x0E, 0x07, 0x7F, 0x70, 0x38, 0x1C, 0x0E, 0x07, 0x03, 0x01];
  var BOLT_S = [0x1C, 0x0E, 0x07, 0x1F, 0x1C, 0x0E, 0x07, 0x03, 0x01];
  var FLAME_L = [0x08, 0x0C, 0x2C, 0x2E, 0x6E, 0x7E, 0x3F, 0x7F, 0x7F, 0x7F, 0x3F, 0x3E, 0x1C];
  var FLAME_S = [0x04, 0x06, 0x16, 0x1E, 0x1F, 0x1F, 0x1F, 0x1F, 0x0E];
  var FOOT_L = [0x6, 0xF, 0xF, 0xF, 0x6, 0x0, 0x6];
  var FOOT_S = [0x2, 0x7, 0x7, 0x0, 0x2];
  var RUN_L = [0x030, 0x030, 0x000, 0x07C, 0x05E, 0x030, 0x078, 0x05C, 0x0CE, 0x086, 0x183, 0x103, 0x001];
  var RUN_S = [0x18, 0x18, 0x00, 0x1E, 0x0F, 0x0C, 0x0E, 0x12, 0x21];
  var CAL_L = [0x1FF, 0x145, 0x1FF, 0x101, 0x155, 0x101, 0x155, 0x101, 0x1FF];
  var CAL_S = [0x7F, 0x55, 0x7F, 0x41, 0x55, 0x41, 0x7F];
  var PHONE_L = [0x3E, 0x7F, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x7F, 0x77, 0x3E];
  var PHONE_S = [0x1F, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1F, 0x1B, 0x1F];

  function blit(s, x, y, rows, w, c) {
    rows.forEach(function (bits, r) {
      for (var col = 0; col < w; col++) { if (bits & (1 << col)) { drawPixel(s, x + col, y + r, c); } }
    });
  }

  function cloud(s, ox, oy, z, c) {
    fillCircle(s, ox + idiv(z * 3, 10), oy + idiv(z * 6, 10), idiv(z, 4), c);
    fillCircle(s, ox + idiv(z * 6, 10), oy + idiv(z * 45, 100), idiv(z, 3), c);
    fillRect(s, rect(ox + idiv(z, 5), oy + idiv(z * 55, 100), idiv(z * 13, 20), idiv(z, 4)), c);
  }

  function sun(s, cx, cy, r, c) {
    fillCircle(s, cx, cy, r, c);
    drawLine(s, cx - r - 3, cy, cx - r - 2, cy, c);
    drawLine(s, cx + r + 2, cy, cx + r + 3, cy, c);
    drawLine(s, cx, cy - r - 3, cx, cy - r - 2, c);
    drawLine(s, cx, cy + r + 2, cx, cy + r + 3, c);
    if (r >= 4) {
      var d = r + 1;
      drawPixel(s, cx - d, cy - d, c); drawPixel(s, cx + d, cy - d, c);
      drawPixel(s, cx - d, cy + d, c); drawPixel(s, cx + d, cy + d, c);
    }
  }

  function bgIsDark(bg) { var k = chan(bg); return k[0] + k[1] + k[2] <= 4; }

  // state: {battery: {percent, charging}, weatherCond}
  function iconWidth(metric, z, state) {
    state = state || {};
    switch (metric) {
      case M.BATTERY: return state.battery && state.battery.charging ? (z >= 12 ? 7 : 5) + 4 : idiv(z * 13, 10) + 4;
      case M.WEATHER: return state.weatherCond ? z + 2 : 0;
      case M.HEART_RATE: case M.CALORIES: case M.CALORIES_TOTAL: case M.SLEEP: case M.STEPS:
      case M.ACTIVE_MIN: case M.NEXT_ALARM: case M.CONNECTION: return z + 2;
      case M.NEXT_EVENT: return (z >= 12 ? 9 : 7) + 2;
      case M.PHONE_BATTERY: return (z >= 12 ? 7 : 5) + 2;
      default: return 0;
    }
  }

  function drawIcon(s, metric, ox, oy, z, fg, bg, state) {
    state = state || {};
    var large = z >= 12, i, x, dark = bgIsDark(bg);
    switch (metric) {
      case M.BATTERY: {
        var bat = state.battery || { percent: 100 };
        if (bat.charging) {
          var rows = large ? BOLT_L : BOLT_S;
          blit(s, ox, oy + idiv(z - rows.length, 2), rows, large ? 7 : 5, dark ? C.Green : C.IslamicGreen);
          break;
        }
        var bw = idiv(z * 13, 10), bh = idiv(z, 2) + 1, by = oy + idiv(z - bh, 2);
        drawRect(s, rect(ox, by, bw, bh), fg);
        fillRect(s, rect(ox + bw, by + idiv(bh, 3), 2, bh - idiv(2 * bh, 3)), fg);
        var inner = bw - 4, fw = Math.max(idiv(inner * bat.percent, 100), idiv(inner, 3));
        var pct = bat.percent;
        var col = pct <= 20 ? (dark ? C.Red : C.DarkCandyAppleRed)
            : pct <= 50 ? (dark ? C.Yellow : C.Orange) : (dark ? C.Green : C.IslamicGreen);
        fillRect(s, rect(ox + 2, by + 2, fw, bh - 4), col);
        break;
      }
      case M.WEATHER:
        switch (state.weatherCond) {
          case COND.CLEAR: sun(s, ox + idiv(z, 2), oy + idiv(z, 2), idiv(z, 3), fg); break;
          case COND.PARTLY:
            sun(s, ox + idiv(z * 3, 10), oy + idiv(z * 3, 10), idiv(z, 5), fg);
            fillCircle(s, ox + idiv(z * 6, 10), oy + idiv(z * 45, 100), idiv(z, 3) + 1, bg);
            cloud(s, ox, oy, z, fg);
            break;
          case COND.CLOUDY: cloud(s, ox, oy - idiv(z, 6), z, fg); break;
          case COND.RAIN:
            cloud(s, ox, oy - idiv(z, 4), z, fg);
            for (i = 0; i < 3; i++) {
              x = ox + idiv(z, 4) + idiv(i * z, 4);
              drawLine(s, x, oy + idiv(z * 7, 10), x - 1, oy + z - 1, fg);
            }
            break;
          case COND.SNOW:
            cloud(s, ox, oy - idiv(z, 4), z, fg);
            for (i = 0; i < 3; i++) {
              drawPixel(s, ox + idiv(z, 4) + idiv(i * z, 4), oy + idiv(z * 75, 100) + (i === 1 ? idiv(z, 8) : 0), fg);
            }
            break;
          case COND.THUNDER: {
            cloud(s, ox, oy - idiv(z, 4), z, fg);
            var bx = ox + idiv(z, 2), by2 = oy + idiv(z * 6, 10);
            drawLine(s, bx, by2, bx - idiv(z, 6), by2 + idiv(z, 5), fg);
            drawLine(s, bx - idiv(z, 6), by2 + idiv(z, 5), bx + 1, by2 + idiv(z * 2, 5), fg);
            break;
          }
          case COND.FOG:
            for (i = 0; i < 3; i++) {
              var fy = oy + idiv(z * 3, 10) + idiv(i * z, 5);
              drawLine(s, ox + (i === 1 ? 0 : idiv(z, 6)), fy, ox + z - (i === 1 ? idiv(z, 6) : 0), fy, fg);
            }
            break;
          case COND.WIND:
            for (i = 0; i < 3; i++) {
              var wy = oy + idiv(z * 3, 10) + idiv(i * z, 5);
              drawLine(s, ox, wy, ox + z - 1 - idiv(i * z, 4), wy, fg);
            }
            break;
        }
        break;
      case M.HEART_RATE: {
        var r = idiv(z, 5) + 1;
        fillCircle(s, ox + idiv(z * 3, 10), oy + idiv(z * 35, 100), r, fg);
        fillCircle(s, ox + idiv(z * 7, 10), oy + idiv(z * 35, 100), r, fg);
        var ax = ox + idiv(z, 2), ay = oy + z - 1, base = oy + idiv(z * 4, 10), hb = idiv(z * 4, 10);
        var th = ay - base;
        for (i = 0; th > 0 && i <= th; i++) {
          var half = idiv(hb * i, th);
          drawLine(s, ax - half, ay - i, ax + half, ay - i, fg);
        }
        break;
      }
      case M.CALORIES: case M.CALORIES_TOTAL:
        blit(s, ox, oy, large ? FLAME_L : FLAME_S, large ? 7 : 5, fg);
        break;
      case M.SLEEP:
        fillCircle(s, ox + idiv(z, 2), oy + idiv(z, 2), idiv(z * 38, 100), fg);
        fillCircle(s, ox + idiv(z * 7, 10), oy + idiv(z * 4, 10), idiv(z * 34, 100), bg);
        break;
      case M.STEPS: {
        var foot = large ? FOOT_L : FOOT_S, fh = large ? 7 : 5, fwid = large ? 4 : 3;
        var dx = large ? 6 : 4, dy = large ? 5 : 4;
        var x0 = ox + idiv(z - (fwid + dx), 2), y0 = oy + idiv(z - (fh + dy), 2);
        blit(s, x0, y0, foot, fwid, fg);
        blit(s, x0 + dx, y0 + dy, foot, fwid, fg);
        break;
      }
      case M.ACTIVE_MIN:
        blit(s, ox, oy, large ? RUN_L : RUN_S, large ? 9 : 6, fg);
        break;
      case M.NEXT_ALARM: {
        var acx = ox + idiv(z, 2), acy = oy + idiv(z * 45, 100);
        fillCircle(s, acx, acy, idiv(z * 35, 100), fg);
        drawLine(s, acx, acy, acx, oy + idiv(z, 4), bg);
        drawLine(s, acx, acy, ox + idiv(z * 65, 100), acy, bg);
        drawLine(s, ox + idiv(z, 5), oy + idiv(z * 8, 10), ox + idiv(z, 3), oy + idiv(z * 7, 10), fg);
        drawLine(s, ox + idiv(z * 4, 5), oy + idiv(z * 8, 10), ox + idiv(z * 2, 3), oy + idiv(z * 7, 10), fg);
        break;
      }
      case M.NEXT_EVENT: {
        var cal = large ? CAL_L : CAL_S;
        blit(s, ox, oy + idiv(z - cal.length, 2), cal, large ? 9 : 7, fg);
        break;
      }
      case M.PHONE_BATTERY: {
        var ph = large ? PHONE_L : PHONE_S;
        blit(s, ox, oy + idiv(z - ph.length, 2), ph, large ? 7 : 5, fg);
        break;
      }
      case M.CONNECTION: {
        var w = idiv(z * 70, 100), rx0 = ox + idiv(z - w, 2);
        var cx = rx0 + idiv(w, 2), rx = rx0 + w - 1, t = oy, b = oy + z - 1;
        var q1 = oy + idiv(z, 3), q2 = oy + idiv(z * 2, 3);
        var pts = [[rx0, q1], [rx, q2], [cx, b], [cx, t], [rx, q1], [rx0, q2]];
        for (i = 0; i < 5; i++) {
          drawLine(s, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], fg);
          drawLine(s, pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], fg);
        }
        var s0x = ox + z - 1, s0y = oy + 1, s1x = ox, s1y = oy + z - 2;
        for (var d = -1; d <= 1; d++) { drawLine(s, s0x + d, s0y, s1x + d, s1y, bg); }
        drawLine(s, s0x, s0y, s1x, s1y, dark ? C.Red : C.DarkCandyAppleRed);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Status line (draw_status.c, horizontal branch).

  function utf8Truncate(str, maxBytes) {
    var out = '', bytes = 0;
    for (var ch of String(str)) {
      var n = ch.codePointAt(0) < 0x80 ? 1 : ch.codePointAt(0) < 0x800 ? 2 : ch.codePointAt(0) < 0x10000 ? 3 : 4;
      if (bytes + n > maxBytes) { break; }
      out += ch;
      bytes += n;
    }
    return out;
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];

  function formatClock(when, s, data) {   // "9:30a" / "21:30"
    if (use24h(s, data)) { return when.getHours() + ':' + pad2(when.getMinutes()); }
    return ((when.getHours() % 12) || 12) + ':' + pad2(when.getMinutes()) + (when.getHours() < 12 ? 'a' : 'p');
  }

  function formatCount(v) {
    if (v < 1000) { return String(v); }
    if (v < 10000) {
      var tenths = idiv(v + 50, 100);
      return tenths % 10 === 0 ? idiv(tenths, 10) + 'k' : idiv(tenths, 10) + '.' + (tenths % 10) + 'k';
    }
    return idiv(v + 500, 1000) + 'k';
  }

  function eventWhen(ev, now, s, data) {   // null = nothing to show
    var nowS = Math.floor(now.getTime() / 1000);
    var start = Math.floor(new Date(ev.start).getTime() / 1000);
    var end = ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : 0;
    if (end && nowS >= end) { return null; }
    var startD = new Date(start * 1000);
    if (ev.allDay) { return nowS < start ? WEEKDAYS[startD.getDay()].slice(0, 3) : ''; }
    if (nowS >= start) { return 'now'; }
    var minutes = idiv(start - nowS + 59, 60);
    if (minutes < 60) { return minutes + 'm'; }
    if (minutes < 120) { return idiv(minutes, 60) + 'h' + pad2(minutes % 60); }
    if (minutes < 20 * 60) { return formatClock(startD, s, data); }
    return WEEKDAYS[startD.getDay()].slice(0, 3);
  }

  function weatherTempDc(w) {
    if (!w) { return null; }
    if (w.temp_dc !== undefined && w.temp_dc !== null) { return w.temp_dc; }
    if (w.tempF !== undefined && w.tempF !== null) { return Math.round((w.tempF - 32) * 50 / 9); }
    if (w.tempC !== undefined && w.tempC !== null) { return Math.round(w.tempC * 10); }
    return null;
  }

  function divRound(n, d) { return n >= 0 ? idiv(n + idiv(d, 2), d) : -idiv(-n + idiv(d, 2), d); }

  // prv_metric_text: the watch's text for a metric, or null (hidden).
  function metricText(metric, s, data) {
    var h = data.health || {}, ok = function (v) { return v !== undefined && v !== null; };
    switch (metric) {
      case M.BATTERY: return data.battery ? data.battery.percent + '%' : null;
      case M.WEATHER: {
        var dc = weatherTempDc(data.weather);
        if (dc === null) { return null; }
        var t = s.TEMP_UNIT ? divRound(dc * 9 + 1600, 50) : divRound(dc, 10);
        return t + (s.TEMP_UNIT ? '°F' : '°C');
      }
      case M.STEPS: return ok(h.steps) && h.steps >= 10 ? formatCount(h.steps) : null;
      case M.DISTANCE: {
        if (!ok(h.distanceM)) { return null; }
        var denom = s.DIST_UNIT ? 1609 : 1000, unit = s.DIST_UNIT ? 'mi' : 'km';
        var tenths = idiv(h.distanceM * 100 + denom * 5, denom * 10);
        if (tenths < 1) { return null; }
        return (tenths >= 1000 || tenths % 10 === 0) ? idiv(tenths, 10) + unit
            : idiv(tenths, 10) + '.' + (tenths % 10) + unit;
      }
      case M.HEART_RATE: return ok(h.heartRate) && h.heartRate > 0 ? String(h.heartRate) : null;
      case M.ACTIVE_MIN: {
        if (!ok(h.activeSec)) { return null; }
        var min = idiv(h.activeSec, 60);
        return min >= 60 ? idiv(min, 60) + 'h' + pad2(min % 60) : min + 'm';
      }
      case M.CALORIES: return ok(h.activeKcal) ? formatCount(h.activeKcal) : null;
      case M.CALORIES_TOTAL:
        return ok(h.activeKcal) && ok(h.restingKcal) ? formatCount(h.activeKcal + h.restingKcal) : null;
      case M.SLEEP:
        return ok(h.sleepSec) && h.sleepSec > 0
            ? idiv(h.sleepSec, 3600) + 'h' + pad2(idiv(h.sleepSec % 3600, 60)) : null;
      case M.WEEK_NUM: return 'W' + isoWeek(data.now);
      case M.NEXT_ALARM: return data.nextAlarm ? formatClock(new Date(data.nextAlarm), s, data) : null;
      case M.PHONE_BATTERY:
        return ok(data.phoneBattery) && data.phoneBattery >= 0 && data.phoneBattery <= 100
            ? data.phoneBattery + '%' : null;
      case M.READING_1: case M.READING_2: case M.READING_3: case M.READING_4: case M.READING_5: {
        var rd = (data.readings || [])[metric - M.READING_1];
        var text = rd && rd.text ? utf8Truncate(rd.text, 15) : '';
        return text || null;
      }
      case M.NEXT_EVENT:
        if (!data.event || !data.event.start) { return null; }
        // The name is required (an unnamed event hides); its time is added below.
        return eventWhen(data.event, data.now, s, data) === null ? null
            : utf8Truncate(data.event.name || '', 23) || null;
      case M.CONNECTION: return data.connected === false ? '' : null;
      default: return null;
    }
  }

  // "Standup 23m": the name loses characters (marked with …) until it fits.
  function eventTextFitted(name, when, maxW, fontKey) {
    var chars = Array.from(name), cut = false, text, w;
    for (;;) {
      text = chars.length ? chars.join('') + (cut ? '…' : '') + (when ? ' ' : '') + when : when;
      w = text ? measureText(text, fontKey).w : 0;
      if (maxW <= 0 || w <= maxW || !chars.length) { return { text: text, w: w }; }
      chars.pop();
      // trim_name_end: spaces, punctuation, dashes, an ellipsis.
      while (chars.length && /[ ,.;:\-\u2013\u2014\u2026]/.test(chars[chars.length - 1])) { chars.pop(); }
      cut = true;
    }
  }

  function collectStatus(P, s, data, opts, maxEventW, skipped) {
    var items = [], overrides = opts.statusOverrides || {};
    var state = { battery: data.battery, weatherCond: data.weather ? data.weather.cond || 0 : 0 };
    s.metrics.forEach(function (metric, slot) {
      if (metric === M.NONE) { return; }
      if (items.some(function (it) { return it.metric === metric; })) {
        skipped.push({ slot: slot, metric: metric, reason: 'duplicate' });
        return;
      }
      var ov = overrides[metric], text, iconMetric = metric;
      if (ov) {
        text = ov.text === undefined || ov.text === null ? '' : String(ov.text);
        if ('icon' in ov) { iconMetric = ov.icon === null ? M.NONE : ov.icon; }
        if (!text && iconMetric === M.NONE) { skipped.push({ slot: slot, metric: metric, reason: 'no-data' }); return; }
      } else {
        text = metricText(metric, s, data);
        if (text === null) { skipped.push({ slot: slot, metric: metric, reason: 'no-data' }); return; }
        // The event's calendar mark only stands in for its name (time only).
        if (metric === M.NEXT_EVENT) { iconMetric = M.NONE; }
      }
      var it = { slot: slot, metric: metric, icon: iconMetric, iconW: iconWidth(iconMetric, P.ICON_S, state), text: text };
      if (!ov && metric === M.NEXT_EVENT) {
        var fit = eventTextFitted(text, eventWhen(data.event, data.now, s, data), maxEventW, P.fonts.small);
        it.text = fit.text;
        it.textW = fit.w;
      } else {
        it.textW = text ? measureText(text, P.fonts.small).w : 0;
      }
      items.push(it);
    });
    return { items: items, state: state };
  }

  function drawStatus(P, sf, l, s, data, th, opts) {
    var skipped = [], zone = l.status;
    var maxW = P.width - 4;
    var got = collectStatus(P, s, data, opts, idiv(maxW * 2, 3), skipped);
    var items = got.items, n = 0, total = 0;
    if (zone) {
      for (; n < items.length; n++) {
        var it = items[n];
        var w = it.iconW + (it.iconW && it.textW ? P.ICON_TEXT_GAP : 0) + it.textW;
        var gap = n > 0 ? P.ITEM_GAP : 0;
        if (total + gap + w > maxW) { break; }
        total += gap + w;
      }
    }
    items.slice(n).forEach(function (it) { skipped.push({ slot: it.slot, metric: it.metric, reason: 'no-room' }); });
    l.statusItems = [];
    l.statusSkipped = skipped.sort(function (a, b) { return a.slot - b.slot; });
    if (!zone) { return; }
    var x = zone.x + idiv(zone.w - total, 2);
    var iconY = zone.y + idiv(zone.h - 2 - P.ICON_S, 2);
    var textY = zone.y + idiv(zone.h - 2 - P.SMALL_DIGIT_H, 2) - P.SMALL_TOP_PAD;
    var iconFn = opts.drawIcon || drawIcon;
    for (var i = 0; i < n; i++) {
      var item = items[i], x0 = x;
      if (i > 0) { fillRect(sf, rect(x - idiv(P.ITEM_GAP, 2) - 1, zone.y + idiv(zone.h, 2) - 2, 1, 1), th.dim); }
      if (item.iconW) {
        iconFn(sf, item.icon, x, iconY, P.ICON_S, th.fg, th.bg, got.state);
        x += item.iconW + (item.textW ? P.ICON_TEXT_GAP : 0);
      }
      if (item.textW) {
        drawText(sf, item.text, P.fonts.small,
                 rect(x, textY, item.textW + 2, P.SMALL_DIGIT_H + P.SMALL_TOP_PAD + P.TEXT_BOX_SLACK), th.fg);
        x += item.textW;
      }
      l.statusItems.push({ slot: item.slot, metric: item.metric, x: x0, w: x - x0, text: item.text });
      x += P.ITEM_GAP;
    }
  }

  // -------------------------------------------------------------------------
  // Banner, header, grid (draw_calendar.c, rectangular branch).

  function bannerText(P, s, data, maxW) {
    var now = data.now, day = now.getDate(), year = now.getFullYear();
    var wdFull = WEEKDAYS[now.getDay()], wdAb = wdFull.slice(0, 3);
    var monFull = MONTHS[now.getMonth()], monAb = monFull.slice(0, 3);
    var dayFirst = !/^en_US/.test(data.locale || 'en_US');
    var mon = now.getMonth() + 1, c;
    switch (s.BANNER_CONTENT) {
      case 1: c = dayFirst ? [day + ' ' + monFull, day + ' ' + monAb] : [monFull + ' ' + day, monAb + ' ' + day]; break;
      case 2: c = dayFirst
          ? [wdFull + ', ' + day + ' ' + monFull, wdAb + ', ' + day + ' ' + monAb, day + ' ' + monAb]
          : [wdFull + ', ' + monFull + ' ' + day, wdAb + ', ' + monAb + ' ' + day, monAb + ' ' + day]; break;
      case 3: c = dayFirst
          ? [day + ' ' + monFull + ' ' + year, day + ' ' + monAb + ' ' + year, day + ' ' + monAb]
          : [monFull + ' ' + day + ', ' + year, monAb + ' ' + day + ', ' + year, monAb + ' ' + day]; break;
      case 4: c = dayFirst
          ? [wdAb + ', ' + day + ' ' + monAb + ' ' + year, day + ' ' + monAb + ' ' + year, day + ' ' + monAb]
          : [wdAb + ', ' + monAb + ' ' + day + ', ' + year, monAb + ' ' + day + ', ' + year, monAb + ' ' + day]; break;
      case 5: c = dayFirst ? [day + '/' + mon + '/' + year, day + '/' + mon]
          : [mon + '/' + day + '/' + year, mon + '/' + day]; break;
      default: c = [monFull, monAb];
    }
    for (var i = 0; i < c.length; i++) {
      var t = c[i].toUpperCase();
      if (i === c.length - 1 || measureText(t, P.fonts.banner).w <= maxW) { return t; }
    }
    return '';
  }

  function drawDayNumber(P, sf, day, cell, c, topAnchor) {
    var y = topAnchor ? cell.y - P.SMALL_TOP_PAD
        : cell.y + idiv(cell.h - 1 - P.SMALL_DIGIT_H, 2) - P.SMALL_TOP_PAD;
    drawText(sf, String(day), P.fonts.small,
             rect(cell.x, y, cell.w, P.SMALL_DIGIT_H + P.SMALL_TOP_PAD + P.TEXT_BOX_SLACK), c, 'center');
  }

  // dots: per-calendar event counts for the day, e.g. [1, 0, 2].
  function drawDots(P, sf, counts, cell, onToday, s, th) {
    counts = (counts || []).slice(0, 3).map(function (n) { return Math.min(3, Math.max(0, n | 0)); });
    while (counts.length < 3) { counts.push(0); }
    var distinct = counts.filter(Boolean).length;
    if (!distinct) { return; }
    var slots = counts.map(function (n) { return n ? 1 : 0; }), n = distinct, progress = true;
    while (n < 3 && progress) {
      progress = false;
      for (var cal = 0; cal < 3 && n < 3; cal++) {
        if (slots[cal] && slots[cal] < counts[cal]) { slots[cal]++; n++; progress = true; }
      }
    }
    var bar = s.DOTS_STYLE === 0, seg = 0;
    var my = cell.y + P.SMALL_DIGIT_H + 1, availH = cell.h - P.SMALL_DIGIT_H - 1;
    if (availH < 1) { return; }
    var sqH = Math.min(P.DOT_SQ_H, availH), barW = cell.w - 7;
    var x = bar ? cell.x + idiv(cell.w - barW, 2)
        : cell.x + idiv(cell.w - (n * P.DOT_SQ_W + (n - 1) * P.DOT_GAP), 2);
    var colors = [s.CAL1_COLOR, s.CAL2_COLOR, s.CAL3_COLOR];
    for (var c = 0; c < 3; c++) {
      var reps = bar ? (counts[c] ? 1 : 0) : slots[c];
      var col = onToday && colors[c] === th.accent ? th.onAccent : colors[c];
      for (var r = 0; r < reps; r++) {
        if (bar) {
          var w = idiv(barW, distinct) + (seg === distinct - 1 ? barW % distinct : 0);
          fillRect(sf, rect(x, my, w, 1), col);
          x += w;
        } else {
          fillRect(sf, rect(x, my, P.DOT_SQ_W, sqH), col);
          x += P.DOT_SQ_W + P.DOT_GAP;
        }
        seg++;
      }
    }
  }

  function drawCalendar(P, sf, l, s, data, th) {
    var now = data.now, bz = l.banner;
    if (bz) {
      var text = bannerText(P, s, data, bz.w - 6);
      var tc = th.accent;
      if (s.BANNER_STYLE === 0) {
        fillRect(sf, bz, th.accent);
        tc = th.onAccent;
      } else if (s.BANNER_STYLE === 2) {
        fillRect(sf, rect(bz.x, bz.y, bz.w, 1), th.accent);
        fillRect(sf, rect(bz.x, bz.y + bz.h - 1, bz.w, 1), th.accent);
      }
      drawText(sf, text, P.fonts.banner, rect(bz.x, bz.y - P.BANNER_TEXT_LIFT, bz.w, bz.h + 6), tc,
               'center', 'ellipsis');
      l.bannerText = text;
    }
    // "!" when markers are on but the phone's last calendar refresh failed.
    if (s.DOTS_ENABLED && data.dots && data.dots.failed && bz) {
      drawText(sf, '!', P.fonts.banner, rect(bz.x, bz.y - P.BANNER_TEXT_LIFT, bz.w - 5, bz.h + 6),
               s.BANNER_STYLE === 0 ? th.onAccent : th.accent, 'right');
    }

    var sw = startWday(s), lead = monthLead(now, sw);
    if (l.bannerInline && lead >= 2) {
      var bar = rect(l.grid.x, l.grid.y, lead * l.cellW - 3, l.rowPitch - 1);
      var filled = s.BANNER_STYLE === 0;
      if (filled) {
        fillRect(sf, bar, th.accent, 2);
      } else if (s.BANNER_STYLE === 2) {
        fillRect(sf, rect(bar.x, bar.y, bar.w, 1), th.accent);
        fillRect(sf, rect(bar.x, bar.y + bar.h - 1, bar.w, 1), th.accent);
      }
      var inText = MONTHS[now.getMonth()].toUpperCase();
      if (measureText(inText, P.fonts.smallBold).w > bar.w - 4) { inText = inText.slice(0, 3); }
      drawText(sf, inText, P.fonts.smallBold,
               rect(bar.x, bar.y + idiv(bar.h - P.SMALL_DIGIT_H, 2) - P.SMALL_TOP_PAD, bar.w,
                    P.SMALL_DIGIT_H + P.SMALL_TOP_PAD + P.TEXT_BOX_SLACK),
               filled ? th.onAccent : th.accent, 'center');
      l.inlineBanner = bar;
    }

    if (l.header) {
      var two = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], one = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      for (var i = 0; i < 7; i++) {
        var di = (sw + i) % 7;
        drawText(sf, s.HEADER_LABEL === 1 ? one[di] : two[di], P.fonts.header,
                 rect(l.header.x + i * l.cellW, l.header.y - P.HEADER_TOP_PAD, l.cellW,
                      l.header.h + P.HEADER_TOP_PAD + P.TEXT_BOX_SLACK), th.fg, 'center');
      }
    }

    var year = now.getFullYear(), mon = now.getMonth(), today = now.getDate();
    var ndays = daysInMonth(year, mon), rows = idiv(lead + ndays + 6, 7);
    var prevDays = daysInMonth(mon === 0 ? year - 1 : year, (mon + 11) % 12);
    var dots = data.dots && data.dots.days;
    var dotsOn = !!(s.DOTS_ENABLED && l.rowPitch >= P.SMALL_DIGIT_H + 2 && dots);

    if (s.GRID_LINES) {
      var g = l.grid, cw = idiv(g.w, 7), gr = s.SHOW_ADJACENT ? 6 : rows, gh = l.rowPitch * gr;
      for (var v = 0; v <= 7; v++) { fillRect(sf, rect(g.x + v * cw, g.y, 1, gh), s.GRID_COLOR); }
      for (var hz = 0; hz <= gr; hz++) { fillRect(sf, rect(g.x, g.y + hz * l.rowPitch, cw * 7 + 1, 1), s.GRID_COLOR); }
    }

    l.cells = [];
    var total = s.SHOW_ADJACENT ? 42 : rows * 7;
    for (var ci = 0; ci < total; ci++) {
      var day = ci - lead + 1, col = ci % 7, row = idiv(ci, 7);
      var cell = rect(l.grid.x + col * l.cellW, l.grid.y + row * l.rowPitch, l.cellW, l.rowPitch);
      if (day < 1 || day > ndays) {
        if (!s.SHOW_ADJACENT) { continue; }
        var shown = day < 1 ? prevDays + day : day - ndays;
        drawDayNumber(P, sf, shown, cell, th.dim, dotsOn);
        l.cells.push({ day: shown, inMonth: false, row: row, col: col, x: cell.x, y: cell.y, w: cell.w, h: cell.h });
        continue;
      }
      var isToday = day === today;
      if (isToday) {
        var top = dotsOn ? cell.y : cell.y + idiv(cell.h - 1 - P.SMALL_DIGIT_H, 2);
        var box = rect(cell.x + 1, top - 2, cell.w - 2, P.SMALL_DIGIT_H + 4);
        if (box.y < cell.y - 1) { box.y = cell.y - 1; }
        if (box.y + box.h > cell.y + cell.h) { box.h = cell.y + cell.h - box.y; }
        fillRect(sf, box, th.accent, 2);
        drawDayNumber(P, sf, day, cell, th.onAccent, dotsOn);
        l.todayBox = box;
      } else {
        drawDayNumber(P, sf, day, cell, th.fg, dotsOn);
      }
      if (dotsOn) { drawDots(P, sf, dots[day - 1], cell, isToday, s, th); }
      l.cells.push({ day: day, inMonth: true, today: isToday, row: row, col: col,
                     x: cell.x, y: cell.y, w: cell.w, h: cell.h });
    }
  }

  // -------------------------------------------------------------------------
  // Public API.

  function toRGBA(sf, corrected) {
    var px = new Uint8ClampedArray(sf.width * sf.height * 4), lut = [];
    for (var c = 0; c < 64; c++) { lut.push(colorToRGB(c, corrected)); }
    for (var i = 0; i < sf.data.length; i++) {
      var rgb = lut[sf.data[i]];
      px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255;
    }
    return px;
  }

  // render(settings, data, opts) -> {width, height, pixels, layout, surface}
  //   opts.platform    'emery' (only one built)
  //   opts.extras      {height, gap = 0}: a band reserved under the status line
  //   opts.obstruction px covered at the bottom (Quick View): the layout gets
  //                    the unobstructed bounds, as layer_get_unobstructed_bounds
  //   opts.statusOverrides {<metric>: {text, icon}}: preview a text the C doesn't produce
  //   opts.drawIcon    replaces drawIcon (same signature) for icon experiments
  //   opts.draw        function (surface, layout, api) run after the face is drawn
  //   opts.corrected   true = pebble-tool's screenshot colours instead of raw GColor
  function render(settings, data, opts) {
    opts = opts || {};
    data = Object.assign({ connected: true }, data || {});
    data.now = data.now ? new Date(data.now) : new Date();
    var P = PLATFORMS[opts.platform || 'emery'];
    var s = normalizeSettings(settings);
    var th = themeColors(s);
    var sf = createSurface(P.width, P.height, th.bg);
    var l = computeLayout(P, s, data.now, opts.extras, opts.obstruction, use24h(s, data));
    // Layer order on the watch: calendar, then status, then time on top.
    drawCalendar(P, sf, l, s, data, th);
    drawStatus(P, sf, l, s, data, th, opts);
    drawTime(P, sf, l, s, data, th);
    l.theme = th;
    if (opts.draw) { opts.draw(sf, l, api); }
    return { width: P.width, height: P.height, pixels: toRGBA(sf, opts.corrected), layout: l, surface: sf };
  }

  function toCanvas(canvas, settings, data, opts) {
    var out = render(settings, data, opts);
    canvas.width = out.width;
    canvas.height = out.height;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(out.width, out.height);
    img.data.set(out.pixels);
    ctx.putImageData(img, 0, 0);
    return out;
  }

  var api = {
    render: render, toCanvas: toCanvas, toRGBA: toRGBA,
    measureText: measureText, drawText: drawText, drawIcon: drawIcon, iconWidth: iconWidth,
    fillRect: fillRect, drawRect: drawRect, drawLine: drawLine, fillCircle: fillCircle,
    drawPixel: drawPixel, createSurface: createSurface,
    themeColors: themeColors, colorFromHex: colorFromHex, colorToRGB: colorToRGB,
    colorToCSS: colorToCSS, normalizeSettings: normalizeSettings,
    GColor: C, METRIC: M, COND: COND, THEME_NAMES: THEME_NAMES, PLATFORMS: PLATFORMS,
    DEFAULTS: DEFAULTS, rect: rect,
  };

  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.MonthGridFace = api; }
})(typeof self !== 'undefined' ? self : this);
