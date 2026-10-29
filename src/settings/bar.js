// The next event in the month bar, worked out the way the watch would: a
// ladder of (date, event) texts tried in order, the first that fits wins,
// measured with the watch's own fonts. prv_banner_text in draw_calendar.c
// already works like this for the date alone; this adds the event to it.
// Runs in the browser and under node (tools/bar-cases.js checks every case).
(function (global) {
  'use strict';
  function F() { return global.MonthGridFace || require('./monthgrid-face.js'); }

  // Each watch's bar. textW is the room between the bar's side paddings;
  // on Round 2 the bar runs edge to edge and the circle clips it, so the
  // room is the circle's width where the letters sit.
  var WATCHES = {
    emery: { name: 'Pebble Time 2', width: 200, barH: 20, date: 'GOTHIC_18_BOLD', event: 'GOTHIC_18',
      lift: 3, pad: 5, gap: 8, glyph: 9, shape: 'rect' },
    basalt: { name: 'Pebble 2 Duo, Time, and 2', width: 144, barH: 14, date: 'GOTHIC_14_BOLD', event: 'GOTHIC_14',
      lift: 2, pad: 4, gap: 6, glyph: 7, shape: 'rect' },
    gabbro: { name: 'Pebble Round 2', width: 260, barH: 20, date: 'GOTHIC_18_BOLD', event: 'GOTHIC_18',
      lift: 3, pad: 6, gap: 8, glyph: 9, shape: 'round' },
    chalk: { name: 'Pebble Time Round', bar: false },
  };
  // Round 2's bar sits under the time, so its height on screen (and the
  // circle's width there) follows the time size (layout.c, R_BANNER_H).
  var ROUND_TIME_H = [40, 24, 21];
  function barRect(watchId, timeSize) {
    var w = WATCHES[watchId];
    if (w.shape === 'round') { return { x: 0, y: ROUND_TIME_H[timeSize || 0] + 40, w: w.width, h: w.barH }; }
    return { x: 0, y: 0, w: w.width, h: w.barH };
  }
  // The span the text may use, [left, right).
  function textSpan(watchId, bar) {
    var w = WATCHES[watchId];
    if (w.shape !== 'round') { return [bar.x + w.pad, bar.x + bar.w - w.pad]; }
    var r = w.width / 2, dy = r - (bar.y + 3);   // the letters' top edge, where the circle is narrowest
    var half = Math.floor(Math.sqrt(r * r - dy * dy));
    return [r - half + w.pad, r + half - w.pad];
  }

  // ---- Names --------------------------------------------------------------
  // English is the watch's own; the others stand in for its language packs.
  var LOCALES = {
    'en-US': { label: 'English', dayFirst: false },
    de: { label: 'German', dayFirst: true },
    es: { label: 'Spanish', dayFirst: true },
    fr: { label: 'French', dayFirst: true },
  };
  var nameCache = {};
  function names(locale) {
    if (nameCache[locale]) { return nameCache[locale]; }
    function list(n, opt, at) {
      var out = [], fmt = new Intl.DateTimeFormat(locale, opt);
      for (var i = 0; i < n; i++) { out.push(fmt.format(at(i)).replace(/\.$/, '')); }
      return out;
    }
    var months = function (i) { return new Date(2026, i, 1); };
    var days = function (i) { return new Date(2026, 1, 1 + i); };   // 2026-02-01 is a Sunday
    return (nameCache[locale] = {
      monFull: list(12, { month: 'long' }, months), monAb: list(12, { month: 'short' }, months),
      wdFull: list(7, { weekday: 'long' }, days), wdAb: list(7, { weekday: 'short' }, days),
      dayFirst: LOCALES[locale].dayFirst,
    });
  }
  // The watch upper-cases ASCII only (prv_uppercase_ascii), so "März"
  // becomes "MäRZ" today. upperAll is the fix: Latin-1 letters too.
  function upperAscii(s) { return s.replace(/[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function upperAll(s) {
    return s.replace(/[a-zà-þ]/g, function (c) { return c === '÷' ? c : c.toUpperCase(); });
  }

  // prv_banner_text's candidates, longest first. With an event in the bar
  // one more rung follows: the month alone (the grid still marks today).
  function dateLadder(content, locale, d, withEvent, fixCase) {
    var L = names(locale), df = L.dayFirst;
    var day = d.getDate(), year = d.getFullYear(), mon = d.getMonth() + 1;
    var wf = L.wdFull[d.getDay()], wa = L.wdAb[d.getDay()], mf = L.monFull[d.getMonth()], ma = L.monAb[d.getMonth()];
    var c;
    switch (content) {
      case 1: c = df ? [day + ' ' + mf, day + ' ' + ma] : [mf + ' ' + day, ma + ' ' + day]; break;
      case 2: c = df ? [wf + ', ' + day + ' ' + mf, wa + ', ' + day + ' ' + ma, day + ' ' + ma]
        : [wf + ', ' + mf + ' ' + day, wa + ', ' + ma + ' ' + day, ma + ' ' + day]; break;
      case 3: c = df ? [day + ' ' + mf + ' ' + year, day + ' ' + ma + ' ' + year, day + ' ' + ma]
        : [mf + ' ' + day + ', ' + year, ma + ' ' + day + ', ' + year, ma + ' ' + day]; break;
      case 4: c = df ? [wa + ', ' + day + ' ' + ma + ' ' + year, day + ' ' + ma + ' ' + year, day + ' ' + ma]
        : [wa + ', ' + ma + ' ' + day + ', ' + year, ma + ' ' + day + ', ' + year, ma + ' ' + day]; break;
      case 5: c = df ? [day + '/' + mon + '/' + year, day + '/' + mon] : [mon + '/' + day + '/' + year, mon + '/' + day]; break;
      default: c = [mf, ma];
    }
    if (withEvent && content !== 0 && content !== 5) { c.push(ma); }
    var up = fixCase ? upperAll : upperAscii;
    return c.map(up).filter(function (s, i, a) { return a.indexOf(s) === i; });
  }

  // ---- The event's words -----------------------------------------------------
  // ev = {name, start, end, allDay}. text is the short form ("12m", "2:30p",
  // "tmrw 9:00a"), full what follows the name in a sentence ("in 12m",
  // "at 2:30p", "tomorrow at 9:00a"); both empty for an all-day event on its day.
  function clock(d, h24) {
    var h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2);
    return h24 ? h + ':' + m : ((h % 12) || 12) + ':' + m + (h < 12 ? 'a' : 'p');
  }
  function dayNumber(d) { return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }
  function when(ev, now, h24) {
    var later = dayNumber(ev.start) > dayNumber(now);
    if (ev.allDay) {
      return later ? { kind: 'tomorrow', text: 'tmrw', full: 'tomorrow' } : { kind: 'allday', text: '', full: '' };
    }
    if (now >= ev.start) { return { kind: 'now', text: 'now', full: 'now' }; }
    var min = Math.ceil((ev.start - now) / 60000), t;
    if (min < 120) {
      t = min < 60 ? min + 'm' : Math.floor(min / 60) + 'h' + ('0' + (min % 60)).slice(-2);
      return { kind: 'soon', text: t, full: 'in ' + t };
    }
    t = clock(ev.start, h24);
    return later ? { kind: 'tomorrow', text: 'tmrw ' + t, full: 'tomorrow at ' + t }
      : { kind: 'clock', text: t, full: 'at ' + t };
  }
  // The phone sends at most 23 bytes (EVENT_NAME_LEN - 1). Today it cuts
  // anywhere; cutName is the fix: at a word, marked with an ellipsis.
  function bytes(s) { return unescape(encodeURIComponent(s)).length; }
  function cutName(name, max) {
    max = max || 23;
    if (bytes(name) <= max) { return name; }
    var cps = Array.from(name), out = '';
    for (var i = 0; i < cps.length && bytes(out + cps[i]) <= max - 3; i++) { out += cps[i]; }
    var sp = out.lastIndexOf(' ');
    if (sp >= 8) { out = out.slice(0, sp); }
    return out.replace(/[\s,.;:–—-]+$/, '') + '…';
  }
  function cutBytes(name, max) {
    var cps = Array.from(name), out = '';
    for (var i = 0; i < cps.length && bytes(out + cps[i]) <= (max || 23); i++) { out += cps[i]; }
    return out;
  }

  // ---- The ladder -----------------------------------------------------------
  var MIN_NAME = 3;   // a name shorter than this, plus "…", says nothing
  // What a cut name shouldn't end on: spaces, punctuation, dashes, and an
  // ellipsis the phone already added (trim_name_end in event.c).
  function trimEnd(s) { return s.replace(/[ ,.;:\-\u2013\u2014\u2026]+$/, ''); }
  var widthCache = {};
  function width(text, font) {
    var k = font + '\u0000' + text;
    if (widthCache[k] === undefined) { widthCache[k] = text ? F().measureText(text, font).w : 0; }
    return widthCache[k];
  }

  // cfg: {watch, content, locale, now, event (or null), h24, stale, timeSize, fixCase}
  // Returns {date, event, glyph, rung, step, span, staleW, fits}.
  function compose(cfg) {
    var w = WATCHES[cfg.watch];
    if (w.bar === false) { return null; }
    var bar = barRect(cfg.watch, cfg.timeSize), span = textSpan(cfg.watch, bar);
    var room = span[1] - span[0];
    var staleW = cfg.stale ? width('!', w.date) + 4 : 0;
    if (!cfg.event) {
      // As the watch does it today: the first candidate that fits, centered.
      var plain = dateLadder(cfg.content, cfg.locale, cfg.now, false, cfg.fixCase);
      var pick = plain[plain.length - 1];
      for (var p = 0; p < plain.length; p++) {
        if (width(plain[p], w.date) <= bar.w - 6) { pick = plain[p]; break; }
      }
      return { date: pick, event: null, rung: 0, step: 'date', span: span, staleW: staleW, bar: bar,
        fits: width(pick, w.date) <= room };
    }
    var avail = room - staleW;
    var ev = cfg.event, t = when(ev, cfg.now, cfg.h24), name = ev.name || 'Event';
    var full = t.full ? name + ' ' + t.full : name;
    var compact = t.text ? name + ' ' + t.text : name;
    var forms = full === compact ? [full] : [full, compact];
    var dates = dateLadder(cfg.content, cfg.locale, cfg.now, true, cfg.fixCase);
    var rung = 0;
    // cfg.trace, when given, collects every line tried, for the review page.
    function fits(d, e, glyph, phase) {
      var used = width(d, w.date) + w.gap + (glyph ? w.glyph + 3 : 0) + width(e, w.event);
      if (cfg.trace) {
        cfg.trace.push({ date: d, event: e, glyph: !!glyph, used: used, room: avail, ok: used <= avail, phase: phase });
      }
      return used <= avail;
    }
    function done(d, e, glyph, step) {
      return { date: d, event: e, glyph: glyph, rung: rung, step: step, span: span, staleW: staleW, bar: bar,
        fits: true, kind: t.kind };
    }
    // 1. Every date, longest first, each with the event in full and then
    //    without "in"/"at": the event's words outrank the date's length.
    for (var i = 0; i < dates.length; i++) {
      for (var j = 0; j < forms.length; j++) {
        rung++;
        if (fits(dates[i], forms[j])) {
          return done(dates[i], forms[j], false, i === 0 && j === 0 ? 'full' : j ? 'compact' : 'shortdate');
        }
      }
    }
    // 2. The shortest date; the name loses letters from its end, the time stays.
    var d = dates[dates.length - 1], cps = Array.from(trimEnd(name));
    for (var n = cps.length - 1; n >= MIN_NAME; n--) {
      rung++;
      var cut = trimEnd(cps.slice(0, n).join('')) + '…';
      var e = t.text ? cut + ' ' + t.text : cut;
      if (fits(d, e, false, 'cut')) { return done(d, e, false, 'cut'); }
    }
    // 3. The time alone, with the calendar mark.
    rung++;
    if (t.text && fits(d, t.text, true)) { return done(d, t.text, true, 'timeonly'); }
    // 4. Nothing else fits: the date steps aside. (No watch reaches this.)
    rung++;
    var r = done('', t.text || cut, !!t.text, 'nodate');
    r.fits = width(r.event, w.event) + (r.glyph ? w.glyph + 3 : 0) <= avail;
    return r;
  }

  // ---- Drawing ----------------------------------------------------------------
  var CAL9 = ['111111111', '101000101', '111111111', '100000001', '101010101', '100000001',
    '101010101', '100000001', '111111111'];
  var CAL7 = ['1111111', '1010101', '1111111', '1000001', '1010101', '1000001', '1111111'];
  function calMark(sf, x, y, size, color) {
    (size === 7 ? CAL7 : CAL9).forEach(function (row, j) {
      for (var i = 0; i < row.length; i++) {
        if (row[i] === '1') { F().fillRect(sf, F().rect(x + i, y + j, 1, 1), color); }
      }
    });
  }

  // Paints the bar into surface sf at rect bar: the style's fill or rules,
  // then res (from compose). th = theme colors; style 0 bar, 1 plain, 2 ruled.
  function paint(sf, watchId, bar, th, style, res) {
    var w = WATCHES[watchId], api = F();
    var filled = style === 0;
    if (filled) { api.fillRect(sf, bar, th.accent); }
    else {
      api.fillRect(sf, api.rect(bar.x, bar.y, bar.w, bar.h), th.bg);
      if (style === 2) {
        api.fillRect(sf, api.rect(bar.x, bar.y, bar.w, 1), th.accent);
        api.fillRect(sf, api.rect(bar.x, bar.y + bar.h - 1, bar.w, 1), th.accent);
      }
    }
    var dateColor = filled ? th.onAccent : th.accent, eventColor = filled ? th.onAccent : th.fg;
    var ty = bar.y - w.lift, th6 = bar.h + 6;
    var span = res.span;
    if (!res.event) {
      api.drawText(sf, res.date, w.date, api.rect(bar.x, ty, bar.w, th6), dateColor, 'center', 'ellipsis');
    } else {
      if (res.date) { api.drawText(sf, res.date, w.date, api.rect(span[0], ty, span[1] - span[0], th6), dateColor, 'left'); }
      var right = span[1] - res.staleW;
      var ew = width(res.event, w.event);
      api.drawText(sf, res.event, w.event, api.rect(right - ew, ty, ew + 1, th6), eventColor, 'left');
      if (res.glyph) {
        calMark(sf, right - ew - 3 - w.glyph, bar.y + Math.floor((bar.h - w.glyph) / 2), w.glyph, eventColor);
      }
    }
    if (res.staleW) {
      api.drawText(sf, '!', w.date, api.rect(span[0], ty, span[1] - span[0], th6), dateColor, 'right');
    }
  }

  // A picture of just the bar on one watch (Round 2 with the circle's edge).
  // Returns {width, height, pixels}; outside the screen is transparent.
  function strip(cfg, settings) {
    var w = WATCHES[cfg.watch], api = F();
    var th = api.themeColors(api.normalizeSettings(settings || {}));
    var res = compose(cfg);
    var bar = res.bar, margin = w.shape === 'round' ? 8 : 4;
    var H = bar.h + 2 * margin, sf = api.createSurface(w.width, H, th.bg);
    var local = api.rect(0, margin, bar.w, bar.h);
    var shifted = { date: res.date, event: res.event, glyph: res.glyph, staleW: res.staleW,
      span: res.span };
    paint(sf, cfg.watch, local, th, settings && settings.BANNER_STYLE || 0, shifted);
    var px = api.toRGBA(sf);
    if (w.shape === 'round') {
      var r = w.width / 2;
      for (var y = 0; y < H; y++) {
        var sy = bar.y - margin + y + 0.5;
        for (var x = 0; x < w.width; x++) {
          var dx = x + 0.5 - r, dy = sy - r;
          if (dx * dx + dy * dy > r * r) { px[(y * w.width + x) * 4 + 3] = 0; }
        }
      }
    }
    return { width: w.width, height: H, pixels: px, res: res };
  }

  var MGBar = { WATCHES: WATCHES, LOCALES: LOCALES, compose: compose, paint: paint, strip: strip,
    dateLadder: dateLadder, when: when, cutName: cutName, cutBytes: cutBytes, width: width,
    calMark: calMark, barRect: barRect, upperAll: upperAll, upperAscii: upperAscii, trimEnd: trimEnd };
  if (typeof module === 'object' && module.exports) { module.exports = MGBar; }
  else { global.MGBar = MGBar; }
})(typeof window !== 'undefined' ? window : globalThis);
