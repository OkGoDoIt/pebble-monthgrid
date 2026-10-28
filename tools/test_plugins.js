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
