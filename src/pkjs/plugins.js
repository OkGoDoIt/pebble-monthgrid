// Data from the Pebble app's plugins (Pebble mobile app 1.15+, with plugins
// switched on): weather, units, calendar, phone state and the user's own
// favorite readings, read from the phone instead of fetched by us.
//
// Everything here is optional. Without `Pebble.subscribeToSource` (older
// apps, the emulator's pypkjs, plugins switched off) nothing subscribes and
// index.js keeps doing what it always did. A source that answers with an
// error, or never answers, falls back the same way.
//
// The host re-delivers a source on every refresh whether or not anything
// changed, so every value goes through an Outbox that sends only what the
// watch has not already acknowledged. The one exception is answering the
// watch's own requests (WEATHER_REQUEST, PLUGIN_REQUEST): those re-send the
// latest values on purpose, because the watch uses the reply to know the
// phone is still there.

var COND = {
  UNKNOWN: 0, CLEAR: 1, PARTLY: 2, CLOUDY: 3, FOG: 4,
  RAIN: 5, SNOW: 6, THUNDER: 7, WIND: 8,
};

// How long a subscription gets to answer before it counts as unreadable
// (reported to its handler as NO_ANSWER).
var FIRST_ANSWER_MS = 15000;

// Errors that mean "this can't be read": its value should disappear rather
// than linger. Anything else (TIMEOUT, RATE_LIMITED...) passes, and the
// subscription carries on.
function gone(code) {
  return code === 'PLUGIN_UNAVAILABLE' || code === 'PERMISSION_DENIED' ||
      code === 'NO_ANSWER' || code === 'NO_DATA';
}
// Weather this old (by when it reached us) no longer answers the watch's
// requests; Open-Meteo does instead. Matches the watch's own stale limit.
var WEATHER_LIVE_MS = 3 * 60 * 60 * 1000;

function log(message) {
  console.log('monthgrid: ' + message);
}

function available() {
  return typeof Pebble !== 'undefined' && typeof Pebble.subscribeToSource === 'function';
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Reading shapes
// ---------------------------------------------------------------------------

function textOf(payloads, shape) {
  var p = payloads && payloads[shape || 'shortText'];
  return p && typeof p.text === 'string' ? p.text : null;
}

function numberOf(payloads) {
  var p = payloads && payloads.numericValue;
  return p && typeof p.value === 'number' && isFinite(p.value) ? p : null;
}

// Tenths of a degree Celsius from a temperature property: its numericValue
// (in °C or °F, which its unit says), else the number in its text.
function tempTenthsC(payloads) {
  var n = numberOf(payloads);
  var value = null, unit = null;
  if (n) {
    value = n.value;
    unit = n.unit;
  } else {
    var text = textOf(payloads) || textOf(payloads, 'longText');
    var m = text && /(-?\d+(?:\.\d+)?)\s*°?\s*([CF])?/i.exec(text);
    if (!m) { return null; }
    value = parseFloat(m[1]);
    unit = m[2] ? '°' + m[2].toUpperCase() : null;
  }
  var dc = (unit && /F/i.test(unit)) ? Math.round((value - 32) * 50 / 9) : Math.round(value * 10);
  return dc || 0;   // no -0
}

// The weather vocabulary (`condition_code`) onto the watch's glyphs. Heavy
// and light share a glyph; mixed rain and snow reads as snow.
var CODE_TO_COND = {
  sun: COND.CLEAR,
  partly_cloudy: COND.PARTLY,
  cloudy: COND.CLOUDY,
  light_rain: COND.RAIN,
  heavy_rain: COND.RAIN,
  light_snow: COND.SNOW,
  heavy_snow: COND.SNOW,
  rain_and_snow: COND.SNOW,
  unknown: COND.UNKNOWN,
};

// The built-in plugin's `condition` words, for a plugin that sends no code.
var WORD_TO_COND = [
  [/thunder|storm/i, COND.THUNDER],
  [/snow|sleet|flurr/i, COND.SNOW],
  [/rain|shower|drizzle/i, COND.RAIN],
  [/fog|mist|haze/i, COND.FOG],
  [/partly|mostly sunny|few clouds/i, COND.PARTLY],
  [/cloud|overcast/i, COND.CLOUDY],
  [/sun|clear/i, COND.CLEAR],
  [/wind/i, COND.WIND],
];

function conditionOf(properties) {
  var code = textOf(properties.condition_code, 'longText') ||
      textOf(properties.condition_code);
  if (code && CODE_TO_COND.hasOwnProperty(code)) { return CODE_TO_COND[code]; }
  var word = textOf(properties.condition) || textOf(properties.condition, 'longText');
  if (word) {
    for (var i = 0; i < WORD_TO_COND.length; i++) {
      if (WORD_TO_COND[i][0].test(word)) { return WORD_TO_COND[i][1]; }
    }
  }
  return COND.UNKNOWN;
}

// The dictionary the watch takes for current weather, or null when the
// envelope has nothing usable (no location, no temperature).
function weatherDict(envelope) {
  var instance = envelope && envelope.instances && envelope.instances[0];
  var properties = instance && instance.properties;
  if (!properties) { return null; }
  var dc = tempTenthsC(properties.temperature);
  if (dc === null) { return null; }
  return {
    WEATHER_TEMP_C: Math.round(dc / 10),
    WEATHER_TEMP_DC: dc,
    WEATHER_COND: conditionOf(properties),
  };
}

// --- calendar ---------------------------------------------------------------

// An event that began this long ago still shows as "now"; after that the
// next one takes its place.
var EVENT_GRACE_SEC = 5 * 60;
var EVENT_NAME_BYTES = 23;   // EVENT_NAME_LEN - 1 on the watch

// Event titles often carry emoji, which the watch fonts can't draw.
function plainText(s) {
  return (s || '').replace(/[\uD800-\uDFFF\uFE0F\u200D\u20E3]/g, '')
      .replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

function timestampOf(payloads) {
  var p = payloads && payloads.timestamp;
  return p && typeof p.value === 'number' ? Math.floor(p.value) : null;
}

function booleanOf(payloads) {
  var p = payloads && payloads.boolean;
  return p ? !!p.value : false;
}

// calendar/event lists upcoming events soonest first, including any under
// way. The next event is the first timed one that hasn't started (or only
// just has); all-day events only count when no timed event is coming.
function pickNextEvent(instances, nowSec) {
  var timed = null, allDay = null;
  for (var i = 0; i < (instances || []).length; i++) {
    var p = instances[i].properties || {};
    var start = timestampOf(p.starts_at);
    if (start === null) { continue; }
    var end = timestampOf(p.ends_at);
    if (end !== null && end <= nowSec) { continue; }
    var ev = {
      name: plainText(textOf(p.name) || textOf(p.name, 'longText')),
      start: start,
      end: end || 0,
      allDay: booleanOf(p.all_day),
    };
    if (ev.allDay) {
      if (!allDay || ev.start < allDay.start) { allDay = ev; }
    } else if (start > nowSec - EVENT_GRACE_SEC) {
      if (!timed || ev.start < timed.start) { timed = ev; }
    }
  }
  return timed || allDay;
}

function eventDict(ev) {
  if (!ev) {
    return { EVENT_NAME: '', EVENT_START: 0, EVENT_END: 0, EVENT_ALL_DAY: 0 };
  }
  return {
    EVENT_NAME: truncateUtf8(ev.name, EVENT_NAME_BYTES),
    EVENT_START: ev.start,
    EVENT_END: ev.end,
    EVENT_ALL_DAY: ev.allDay ? 1 : 0,
  };
}

// --- forecast -----------------------------------------------------------------

var TEMP_NONE = -32768;     // TEMP_NONE on the watch
var PRECIP_NONE = 255;
var FORECAST_HOURS = 3;

// One point of a series, as a payload of the shape it was drawn from.
function seriesPoint(series, shape, i) {
  var s = series && series[shape];
  if (!s || !s.values || i < 0 || i >= s.values.length) { return null; }
  var v = s.values[i];
  if (v === null || v === undefined) { return null; }
  if (shape === 'numericValue') { return { numericValue: { value: v, unit: s.unit } }; }
  return { shortText: { text: v } };
}

// Where now falls in a series (start at local midnight, stepSec apart).
function seriesIndex(series, nowSec) {
  if (!series || typeof series.start !== 'number' || !series.stepSec) { return -1; }
  return Math.floor((nowSec - series.start) / series.stepSec);
}

function seriesTemp(property, i) {
  var series = property && property.series;
  var t = tempTenthsC(seriesPoint(series, 'numericValue', i) || seriesPoint(series, 'shortText', i));
  return t === null ? TEMP_NONE : t;
}

// Today's high and low, the chance of precipitation, and the next three
// hours: the plumbing for a forecast the face doesn't draw yet. On 1.15
// (no series) only what the plain properties give.
function forecastDict(envelope, nowSec) {
  var instance = envelope && envelope.instances && envelope.instances[0];
  var p = (instance && instance.properties) || {};
  var high = tempTenthsC(p.high), low = tempTenthsC(p.low);
  var daily = p.daily_high && p.daily_high.series;
  var today = seriesIndex(daily, nowSec);
  if (high === null) { high = seriesTemp(p.daily_high, today); }
  if (low === null) { low = seriesTemp(p.daily_low, seriesIndex(p.daily_low && p.daily_low.series, nowSec)); }
  var precip = numberOf(p.precipitation);
  var dict = {
    FC_HIGH_DC: high,
    FC_LOW_DC: low,
    FC_PRECIP: precip ? Math.max(0, Math.min(100, Math.round(precip.value))) : PRECIP_NONE,
    FC_HOURS_START: 0,
  };
  var hourly = p.hourly_temperature && p.hourly_temperature.series;
  var next = seriesIndex(hourly, nowSec) + 1;   // the next whole hour
  var any = false;
  for (var h = 0; h < FORECAST_HOURS; h++) {
    var t = hourly ? seriesTemp(p.hourly_temperature, next + h) : TEMP_NONE;
    dict['FC_HOUR' + (h + 1) + '_DC'] = t;
    if (t !== TEMP_NONE) { any = true; }
  }
  if (any) { dict.FC_HOURS_START = hourly.start + next * hourly.stepSec; }
  return dict;
}

// ---------------------------------------------------------------------------
// Outbox: send only what changed, one message at a time
// ---------------------------------------------------------------------------

// Each value travels in a named group that the watch always gets whole (an
// event's name and start belong together). A group is sent when it differs
// from what the watch last acknowledged, or is already on its way, and a
// newer value replaces an older one still waiting. Messages are packed up to
// a budget well inside the watch's 512-byte inbox.

var RETRY_MS = [3000, 10000, 30000, 60000, 300000];
var ACK_TIMEOUT_MS = 20000;
var MESSAGE_BUDGET = 360;

function utf8Length(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) { n += 1; }
    else if (c < 0x800) { n += 2; }
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else { n += 3; }
  }
  return n;
}

// Cut a string to at most maxBytes of UTF-8 without splitting a character.
function truncateUtf8(s, maxBytes) {
  if (typeof s !== 'string') { return ''; }
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var w = c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF) ? 4 : 3;
    if (n + w > maxBytes) { return s.substring(0, i); }
    n += w;
    if (w === 4) { i++; }
  }
  return s;
}

function dictBytes(dict) {
  var n = 0;
  for (var k in dict) {
    if (!dict.hasOwnProperty(k)) { continue; }
    var v = dict[k];
    n += 7 + (typeof v === 'string' ? utf8Length(v) + 1 : 4);
  }
  return n;
}

function sameDict(a, b) {
  if (!a || !b) { return false; }
  var k;
  for (k in a) { if (a.hasOwnProperty(k) && a[k] !== b[k]) { return false; } }
  for (k in b) { if (b.hasOwnProperty(k) && !a.hasOwnProperty(k)) { return false; } }
  return true;
}

function Outbox(send) {
  this.send = send;
  this.groups = {};
  this.order = [];
  this.busy = false;
  this.failures = 0;
  this.retryTimer = null;
}

Outbox.prototype.group = function(name) {
  if (!this.groups[name]) {
    this.groups[name] = { acked: null, inflight: null, queued: null, latest: null };
    this.order.push(name);
  }
  return this.groups[name];
};

// Queue a group's latest value. Unchanged values are dropped unless forced.
Outbox.prototype.offer = function(name, dict, force) {
  var g = this.group(name);
  g.latest = dict;
  var basis = g.queued || g.inflight || g.acked;
  if (!force && sameDict(basis, dict)) { return false; }
  if (g.queued && sameDict(g.queued, dict)) { return false; }
  g.queued = dict;
  this.pump();
  return true;
};

// Re-send the latest value of each named group, changed or not.
Outbox.prototype.resend = function(names) {
  for (var i = 0; i < names.length; i++) {
    var g = this.groups[names[i]];
    if (g && g.latest) { this.offer(names[i], g.latest, true); }
  }
};

Outbox.prototype.latest = function(name) {
  var g = this.groups[name];
  return g ? g.latest : null;
};

Outbox.prototype.pump = function() {
  if (this.busy || this.retryTimer) { return; }
  var message = {};
  var names = [];
  var size = 1;
  for (var i = 0; i < this.order.length; i++) {
    var g = this.groups[this.order[i]];
    if (!g.queued) { continue; }
    var bytes = dictBytes(g.queued);
    if (names.length && size + bytes > MESSAGE_BUDGET) { continue; }
    for (var k in g.queued) {
      if (g.queued.hasOwnProperty(k)) { message[k] = g.queued[k]; }
    }
    g.inflight = g.queued;
    g.queued = null;
    names.push(this.order[i]);
    size += bytes;
  }
  if (!names.length) { return; }

  var self = this;
  var settled = false;
  var watchdog = setTimeout(function() { done(false); }, ACK_TIMEOUT_MS);
  function done(ok) {
    if (settled) { return; }
    settled = true;
    clearTimeout(watchdog);
    self.busy = false;
    for (var j = 0; j < names.length; j++) {
      var g = self.groups[names[j]];
      if (ok) {
        g.acked = g.inflight;
      } else if (!g.queued) {
        g.queued = g.inflight;   // retry, unless something newer is waiting
      }
      g.inflight = null;
    }
    if (ok) {
      self.failures = 0;
      self.pump();
      return;
    }
    var delay = RETRY_MS[Math.min(self.failures, RETRY_MS.length - 1)];
    self.failures++;
    log('send failed (' + names.join(', ') + '), retrying in ' + Math.round(delay / 1000) + 's');
    self.retryTimer = setTimeout(function() {
      self.retryTimer = null;
      self.pump();
    }, delay);
  }
  this.busy = true;
  this.send(message, function() { done(true); }, function() { done(false); });
};

// ---------------------------------------------------------------------------
// Bridge: which sources to read, and what to do with them
// ---------------------------------------------------------------------------

// options:
//   outbox             an Outbox
//   selectedMetrics()  the status-line metric values the user has chosen
//   fallbackWeather()  fetch weather the old way (Open-Meteo)
//   onUnits(units)     the Pebble app's units changed ({ fahrenheit, miles })
function Bridge(options) {
  this.outbox = options.outbox;
  this.selectedMetrics = options.selectedMetrics;
  this.fallbackWeather = options.fallbackWeather;
  this.onUnits = options.onUnits || function() {};
  this.subs = {};
  this.weather = { state: 'off', at: 0 };
  this.units = null;
  this.events = null;
  this.eventTimer = null;
  this.slots = null;          // preferences/complications, parsed; null = unknown
  this.readingData = {};      // 'category/item' -> latest envelope (null = can't read)
}

Bridge.prototype.subscribe = function(name, request, onData, onError) {
  this.unsubscribe(name);
  var self = this;
  var sub = null;
  var firstAnswer = setTimeout(function() {
    firstAnswer = null;
    if (self.subs[name] !== sub) { return; }
    log(request.category + '/' + request.item + ': no answer');
    onError.call(self, 'NO_ANSWER');
  }, FIRST_ANSWER_MS);
  function answered() {
    if (firstAnswer) { clearTimeout(firstAnswer); firstAnswer = null; }
  }
  request.onData = function(envelope) {
    if (self.subs[name] !== sub) { return; }   // a late update for an old subscription
    answered();
    onData.call(self, envelope || {});
  };
  request.onError = function(err) {
    if (self.subs[name] !== sub) { return; }
    answered();
    var code = (err && err.code) || 'UNKNOWN';
    log(request.category + '/' + request.item + ': ' + code);
    onError.call(self, code);
  };
  try {
    sub = Pebble.subscribeToSource(request) || { unsubscribe: function() {} };
  } catch (e) {
    answered();
    log(request.category + '/' + request.item + ' threw: ' + e);
    return false;
  }
  sub.stopFirstAnswer = answered;
  this.subs[name] = sub;
  return true;
};

Bridge.prototype.unsubscribe = function(name) {
  var sub = this.subs[name];
  if (!sub) { return; }
  delete this.subs[name];
  if (sub.stopFirstAnswer) { sub.stopFirstAnswer(); }
  try { sub.unsubscribe(); } catch (e) { log('unsubscribe ' + name + ' threw: ' + e); }
};

Bridge.prototype.wants = function(metric) {
  return this.selectedMetrics().indexOf(metric) !== -1;
};

// Bring subscriptions in line with the user's settings. Safe to call again:
// a subscription that is still wanted is left alone.
Bridge.prototype.sync = function() {
  this.syncUnits();
  this.syncWeather();
  this.syncEvent();
  this.syncPhone();
  this.syncReadings();
};

// The groups that answer the watch's PLUGIN_REQUEST.
var PLUGIN_GROUPS = ['event', 'phone', 'reading1', 'reading2', 'reading3', 'reading4',
                     'reading5'];

// The watch asks when it has heard nothing for a while: re-send everything
// we have, so it knows the phone is still here. A chosen item with nothing
// to show yet (or ever, without the plugin API) answers empty, which also
// stops the watch asking again every five minutes.
Bridge.prototype.answerPluginRequest = function() {
  var self = this;
  var chosen = this.selectedMetrics();
  PLUGIN_GROUPS.forEach(function(name) {
    if (self.outbox.latest(name)) {
      self.outbox.resend([name]);
    } else if (name === 'event' && chosen.indexOf(METRIC_NEXT_EVENT) !== -1) {
      self.outbox.offer(name, eventDict(null), true);
    } else if (name === 'phone' && chosen.indexOf(METRIC_PHONE_BATTERY) !== -1) {
      self.outbox.offer(name, { PHONE_BATTERY: -1 }, true);
    } else if (/^reading\d$/.test(name)) {
      var n = +name.charAt(7);
      if (chosen.indexOf(METRIC_READING_1 + n - 1) !== -1) {
        var dict = {};
        dict['READING' + n + '_TEXT'] = '';
        dict['READING' + n + '_LABEL'] = '';
        self.outbox.offer(name, dict, true);
      }
    }
  });
};

// --- units (A2) -------------------------------------------------------------

// preferences/units (1.16+, no permission needed): the units the user picked
// in the Pebble app. While it answers, the face follows it and the settings
// page stops asking.
Bridge.prototype.syncUnits = function() {
  if (this.subs.units) { return; }
  this.subscribe('units', {
    category: 'preferences',
    item: 'units',
    properties: ['temperature', 'distance'],
  }, this.onUnitsData, this.onUnitsError);
};

Bridge.prototype.onUnitsData = function(envelope) {
  var instance = envelope.instances && envelope.instances[0];
  var p = (instance && instance.properties) || {};
  var temp = textOf(p.temperature);
  var dist = textOf(p.distance);
  var units = {};
  var dict = {};
  if (temp && /F/i.test(temp)) { units.fahrenheit = true; }
  else if (temp && /C/i.test(temp)) { units.fahrenheit = false; }
  if (dist === 'mi') { units.miles = true; }
  else if (dist === 'km') { units.miles = false; }
  if (units.fahrenheit === undefined || units.miles === undefined) {
    // Half an answer is no answer: the settings page keeps both fields.
    this.onUnitsError('NO_DATA');
    return;
  }
  dict.TEMP_UNIT = units.fahrenheit ? 1 : 0;
  dict.DIST_UNIT = units.miles ? 1 : 0;
  this.units = units;
  if (this.outbox.offer('units', dict)) { this.onUnits(units); }
};

Bridge.prototype.onUnitsError = function(code) {
  if (gone(code)) { this.units = null; }
};

// True while the Pebble app decides the units (the settings page hides them).
Bridge.prototype.unitsFromApp = function() {
  return this.units !== null;
};

// --- weather (A1) -----------------------------------------------------------

var METRIC_WEATHER = 2;

Bridge.prototype.syncWeather = function() {
  if (!this.wants(METRIC_WEATHER)) {
    this.unsubscribe('weather');
    this.setWeatherState('off');
    return;
  }
  if (this.subs.weather) { return; }
  var ok = this.subscribe('weather', {
    category: 'weather',
    item: 'location',
    // No plugin uuid: whichever weather plugin the user prefers answers.
    properties: ['name', 'temperature', 'condition_code', 'condition', 'high', 'low',
                 'precipitation', 'daily_high', 'daily_low', 'hourly_temperature'],
  }, this.onWeather, this.onWeatherError);
  if (!ok) {
    this.setWeatherState('failed');
    this.fallbackWeather();
    return;
  }
  this.setWeatherState('waiting');
};

Bridge.prototype.setWeatherState = function(state) {
  this.weather.state = state;
};

Bridge.prototype.onWeather = function(envelope) {
  var dict = weatherDict(envelope);
  if (!dict) {
    this.onWeatherError('NO_DATA');
    return;
  }
  this.weather.at = nowMs();
  this.setWeatherState('live');
  this.outbox.offer('weather', dict);
  this.outbox.offer('forecast', forecastDict(envelope, Math.floor(nowMs() / 1000)));
};

Bridge.prototype.onWeatherError = function(code) {
  // An error doesn't end a subscription, and one that has already answered
  // keeps its last reading until it goes stale. Before the first answer,
  // any error (or none within FIRST_ANSWER_MS) hands over to Open-Meteo.
  if (this.weather.state === 'waiting') {
    log('weather/location unavailable (' + code + '); using Open-Meteo');
    this.setWeatherState('failed');
    this.fallbackWeather();
  }
};

// True while a weather/location subscription is answering, about to, or
// has already handed over to Open-Meteo by itself.
Bridge.prototype.handlesWeather = function() {
  return this.weather.state !== 'off';
};

Bridge.prototype.weatherLive = function() {
  return this.weather.state === 'live' && nowMs() - this.weather.at < WEATHER_LIVE_MS;
};

// The watch asks for weather when its copy is getting old. Returns true when
// the request is handled here, false when the caller should fetch.
Bridge.prototype.answerWeatherRequest = function() {
  if (this.weatherLive()) {
    this.outbox.resend(['weather', 'forecast']);
    return true;
  }
  // Subscribed and about to answer (or fall back by itself): nothing to do.
  return this.weather.state === 'waiting';
};

// --- next event (A3) ---------------------------------------------------------

var METRIC_NEXT_EVENT = 13;

// calendar/event needs the Calendar permission, so nothing subscribes (and
// nothing asks) unless the user put the item in their status line.
Bridge.prototype.syncEvent = function() {
  if (!this.wants(METRIC_NEXT_EVENT)) {
    this.unsubscribe('event');
    this.events = null;
    this.scheduleEventPick(null);
    return;
  }
  if (this.subs.event) { return; }
  this.subscribe('event', {
    category: 'calendar',
    item: 'event',
    properties: ['name', 'starts_at', 'ends_at', 'all_day'],
  }, this.onEvents, this.onEventsError);
};

Bridge.prototype.onEvents = function(envelope) {
  this.events = envelope.instances || [];
  this.pickEvent();
};

Bridge.prototype.onEventsError = function(code) {
  if (gone(code)) {
    this.events = [];
    this.pickEvent();
  }
};

Bridge.prototype.pickEvent = function() {
  var ev = pickNextEvent(this.events, Math.floor(nowMs() / 1000));
  this.outbox.offer('event', eventDict(ev));
  // The calendar only updates when its list changes, which an event
  // starting doesn't do: move on to the following one ourselves.
  this.scheduleEventPick(ev && !ev.allDay ? (ev.start + EVENT_GRACE_SEC) * 1000 : null);
};

Bridge.prototype.scheduleEventPick = function(atMs) {
  if (this.eventTimer) {
    clearTimeout(this.eventTimer);
    this.eventTimer = null;
  }
  if (atMs === null) { return; }
  var self = this;
  this.eventTimer = setTimeout(function() {
    self.eventTimer = null;
    self.pickEvent();
  }, Math.max(1000, atMs - nowMs() + 1000));
};

// --- phone battery (A4) ------------------------------------------------------

var METRIC_PHONE_BATTERY = 14;

Bridge.prototype.syncPhone = function() {
  if (!this.wants(METRIC_PHONE_BATTERY)) {
    this.unsubscribe('phone');
    return;
  }
  if (this.subs.phone) { return; }
  this.subscribe('phone', {
    category: 'phone',
    item: 'phone_state',
    properties: ['battery_level'],
  }, this.onPhone, this.onPhoneError);
};

Bridge.prototype.onPhone = function(envelope) {
  var instance = envelope.instances && envelope.instances[0];
  var level = instance && instance.properties && instance.properties.battery_level;
  var n = numberOf(level);
  var pct = n ? n.value : parseFloat(textOf(level));
  pct = isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : -1;
  this.outbox.offer('phone', { PHONE_BATTERY: pct });
};

Bridge.prototype.onPhoneError = function(code) {
  if (gone(code)) {
    this.outbox.offer('phone', { PHONE_BATTERY: -1 });
  }
};

// --- readings 1-5 (A5) ---------------------------------------------------------

var METRIC_READING_1 = 15;
var NUM_READINGS = 5;
var READING_TEXT_BYTES = 15;    // READING_TEXT_LEN - 1 on the watch
var READING_LABEL_BYTES = 11;   // READING_LABEL_LEN - 1

function words(s) {
  return (s || '').replace(/_/g, ' ');
}

// A number as a reading: whole when it's big or whole, one decimal otherwise.
function formatNumber(n) {
  var v = n.value;
  var shown = (Math.abs(v) >= 100 || v === Math.round(v)) ? String(Math.round(v))
      : String(Math.round(v * 10) / 10);
  return shown + (n.unit || '');
}

// What one reading says: its shortText, else its number with its unit.
function readingText(payloads) {
  var t = textOf(payloads);
  if (t === null) {
    var n = numberOf(payloads);
    t = n ? formatNumber(n) : '';
  }
  return truncateUtf8(plainText(t), READING_TEXT_BYTES);
}

function parseSlots(envelope) {
  return (envelope.instances || []).map(function(instance) {
    var p = instance.properties || {};
    var index = numberOf(p.index);
    return {
      category: textOf(p.category) || '',
      item: textOf(p.item) || '',
      index: index ? Math.max(0, Math.round(index.value)) : 0,
      property: textOf(p.property) || '',
    };
  });
}

function sourceKey(slot) {
  return slot.category + '/' + slot.item;
}

// Which reading numbers (1-5) the user put in the status line.
Bridge.prototype.wantedReadings = function() {
  var out = [];
  var chosen = this.selectedMetrics();
  for (var n = 1; n <= NUM_READINGS; n++) {
    if (chosen.indexOf(METRIC_READING_1 + n - 1) !== -1) { out.push(n); }
  }
  return out;
};

// preferences/complications (1.16+, no permission) is cheap and tells the
// settings page what each reading is, so it is read whenever it exists. The
// sources it points at are read only for the readings the user chose: they
// may need permissions.
Bridge.prototype.syncReadings = function() {
  if (!this.subs.complications) {
    this.subscribe('complications', {
      category: 'preferences',
      item: 'complications',
    }, this.onComplications, this.onComplicationsError);
  }
  this.syncReadingSources();
};

Bridge.prototype.onComplications = function(envelope) {
  var slots = parseSlots(envelope);
  // Re-delivered unchanged on every refresh: only a real change re-subscribes.
  if (this.slots && JSON.stringify(slots) === JSON.stringify(this.slots)) { return; }
  this.slots = slots;
  this.syncReadingSources();
};

Bridge.prototype.onComplicationsError = function(code) {
  if (gone(code)) {
    this.slots = [];
    this.syncReadingSources();
  }
};

// One subscription per source the chosen readings point at.
Bridge.prototype.syncReadingSources = function() {
  var self = this;
  var wanted = this.wantedReadings();
  var needed = {};
  if (this.slots) {
    wanted.forEach(function(n) {
      var slot = self.slots[n - 1];
      if (!slot || !slot.category || !slot.item || !slot.property) { return; }
      var key = sourceKey(slot);
      needed[key] = needed[key] || { category: slot.category, item: slot.item, properties: ['name'] };
      if (needed[key].properties.indexOf(slot.property) === -1) {
        needed[key].properties.push(slot.property);
      }
    });
  }
  Object.keys(this.subs).forEach(function(name) {
    var key = name.indexOf('reading:') === 0 ? name.substring(8) : null;
    if (key === null) { return; }
    var want = needed[key];
    // A source whose wanted properties changed is subscribed afresh.
    if (!want || want.properties.join() !== self.subs[name].properties) {
      self.unsubscribe(name);
      delete self.readingData[key];
    }
  });
  Object.keys(needed).forEach(function(key) {
    var name = 'reading:' + key;
    if (self.subs[name]) { return; }
    var want = needed[key];
    var ok = self.subscribe(name, {
      category: want.category,
      item: want.item,
      properties: want.properties.slice(),
    }, function(envelope) {
      self.readingData[key] = envelope;
      self.offerReadings();
    }, function(code) {
      if (gone(code)) {
        self.readingData[key] = null;   // can't be read: hide what uses it
        self.offerReadings();
      }
    });
    if (ok) {
      self.subs[name].properties = want.properties.join();
    } else {
      self.readingData[key] = null;
    }
  });
  this.offerReadings();
};

// Send each chosen reading whose value is known (or known to be missing).
Bridge.prototype.offerReadings = function() {
  if (this.slots === null) { return; }   // not heard from the Pebble app yet
  var self = this;
  this.wantedReadings().forEach(function(n) {
    var slot = self.slots[n - 1];
    var text = '', label = '';
    if (slot && slot.category && slot.item && slot.property) {
      var envelope = self.readingData[sourceKey(slot)];
      if (envelope === undefined) { return; }   // still waiting for it
      var instance = envelope && envelope.instances && envelope.instances[slot.index];
      var p = (instance && instance.properties) || {};
      text = readingText(p[slot.property]);
      label = text ? truncateUtf8(plainText(textOf(p.name) || ''), READING_LABEL_BYTES) : '';
    }
    var dict = {};
    dict['READING' + n + '_TEXT'] = text;
    dict['READING' + n + '_LABEL'] = label;
    self.outbox.offer('reading' + n, dict);
  });
};

// "Seattle temperature (14°C)": what reading n is, for the settings page.
Bridge.prototype.describeReading = function(n) {
  var slot = this.slots && this.slots[n - 1];
  if (!slot) { return null; }
  var envelope = this.readingData[sourceKey(slot)];
  var instance = envelope && envelope.instances && envelope.instances[slot.index];
  var p = (instance && instance.properties) || {};
  var what = plainText(textOf(p.name) || '') || words(slot.category);
  var value = instance ? readingText(p[slot.property]) : '';
  return what + ' ' + words(slot.property) + (value ? ' (' + value + ')' : '');
};

// --- settings page -------------------------------------------------------------

// Is category/item served by an installed plugin (built-ins included)?
function served(category, item) {
  if (typeof Pebble === 'undefined' || typeof Pebble.enumeratePlugins !== 'function') {
    return false;
  }
  try {
    var list = Pebble.enumeratePlugins() || [];
    for (var i = 0; i < list.length; i++) {
      var sources = list[i].sources || [];
      for (var j = 0; j < sources.length; j++) {
        if (sources[j].category === category &&
            (sources[j].items || []).indexOf(item) !== -1) {
          return true;
        }
      }
    }
  } catch (e) {
    log('enumeratePlugins threw: ' + e);
  }
  return false;
}

// Status-line choices that come from the Pebble app's plugins, for the
// settings page: offered while something can serve them, and always when
// already chosen, so saving the page never quietly drops a choice.
Bridge.prototype.metricOptions = function(chosen) {
  var out = [];
  var api = available();
  function add(value, label, ok) {
    if ((api && ok) || chosen.indexOf(value) !== -1) {
      out.push({ label: label, value: value });
    }
  }
  add(METRIC_NEXT_EVENT, 'Next calendar event', served('calendar', 'event'));
  add(METRIC_PHONE_BATTERY, 'Phone battery', served('phone', 'phone_state'));
  for (var n = 1; n <= NUM_READINGS; n++) {
    var what = this.describeReading(n);
    add(METRIC_READING_1 + n - 1, 'Reading ' + n + (what ? ': ' + what : ''), what !== null);
  }
  return out;
};

module.exports = {
  available: available,
  Outbox: Outbox,
  Bridge: Bridge,
  COND: COND,
  // Exposed for tools/test_plugins.js.
  _test: {
    tempTenthsC: tempTenthsC,
    conditionOf: conditionOf,
    weatherDict: weatherDict,
    pickNextEvent: pickNextEvent,
    readingText: readingText,
    forecastDict: forecastDict,
    plainText: plainText,
    truncateUtf8: truncateUtf8,
    utf8Length: utf8Length,
    dictBytes: dictBytes,
  },
};
