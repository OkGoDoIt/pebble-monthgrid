// The model behind MonthGrid's settings page: what a person picks, what the
// watch would draw for it at a moment, and pictures cut from that drawing.
// Plain script, no framework: the real page ships inside the watchface as a
// data: URI. Needs monthgrid-face.js (the preview renderer) loaded first;
// bar.js and event.js paint what the watch doesn't draw yet.
(function (global) {
  'use strict';

  var M = { BATTERY: 1, WEATHER: 2, STEPS: 3, DISTANCE: 4, HEART: 5, ACTIVE: 6, CALORIES: 7,
    SLEEP: 8, WEEK: 9, CONNECTION: 10, ALARM: 11, CALORIES_TOTAL: 12, EVENT: 13,
    PHONE_BATTERY: 14, READING_1: 15 };
  // The watch keeps 8 status slots today; the build raises this to every item
  // (the page has no limit). Items past it here simply wait for room.
  var MAX_METRICS = 8;

  function opt(key, label, choices, def, more) {
    var o = { key: key, label: label, choices: choices, def: def };
    Object.keys(more || {}).forEach(function (k) { o[k] = more[k]; });
    return o;
  }

  // The status items. An item can have its own options, and one item can
  // stand for more than one watch metric (Battery: the watch's, the phone's, or both).
  var ITEMS = [
    { id: 'battery', name: 'Battery', options: [
      opt('source', 'Which battery', [['watch', 'Watch'], ['phone', 'Phone'], ['both', 'Watch and phone']], 'watch'),
      opt('when', 'Show it', [['always', 'Always'], ['50', 'At 50% or less'], ['20', 'At 20% or less']], 'always',
        { note: function (st) {
          return optValue(st, 'battery', 'source') === 'both' && optValue(st, 'battery', 'when') !== 'always'
            ? 'Each battery shows on its own once it gets that low.' : null; } })] },
    { id: 'weather', name: 'Weather', options: [
      opt('detail', 'Show', [['now', 'Now'], ['range', 'Now, high and low'], ['hours', 'Next 3 hours']], 'now'),
      opt('unit', 'Unit', [['f', '°F'], ['c', '°C']], 'f')] },
    { id: 'steps', name: 'Steps', options: [
      opt('show', 'Show', [['count', 'Today’s count'], ['usual', 'Ahead or behind your usual']], 'count')] },
    { id: 'distance', name: 'Distance walked', options: [
      opt('unit', 'Unit', [['mi', 'Miles'], ['km', 'Kilometers']], 'mi')] },
    { id: 'heart', name: 'Heart rate' },
    { id: 'active', name: 'Active minutes' },
    { id: 'calories', name: 'Calories', options: [
      opt('count', 'Count', [['active', 'Active'], ['total', 'Active and resting']], 'active')] },
    { id: 'sleep', name: 'Sleep last night', options: [
      opt('kind', 'Show', [['all', 'All sleep'], ['deep', 'Deep sleep']], 'all')] },
    { id: 'alarm', name: 'Next alarm', options: [
      opt('when', 'Show it', [['always', 'Whenever one is set'], ['12h', 'In the 12 hours before']], 'always')] },
    { id: 'week', name: 'Week number' },
    { id: 'conn', name: 'Phone disconnected', options: [
      opt('vibe', 'Vibrate', [['off', 'No'], ['on', 'When it drops']], 'off')],
      summary: function (st) {
        return 'While your phone is away' + (optValue(st, 'conn', 'vibe') === 'on' ? ' · vibrates' : '');
      } },
    { id: 'reading1', name: 'AAPL', group: 'From other apps', options: [
      opt('label', 'Show', [['value', 'Value only'], ['label', 'Name and value']], 'value')] },
  ];
  var BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  // The next event is its own setting: whether and where it shows.
  var EVENT = {
    place: opt('place', 'Where', [['off', 'Off'], ['bar', 'In the month bar'], ['own', 'On its own line'],
      ['line', 'In the status line'], ['take', 'Takes over the status line']], 'bar'),
    within: opt('within', 'Show it', [['1h', '1 hour before'], ['2h', '2 hours before'], ['4h', '4 hours before'],
      ['day', 'Any time today']], '2h'),
    style: opt('style', 'Show', [['full', 'Name and time'], ['short', 'Time only']], 'full'),
  };
  var TAKE_MIN = 15;

  // ---- Example data: Thursday, October 29, 9:48, Standup at 10:00 ------------
  function at(h, m, dayOffset) { return new Date(2026, 9, 29 + (dayOffset || 0), h, m); }
  function merge(a, b) {
    var out = {};
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      out[k] = (b[k] && typeof b[k] === 'object' && !(b[k] instanceof Date) && !Array.isArray(b[k])
        && a[k] && typeof a[k] === 'object') ? merge(a[k], b[k]) : b[k];
    });
    return out;
  }
  var BASE = {
    system24h: false,
    battery: { percent: 90, charging: false },
    connected: true,
    weather: { tempF: 56, cond: 2, highF: 64, lowF: 48, hoursF: [58, 61, 63] },
    // Event markers for October: [calendar 1, 2, 3] event counts per day.
    dots: { days: [[0], [1], [0], [0], [1, 1], [2], [0], [1], [0, 0, 1], [0], [0], [1, 1], [3], [1],
      [0], [1], [0], [0], [1], [2, 1], [1], [0], [1], [0], [0], [1, 0, 1], [1], [2], [1], [0], [0]] },
    health: { steps: 4212, usualSteps: 3600, distanceM: 3058, heartRate: 72, activeSec: 2040,
      activeKcal: 210, restingKcal: 930, sleepSec: 25920, deepSleepSec: 6480 },
    nextAlarm: at(6, 30, 1),
    phoneBattery: 64,
    readings: [{ label: 'AAPL', text: '$232.14' }],
    event: { name: 'Standup', start: at(10, 0), end: at(10, 15), allDay: false },
    now: at(9, 48),
  };

  // ---- Settings ---------------------------------------------------------
  var C = global.MonthGridFace.GColor;
  function defaultState() {
    return {
      look: { THEME: 0, CUSTOM_BG: C.Black, CUSTOM_FG: C.White, CUSTOM_ACCENT: C.VividCerulean,
        TIME_FONT: 0, TIME_SIZE: 0, TIME_FORMAT: 0, SHOW_SECONDS: false, BANNER_STYLE: 0, BANNER_CONTENT: 0,
        HEADER_LABEL: 0, START_DAY: 0, SHOW_ADJACENT: false, GRID_LINES: false, GRID_COLOR: C.DarkGray,
        DOTS_ENABLED: false, DOTS_STYLE: 0, CAL1_COLOR: C.Red, CAL2_COLOR: C.BlueMoon, CAL3_COLOR: C.IslamicGreen },
      // The status line as it is set on Roger's watch today, the two batteries as one item.
      status: ['conn', 'battery', 'alarm', 'heart', 'weather', 'distance'],
      opts: { battery: { source: 'both' } },
      event: { place: 'bar', within: '2h', style: 'full' },
      calendars: ['', '', ''],
    };
  }
  function optValue(state, id, key) {
    var o = state.opts[id];
    if (o && o[key] !== undefined) { return o[key]; }
    var spec = (BY_ID[id].options || []).filter(function (x) { return x.key === key; })[0];
    return spec ? spec.def : undefined;
  }
  function choiceLabel(o, v) { return o.choices.filter(function (c) { return c[0] === v; })[0][1]; }

  // ---- Text the watch would show ------------------------------------------
  function clock(d, h24) {
    var h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2);
    if (h24) { return h + ':' + m; }
    return ((h % 12) || 12) + ':' + m + (h < 12 ? 'a' : 'p');
  }
  // When the next event starts, as the status line says it (draw_status.c).
  function countdown(ev, now, h24) {
    if (now >= ev.start) { return 'now'; }
    var min = Math.ceil((ev.start - now) / 60000);
    if (min < 60) { return min + 'm'; }
    if (min < 120) { return Math.floor(min / 60) + 'h' + ('0' + (min % 60)).slice(-2); }
    if (min < 20 * 60) { return clock(ev.start, h24); }
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][ev.start.getDay()];
  }
  // "Standup in 23m", "Standup at 2:30p", "Standup now".
  function sentence(name, when) {
    if (when === 'now') { return name + ' now'; }
    return name + (when.indexOf(':') > 0 ? ' at ' : ' in ') + when;
  }
  function hm(sec) { return Math.floor(sec / 3600) + 'h' + ('0' + Math.floor(sec % 3600 / 60)).slice(-2); }
  function signedK(v) {
    var s = v < 0 ? '-' : '+', a = Math.abs(v);
    return s + (a < 1000 ? a : (Math.round(a / 100) / 10) + 'k');
  }
  function hex(c) { return ((c >> 4) & 3) * 0x550000 + ((c >> 2) & 3) * 0x5500 + (c & 3) * 0x55; }
  function temp(f, unit) { return unit === 'c' ? Math.round((f - 32) * 5 / 9) : f; }
  function eventVisible(ev, now, within) {
    if (!ev || (ev.end && now >= ev.end)) { return false; }
    // An all-day event has no start to count down to: it shows on its day
    // with "Any time today" only.
    if (ev.allDay) { return within === 'day' && ev.start.toDateString() === now.toDateString(); }
    if (within === 'day') { return ev.start.toDateString() === now.toDateString() || now >= ev.start; }
    var limit = { '1h': 60, '2h': 120, '4h': 240 }[within];
    return (ev.start - now) / 60000 <= limit;
  }

  // ---- From picks to what the watch draws ------------------------------
  // Works out, for one moment, which watch metrics each picked item becomes,
  // the text overrides for options the watch doesn't draw yet, why an item is
  // off right now, and where the next event goes.
  function plan(state, data) {
    var h24 = data.system24h || state.look.TIME_FORMAT === 2;
    var metrics = [], overrides = {}, rows = [], glyph = false, takeover = false;
    var E = state.event, ev = data.event, event = null, eventWhy = null;
    if (E.place === 'off') { eventWhy = 'Off'; }
    else if (!ev || !eventVisible(ev, data.now, E.within)) {
      eventWhy = !ev ? 'Nothing coming up' : E.within === 'day' ? 'Nothing more today'
        : 'Shows ' + choiceLabel(EVENT.within, E.within);
    } else {
      var when = countdown(ev, data.now, h24);
      if (E.place === 'line') {
        // In the status line it goes first: it's only there while it's close.
        metrics.push(M.EVENT);
        if (E.style === 'short') { overrides[M.EVENT] = { text: '   ' + when }; glyph = true; }
        else { overrides[M.EVENT] = { text: ev.name + ' ' + when }; }
      } else if (E.place === 'take') {
        if (ev.start - data.now <= TAKE_MIN * 60000) {
          takeover = true;
          metrics.push(M.EVENT);
          overrides[M.EVENT] = { text: '   ' + sentence(ev.name, when) };
          glyph = true;
        } else { eventWhy = 'Takes over the line ' + TAKE_MIN + ' minutes before'; }
      } else {
        event = { place: E.place, ev: ev, name: ev.name, when: when };
      }
    }
    state.status.forEach(function (id) {
      var row = { id: id, metrics: [], why: null };
      var v = function (k) { return optValue(state, id, k); };
      var push = function (m, text) {
        if (metrics.length >= MAX_METRICS) { row.overflow = true; return; }
        metrics.push(m); row.metrics.push(m);
        if (text !== undefined) { overrides[m] = { text: text }; }
      };
      switch (id) {
        case 'battery': {
          // A threshold applies to each battery on its own.
          var lim = v('when') === 'always' ? 100 : Number(v('when')), src = v('source');
          if (src !== 'phone' && data.battery.percent <= lim) { push(M.BATTERY); }
          if (src !== 'watch' && data.phoneBattery <= lim) { push(M.PHONE_BATTERY, '   ' + data.phoneBattery + '%'); }
          if (!row.metrics.length && !row.overflow) { row.why = 'Shows at ' + lim + '% or less'; }
          break;
        }
        case 'weather': {
          var w = data.weather, u = v('unit'), t = temp(w.tempF, u);
          var text = v('detail') === 'range' ? t + '°' + u.toUpperCase() + ' ' + temp(w.highF, u) + '/' + temp(w.lowF, u)
            : v('detail') === 'hours' ? t + '° ' + w.hoursF.map(function (x) { return temp(x, u) + '°'; }).join(' ')
            : undefined;
          push(M.WEATHER, text);
          break;
        }
        case 'steps':
          push(M.STEPS, v('show') === 'usual' ? signedK(data.health.steps - data.health.usualSteps) : undefined);
          break;
        case 'distance': push(M.DISTANCE); break;
        case 'heart': push(M.HEART); break;
        case 'active': push(M.ACTIVE); break;
        case 'calories': push(v('count') === 'total' ? M.CALORIES_TOTAL : M.CALORIES); break;
        case 'sleep': push(M.SLEEP, v('kind') === 'deep' ? hm(data.health.deepSleepSec) : undefined); break;
        case 'alarm':
          if (v('when') === '12h' && data.nextAlarm && data.nextAlarm - data.now > 12 * 3600000) {
            row.why = 'Shows in the 12 hours before';
          } else { push(M.ALARM); }
          break;
        case 'week': push(M.WEEK); break;
        case 'conn':
          push(M.CONNECTION);
          if (data.connected) { row.why = 'Shows only while your phone is away'; }
          break;
        case 'reading1': {
          var r = data.readings[0];
          push(M.READING_1, v('label') === 'label' ? r.label + ' ' + r.text : r.text);
          break;
        }
      }
      rows.push(row);
    });
    // In its last minutes an event that takes over is the line's only item.
    if (takeover) {
      metrics = [M.EVENT];
      rows.forEach(function (r) { if (!r.why) { r.why = 'Back once the event starts'; } });
    }
    // Colors are kept as Pebble colors (0..63) and sent as 0xRRGGBB, as Clay sends them.
    var settings = {};
    Object.keys(state.look).forEach(function (k) {
      var v = state.look[k];
      settings[k] = /_COLOR$|^CUSTOM_/.test(k) ? hex(v) : v;
    });
    for (var i = 0; i < MAX_METRICS; i++) { settings['METRIC' + (i + 1)] = metrics[i] || 0; }
    settings.TEMP_UNIT = optValue(state, 'weather', 'unit') === 'c' ? 0 : 1;
    settings.DIST_UNIT = optValue(state, 'distance', 'unit') === 'km' ? 0 : 1;
    settings.VIBE_DISCONNECT = optValue(state, 'conn', 'vibe') === 'on';
    return { settings: settings, overrides: overrides, rows: rows, event: event, eventWhy: eventWhy,
      takeover: takeover, state: state, eventGlyph: glyph, h24: h24 };
  }

  // ---- Drawing --------------------------------------------------------
  var Face = global.MonthGridFace;
  var QUICK_VIEW_H = 51;   // TIMELINE_PEEK_HEIGHT on rectangular watches
  function zone(layout, name) { return layout[name] || null; }
  // Renders the face for these picks at this moment; also works out each
  // row's fit on the watch: 'shown', 'room' (no room left) or 'hidden' (with why).
  function draw(state, data, extra) {
    var p = plan(state, data);
    var opts = { statusOverrides: p.overrides, obstruction: data.quickView ? QUICK_VIEW_H : 0 };
    if (extra) { Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; }); }
    var r = Face.render(p.settings, data, opts);
    if (p.event && p.event.place === 'own' && global.MGEvent) {
      // The event's own line shows only while it costs the face nothing
      // else (weekday letters, the bar, a time size); otherwise it goes in
      // the month bar.
      var withLine = Face.render(p.settings, data, merge(opts, { extras: global.MGEvent.band() }));
      if (withLine.layout.stage === r.layout.stage) { r = withLine; }
      else { p.event.place = 'bar'; p.event.from = 'own'; }
    }
    var drawn = {}, skipped = {};
    (r.layout.statusItems || []).forEach(function (it) { drawn[it.metric] = it; });
    (r.layout.statusSkipped || []).forEach(function (it) { skipped[it.metric] = it.reason; });
    r.drawn = drawn;
    if (global.MGEvent) { global.MGEvent.draw(r, p, data); }
    p.rows.forEach(function (row) {
      if (row.why) { row.state = 'hidden'; return; }
      var any = row.metrics.some(function (m) { return drawn[m]; });
      var room = row.overflow || row.metrics.some(function (m) { return skipped[m] === 'no-room'; });
      row.state = any ? 'shown' : room ? 'room' : 'hidden';
      if (row.state === 'hidden') { row.why = 'Nothing to show yet'; }
    });
    r.plan = p;
    return r;
  }
  // A canvas showing part of a render, scale CSS px per watch pixel.
  function crop(r, rect, scale) {
    rect = rect || { x: 0, y: 0, w: r.width, h: r.height };
    var c = document.createElement('canvas');
    c.width = Math.max(1, rect.w); c.height = Math.max(1, rect.h);
    var img = new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height);
    c.getContext('2d').putImageData(img, -rect.x, -rect.y, rect.x, rect.y, rect.w, rect.h);
    c.className = 'pix';
    c.style.width = (rect.w * (scale || 1)) + 'px';
    c.style.height = (rect.h * (scale || 1)) + 'px';
    return c;
  }
  function region(r, name, pad) {
    var z = zone(r.layout, name);
    if (!z) { return null; }
    pad = pad || 0;
    var x = Math.max(0, z.x - pad), y = Math.max(0, z.y - pad);
    return { x: x, y: y, w: Math.min(r.width - x, z.w + 2 * pad), h: Math.min(r.height - y, z.h + 2 * pad) };
  }
  // A rect of a render trimmed to what's drawn in it (columns that are all
  // one color are dropped from the sides), with pad pixels kept around it.
  function trim(r, rect, pad) {
    var px = r.pixels, W = r.width, bg = (rect.y * W + rect.x) * 4;
    function plain(x) {
      for (var y = rect.y; y < rect.y + rect.h; y++) {
        var i = (y * W + x) * 4;
        if (px[i] !== px[bg] || px[i + 1] !== px[bg + 1] || px[i + 2] !== px[bg + 2]) { return false; }
      }
      return true;
    }
    var x0 = rect.x, x1 = rect.x + rect.w - 1;
    while (x0 < x1 && plain(x0)) { x0++; }
    while (x1 > x0 && plain(x1)) { x1--; }
    x0 = Math.max(rect.x, x0 - pad); x1 = Math.min(rect.x + rect.w - 1, x1 + pad);
    return { x: x0, y: rect.y, w: x1 - x0 + 1, h: rect.h };
  }
  // Data in which an item that is off right now would show: how it looks
  // when it does.
  function whenShown(id, state, data) {
    switch (id) {
      case 'battery': {
        var lim = optValue(state, 'battery', 'when');
        lim = lim === 'always' ? 100 : Number(lim);
        return merge(data, { battery: { percent: Math.min(data.battery.percent, lim - 8) },
          phoneBattery: Math.min(data.phoneBattery, lim - 11) });
      }
      case 'event': return merge(data, { event: BASE.event, now: new Date(BASE.event.start - 12 * 60000) });
      case 'conn': return merge(data, { connected: false });
      case 'alarm': return merge(data, { nextAlarm: new Date(data.now.getTime() + 5 * 3600000) });
    }
    return data;
  }
  // One item drawn the way the watch draws it, for its row, at most maxW px
  // wide (scaled down, never cut). An item off right now is drawn as it looks
  // when it shows; the row dims it.
  function chip(state, id, data, maxW) {
    var s = JSON.parse(JSON.stringify(state));
    s.status = [id];
    s.event = { place: 'off' };
    function picture(r) {
      var z = zone(r.layout, 'status');
      var t = z && trim(r, z, 3);
      return t && t.w > 7 ? t : null;
    }
    var r = draw(s, data), rect = picture(r);
    if (!rect) { r = draw(s, whenShown(id, s, data)); rect = picture(r); }
    if (!rect) { return null; }
    return crop(r, rect, Math.min(1, (maxW || 120) / rect.w));
  }
  // An item's choices in a few words, for its row: "Watch and phone · at 50% or less".
  function summary(state, id) {
    var it = BY_ID[id];
    if (it.summary) { return it.summary(state); }
    return (it.options || []).map(function (o, i) {
      var label = choiceLabel(o, optValue(state, id, o.key));
      return i ? label.charAt(0).toLowerCase() + label.slice(1) : label;
    }).join(' · ');
  }

  // ---- Store ----------------------------------------------------------
  function Store(state) { this.state = state; this.fns = []; }
  Store.prototype.on = function (fn) { this.fns.push(fn); };
  Store.prototype.set = function (mutate) {
    mutate(this.state);
    this.fns.forEach(function (fn) { fn(); });
  };
  Store.prototype.setOpt = function (id, key, value) {
    this.set(function (s) { (s.opts[id] = s.opts[id] || {})[key] = value; });
  };

  // ---- Small DOM helpers --------------------------------------------------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') { e.textContent = attrs[k]; }
      else if (k === 'html') { e.innerHTML = attrs[k]; }
      else if (k.slice(0, 2) === 'on') { e.addEventListener(k.slice(2), attrs[k]); }
      else if (attrs[k] !== false && attrs[k] != null) { e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    });
    (kids || []).forEach(function (k) { if (k) { e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); } });
    return e;
  }
  function segmented(choices, value, onPick, label) {
    return el('div', { class: 'seg', role: 'group', 'aria-label': label }, choices.map(function (c) {
      return el('button', { type: 'button', 'aria-pressed': String(c[0] === value),
        onclick: function () { onPick(c[0]); } }, [c[1]]);
    }));
  }
  // A short message over the bottom of host, with an optional action button.
  function toast(host, text, action) {
    var old = host.querySelector('.toast');
    if (old) { old.remove(); }
    var t = el('div', { class: 'toast', role: 'status' }, [el('span', { text: text }),
      action ? el('button', { type: 'button', onclick: function () { t.remove(); action.run(); } }, [action.label]) : null]);
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, action ? 5000 : 1600);
  }

  global.MG = {
    M: M, ITEMS: ITEMS, BY_ID: BY_ID, EVENT: EVENT, TAKE_MIN: TAKE_MIN, BASE: BASE, defaultState: defaultState,
    optValue: optValue, choiceLabel: choiceLabel, plan: plan, draw: draw, crop: crop, region: region, zone: zone,
    trim: trim, chip: chip, summary: summary, whenShown: whenShown, sentence: sentence, countdown: countdown,
    clock: clock, merge: merge, Store: Store, el: el, segmented: segmented, toast: toast,
  };
})(typeof window !== 'undefined' ? window : globalThis);
