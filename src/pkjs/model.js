// What a person picks on MonthGrid's settings page, kept as one plain object
// (the state), and how it becomes the watch's settings. Shared by the phone
// (index.js) and the settings page itself, which inlines this file.
//
// state = {
//   v: 2,
//   look: { THEME, TIME_FONT, ..., CUSTOM_BG, GRID_COLOR, CAL1_COLOR, ... }
//         (the watch's own setting names; colors are Pebble colors 0..63),
//   status: ['battery', 'weather', 'event', ...]   most important first,
//   opts: { battery: { when }, weather: { detail }, ... }   an item's own options,
//   event: { place, today, minutes, style },
//   calendars: [url, url, url]                        never sent to the watch,
// }
(function (global) {
  'use strict';

  // Watch metrics (MetricType in common.h).
  var M = { NONE: 0, BATTERY: 1, WEATHER: 2, STEPS: 3, DISTANCE: 4, HEART: 5, ACTIVE: 6, CALORIES: 7,
    SLEEP: 8, WEEK: 9, CONNECTION: 10, ALARM: 11, CALORIES_TOTAL: 12, EVENT: 13, PHONE_BATTERY: 14,
    READING_1: 15 };
  var NUM_READINGS = 5;
  // Every metric fits in the watch's list (NUM_METRIC_SLOTS).
  var MAX_METRICS = 20;

  // Where the next event goes (EventPlace in common.h).
  var PLACES = ['off', 'bar', 'own', 'line', 'take'];
  // In the last minutes before it starts, an event set to take over the
  // status line is the line's only item (EVENT_TAKE_MIN on the watch).
  var TAKE_MIN = 15;
  // How long before it starts an event may show, in minutes.
  var LEAD_STOPS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1080, 1440];

  // An option: kind 'seg' (a segmented control), 'menu' (a pop-up menu) or
  // 'switch' (on or off; choices are [off, on]).
  function opt(key, label, kind, choices, def, more) {
    var o = { key: key, label: label, kind: kind, choices: choices, def: def };
    Object.keys(more || {}).forEach(function (k) { o[k] = more[k]; });
    return o;
  }

  // When a battery shows: always, or once it gets low.
  function lowOpt() {
    return opt('when', 'Show it', 'menu', [['always', 'Always'], ['50', 'At 50% or less'], ['20', 'At 20% or less']],
      'always');
  }

  // The status items. needs: what the watch or phone must have for the item
  // to be offered.
  var ITEMS = [
    { id: 'battery', name: 'Watch battery', options: [lowOpt()] },
    { id: 'phoneBattery', name: 'Phone battery', needs: 'phone', options: [lowOpt()] },
    { id: 'weather', name: 'Weather', options: [
      opt('detail', 'Show', 'menu', [['now', 'Now'], ['range', 'Now, high, and low'], ['hours', 'Next 3 hours']], 'now'),
      opt('unit', 'Unit', 'seg', [['f', '°F'], ['c', '°C']], 'f', { needs: 'units' })] },
    { id: 'steps', name: 'Steps', needs: 'health', options: [
      opt('show', 'Show', 'menu', [['count', 'Today’s count'], ['usual', 'Ahead or behind your usual']], 'count')] },
    { id: 'distance', name: 'Distance walked', needs: 'health', options: [
      opt('unit', 'Unit', 'seg', [['mi', 'Miles'], ['km', 'Kilometers']], 'mi', { needs: 'units' })] },
    { id: 'heart', name: 'Heart rate', needs: 'hrm' },
    { id: 'active', name: 'Active minutes', needs: 'health' },
    { id: 'calories', name: 'Calories', needs: 'health', options: [
      opt('count', 'Count', 'seg', [['active', 'Active'], ['total', 'Active and resting']], 'active')] },
    { id: 'sleep', name: 'Sleep last night', needs: 'health', options: [
      opt('kind', 'Show', 'seg', [['all', 'All sleep'], ['deep', 'Deep sleep']], 'all'),
      opt('wake', 'Only in the hour after waking', 'switch', [['off', 'Any time'], ['on', 'The hour after waking']],
        'off')] },
    { id: 'alarm', name: 'Next alarm', needs: 'alarms', options: [
      opt('when', 'Only in the 12 hours before', 'switch',
        [['always', 'Whenever one is set'], ['12h', 'In the 12 hours before']], 'always')] },
    { id: 'week', name: 'Week number' },
    { id: 'conn', name: 'Phone disconnected', options: [
      opt('vibe', 'Vibrate when it drops', 'switch', [['off', 'While your phone is away'],
        ['on', 'While your phone is away · vibrates']], 'off')] },
  ];
  for (var n = 1; n <= NUM_READINGS; n++) {
    ITEMS.push({ id: 'reading' + n, name: 'Reading ' + n, reading: n, group: 'From other apps', needs: 'reading',
      options: [opt('label', 'Show', 'seg', [['value', 'Value'], ['label', 'Name and value']], 'value')] });
  }
  // The next event is an item only while it is set to show in the status line.
  var EVENT_ITEM = { id: 'event', name: 'Next event', needs: 'event' };
  var BY_ID = { event: EVENT_ITEM };
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  function optionSpec(id, key) {
    return (BY_ID[id].options || []).filter(function (o) { return o.key === key; })[0];
  }
  function value(state, id, key) {
    var o = state.opts && state.opts[id];
    if (o && o[key] !== undefined) { return o[key]; }
    var spec = optionSpec(id, key);
    return spec ? spec.def : undefined;
  }

  // Whether this watch and phone can show something that needs `needs` (an
  // item's or option's). ctx: what the phone told the settings page.
  function canShow(needs, ctx) {
    if (!ctx) { return true; }
    switch (needs) {
      case 'health': return !!ctx.health;
      case 'hrm': return !!(ctx.health && ctx.hrm);
      case 'alarms': return !!ctx.alarms;
      case 'phone': return !!ctx.served.phone;
      case 'event': return !!ctx.served.event;
      case 'units': return !ctx.units;
    }
    return true;
  }

  // ---- Lead time ------------------------------------------------------------
  // "15 minutes", "1½ hours", "24 hours".
  function leadLabel(min) {
    if (min < 60) { return min + ' minutes'; }
    var h = min / 60, whole = Math.floor(h);
    var text = h === whole ? String(whole) : (h - whole === 0.5 ? whole + '½' : h.toFixed(1));
    return text + (h === 1 ? ' hour' : ' hours');
  }
  function nearestStop(min) {
    var best = LEAD_STOPS[0];
    LEAD_STOPS.forEach(function (s) { if (Math.abs(s - min) < Math.abs(best - min)) { best = s; } });
    return best;
  }
  // When the event shows, in a few words: "2 hours before", "Any time today".
  function eventWhen(ev) {
    return ev.today ? 'Any time today' : leadLabel(ev.minutes) + ' before';
  }

  // ---- The state -------------------------------------------------------------
  // Pebble colors by name, for defaults (GColor8 .argb & 63).
  var GC = { Black: 0, White: 63, DarkGray: 21, LightGray: 42, Red: 48, BlueMoon: 7, IslamicGreen: 8,
    VividCerulean: 11 };

  function defaultLook() {
    return { THEME: 0, CUSTOM_BG: GC.Black, CUSTOM_FG: GC.White, CUSTOM_ACCENT: GC.VividCerulean,
      TIME_FONT: 0, TIME_SIZE: 0, TIME_FORMAT: 0, SHOW_SECONDS: false, BANNER_STYLE: 0, BANNER_CONTENT: 0,
      HEADER_LABEL: 0, START_DAY: 0, SHOW_ADJACENT: false, GRID_LINES: false, GRID_COLOR: GC.DarkGray,
      DOTS_ENABLED: false, DOTS_STYLE: 0, CAL1_COLOR: GC.Red, CAL2_COLOR: GC.BlueMoon, CAL3_COLOR: GC.IslamicGreen };
  }
  function defaultState() {
    return { v: 2, look: defaultLook(), status: ['battery', 'weather'], opts: {},
      event: { place: 'bar', today: false, minutes: 120, style: 'full' }, calendars: ['', '', ''] };
  }

  // Fills in what's missing and drops what doesn't belong, so a state from
  // an older page (or a hand-edited one) is always whole.
  function normalize(input) {
    var s = defaultState(), src = input || {};
    var look = src.look || {};
    Object.keys(s.look).forEach(function (k) {
      if (look[k] === undefined || look[k] === null) { return; }
      s.look[k] = typeof s.look[k] === 'boolean' ? !!look[k] : Number(look[k]) || 0;
    });
    var ev = src.event || {};
    if (PLACES.indexOf(ev.place) >= 0) { s.event.place = ev.place; }
    s.event.today = !!ev.today;
    if (typeof ev.minutes === 'number' && ev.minutes > 0) { s.event.minutes = nearestStop(ev.minutes); }
    if (ev.style === 'short') { s.event.style = 'short'; }
    if (Array.isArray(src.status)) {
      var seen = {};
      s.status = src.status.filter(function (id) {
        if (!BY_ID[id] || seen[id]) { return false; }
        seen[id] = true;
        return true;
      });
    }
    // The event is in the list exactly when it shows in the status line.
    var at = s.status.indexOf('event');
    if (s.event.place === 'line' && at < 0) { s.status.unshift('event'); }
    if (s.event.place !== 'line' && at >= 0) { s.status.splice(at, 1); }
    var opts = src.opts || {};
    Object.keys(opts).forEach(function (id) {
      if (!BY_ID[id] || !BY_ID[id].options) { return; }
      BY_ID[id].options.forEach(function (o) {
        var v = opts[id] && opts[id][o.key];
        if (o.choices.some(function (c) { return c[0] === v; })) { (s.opts[id] = s.opts[id] || {})[o.key] = v; }
      });
    });
    if (Array.isArray(src.calendars)) {
      s.calendars = [0, 1, 2].map(function (i) { return typeof src.calendars[i] === 'string' ? src.calendars[i] : ''; });
    }
    return s;
  }

  // ---- Colors -------------------------------------------------------------------
  // Pebble color 0..63 <-> 0xRRGGBB.
  function toHex(c) { return ((c >> 4) & 3) * 0x550000 + ((c >> 2) & 3) * 0x5500 + (c & 3) * 0x55; }
  function fromHex(v) {
    if (typeof v === 'string') { v = parseInt(v.replace(/^#|^0x/i, ''), 16); }
    v = Number(v) || 0;
    function ch(x) { return Math.round(((v >> x) & 255) / 85); }
    return (ch(16) << 4) | (ch(8) << 2) | ch(0);
  }

  // ---- From the old settings page (Clay) ------------------------------------------
  // Clay kept its values by message key in localStorage ('clay-settings').
  var FROM_METRIC = { 1: 'battery', 2: 'weather', 3: 'steps', 4: 'distance', 5: 'heart', 6: 'active', 7: 'calories',
    8: 'sleep', 9: 'week', 10: 'conn', 11: 'alarm', 12: 'calories', 13: 'event', 14: 'phoneBattery' };
  function fromClay(clay) {
    var s = defaultState(), look = s.look;
    function has(k) { return clay[k] !== undefined && clay[k] !== null && clay[k] !== ''; }
    Object.keys(look).forEach(function (k) {
      if (!has(k)) { return; }
      if (/_COLOR$|^CUSTOM_/.test(k)) { look[k] = fromHex(clay[k]); }
      else if (typeof look[k] === 'boolean') { look[k] = clay[k] === true || clay[k] === 'true' || clay[k] === 1 || clay[k] === '1'; }
      else { look[k] = parseInt(clay[k], 10) || 0; }
    });
    // Clay stored every slot once saved; before that, its defaults applied.
    var saved = false, metrics = [];
    for (var i = 1; i <= 8; i++) { if (has('METRIC' + i)) { saved = true; } }
    for (i = 1; i <= 8; i++) {
      var v = saved ? parseInt(clay['METRIC' + i], 10) || 0 : (i === 1 ? 1 : i === 2 ? 2 : 0);
      if (v) { metrics.push(v); }
    }
    s.status = [];
    metrics.forEach(function (m) {
      var id = m >= M.READING_1 && m < M.READING_1 + NUM_READINGS ? 'reading' + (m - M.READING_1 + 1) : FROM_METRIC[m];
      if (id && s.status.indexOf(id) < 0) { s.status.push(id); }
    });
    if (metrics.indexOf(M.CALORIES_TOTAL) >= 0 && metrics.indexOf(M.CALORIES) < 0) { s.opts.calories = { count: 'total' }; }
    // Someone who had the event in their status line keeps it there; no one
    // else starts seeing events they never asked for.
    s.event.place = metrics.indexOf(M.EVENT) >= 0 ? 'line' : 'off';
    if (has('TEMP_UNIT') && String(clay.TEMP_UNIT) === '0') { s.opts.weather = { unit: 'c' }; }
    if (has('DIST_UNIT') && String(clay.DIST_UNIT) === '0') { s.opts.distance = { unit: 'km' }; }
    if (clay.VIBE_DISCONNECT === true || clay.VIBE_DISCONNECT === 'true' || clay.VIBE_DISCONNECT === 1) {
      s.opts.conn = { vibe: 'on' };
    }
    s.calendars = [clay.CAL1_URL || '', clay.CAL2_URL || '', clay.CAL3_URL || ''];
    return normalize(s);
  }

  // ---- To the watch -------------------------------------------------------------
  // The watch metrics the status list stands for, in order.
  function metricsOf(state) {
    var out = [];
    function push(m) { if (out.indexOf(m) < 0 && out.length < MAX_METRICS) { out.push(m); } }
    state.status.forEach(function (id) {
      var v = function (k) { return value(state, id, k); };
      switch (id) {
        case 'battery': push(M.BATTERY); break;
        case 'phoneBattery': push(M.PHONE_BATTERY); break;
        case 'weather': push(M.WEATHER); break;
        case 'steps': push(M.STEPS); break;
        case 'distance': push(M.DISTANCE); break;
        case 'heart': push(M.HEART); break;
        case 'active': push(M.ACTIVE); break;
        case 'calories': push(v('count') === 'total' ? M.CALORIES_TOTAL : M.CALORIES); break;
        case 'sleep': push(M.SLEEP); break;
        case 'week': push(M.WEEK); break;
        case 'conn': push(M.CONNECTION); break;
        case 'alarm': push(M.ALARM); break;
        case 'event': push(M.EVENT); break;
        default:
          if (BY_ID[id] && BY_ID[id].reading) { push(M.READING_1 + BY_ID[id].reading - 1); }
      }
    });
    return out;
  }

  // The message the watch gets (by message-key name). units: the Pebble
  // app's units when it decides them ({fahrenheit, miles}), else null.
  function toWatch(state, units) {
    var look = state.look, d = {};
    Object.keys(look).forEach(function (k) {
      var v = look[k];
      d[k] = /_COLOR$|^CUSTOM_/.test(k) ? toHex(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
    });
    d.METRICS = metricsOf(state);
    d.TEMP_UNIT = units ? (units.fahrenheit ? 1 : 0) : (value(state, 'weather', 'unit') === 'c' ? 0 : 1);
    d.DIST_UNIT = units ? (units.miles ? 1 : 0) : (value(state, 'distance', 'unit') === 'km' ? 0 : 1);
    d.VIBE_DISCONNECT = value(state, 'conn', 'vibe') === 'on' ? 1 : 0;
    var below = function (id) { var w = value(state, id, 'when'); return w === 'always' ? 0 : Number(w); };
    d.BATTERY_BELOW = below('battery');
    d.PHONE_BATTERY_BELOW = below('phoneBattery');
    d.WEATHER_DETAIL = ['now', 'range', 'hours'].indexOf(value(state, 'weather', 'detail'));
    d.STEPS_SHOW = value(state, 'steps', 'show') === 'usual' ? 1 : 0;
    d.SLEEP_KIND = value(state, 'sleep', 'kind') === 'deep' ? 1 : 0;
    d.SLEEP_AFTER_WAKE = value(state, 'sleep', 'wake') === 'on' ? 1 : 0;
    d.ALARM_WITHIN = value(state, 'alarm', 'when') === '12h' ? 12 : 0;
    var labels = 0;
    for (var r = 1; r <= NUM_READINGS; r++) {
      if (value(state, 'reading' + r, 'label') === 'label') { labels |= 1 << (r - 1); }
    }
    d.READING_LABELS = labels;
    d.EVENT_PLACE = PLACES.indexOf(state.event.place);
    d.EVENT_WITHIN = state.event.today ? 0 : state.event.minutes;
    d.EVENT_STYLE = state.event.style === 'short' ? 1 : 0;
    return d;
  }

  // Does the phone need to read the calendar for this state?
  function wantsEvent(state) { return state.event.place !== 'off'; }

  var api = { M: M, NUM_READINGS: NUM_READINGS, MAX_METRICS: MAX_METRICS, PLACES: PLACES, TAKE_MIN: TAKE_MIN,
    LEAD_STOPS: LEAD_STOPS, ITEMS: ITEMS, BY_ID: BY_ID, optionSpec: optionSpec, value: value,
    canShow: canShow, leadLabel: leadLabel, nearestStop: nearestStop, eventWhen: eventWhen, defaultState: defaultState,
    normalize: normalize, toHex: toHex, fromHex: fromHex, fromClay: fromClay, metricsOf: metricsOf,
    toWatch: toWatch, wantsEvent: wantsEvent };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { global.MGModel = api; }
})(typeof window !== 'undefined' ? window : this);
