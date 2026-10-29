// Shared model and widgets for the MonthGrid settings-page studies. Plain
// script, no framework: the real page would ship inside the watchface as a
// data: URI and be built from this. Needs monthgrid-face.js (the preview
// renderer) loaded first.
(function (global) {
  'use strict';

  var M = { BATTERY: 1, WEATHER: 2, STEPS: 3, DISTANCE: 4, HEART: 5, ACTIVE: 6, CALORIES: 7,
    SLEEP: 8, WEEK: 9, CONNECTION: 10, ALARM: 11, CALORIES_TOTAL: 12, EVENT: 13,
    PHONE_BATTERY: 14, READING_1: 15 };
  var MAX_METRICS = 8;

  function opt(key, label, choices, def, more) {
    var o = { key: key, label: label, choices: choices, def: def };
    Object.keys(more || {}).forEach(function (k) { o[k] = more[k]; });
    return o;
  }

  // What a person picks. An item can have its own options, and one item can
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
    { id: 'event', name: 'Next event', needs: 'Turn on plugins in the Pebble app', options: [
      opt('place', 'Where', [['bar', 'In the month bar'], ['own', 'On its own line'], ['line', 'In the status line'],
        ['take', 'Takes over the status line']], 'bar', { pictured: true }),
      opt('within', 'Show it', [['1h', '1 hour before'], ['2h', '2 hours before'], ['4h', '4 hours before'],
        ['day', 'Any time today']], '2h'),
      opt('style', 'Show', [['full', 'Name and time'], ['short', 'Time only']], 'full',
        { onlyIf: function (st) { return optValue(st, 'event', 'place') === 'line'; } })] },
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
      opt('vibe', 'Vibrate', [['off', 'Don’t vibrate'], ['on', 'Vibrate when it drops']], 'off')] },
    { id: 'reading1', name: 'AAPL', group: 'From other apps', options: [
      opt('label', 'Show', [['value', 'Value only'], ['label', 'Name and value']], 'value')] },
    { id: 'reading2', name: 'More readings', group: 'From other apps',
      needs: 'Pick them in the Pebble app’s Complications' },
  ];
  var BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  // ---- Example data: one day, four moments in it -------------------------
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
  };
  var MOMENTS = [
    { id: 'wake', time: '7:05a', title: 'Just up', data: merge(BASE, { now: at(7, 5),
      battery: { percent: 98 }, phoneBattery: 100, weather: { tempF: 49, cond: 1 },
      health: { steps: 140, usualSteps: 180, distanceM: 90, activeSec: 0, activeKcal: 4, restingKcal: 420 } }) },
    { id: 'standup', time: '9:37a', title: 'Standup soon', data: merge(BASE, { now: at(9, 37) }) },
    { id: 'afternoon', time: '2:20p', title: 'Afternoon', data: merge(BASE, { now: at(14, 20),
      battery: { percent: 61 }, phoneBattery: 41, weather: { tempF: 63, cond: 3, hoursF: [62, 60, 57] },
      health: { steps: 8406, usualSteps: 7900, distanceM: 6100, activeSec: 4300, activeKcal: 420, restingKcal: 1210 },
      event: { name: 'Design review', start: at(16, 30), end: at(17, 15), allDay: false } }) },
    { id: 'evening', time: '10:40p', title: 'Phone left behind', data: merge(BASE, { now: at(22, 40),
      battery: { percent: 18 }, connected: false, phoneBattery: 23, weather: { tempF: 47, cond: 1 },
      health: { steps: 11240, usualSteps: 10100, distanceM: 8300, activeSec: 5100, activeKcal: 560, restingKcal: 1690 },
      event: null }) },
  ];

  // ---- Settings ---------------------------------------------------------
  function defaultState() {
    return {
      look: { THEME: 0, TIME_FONT: 0, TIME_SIZE: 0, TIME_FORMAT: 0, SHOW_SECONDS: false, BANNER_STYLE: 0,
        BANNER_CONTENT: 0, HEADER_LABEL: 0, START_DAY: 0, SHOW_ADJACENT: false, GRID_LINES: false,
        DOTS_ENABLED: false, DOTS_STYLE: 0 },
      // The status line as it is set on Roger's watch today, plus Next event.
      status: ['conn', 'event', 'battery', 'alarm', 'heart', 'weather', 'distance'],
      opts: { battery: { source: 'both' } },
      calendars: ['', '', ''],
    };
  }
  function optValue(state, id, key) {
    var o = state.opts[id];
    if (o && o[key] !== undefined) { return o[key]; }
    var spec = (BY_ID[id].options || []).filter(function (x) { return x.key === key; })[0];
    return spec ? spec.def : undefined;
  }

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
  var TAKE_MIN = 15;
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
  // the text overrides for options the watch doesn't draw yet, and why an
  // item is hidden right now.
  function plan(state, data) {
    var h24 = data.system24h || state.look.TIME_FORMAT === 2;
    var metrics = [], overrides = {}, rows = [], event = null, takeover = null, glyph = false;
    state.status.forEach(function (id) {
      var row = { id: id, metrics: [], why: null };
      var v = function (k) { return optValue(state, id, k); };
      var push = function (m, text) {
        if (metrics.length >= MAX_METRICS) { return; }
        metrics.push(m); row.metrics.push(m);
        if (text !== undefined) { overrides[m] = { text: text }; }
      };
      switch (id) {
        case 'battery': {
          // A threshold applies to each battery on its own.
          var lim = v('when') === 'always' ? 100 : Number(v('when')), src = v('source');
          if (src !== 'phone' && data.battery.percent <= lim) { push(M.BATTERY); }
          if (src !== 'watch' && data.phoneBattery <= lim) { push(M.PHONE_BATTERY, '   ' + data.phoneBattery + '%'); }
          if (!row.metrics.length) { row.why = 'Shows at ' + lim + '% or less'; }
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
        case 'event': {
          var ev = data.event;
          if (!ev) { row.why = 'Nothing coming up'; break; }
          if (!eventVisible(ev, data.now, v('within'))) {
            row.why = v('within') === 'day' ? 'Nothing more today'
              : 'Shows ' + BY_ID.event.options[0].choices.filter(function (c) { return c[0] === v('within'); })[0][1];
            break;
          }
          var when = countdown(ev, data.now, h24), place = v('place');
          if (place === 'line') {
            // Time only leaves room at the front for the calendar mark (event.js).
            if (v('style') === 'short') { push(M.EVENT, '   ' + when); glyph = true; }
            else { push(M.EVENT, ev.name + ' ' + when); }
          } else if (place === 'take') {
            if (ev.start - data.now <= TAKE_MIN * 60000) {
              takeover = row;
              push(M.EVENT, '   ' + sentence(ev.name, when));
              glyph = true;
            } else { row.why = 'Takes over the line ' + TAKE_MIN + ' minutes before'; }
          } else {
            event = { place: place, ev: ev, name: ev.name, when: when };
            row.elsewhere = place;
          }
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
      rows.forEach(function (r) { if (r !== takeover && !r.why && !r.elsewhere) { r.why = 'Back once the event starts'; } });
    }
    var settings = {};
    Object.keys(state.look).forEach(function (k) { settings[k] = state.look[k]; });
    for (var i = 0; i < MAX_METRICS; i++) { settings['METRIC' + (i + 1)] = metrics[i] || 0; }
    settings.TEMP_UNIT = optValue(state, 'weather', 'unit') === 'c' ? 0 : 1;
    settings.DIST_UNIT = optValue(state, 'distance', 'unit') === 'km' ? 0 : 1;
    settings.VIBE_DISCONNECT = optValue(state, 'conn', 'vibe') === 'on';
    return { settings: settings, overrides: overrides, rows: rows, event: event, state: state,
      eventGlyph: glyph, h24: h24 };
  }

  // ---- Drawing --------------------------------------------------------
  var Face = global.MonthGridFace;
  function zone(layout, name) { return layout[name] || null; }
  // Renders the face for these picks at this moment; also returns each row's
  // fit on the watch: 'shown', 'room' (no room left) or 'hidden' (with why).
  var QUICK_VIEW_H = 51;   // TIMELINE_PEEK_HEIGHT on rectangular watches
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
      if (row.elsewhere) {
        row.state = p.event.shown ? 'shown' : 'hidden';
        if (!p.event.shown) { row.why = 'No room for it right now'; }
        return;
      }
      var any = row.metrics.some(function (m) { return drawn[m]; });
      var room = row.metrics.some(function (m) { return skipped[m] === 'no-room'; });
      row.state = any ? 'shown' : room ? 'room' : 'hidden';
      if (row.state === 'hidden' && !row.why) { row.why = 'Nothing to show yet'; }
    });
    r.plan = p;
    return r;
  }
  // A canvas showing part of a render, at whole-pixel scale.
  function crop(r, rect, scale) {
    rect = rect || { x: 0, y: 0, w: r.width, h: r.height };
    var c = document.createElement('canvas');
    c.width = Math.max(1, rect.w); c.height = Math.max(1, rect.h);
    var img = new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height);
    c.getContext('2d').putImageData(img, -rect.x, -rect.y, rect.x, rect.y, rect.w, rect.h);
    c.className = 'pix';
    c.style.width = (rect.w * (scale || 2)) + 'px';
    c.style.height = (rect.h * (scale || 2)) + 'px';
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
  // Data in which an item that is hidden right now would show: how it looks
  // when it does.
  function whenShown(id, state, data) {
    var lim = optValue(state, 'battery', 'when');
    switch (id) {
      case 'battery': lim = lim === 'always' ? 100 : Number(lim);
        return merge(data, { battery: { percent: Math.min(data.battery.percent, lim - 8) },
          phoneBattery: Math.min(data.phoneBattery, lim - 11) });
      case 'event': return merge(data, { event: BASE.event, now: new Date(BASE.event.start - 12 * 60000) });
      case 'conn': return merge(data, { connected: false });
      case 'alarm': return merge(data, { nextAlarm: new Date(data.now.getTime() + 5 * 3600000) });
    }
    return data;
  }
  // One item drawn the way the watch draws it, for list rows and the palette,
  // at most maxW px wide (scaled down, never cut). An item hidden right now is
  // drawn as it looks when it shows; the row dims it.
  function chip(state, id, data, maxW) {
    var s = JSON.parse(JSON.stringify(state));
    s.status = [id];
    var r = draw(s, data);
    var place = id === 'event' && optValue(s, 'event', 'place');
    function picture(r) {
      if (place === 'bar' && r.barEvent) {
        var b = zone(r.layout, 'banner');
        return { x: Math.max(0, r.barEvent.x - 5), y: b.y, w: Math.min(r.width - r.barEvent.x + 5, r.barEvent.w + 10), h: b.h };
      }
      var z = zone(r.layout, place === 'own' ? 'extra' : 'status');
      return z && trim(r, z, 3).w > 7 ? trim(r, z, 3) : null;
    }
    var rect = picture(r);
    if (!rect) { r = draw(s, whenShown(id, s, data)); rect = picture(r); }
    if (!rect) { return null; }
    var scale = Math.min(1, (maxW || 132) / rect.w);
    return crop(r, rect, scale);
  }
  // An item's choices in a few words, for its row: "Watch and phone · at 50% or less".
  function optionApplies(state, o) { return !o.onlyIf || o.onlyIf(state); }
  function summary(state, id) {
    return (BY_ID[id].options || []).filter(function (o) { return optionApplies(state, o); }).map(function (o, i) {
      var v = optValue(state, id, o.key);
      var label = o.choices.filter(function (c) { return c[0] === v; })[0][1];
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

  // ---- Small DOM helper --------------------------------------------------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') { e.textContent = attrs[k]; }
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

  // ---- Widgets ------------------------------------------------------------
  // An item's own options, as segmented choices or, for where the event
  // goes, as pictures of the face with an event 12 minutes away. Ends with
  // the way to take the item out of the line.
  function optionsPanel(store, id, data) {
    var it = BY_ID[id];
    var box = el('div', { class: 'opts' });
    (it.options || []).forEach(function (o) {
      if (!optionApplies(store.state, o)) { return; }
      var cur = optValue(store.state, id, o.key), pick = function (v) { store.setOpt(id, o.key, v); };
      var control;
      if (o.pictured && data) {
        control = el('div', { class: 'pics grid2', role: 'group', 'aria-label': o.label }, o.choices.map(function (c) {
          var st = JSON.parse(JSON.stringify(store.state));
          (st.opts[id] = st.opts[id] || {})[o.key] = c[0];
          var r = draw(st, whenShown('event', st, data));
          var L = r.layout, top = zone(L, 'time'), low = zone(L, 'banner') || zone(L, 'extra') || zone(L, 'status');
          var rect = { x: 0, y: Math.max(0, top.y - 3), w: r.width, h: low.y + low.h + 3 - Math.max(0, top.y - 3) };
          var pic = crop(r, rect, 1);
          return el('button', { type: 'button', class: 'pic', 'aria-pressed': String(c[0] === cur),
            onclick: function () { pick(c[0]); } }, [pic, el('span', { text: c[1] })]);
        }));
      } else {
        control = segmented(o.choices, cur, pick, o.label);
      }
      var note = o.note && o.note(store.state);
      box.appendChild(el('div', { class: 'opt' }, [el('span', { text: o.label }), control,
        note ? el('p', { class: 'note', text: note }) : null]));
    });
    box.appendChild(el('button', { type: 'button', class: 'remove-item',
      onclick: function () { store.set(function (s) { s.status.splice(s.status.indexOf(id), 1); }); } },
      ['Remove from the status line']));
    return box;
  }

  var GRIP = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var CHEVRON = '<svg class="chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The status line as an ordered list. Rows above the fold fit on the watch;
  // rows below it wait for room. Every row opens to its options (opts.open is
  // the open one) and says what they are set to; onOpen(id) toggles a row.
  function statusList(store, data, onOpen, opts) {
    opts = opts || {};
    var r = draw(store.state, data);
    var rows = r.plan.rows;
    var lastShown = -1;
    rows.forEach(function (row, i) { if (row.state === 'shown') { lastShown = i; } });
    var anyRoom = rows.some(function (row) { return row.state === 'room'; });
    var list = el('ol', { class: 'slist', 'aria-label': 'Status items in priority order' });
    rows.forEach(function (row, i) {
      var it = BY_ID[row.id], open = opts.open === row.id;
      var line2 = summary(store.state, row.id) ||
        (row.state === 'room' ? 'Waits for room on the watch' : row.state === 'hidden' ? row.why : '');
      var pic = chip(store.state, row.id, data, opts.picW || 120);
      if (pic) { pic.classList.add('chip'); }
      var li = el('li', { class: 'srow' + (row.state === 'shown' ? '' : ' off') + (open ? ' open' : ''), 'data-id': row.id }, [
        el('button', { type: 'button', class: 'handle', 'aria-label': 'Reorder ' + it.name }),
        el('button', { type: 'button', class: 'main', 'aria-expanded': String(open),
          onclick: function () { onOpen && onOpen(row.id); } }, [
          el('span', { class: 'label' }, [el('span', { class: 'name', text: it.name }),
            line2 ? el('span', { class: 'why', text: line2 }) : null]),
          pic, el('span', { class: 'chevwrap' }),
        ]),
      ]);
      li.querySelector('.handle').innerHTML = GRIP;
      li.querySelector('.chevwrap').innerHTML = CHEVRON;
      dragToReorder(li, list, store);
      list.appendChild(li);
      if (open) { list.appendChild(el('li', { class: 'inline-opts' }, [optionsPanel(store, row.id, data)])); }
      if (anyRoom && i === lastShown) {
        list.appendChild(el('li', { class: 'fold', 'aria-hidden': 'true', text: 'Room on the watch ends here' }));
      }
    });
    return list;
  }

  // Drag a row by its handle; the new order is saved when the finger lifts.
  function dragToReorder(li, list, store) {
    var handle = li.querySelector('.handle');
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      li.classList.add('dragging');
      var startY = e.clientY;
      function rowsNow() { return Array.prototype.filter.call(list.children, function (c) { return c.classList.contains('srow'); }); }
      function move(ev) {
        var dy = ev.clientY - startY;
        li.style.transform = 'translateY(' + dy + 'px)';
        var rows = rowsNow(), i = rows.indexOf(li);
        var prev = rows[i - 1], next = rows[i + 1];
        if (next && dy > next.offsetHeight / 2) {
          list.insertBefore(next, li); startY += next.offsetHeight; li.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
        } else if (prev && dy < -prev.offsetHeight / 2) {
          list.insertBefore(li, prev); startY -= prev.offsetHeight; li.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
        }
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        li.classList.remove('dragging');
        li.style.transform = '';
        var order = rowsNow().map(function (c) { return c.getAttribute('data-id'); });
        store.set(function (s) { s.status = order; });
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // Every item not yet in the line, drawn as the watch draws it.
  function palette(store, data, onPick) {
    var used = store.state.status;
    var full = draw(store.state, data).plan.settings.METRIC8 !== 0;
    var box = el('div', { class: 'palette' });
    ITEMS.forEach(function (it) {
      if (used.indexOf(it.id) >= 0) { return; }
      var unavailable = it.id === 'reading2';
      var pic = unavailable ? null : chip(store.state, it.id, data, 140);
      box.appendChild(el('button', { type: 'button', class: 'tile', disabled: unavailable || full,
        onclick: function () { store.set(function (s) { s.status.push(it.id); }); onPick && onPick(it.id); } }, [
        pic, el('span', { text: it.name }),
        unavailable ? el('span', { class: 'why', text: it.needs }) : null,
      ]));
    });
    if (full) { box.appendChild(el('p', { class: 'note', text: 'The line holds 8 items. Remove one to add another.' })); }
    return box;
  }

  function toast(host, text) {
    var t = el('div', { class: 'toast', role: 'status', text: text });
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 1600);
  }

  global.MG = {
    M: M, ITEMS: ITEMS, BY_ID: BY_ID, MOMENTS: MOMENTS, NOW: MOMENTS[1], defaultState: defaultState,
    optValue: optValue, plan: plan, draw: draw, crop: crop, region: region, zone: zone, chip: chip,
    summary: summary, trim: trim, whenShown: whenShown, BASE: BASE,
    Store: Store, el: el, segmented: segmented, optionsPanel: optionsPanel, statusList: statusList,
    palette: palette, toast: toast, countdown: countdown, clock: clock, merge: merge,
  };
})(typeof window !== 'undefined' ? window : globalThis);

// ---- Look settings, shared by every direction ------------------------------
// Each control is either plain (choices as words) or pictured (each choice
// drawn as that part of the face would look with it).
(function (global) {
  'use strict';
  var MG = global.MG, el = MG.el;

  var THEMES = ['Classic', 'Paper', 'Amber', 'Ice', 'Crimson', 'Midnight', 'Terminal', 'Sunset', 'Violet', 'Newsprint'];
  var CONTROLS = {
    colors: [
      { key: 'THEME', label: 'Colors', region: 'top', choices: THEMES.map(function (n, i) { return [i, n]; }) },
    ],
    time: [
      { key: 'TIME_FONT', label: 'Font', region: 'time',
        choices: [[0, 'Roboto'], [1, 'Digital'], [2, 'Pixel'], [3, 'Bitham bold'], [4, 'Bitham light']] },
      { key: 'TIME_SIZE', label: 'Size', region: 'time', choices: [[0, 'Large'], [1, 'Medium'], [2, 'Small']] },
      { key: 'TIME_FORMAT', label: 'Hours', choices: [[0, 'Like the phone'], [1, '12-hour'], [2, '24-hour']] },
      { key: 'SHOW_SECONDS', label: 'Seconds', choices: [[false, 'Hide'], [true, 'Show']],
        note: 'Showing seconds uses noticeably more battery.' },
    ],
    month: [
      { key: 'BANNER_STYLE', label: 'Style', region: 'banner', choices: [[0, 'Bar'], [1, 'Plain'], [2, 'Ruled']] },
      { key: 'BANNER_CONTENT', label: 'Shows', region: 'banner', choices: [[0, 'Month'], [1, 'Month and day'],
        [2, 'Weekday, month and day'], [3, 'Month, day and year'], [4, 'Weekday, date and year'], [5, 'Numbers']] },
      { key: 'HEADER_LABEL', label: 'Weekdays', region: 'header', choices: [[0, 'Two letters'], [1, 'One letter']] },
    ],
    calendar: [
      { key: 'START_DAY', label: 'Weeks start on', region: 'header', choices: [[0, 'Sunday'], [1, 'Monday'], [2, 'Saturday']] },
      { key: 'SHOW_ADJACENT', label: 'Days from next and last month', region: 'grid',
        choices: [[false, 'Hide'], [true, 'Show']] },
      { key: 'GRID_LINES', label: 'Borders', region: 'grid', choices: [[false, 'None'], [true, 'Lines']] },
      { key: 'DOTS_ENABLED', label: 'Event markers', region: 'grid', choices: [[false, 'Off'], [true, 'On']] },
      { key: 'DOTS_STYLE', label: 'Marker style', region: 'grid', onlyIf: 'DOTS_ENABLED',
        choices: [[0, 'Underline'], [1, 'Squares']] },
    ],
  };

  function lookWith(state, key, value) {
    var s = JSON.parse(JSON.stringify(state));
    s.look[key] = value;
    return s;
  }
  // The part of the face a pictured control shows.
  function pictureRect(r, region) {
    var L = r.layout;
    if (region === 'top') {
      var t = MG.zone(L, 'time'), b = MG.zone(L, 'banner') || MG.zone(L, 'status');
      return { x: 0, y: Math.max(0, t.y - 4), w: r.width, h: (b.y + b.h + 4) - Math.max(0, t.y - 4) };
    }
    if (region === 'grid') {
      var g = MG.zone(L, 'grid'), h = MG.zone(L, 'header');
      var top = h ? h.y : g.y;
      return { x: 0, y: top, w: r.width, h: Math.min(r.height - top, (g.y - top) + Math.round(g.h / 2)) };
    }
    return MG.region(r, region, 2);
  }

  function control(store, data, c, pictured, alone) {
    var cur = store.state.look[c.key];
    var pick = function (v) { store.set(function (s) { s.look[c.key] = v; }); };
    var wrap = el('div', { class: 'opt' }, [alone ? null : el('span', { text: c.label })]);
    if (pictured && c.region) {
      var list = el('div', { class: 'pics' + (c.region === 'top' ? ' pics-row' : ''), role: 'group', 'aria-label': c.label });
      c.choices.forEach(function (ch) {
        var r = MG.draw(lookWith(store.state, c.key, ch[0]), data);
        var pic = MG.crop(r, pictureRect(r, c.region), 1);
        list.appendChild(el('button', { type: 'button', class: 'pic', 'aria-pressed': String(ch[0] === cur),
          onclick: function () { pick(ch[0]); } }, [pic, el('span', { text: ch[1] })]));
      });
      wrap.appendChild(list);
    } else {
      wrap.appendChild(MG.segmented(c.choices, cur, pick, c.label));
    }
    if (c.note) { wrap.appendChild(el('p', { class: 'note', text: c.note })); }
    return wrap;
  }

  // Event-marker calendars: shown under the markers control while it's on.
  function calendars(store) {
    if (!store.state.look.DOTS_ENABLED) { return null; }
    var box = el('div', { class: 'opt' }, [el('span', { text: 'Calendars (iCal links)' })]);
    [0, 1, 2].forEach(function (i) {
      var input = el('input', { type: 'url', id: 'cal-url-' + i, placeholder: 'https://…/basic.ics',
        value: store.state.calendars[i], 'aria-label': 'Calendar ' + (i + 1) + ' link',
        onchange: function () { store.state.calendars[i] = input.value; } });
      box.appendChild(input);
    });
    box.appendChild(el('p', { class: 'note', text: 'The links stay on your phone; the watch only learns which days have events.' }));
    return box;
  }

  MG.CONTROLS = CONTROLS;
  MG.lookControls = function (store, data, section, pictured) {
    var box = el('div', { class: 'controls', style: 'display:grid;gap:18px' });
    var alone = CONTROLS[section].length === 1;
    CONTROLS[section].forEach(function (c) {
      if (c.onlyIf && !store.state.look[c.onlyIf]) { return; }
      var drawn = Array.isArray(pictured) ? pictured.indexOf(c.key) >= 0 : pictured;
      box.appendChild(control(store, data, c, drawn, alone));
    });
    if (section === 'calendar') { var cals = calendars(store); if (cals) { box.appendChild(cals); } }
    return box;
  };
  MG.pictureRect = pictureRect;
})(typeof window !== 'undefined' ? window : globalThis);
