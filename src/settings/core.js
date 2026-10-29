// The preview side of MonthGrid's settings page: what the watch would draw
// for a person's picks at one moment, and pictures cut from that drawing.
// Plain script, no framework: the page ships inside the watchface as a
// data: URI. Needs monthgrid-face.js (the preview renderer) and model.js
// (the picks themselves) loaded first; bar.js and event.js paint the next
// event where the renderer doesn't.
(function (global) {
  'use strict';

  var Model = global.MGModel, M = Model.M, value = Model.value;

  // ---- Example data: today at 9:48, Standup at 10:00 -------------------------
  var TODAY = new Date();
  function at(h, m, dayOffset) {
    return new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + (dayOffset || 0), h, m);
  }
  function merge(a, b) {
    var out = {};
    Object.keys(a).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      out[k] = (b[k] && typeof b[k] === 'object' && !(b[k] instanceof Date) && !Array.isArray(b[k])
        && a[k] && typeof a[k] === 'object') ? merge(a[k], b[k]) : b[k];
    });
    return out;
  }
  // Event markers on a few days of this month: [calendar 1, 2, 3] counts.
  var MARKS = [[0], [1], [0], [0], [1, 1], [2], [0], [1], [0, 0, 1], [0], [0], [1, 1], [3], [1], [0], [1], [0], [0],
    [1], [2, 1], [1], [0], [1], [0], [0], [1, 0, 1], [1], [2], [1], [0], [0]];
  var BASE = {
    system24h: false,
    battery: { percent: 90, charging: false },
    connected: true,
    weather: { tempF: 56, cond: 2, highF: 64, lowF: 48, hoursF: [58, 61, 63] },
    dots: { days: MARKS },
    health: { steps: 4212, usualSteps: 3600, distanceM: 3058, heartRate: 72, activeSec: 2040,
      activeKcal: 210, restingKcal: 930, sleepSec: 25920, deepSleepSec: 6480 },
    wokeAt: at(6, 52),
    nextAlarm: at(6, 30, 1),
    phoneBattery: 64,
    readings: [],
    event: { name: 'Standup', start: at(10, 0), end: at(10, 15), allDay: false },
    now: at(9, 48),
  };

  // ---- Text the watch would show ------------------------------------------
  function clock(d, h24) {
    var h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2);
    if (h24) { return h + ':' + m; }
    return ((h % 12) || 12) + ':' + m + (h < 12 ? 'a' : 'p');
  }
  function hm(sec) { return Math.floor(sec / 3600) + 'h' + ('0' + Math.floor(sec % 3600 / 60)).slice(-2); }
  function signedK(v) {
    var s = v < 0 ? '-' : '+', a = Math.abs(v);
    return s + (a < 1000 ? a : (Math.round(a / 100) / 10) + 'k');
  }
  function temp(f, unit) { return unit === 'c' ? Math.round((f - 32) * 5 / 9) : f; }
  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
  // Does the event show at this moment? (event_visible on the watch)
  function eventVisible(ev, now, E) {
    if (!ev || (ev.end && now >= ev.end)) { return false; }
    if (now >= ev.start) { return true; }
    if (E.today) { return sameDay(ev.start, now); }
    return (ev.start - now) / 60000 <= E.minutes;
  }

  // ---- From picks to what the watch draws ------------------------------
  // For one moment: which watch metrics the status list becomes, the text
  // for options the renderer doesn't draw itself, why an item is off right
  // now, and where the next event goes.
  function plan(state, data, ctx) {
    var h24 = data.system24h || state.look.TIME_FORMAT === 2;
    var metrics = [], overrides = {}, rows = [], takeover = false;
    var E = state.event, ev = data.event, event = null, eventWhy = null, eventOn = false;
    var units = ctx && ctx.units;
    if (E.place === 'off') { eventWhy = 'Off'; }
    else if (!Model.canShow('event', ctx)) { eventWhy = 'Needs the Pebble app’s calendar'; }
    else if (!ev || !eventVisible(ev, data.now, E)) {
      eventWhy = !ev ? 'Nothing coming up' : E.today ? 'Nothing more today' : 'Shows ' + Model.eventWhen(E).toLowerCase();
    } else {
      var w = global.MGBar.when(ev, data.now, h24);
      eventOn = true;
      if (E.place === 'take') {
        if (ev.start - data.now <= Model.TAKE_MIN * 60000 && data.now < ev.start) {
          takeover = true;
          overrides[M.EVENT] = { text: global.MGEvent.sentence(ev.name, w), icon: M.EVENT };
        } else { eventWhy = 'Takes over the line ' + Model.TAKE_MIN + ' minutes before'; }
      } else if (E.place === 'line') {
        overrides[M.EVENT] = E.style === 'short' ? { text: w.text, icon: M.EVENT }
          : { text: w.text ? ev.name + ' ' + w.text : ev.name, icon: null };
      } else {
        event = { place: E.place, ev: ev, name: ev.name, when: w };
      }
    }
    state.status.forEach(function (id) {
      var row = { id: id, metrics: [], why: null };
      var v = function (k) { return value(state, id, k); };
      if (!Model.canShow(Model.BY_ID[id].needs, ctx)) {
        row.why = 'Not on this watch';
        rows.push(row);
        return;
      }
      var push = function (m, text) {
        if (metrics.length >= Model.MAX_METRICS) { row.overflow = true; return; }
        metrics.push(m); row.metrics.push(m);
        if (text !== undefined) { overrides[m] = { text: text }; }
      };
      switch (id) {
        case 'battery': {
          // A threshold applies to each battery on its own.
          var lim = v('when') === 'always' ? 100 : Number(v('when'));
          var src = Model.canShow('phone', ctx) ? v('source') : 'watch';
          if (src !== 'phone' && data.battery.percent <= lim) { push(M.BATTERY); }
          if (src !== 'watch' && data.phoneBattery <= lim) { push(M.PHONE_BATTERY); }
          if (!row.metrics.length && !row.overflow) { row.why = 'Shows at ' + lim + '% or less'; }
          break;
        }
        case 'weather': {
          var wd = data.weather, u = units ? (units.fahrenheit ? 'f' : 'c') : v('unit'), t = temp(wd.tempF, u);
          var text = v('detail') === 'range' ? t + '°' + u.toUpperCase() + ' ' + temp(wd.highF, u) + '/' + temp(wd.lowF, u)
            : v('detail') === 'hours' ? t + '° ' + wd.hoursF.map(function (x) { return temp(x, u) + '°'; }).join(' ')
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
        case 'sleep':
          if (v('wake') === 'on' && (!data.wokeAt || data.now - data.wokeAt > 3600000)) {
            row.why = 'Shows in the hour after waking';
          } else { push(M.SLEEP, v('kind') === 'deep' ? hm(data.health.deepSleepSec) : undefined); }
          break;
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
        case 'event':
          if (eventOn) { push(M.EVENT); } else { row.why = eventWhy; }
          break;
        default: {
          var n = Model.BY_ID[id].reading, r = (data.readings || [])[n - 1];
          if (!r || !r.text) { row.why = 'Nothing to show yet'; break; }
          push(M.READING_1 + n - 1, v('label') === 'label' && r.label ? r.label + ' ' + r.text : r.text);
        }
      }
      rows.push(row);
    });
    // In its last minutes an event that takes over is the line's only item.
    if (takeover) {
      metrics = [M.EVENT];
      rows.forEach(function (r) { if (!r.why) { r.why = 'Back once the event starts'; } });
    }
    var settings = Model.toWatch(state, units);
    settings.METRICS = metrics;
    return { settings: settings, overrides: overrides, rows: rows, event: event, eventWhy: eventWhy,
      takeover: takeover, state: state, h24: h24 };
  }

  // ---- Drawing --------------------------------------------------------
  var Face = global.MonthGridFace;
  var QUICK_VIEW_H = 51;   // TIMELINE_PEEK_HEIGHT on rectangular watches
  function zone(layout, name) { return layout[name] || null; }
  // Renders the face for these picks at this moment; also works out each
  // row's fit on the watch: 'shown', 'room' (no room left) or 'hidden' (with why).
  function draw(state, data, ctx, extra) {
    var p = plan(state, data, ctx);
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
    if (ctx && ctx.color === false) { blackAndWhite(r); }
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
  // A black-and-white watch draws everything that isn't background in its
  // text color: battery levels, dimmed days, the accent.
  function blackAndWhite(r) {
    var th = r.layout.theme, bg = Face.colorToRGB(th.bg), fg = Face.colorToRGB(th.fg), px = r.pixels;
    for (var i = 0; i < px.length; i += 4) {
      var isBg = px[i] === bg[0] && px[i + 1] === bg[1] && px[i + 2] === bg[2];
      var c = isBg ? bg : fg;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
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
        var lim = value(state, 'battery', 'when');
        lim = lim === 'always' ? 100 : Number(lim);
        return merge(data, { battery: { percent: Math.min(data.battery.percent, lim - 8) },
          phoneBattery: Math.min(data.phoneBattery, lim - 11) });
      }
      case 'event': return merge(data, { event: BASE.event, now: new Date(BASE.event.start - 12 * 60000) });
      case 'conn': return merge(data, { connected: false });
      case 'alarm': return merge(data, { nextAlarm: new Date(data.now.getTime() + 5 * 3600000) });
      case 'sleep': return merge(data, { now: new Date(data.wokeAt.getTime() + 20 * 60000) });
    }
    return data;
  }
  // One item drawn the way the watch draws it, for its row, at most maxW px
  // wide (scaled down, never cut). An item off right now is drawn as it looks
  // when it shows; the row dims it.
  function chip(state, id, data, ctx, maxW) {
    var s = JSON.parse(JSON.stringify(state));
    s.status = [id];
    if (id === 'event') { s.event.place = 'line'; } else { s.event.place = 'off'; }
    function picture(r) {
      var z = zone(r.layout, 'status');
      var t = z && trim(r, z, 3);
      return t && t.w > 7 ? t : null;
    }
    var r = draw(s, data, ctx), rect = picture(r);
    if (!rect) { r = draw(s, whenShown(id, s, data), ctx); rect = picture(r); }
    if (!rect) { return null; }
    return crop(r, rect, Math.min(1, (maxW || 120) / rect.w));
  }
  // An option's value in words, as an item's summary line says it.
  function choiceText(o, v) {
    if (o.summary && o.summary[v]) { return o.summary[v]; }
    var c = o.choices.filter(function (x) { return x[0] === v; })[0];
    return c ? c[1] : '';
  }

  // ---- Store ----------------------------------------------------------
  function Store(state) { this.state = state; this.fns = []; }
  Store.prototype.on = function (fn) { this.fns.push(fn); };
  Store.prototype.set = function (mutate) {
    mutate(this.state);
    this.fns.forEach(function (fn) { fn(); });
  };
  Store.prototype.setOpt = function (id, key, v) {
    this.set(function (s) { (s.opts[id] = s.opts[id] || {})[key] = v; });
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
    M: M, BASE: BASE, plan: plan, draw: draw, crop: crop, region: region, zone: zone, trim: trim, chip: chip,
    choiceText: choiceText, whenShown: whenShown, clock: clock, merge: merge, eventVisible: eventVisible,
    Store: Store, el: el, toast: toast,
  };
})(typeof window !== 'undefined' ? window : globalThis);
