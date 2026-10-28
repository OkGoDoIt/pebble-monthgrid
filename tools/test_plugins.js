#!/usr/bin/env node
// Tests for the phone-side plugin code (src/pkjs/plugins.js and its wiring in
// src/pkjs/index.js). Run: node tools/test_plugins.js
//
// index.js is loaded as-is under a fake Pebble runtime: a fake clock and
// timers, localStorage, geolocation and XMLHttpRequest (for the Open-Meteo
// fallback), and a Pebble object whose subscribeToSource hands the test the
// onData/onError callbacks so it can play envelopes at it. Every
// sendAppMessage is recorded; the assertions are on those dictionaries.

var assert = require('assert');
var path = require('path');
var Module = require('module');

var ROOT = path.join(__dirname, '..');
var PKJS = path.join(ROOT, 'src', 'pkjs');

// ---------------------------------------------------------------------------
// message_keys, numbered the way the SDK numbers them
// ---------------------------------------------------------------------------

function messageKeys() {
  var keys = require(path.join(ROOT, 'package.json')).pebble.messageKeys;
  var out = {};
  var next = 10000;
  keys.forEach(function(k) {
    var m = /^(\w+)\[(\d+)\]$/.exec(k);
    if (m) { out[m[1]] = next; next += +m[2]; }
  });
  keys.forEach(function(k) {
    if (k.indexOf('[') === -1) { out[k] = next++; }
  });
  return out;
}

var origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'message_keys') { return messageKeys(); }
  // The SDK bundles Clay's prebuilt dist, not its source entry point.
  if (request === '@rebble/clay') {
    return origLoad.call(this, path.join(ROOT, 'node_modules/@rebble/clay/dist/js/index.js'),
                         parent, isMain);
  }
  return origLoad.apply(this, arguments);
};

// ---------------------------------------------------------------------------
// Fake clock and timers
// ---------------------------------------------------------------------------

var clock;
var RealDate = Date;

function resetClock(startMs) {
  clock = { now: startMs, timers: [], seq: 0 };
  global.Date = function(a, b, c, d, e, f, g) {
    if (arguments.length === 0) { return new RealDate(clock.now); }
    if (arguments.length === 1) { return new RealDate(a); }
    return new RealDate(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
  };
  global.Date.now = function() { return clock.now; };
  global.Date.UTC = RealDate.UTC;
  global.Date.parse = RealDate.parse;
  global.Date.prototype = RealDate.prototype;
  global.setTimeout = function(fn, ms) {
    var t = { id: ++clock.seq, at: clock.now + (ms || 0), fn: fn };
    clock.timers.push(t);
    return t.id;
  };
  global.setInterval = function(fn, ms) {
    var t = { id: ++clock.seq, at: clock.now + ms, fn: fn, every: ms };
    clock.timers.push(t);
    return t.id;
  };
  global.clearTimeout = global.clearInterval = function(id) {
    clock.timers = clock.timers.filter(function(t) { return t.id !== id; });
  };
}

// Run every timer due within the next ms milliseconds, in order.
function advance(ms) {
  var end = clock.now + (ms || 0);
  for (;;) {
    var due = clock.timers.filter(function(t) { return t.at <= end; });
    if (!due.length) { break; }
    due.sort(function(a, b) { return a.at - b.at || a.id - b.id; });
    var t = due[0];
    clock.now = Math.max(clock.now, t.at);
    if (t.every) { t.at += t.every; } else {
      clock.timers = clock.timers.filter(function(x) { return x !== t; });
    }
    t.fn();
  }
  clock.now = end;
}

// ---------------------------------------------------------------------------
// Fake Pebble runtime
// ---------------------------------------------------------------------------

var env;

function setup(opts) {
  opts = opts || {};
  resetClock(opts.now || RealDate.UTC(2026, 9, 28, 16, 30, 0));
  env = {
    logs: [],            // what the code under test logged
    sent: [],            // every dict passed to sendAppMessage
    subs: [],            // every subscribeToSource request
    xhr: [],             // every URL fetched
    listeners: {},
    nack: false,         // fail every sendAppMessage while true
    openedUrl: null,
    store: {},
    plugins: opts.plugins || [],
  };
  global.localStorage = {
    getItem: function(k) { return env.store.hasOwnProperty(k) ? env.store[k] : null; },
    setItem: function(k, v) { env.store[k] = String(v); },
    removeItem: function(k) { delete env.store[k]; },
  };
  if (opts.settings) {
    env.store['clay-settings'] = JSON.stringify(opts.settings);
  }
  // Node has a read-only navigator of its own.
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      geolocation: {
        getCurrentPosition: function(ok) {
          setTimeout(function() { ok({ coords: { latitude: 47.6, longitude: -122.3 } }); }, 10);
        },
      },
    },
  });
  global.XMLHttpRequest = function() {};
  global.XMLHttpRequest.prototype.open = function(method, url) { this.url = url; };
  global.XMLHttpRequest.prototype.send = function() {
    var self = this;
    env.xhr.push(self.url);
    setTimeout(function() {
      if (/open-meteo/.test(self.url)) {
        self.status = 200;
        self.readyState = 4;
        self.responseText = JSON.stringify({ current: { temperature_2m: 12.34, weather_code: 3 } });
        if (self.onload) { self.onload(); }
      } else {
        self.status = 404;
        self.readyState = 4;
        if (self.onreadystatechange) { self.onreadystatechange(); }
      }
    }, 50);
  };

  global.Pebble = {
    addEventListener: function(name, fn) {
      (env.listeners[name] = env.listeners[name] || []).push(fn);
    },
    sendAppMessage: function(dict, ok, fail) {
      var copy = {};
      Object.keys(dict).forEach(function(k) { copy[k] = dict[k]; });
      env.sent.push(copy);
      var nack = env.nack;
      setTimeout(function() {
        if (nack) { if (fail) { fail({}); } } else if (ok) { ok({}); }
      }, 5);
    },
    openURL: function(url) { env.openedUrl = url; },
    getActiveWatchInfo: function() { return { platform: 'emery', model: 'pebble_time_2' }; },
    getAccountToken: function() { return 'acct'; },
    getWatchToken: function() { return 'watch'; },
  };
  if (opts.plugins !== undefined) {
    global.Pebble.subscribeToSource = function(request) {
      var sub = {
        request: request,
        active: true,
        data: function(envelope) { if (sub.active) { request.onData(envelope); } },
        error: function(code) { if (sub.active) { request.onError({ code: code, message: code }); } },
      };
      env.subs.push(sub);
      return { unsubscribe: function() { sub.active = false; } };
    };
    global.Pebble.enumeratePlugins = function() { return env.plugins; };
  }

  // Fresh copies of the modules for every scenario.
  Object.keys(require.cache).forEach(function(k) {
    if (k.indexOf(PKJS) === 0) { delete require.cache[k]; }
  });
  require(path.join(PKJS, 'index.js'));
}

function fire(name, payload) {
  (env.listeners[name] || []).forEach(function(fn) { fn(payload || {}); });
}

function ready() {
  fire('ready');
  advance(0);
}

function fromWatch(payload) {
  fire('appmessage', { payload: payload });
}

// The live subscription for category/item (the newest one).
function sub(category, item) {
  var found = env.subs.filter(function(s) {
    return s.active && s.request.category === category && s.request.item === item;
  });
  return found[found.length - 1] || null;
}

// Messages sent since the last call, with only the keys a test cares about.
var seen = 0;
function take(keys) {
  var out = env.sent.slice(seen);
  seen = env.sent.length;
  if (!keys) { return out; }
  return out.map(function(d) {
    var o = {};
    Object.keys(d).forEach(function(k) { if (keys.test(k)) { o[k] = d[k]; } });
    return o;
  }).filter(function(o) { return Object.keys(o).length; });
}

function resetTake() { seen = env ? env.sent.length : 0; }

// ---------------------------------------------------------------------------
// Envelopes, shaped like the Pebble app's built-in plugins
// ---------------------------------------------------------------------------

function text(t) { return { shortText: { text: t } }; }

function temp(value, unit) {
  return {
    shortText: { text: value + unit },
    longText: { text: value + unit },
    numericValue: { value: value, unit: unit },
  };
}

function weatherEnvelope(t, unit, code, extra) {
  var props = {
    name: text('Seattle'),
    temperature: temp(t, unit),
    condition: { shortText: { text: 'Partly cloudy' } },
    condition_code: { longText: { text: code } },
  };
  Object.keys(extra || {}).forEach(function(k) { props[k] = extra[k]; });
  return {
    pluginUuid: '00000000-0000-0000-0001-000000000002',
    validUntilMs: null,
    instances: [{ instanceId: '1', properties: props }],
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// The code under test logs freely; keep it out of the report unless asked.
var VERBOSE = process.argv.indexOf('-v') !== -1;
function out(line) { process.stdout.write(line + '\n'); }
console.log = function() {
  var line = Array.prototype.join.call(arguments, ' ');
  if (env) { env.logs.push(line); }
  if (VERBOSE) { out('     | ' + line); }
};

var WEATHER_KEYS = /^WEATHER_/;

// --- pure helpers ------------------------------------------------------------

test('temperatures become tenths of a degree Celsius', function() {
  setup();
  var t = require(path.join(PKJS, 'plugins.js'))._test;
  assert.strictEqual(t.tempTenthsC(temp(72, '°F')), 222);
  assert.strictEqual(t.tempTenthsC(temp(71, '°F')), 217);
  assert.strictEqual(t.tempTenthsC(temp(-3, '°C')), -30);
  assert.strictEqual(t.tempTenthsC(text('68°F')), 200);
  assert.strictEqual(t.tempTenthsC(text('21.5°C')), 215);
  assert.strictEqual(t.tempTenthsC(text('n/a')), null);
  // Every whole °F survives the trip through tenths of °C and back, which
  // is the watch's arithmetic (util.c temp_dc_display).
  for (var f = -40; f <= 120; f++) {
    var dc = t.tempTenthsC(temp(f, '°F'));
    var num = dc * 9 + 1600;
    var back = (num >= 0 ? Math.floor((num + 25) / 50) : -Math.floor((-num + 25) / 50)) || 0;
    assert.strictEqual(back, f, f + '°F came back as ' + back);
  }
});

test('condition codes map onto the existing glyphs', function() {
  setup();
  var t = require(path.join(PKJS, 'plugins.js'))._test;
  function cond(code, word) {
    var p = {};
    if (code) { p.condition_code = { longText: { text: code } }; }
    if (word) { p.condition = text(word); }
    return t.conditionOf(p);
  }
  assert.deepStrictEqual(
    ['sun', 'partly_cloudy', 'cloudy', 'light_rain', 'heavy_rain', 'light_snow',
     'heavy_snow', 'rain_and_snow', 'unknown'].map(function(c) { return cond(c); }),
    [1, 2, 3, 5, 5, 6, 6, 6, 0]);
  // No code (or one we don't know): the words, as a 1.15 plugin might send.
  assert.strictEqual(cond(null, 'Light rain'), 5);
  assert.strictEqual(cond('hail', 'Thunderstorms'), 7);
  assert.strictEqual(cond(null, 'Sunny'), 1);
  assert.strictEqual(cond(null, null), 0);
  // shortText codes are read too.
  assert.strictEqual(t.conditionOf({ condition_code: text('cloudy') }), 3);
});

test('UTF-8 truncation never splits a character', function() {
  setup();
  var t = require(path.join(PKJS, 'plugins.js'))._test;
  assert.strictEqual(t.truncateUtf8('Standup', 4), 'Stan');
  assert.strictEqual(t.truncateUtf8('Café crème', 4), 'Caf');
  assert.strictEqual(t.truncateUtf8('Café crème', 5), 'Café');
  assert.strictEqual(t.truncateUtf8('a😀b', 4), 'a');
  assert.strictEqual(t.truncateUtf8('a😀b', 5), 'a😀');
  assert.strictEqual(t.utf8Length('°F'), 3);
});

// --- A1: weather -------------------------------------------------------------

test('without the plugin API, weather comes from Open-Meteo as before', function() {
  setup();               // no plugins option: Pebble.subscribeToSource is undefined
  resetTake();
  ready();
  advance(1000);
  assert.strictEqual(env.xhr.filter(function(u) { return /open-meteo/.test(u); }).length, 1);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 12, WEATHER_TEMP_DC: 123, WEATHER_COND: 3 }]);
  // The watch's periodic request still fetches.
  fromWatch({ WEATHER_REQUEST: 1 });
  advance(1000);
  assert.strictEqual(env.xhr.length, 2);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 12, WEATHER_TEMP_DC: 123, WEATHER_COND: 3 }]);
});

test('weather/location feeds the weather item, and unchanged polls send nothing', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  var s = sub('weather', 'location');
  assert.ok(s, 'subscribed to weather/location');
  assert.strictEqual(s.request.plugin, undefined, 'no plugin uuid: the preferred provider answers');
  ['name', 'temperature', 'condition_code', 'high', 'low', 'precipitation'].forEach(function(p) {
    assert.ok(s.request.properties.indexOf(p) !== -1, 'asks for ' + p);
  });
  s.data(weatherEnvelope(72, '°F', 'partly_cloudy'));
  advance(100);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 22, WEATHER_TEMP_DC: 222, WEATHER_COND: 2 }]);
  // The host re-delivers the same reading on every refresh.
  s.data(weatherEnvelope(72, '°F', 'partly_cloudy'));
  s.data(weatherEnvelope(72, '°F', 'partly_cloudy'));
  advance(100);
  assert.deepStrictEqual(take(WEATHER_KEYS), []);
  // A real change goes out.
  s.data(weatherEnvelope(73, '°F', 'light_rain'));
  advance(100);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 23, WEATHER_TEMP_DC: 228, WEATHER_COND: 5 }]);
  // No Open-Meteo at any point.
  assert.strictEqual(env.xhr.length, 0);
});

test('the watch\'s weather request is answered from the subscription, not Open-Meteo', function() {
  setup({ plugins: [] });
  ready();
  sub('weather', 'location').data(weatherEnvelope(18, '°C', 'sun'));
  advance(100);
  resetTake();
  fromWatch({ WEATHER_REQUEST: 1 });
  advance(100);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 18, WEATHER_TEMP_DC: 180, WEATHER_COND: 1 }]);
  assert.strictEqual(env.xhr.length, 0);
  // Three hours without an update: the subscription no longer counts as
  // live, and the request falls back to Open-Meteo.
  advance(3 * 3600 * 1000 + 1000);
  fromWatch({ WEATHER_REQUEST: 1 });
  advance(1000);
  assert.strictEqual(env.xhr.length, 1);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 12, WEATHER_TEMP_DC: 123, WEATHER_COND: 3 }]);
});

test('PLUGIN_UNAVAILABLE falls back to Open-Meteo straight away', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  sub('weather', 'location').error('PLUGIN_UNAVAILABLE');
  advance(1000);
  assert.strictEqual(env.xhr.length, 1);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 12, WEATHER_TEMP_DC: 123, WEATHER_COND: 3 }]);
  // The subscription carries on; if it later answers, it takes over.
  sub('weather', 'location').data(weatherEnvelope(15, '°C', 'cloudy'));
  advance(100);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 15, WEATHER_TEMP_DC: 150, WEATHER_COND: 3 }]);
});

test('a subscription that never answers falls back after 15 seconds', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  advance(14000);
  assert.strictEqual(env.xhr.length, 0);
  // A watch request while we wait doesn't start a second fetch.
  fromWatch({ WEATHER_REQUEST: 1 });
  advance(500);
  assert.strictEqual(env.xhr.length, 0);
  advance(2000);
  assert.strictEqual(env.xhr.length, 1);
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 12, WEATHER_TEMP_DC: 123, WEATHER_COND: 3 }]);
});

test('an envelope with no location counts as no answer', function() {
  setup({ plugins: [] });
  ready();
  sub('weather', 'location').data({ instances: [] });
  advance(1000);
  assert.strictEqual(env.xhr.length, 1);
});

test('weather off in the status line: no subscription, Open-Meteo path unchanged', function() {
  setup({ plugins: [], settings: { METRIC1: '1', METRIC2: '3' } });
  ready();
  assert.strictEqual(sub('weather', 'location'), null);
  advance(1000);
  assert.strictEqual(env.xhr.length, 1);
});

test('an undelivered change is retried, then not repeated once delivered', function() {
  setup({ plugins: [] });
  ready();
  var s = sub('weather', 'location');
  env.nack = true;
  resetTake();
  s.data(weatherEnvelope(10, '°C', 'sun'));
  advance(100);
  assert.strictEqual(take(WEATHER_KEYS).length, 1);
  // The same value again while undelivered doesn't pile up a second copy.
  s.data(weatherEnvelope(10, '°C', 'sun'));
  advance(100);
  assert.strictEqual(take(WEATHER_KEYS).length, 0);
  env.nack = false;
  advance(3500);   // first retry
  assert.deepStrictEqual(take(WEATHER_KEYS),
    [{ WEATHER_TEMP_C: 10, WEATHER_TEMP_DC: 100, WEATHER_COND: 1 }]);
  s.data(weatherEnvelope(10, '°C', 'sun'));
  advance(60000);
  assert.deepStrictEqual(take(WEATHER_KEYS), []);
});

// --- A2: units ---------------------------------------------------------------

function unitsEnvelope(temperature, distance) {
  return {
    pluginUuid: '00000000-0000-0000-0001-000000000009',
    instances: [{
      instanceId: 'units',
      properties: {
        locale: text('en-US'), temperature: text(temperature), distance: text(distance),
        wind_speed: text('mph'), pressure: text('inHg'), precipitation: text('in'),
        clock: text('12h'),
      },
    }],
  };
}

// The settings page Clay would open, as the config array it was built from.
function openedConfig() {
  fire('showConfiguration');
  assert.ok(env.openedUrl, 'a settings page was opened');
  return decodeURIComponent(env.openedUrl.replace(/^data:text\/html;charset=utf-8,/, ''));
}

// A settings-page item in Clay's serialized config (not its stored values).
function field(key) { return new RegExp('messageKey:\\s*"' + key + '"'); }

var UNIT_KEYS = /^(TEMP_UNIT|DIST_UNIT)$/;

test('preferences/units sets the units, once per change', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  var s = sub('preferences', 'units');
  assert.ok(s, 'subscribed to preferences/units');
  s.data(unitsEnvelope('°C', 'km'));
  advance(100);
  assert.deepStrictEqual(take(UNIT_KEYS), [{ TEMP_UNIT: 0, DIST_UNIT: 0 }]);
  s.data(unitsEnvelope('°C', 'km'));
  advance(100);
  assert.deepStrictEqual(take(UNIT_KEYS), []);
  s.data(unitsEnvelope('°F', 'mi'));
  advance(100);
  assert.deepStrictEqual(take(UNIT_KEYS), [{ TEMP_UNIT: 1, DIST_UNIT: 1 }]);
  // Stored, so the settings page tells the truth if the plugin goes away.
  var stored = JSON.parse(env.store['clay-settings']);
  assert.strictEqual(stored.TEMP_UNIT, '1');
  assert.strictEqual(stored.DIST_UNIT, '1');
});

test('the settings page drops the unit fields while the Pebble app decides them', function() {
  setup({ plugins: [] });
  ready();
  var before = openedConfig();
  assert.ok(field('TEMP_UNIT').test(before) && field('DIST_UNIT').test(before),
            'fields shown before units are known');
  sub('preferences', 'units').data(unitsEnvelope('°F', 'mi'));
  advance(100);
  var after = openedConfig();
  assert.ok(!field('TEMP_UNIT').test(after) && !field('DIST_UNIT').test(after), 'fields hidden');
  assert.ok(field('METRIC1').test(after), 'the rest of the page is intact');
});

test('saving the settings page keeps the Pebble app\'s units and sends none', function() {
  setup({ plugins: [] });
  ready();
  sub('preferences', 'units').data(unitsEnvelope('°C', 'km'));
  advance(100);
  resetTake();
  // What Clay's page returns: only the fields it showed.
  fire('webviewclosed', { response: encodeURIComponent(JSON.stringify({
    METRIC1: { value: '1' }, METRIC2: { value: '2' }, THEME: { value: '3' },
  })) });
  advance(100);
  var sent = take();
  var keys = messageKeys();
  sent.forEach(function(d) {
    assert.ok(!(keys.TEMP_UNIT in d) && !('TEMP_UNIT' in d), 'no TEMP_UNIT sent');
  });
  var stored = JSON.parse(env.store['clay-settings']);
  assert.strictEqual(stored.TEMP_UNIT, '0');
  assert.strictEqual(stored.THEME, '3');
});

test('1.15 (no preferences source): units stay on the settings page', function() {
  setup({ plugins: [] });
  ready();
  sub('preferences', 'units').error('PLUGIN_UNAVAILABLE');
  advance(100);
  assert.ok(field('TEMP_UNIT').test(openedConfig()));
  assert.deepStrictEqual(take(UNIT_KEYS), []);
});

// --- A3: next event ----------------------------------------------------------

function nowSec() { return Math.floor(clock.now / 1000); }

function calendarEnvelope(events) {
  return {
    pluginUuid: '00000000-0000-0000-0001-000000000004',
    instances: events.map(function(e, i) {
      return {
        instanceId: String(i),
        properties: {
          name: { shortText: { text: e.name }, longText: { text: e.name } },
          starts_at: { shortText: { text: 'hh:mm' }, timestamp: { value: e.start } },
          ends_at: { shortText: { text: 'hh:mm' }, timestamp: { value: e.end } },
          all_day: { boolean: { value: !!e.allDay } },
          calendar: text('Work'),
        },
      };
    }),
  };
}

var EVENT_KEYS = /^EVENT_/;
var CAL_PLUGIN = [{
  uuid: '00000000-0000-0000-0001-000000000004', name: 'Calendar',
  sources: [{ category: 'calendar', items: ['event'], properties: {} }], actions: [],
}];

test('no calendar subscription (and no permission prompt) unless the item is chosen', function() {
  setup({ plugins: CAL_PLUGIN });
  ready();
  assert.strictEqual(sub('calendar', 'event'), null);
});

test('next event: the first timed event, re-sent only when it changes', function() {
  setup({ plugins: CAL_PLUGIN, settings: { METRIC1: '1', METRIC2: '13' } });
  resetTake();
  ready();
  var s = sub('calendar', 'event');
  assert.ok(s, 'subscribed to calendar/event');
  var t = nowSec();
  var events = [
    { name: 'Company holiday', start: t - 3600 * 10, end: t + 3600 * 14, allDay: true },
    { name: 'Standup', start: t + 23 * 60, end: t + 38 * 60 },
    { name: 'Lunch with Sam', start: t + 65 * 60, end: t + 125 * 60 },
  ];
  s.data(calendarEnvelope(events));
  advance(100);
  assert.deepStrictEqual(take(EVENT_KEYS), [{
    EVENT_NAME: 'Standup', EVENT_START: t + 23 * 60, EVENT_END: t + 38 * 60, EVENT_ALL_DAY: 0,
  }]);
  s.data(calendarEnvelope(events));   // the calendar's minute tick, unchanged
  advance(100);
  assert.deepStrictEqual(take(EVENT_KEYS), []);
  // Five minutes after Standup starts, the face moves on to Lunch by itself:
  // the calendar sends nothing when an event merely starts.
  advance((23 + 5) * 60 * 1000 + 2000);
  assert.deepStrictEqual(take(EVENT_KEYS), [{
    EVENT_NAME: 'Lunch with Sam', EVENT_START: t + 65 * 60, EVENT_END: t + 125 * 60,
    EVENT_ALL_DAY: 0,
  }]);
  // The watch asks after half an hour of silence: the same event again.
  fromWatch({ PLUGIN_REQUEST: 1 });
  advance(100);
  assert.strictEqual(take(EVENT_KEYS).length, 1);
});

test('next event: all-day only when nothing timed is coming; titles cleaned and cut', function() {
  setup({ plugins: CAL_PLUGIN, settings: { METRIC1: '13' } });
  resetTake();
  ready();
  var t = nowSec();
  sub('calendar', 'event').data(calendarEnvelope([
    { name: '🎂 Mom’s birthday 🎉', start: t - 3600, end: t + 3600 * 20, allDay: true },
  ]));
  advance(100);
  var got = take(EVENT_KEYS);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].EVENT_NAME, 'Mom’s birthday');
  assert.strictEqual(got[0].EVENT_ALL_DAY, 1);
  sub('calendar', 'event').data(calendarEnvelope([
    { name: 'Quarterly planning review with the whole team', start: t + 600, end: t + 4200 },
  ]));
  advance(100);
  got = take(EVENT_KEYS);
  assert.strictEqual(got[0].EVENT_NAME, 'Quarterly planning revi');
  var plugins = require(path.join(PKJS, 'plugins.js'));
  assert.ok(plugins._test.truncateUtf8 && got[0].EVENT_NAME.length <= 23);
});

test('next event: refused or gone clears the item', function() {
  setup({ plugins: CAL_PLUGIN, settings: { METRIC1: '13' } });
  resetTake();
  ready();
  sub('calendar', 'event').error('PERMISSION_DENIED');
  advance(100);
  assert.deepStrictEqual(take(EVENT_KEYS),
    [{ EVENT_NAME: '', EVENT_START: 0, EVENT_END: 0, EVENT_ALL_DAY: 0 }]);
  // A passing error keeps what the watch has.
  sub('calendar', 'event').error('TIMEOUT');
  advance(100);
  assert.deepStrictEqual(take(EVENT_KEYS), []);
});

test('settings page offers Next calendar event only where it can work', function() {
  setup({ plugins: CAL_PLUGIN });
  ready();
  assert.ok(/Next calendar event/.test(openedConfig()));
  setup({ plugins: [] });   // plugin API, but no calendar source
  ready();
  assert.ok(!/Next calendar event/.test(openedConfig()));
  setup();                  // no plugin API at all
  ready();
  assert.ok(!/Next calendar event/.test(openedConfig()));
  // Already chosen: kept on the page so saving doesn't drop it.
  setup({ settings: { METRIC1: '13' } });
  ready();
  assert.ok(/Next calendar event/.test(openedConfig()));
});

// --- A4: phone battery -------------------------------------------------------

function phoneEnvelope(level, wifi) {
  return {
    pluginUuid: '00000000-0000-0000-0001-000000000001',
    instances: [{
      instanceId: 'phone',
      properties: {
        battery_level: { numericValue: { value: level, unit: '%', min: 0, max: 100 },
                         shortText: { text: level + '%' } },
        cell: text('5G'),
        wifi: { boolean: { value: !!wifi }, shortText: { text: wifi ? 'Wi-Fi' : 'Off' } },
        mobile_data: { boolean: { value: !wifi }, shortText: { text: wifi ? 'Off' : 'Mobile' } },
      },
    }],
  };
}

var PHONE_KEYS = /^PHONE_/;
var PHONE_PLUGIN = [{
  uuid: '00000000-0000-0000-0001-000000000001', name: 'Phone',
  sources: [{ category: 'phone', items: ['phone_state'], properties: {} }], actions: [],
}];

test('phone battery: sent when the level changes, not when the network does', function() {
  setup({ plugins: PHONE_PLUGIN, settings: { METRIC1: '14' } });
  resetTake();
  ready();
  var s = sub('phone', 'phone_state');
  assert.ok(s, 'subscribed to phone/phone_state');
  s.data(phoneEnvelope(82, true));
  advance(100);
  assert.deepStrictEqual(take(PHONE_KEYS), [{ PHONE_BATTERY: 82 }]);
  s.data(phoneEnvelope(82, false));
  s.data(phoneEnvelope(82, true));
  advance(100);
  assert.deepStrictEqual(take(PHONE_KEYS), []);
  s.data(phoneEnvelope(81, true));
  advance(100);
  assert.deepStrictEqual(take(PHONE_KEYS), [{ PHONE_BATTERY: 81 }]);
  fromWatch({ PLUGIN_REQUEST: 1 });
  advance(100);
  assert.deepStrictEqual(take(PHONE_KEYS), [{ PHONE_BATTERY: 81 }]);
  s.data({ instances: [] });
  advance(100);
  assert.deepStrictEqual(take(PHONE_KEYS), [{ PHONE_BATTERY: -1 }]);
});

test('phone battery: offered on the settings page when phone_state is served', function() {
  setup({ plugins: PHONE_PLUGIN });
  ready();
  assert.ok(/Phone battery/.test(openedConfig()));
  assert.strictEqual(sub('phone', 'phone_state'), null, 'not subscribed until chosen');
});

// --- A5: readings 1-5 --------------------------------------------------------

function complicationsEnvelope(slots) {
  return {
    pluginUuid: '00000000-0000-0000-0001-000000000009',
    instances: slots.map(function(slot, i) {
      return {
        instanceId: String(slot.position !== undefined ? slot.position : i),
        properties: {
          category: text(slot.category), item: text(slot.item),
          index: { numericValue: { value: slot.index || 0 } }, property: text(slot.property),
        },
      };
    }),
  };
}

// The Pebble app's default list (PreferencesPlugin.DEFAULT_COMPLICATIONS).
var DEFAULT_SLOTS = [
  { category: 'phone', item: 'phone_state', property: 'battery_level' },
  { category: 'weather', item: 'location', property: 'temperature' },
  { category: 'calendar', item: 'event', property: 'starts_at' },
  { category: 'finance', item: 'stock', property: 'price' },
];

var READING_KEYS = /^READING/;

function subCount(category, item) {
  return env.subs.filter(function(x) {
    return x.request.category === category && x.request.item === item;
  }).length;
}

test('readings: each chosen slot reads its source, by position in the user\'s list', function() {
  // Readings 1, 2 and 4 in the status line; 3 (the calendar) is not.
  setup({ plugins: [], settings: { METRIC1: '15', METRIC2: '16', METRIC3: '18' } });
  resetTake();
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS));
  advance(0);
  var phone = sub('phone', 'phone_state');
  var weather = sub('weather', 'location');
  assert.ok(phone && weather && sub('finance', 'stock'), 'one subscription per chosen source');
  assert.deepStrictEqual(phone.request.properties, ['name', 'battery_level']);
  assert.strictEqual(sub('calendar', 'event'), null, 'reading 3 is not chosen: no calendar');
  sub('finance', 'stock').error('PLUGIN_UNAVAILABLE');   // no Stocks plugin installed
  phone.data(phoneEnvelope(82, true));
  weather.data(weatherEnvelope(14, '°C', 'sun'));
  advance(100);
  var got = {};
  take(READING_KEYS).forEach(function(d) {
    Object.keys(d).forEach(function(k) { got[k] = d[k]; });
  });
  assert.deepStrictEqual(got, {
    READING1_TEXT: '82%', READING1_LABEL: '',
    READING2_TEXT: '14°C', READING2_LABEL: 'Seattle',
    READING4_TEXT: '', READING4_LABEL: '',
  });
  // Unchanged re-deliveries: no messages, no re-subscribing.
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS));
  phone.data(phoneEnvelope(82, false));
  weather.data(weatherEnvelope(14, '°C', 'sun'));
  advance(100);
  assert.deepStrictEqual(take(READING_KEYS), []);
  assert.strictEqual(subCount('phone', 'phone_state'), 1);
  // A real change to one reading sends just that slot.
  phone.data(phoneEnvelope(80, true));
  advance(100);
  assert.deepStrictEqual(take(READING_KEYS), [{ READING1_TEXT: '80%', READING1_LABEL: '' }]);
});

test('readings: reordering the list in the Pebble app moves the slots', function() {
  setup({ plugins: [], settings: { METRIC1: '15', METRIC2: '16' } });
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS.slice(0, 2)));
  sub('phone', 'phone_state').data(phoneEnvelope(55, true));
  sub('weather', 'location').data(weatherEnvelope(70, '°F', 'sun'));
  advance(100);
  resetTake();
  sub('preferences', 'complications').data(
    complicationsEnvelope([DEFAULT_SLOTS[1], DEFAULT_SLOTS[0]]));
  advance(0);
  // Same two sources, same properties: the subscriptions are kept, and the
  // readings swap places.
  assert.strictEqual(subCount('phone', 'phone_state'), 1);
  advance(100);
  var got = {};
  take(READING_KEYS).forEach(function(d) {
    Object.keys(d).forEach(function(k) { got[k] = d[k]; });
  });
  assert.deepStrictEqual(got, {
    READING1_TEXT: '70°F', READING1_LABEL: 'Seattle',
    READING2_TEXT: '55%', READING2_LABEL: '',
  });
});

test('readings: an entry missing its property is sent empty, not left waiting', function() {
  setup({ plugins: [], settings: { METRIC1: '15' } });
  resetTake();
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope([
    { category: 'phone', item: 'phone_state', property: '' },
  ]));
  advance(100);
  assert.deepStrictEqual(take(READING_KEYS), [{ READING1_TEXT: '', READING1_LABEL: '' }]);
  assert.strictEqual(sub('phone', 'phone_state'), null);
});

test('readings: a number without text is shown with its unit', function() {
  setup();
  var t = require(path.join(PKJS, 'plugins.js'))._test;
  assert.strictEqual(t.readingText({ numericValue: { value: 5.46, min: 0, max: 11 } }), '5.5');
  assert.strictEqual(t.readingText({ numericValue: { value: 64, unit: '%' } }), '64%');
  assert.strictEqual(t.readingText({ numericValue: { value: 1234.5, unit: ' ft' } }), '1235 ft');
  assert.strictEqual(t.readingText({ shortText: { text: '$189.53' },
                                     numericValue: { value: 189.53 } }), '$189.53');
  assert.strictEqual(t.readingText({ boolean: { value: true } }), '');
  assert.strictEqual(t.readingText(undefined), '');
});

test('readings: on 1.15 (no preferences source) chosen readings are empty', function() {
  setup({ plugins: [], settings: { METRIC1: '15' } });
  resetTake();
  ready();
  sub('preferences', 'complications').error('PLUGIN_UNAVAILABLE');
  advance(100);
  assert.deepStrictEqual(take(READING_KEYS), [{ READING1_TEXT: '', READING1_LABEL: '' }]);
  assert.ok(/Reading 1/.test(openedConfig()), 'still listed: it is chosen');
  assert.ok(!/Reading 2/.test(openedConfig()), 'nothing to offer otherwise');
});

test('readings: the settings page says what each one is', function() {
  setup({ plugins: [], settings: { METRIC1: '15' } });
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS));
  sub('phone', 'phone_state').data(phoneEnvelope(82, true));
  advance(100);
  var page = openedConfig();
  assert.ok(/Reading 1: phone battery level \(82%\)/.test(page), 'reading 1 described with its value');
  assert.ok(/Reading 2: weather temperature/.test(page), 'reading 2 described');
  assert.ok(/Reading 4: finance price/.test(page), 'reading 4 described');
  assert.ok(!/Reading 5/.test(page), 'no fifth reading in the list');
});

test('readings: the watch\'s request re-sends them; none chosen sends none', function() {
  setup({ plugins: [], settings: { METRIC1: '15' } });
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS));
  sub('phone', 'phone_state').data(phoneEnvelope(82, true));
  advance(100);
  resetTake();
  fromWatch({ PLUGIN_REQUEST: 1 });
  advance(100);
  assert.deepStrictEqual(take(READING_KEYS), [{ READING1_TEXT: '82%', READING1_LABEL: '' }]);

  setup({ plugins: [] });
  resetTake();
  ready();
  sub('preferences', 'complications').data(complicationsEnvelope(DEFAULT_SLOTS));
  advance(20000);
  assert.deepStrictEqual(take(READING_KEYS), []);
  assert.strictEqual(sub('phone', 'phone_state'), null);
});

test('without the plugin API, the watch\'s request is answered empty', function() {
  setup({ settings: { METRIC1: '14', METRIC2: '13', METRIC3: '16' } });
  resetTake();
  ready();
  fromWatch({ PLUGIN_REQUEST: 1 });
  advance(100);
  var got = {};
  take(/^(PHONE|EVENT|READING)/).forEach(function(d) {
    Object.keys(d).forEach(function(k) { got[k] = d[k]; });
  });
  assert.deepStrictEqual(got, {
    PHONE_BATTERY: -1, EVENT_NAME: '', EVENT_START: 0, EVENT_END: 0, EVENT_ALL_DAY: 0,
    READING2_TEXT: '', READING2_LABEL: '',
  });
});

test('a source that never answers stops showing whatever it showed last', function() {
  setup({ plugins: [], settings: { METRIC1: '14' } });
  resetTake();
  ready();
  advance(16000);
  assert.deepStrictEqual(take(PHONE_KEYS), [{ PHONE_BATTERY: -1 }]);
});

// --- A8: forecast plumbing ---------------------------------------------------

var FC_KEYS = /^FC_/;
var MIDNIGHT = RealDate.UTC(2026, 9, 28) / 1000;   // the fake clock's day starts here

function numericSeries(start, step, values, unit) {
  return { series: {
    start: start, stepSec: step,
    numericValue: { values: values, unit: unit },
    shortText: { values: values.map(function(v) { return v === null ? null : v + unit; }) },
  } };
}

function hours(from) {
  var out = [];
  for (var h = 0; h < 48; h++) { out.push(from + h); }
  return out;
}

test('forecast: today\'s range and the next three hours, sent when they change', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  var s = sub('weather', 'location');
  ['daily_high', 'daily_low', 'hourly_temperature'].forEach(function(p) {
    assert.ok(s.request.properties.indexOf(p) !== -1, 'asks for ' + p);
  });
  var extra = {
    high: temp(75, '°F'), low: temp(50, '°F'),
    precipitation: { numericValue: { value: 30, unit: '%', min: 0, max: 100 }, shortText: { text: '30%' } },
    hourly_temperature: numericSeries(MIDNIGHT, 3600, hours(40), '°F'),
    daily_high: numericSeries(MIDNIGHT, 86400, [75, 77, 71], '°F'),
    daily_low: numericSeries(MIDNIGHT, 86400, [50, 52, 49], '°F'),
  };
  s.data(weatherEnvelope(60, '°F', 'sun', extra));
  advance(100);
  // 16:30 now: the next hours are 17:00, 18:00 and 19:00 (values 57, 58, 59 °F).
  assert.deepStrictEqual(take(FC_KEYS), [{
    FC_HIGH_DC: 239, FC_LOW_DC: 100, FC_PRECIP: 30,
    FC_HOUR1_DC: 139, FC_HOUR2_DC: 144, FC_HOUR3_DC: 150,
    FC_HOURS_START: MIDNIGHT + 17 * 3600,
  }]);
  s.data(weatherEnvelope(60, '°F', 'sun', extra));
  advance(100);
  assert.deepStrictEqual(take(FC_KEYS), []);
  // An hour on, the same envelope moves the window by one.
  advance(3600 * 1000);
  s.data(weatherEnvelope(60, '°F', 'sun', extra));
  advance(100);
  var got = take(FC_KEYS);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].FC_HOURS_START, MIDNIGHT + 18 * 3600);
  assert.strictEqual(got[0].FC_HOUR1_DC, 144);
  // The watch's weather request re-sends the forecast with the weather.
  fromWatch({ WEATHER_REQUEST: 1 });
  advance(100);
  assert.strictEqual(take(FC_KEYS).length, 1);
});

test('forecast: a 1.15 envelope (no series) sends what it has, hours empty', function() {
  setup({ plugins: [] });
  resetTake();
  ready();
  sub('weather', 'location').data(weatherEnvelope(20, '°C', 'cloudy', {
    high: temp(23, '°C'), low: temp(12, '°C'),
  }));
  advance(100);
  assert.deepStrictEqual(take(FC_KEYS), [{
    FC_HIGH_DC: 230, FC_LOW_DC: 120, FC_PRECIP: 255,
    FC_HOUR1_DC: -32768, FC_HOUR2_DC: -32768, FC_HOUR3_DC: -32768, FC_HOURS_START: 0,
  }]);
});

test('forecast: high and low from the daily series when the plain ones are missing', function() {
  setup();
  var t = require(path.join(PKJS, 'plugins.js'))._test;
  var d = t.forecastDict(weatherEnvelope(20, '°C', 'sun', {
    daily_high: numericSeries(MIDNIGHT - 86400, 86400, [19, 24, 26], '°C'),
    daily_low: numericSeries(MIDNIGHT - 86400, 86400, [9, 11, null], '°C'),
  }), MIDNIGHT + 3600 * 10);
  assert.strictEqual(d.FC_HIGH_DC, 240);
  assert.strictEqual(d.FC_LOW_DC, 110);
});

test('a full update stays inside the watch\'s 512-byte inbox', function() {
  setup({ plugins: [], settings: {
    METRIC1: '2', METRIC2: '13', METRIC3: '14', METRIC4: '15', METRIC5: '16', METRIC6: '17',
    METRIC7: '18', METRIC8: '19',
  } });
  resetTake();
  ready();
  var t = nowSec();
  sub('preferences', 'units').data(unitsEnvelope('°F', 'mi'));
  sub('calendar', 'event').data(calendarEnvelope([
    { name: 'A very long meeting title that goes on', start: t + 600, end: t + 4200 },
  ]));
  sub('phone', 'phone_state').data(phoneEnvelope(100, true));
  var slots = [0, 1, 2, 3, 4].map(function(i) {
    return { category: 'demo', item: 'thing', index: i, property: 'value' };
  });
  sub('preferences', 'complications').data(complicationsEnvelope(slots));
  advance(0);
  var instances = [0, 1, 2, 3, 4].map(function(i) {
    return { instanceId: String(i), properties: {
      name: text('Long instance name ' + i), value: text('Fifteen chars!' + i + ' and more'),
    } };
  });
  sub('demo', 'thing').data({ instances: instances });
  sub('weather', 'location').data(weatherEnvelope(-12, '°F', 'heavy_snow', {
    hourly_temperature: numericSeries(MIDNIGHT, 3600, hours(-20), '°F'),
    high: temp(-1, '°F'), low: temp(-25, '°F'),
  }));
  advance(1000);
  var plugins = require(path.join(PKJS, 'plugins.js'));
  var all = take();
  assert.ok(all.length >= 1);
  all.forEach(function(d) {
    // 1 byte of header plus 7 per tuple and its value (ints as int32).
    var bytes = plugins._test.dictBytes(d) + 1;
    assert.ok(bytes <= 512, 'message of ' + bytes + ' bytes');
  });
  var keys = {};
  all.forEach(function(d) { Object.keys(d).forEach(function(k) { keys[k] = true; }); });
  ['WEATHER_TEMP_DC', 'TEMP_UNIT', 'EVENT_NAME', 'PHONE_BATTERY', 'READING5_TEXT', 'FC_HOUR3_DC']
      .forEach(function(k) { assert.ok(keys[k], k + ' delivered'); });
});

// ---------------------------------------------------------------------------

var failures = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    out('ok   ' + t.name);
  } catch (e) {
    failures++;
    out('FAIL ' + t.name);
    out('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
});
global.Date = RealDate;
out('\n' + (tests.length - failures) + '/' + tests.length + ' passed');
process.exit(failures ? 1 : 0);
