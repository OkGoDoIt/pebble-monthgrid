// MonthGrid phone-side logic: the settings page, weather fetch, and
// calendar-dot computation. Calendar URLs live only in phone localStorage —
// the watch only ever receives a per-day bitmask.

var Model = require('./model');
var page = require('./settings_page');
var weather = require('./weather');
var ics = require('./ics');
var plugins = require('./plugins');

var DOTS_REFRESH_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// The settings page's state (model.js), kept whole on the phone. The first
// time, it comes from what the old settings page (Clay) stored.
var STATE_KEY = 'monthgrid-state';

function loadState() {
  try {
    var saved = localStorage.getItem(STATE_KEY);
    if (saved) { return Model.normalize(JSON.parse(saved)); }
  } catch (e) {
    console.log('monthgrid: stored settings unreadable: ' + e);
  }
  var clay = null;
  try { clay = JSON.parse(localStorage.getItem('clay-settings')); } catch (e) {}
  var state = clay ? Model.fromClay(clay) : Model.defaultState();
  saveState(state);
  return state;
}

function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function sendWithRetry(dict, what) {
  Pebble.sendAppMessage(dict, function() {}, function() {
    console.log('monthgrid: ' + what + ' send failed, retrying once');
    setTimeout(function() {
      Pebble.sendAppMessage(dict, function() {}, function() {
        console.log('monthgrid: ' + what + ' retry failed');
      });
    }, 2000);
  });
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

// Everything the watch gets from the phone's own data (weather, plugins)
// goes through one outbox, which sends a value only when it changed.
var outbox = new plugins.Outbox(function(dict, ok, fail) {
  Pebble.sendAppMessage(dict, ok, fail);
});

// Open-Meteo: the fallback whenever the Pebble app's weather can't be read.
// Forced through the outbox: it answers a request, and the watch takes any
// answer as proof its weather is fresh.
function pushWeather() {
  weather.fetch(function(result) {
    if (!result) { return; }
    outbox.offer('weather', {
      WEATHER_TEMP_C: result.temp_c,
      WEATHER_TEMP_DC: result.temp_dc,
      WEATHER_COND: result.cond,
    }, true);
    if (result.forecast) { outbox.offer('forecast', result.forecast); }
  });
}

// The watch metrics the status line stands for.
function selectedMetrics() {
  return Model.metricsOf(loadState());
}

// Units from the Pebble app also go into the stored settings, so the
// settings page shows the truth if the Pebble app ever stops providing them.
function rememberUnits(units) {
  var state = loadState();
  state.opts.weather = state.opts.weather || {};
  state.opts.distance = state.opts.distance || {};
  state.opts.weather.unit = units.fahrenheit ? 'f' : 'c';
  state.opts.distance.unit = units.miles ? 'mi' : 'km';
  saveState(state);
}

var bridge = new plugins.Bridge({
  outbox: outbox,
  selectedMetrics: selectedMetrics,
  wantsEvent: function() { return Model.wantsEvent(loadState()); },
  fallbackWeather: pushWeather,
  onUnits: rememberUnits,
});

// Subscribe to whatever the Pebble app can provide, then fetch the weather
// ourselves only if no subscription is going to.
function syncSources() {
  if (plugins.available()) { bridge.sync(); }
  if (!bridge.handlesWeather()) { pushWeather(); }
}

// ---------------------------------------------------------------------------
// Calendar dots
// ---------------------------------------------------------------------------

// cb({ok, text}) on success, cb({ok:false, error}) on failure — the error
// string feeds the diagnostics shown in the settings page and pebble logs.
// Driven from readystatechange with a settle-once guard: some runtimes
// (including the emulator's) never fire onerror for connection failures,
// but every terminal path fires readystatechange.
function fetchUrl(url, cb) {
  if (!url) { cb({ ok: false, error: 'no URL' }); return; }
  url = url.replace(/^webcal:\/\//i, 'https://');
  var xhr = new XMLHttpRequest();
  var done = false;
  function settle(res) {
    if (!done) { done = true; cb(res); }
  }
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) { return; }
    if (xhr.status >= 200 && xhr.status < 300) {
      settle({ ok: true, text: xhr.responseText });
    } else if (!xhr.status) {
      settle({ ok: false, error: 'network error (' + (xhr.statusText || 'unreachable') + ')' });
    } else {
      settle({ ok: false, error: 'HTTP ' + xhr.status });
    }
  };
  xhr.ontimeout = function() { settle({ ok: false, error: 'timeout' }); };
  xhr.onerror = function() { settle({ ok: false, error: 'network error' }); };
  try {
    xhr.open('GET', url);
    xhr.timeout = 30000;
    xhr.send();
  } catch (e) {
    settle({ ok: false, error: 'request failed: ' + e });
  }
}

var DOTS_STATUS_KEY = 'monthgrid-dots-status';

function saveDotsStatus(entries) {
  try { localStorage.setItem(DOTS_STATUS_KEY, JSON.stringify(entries)); } catch (e) {}
}

function loadDotsStatus() {
  try { return JSON.parse(localStorage.getItem(DOTS_STATUS_KEY)) || []; } catch (e) { return []; }
}

function currentMonthkey() {
  var now = new Date();
  return now.getFullYear() * 16 + now.getMonth() + 1;
}

function pushDots(monthkey) {
  var state = loadState();
  if (!monthkey) { monthkey = currentMonthkey(); }
  var year = monthkey >> 4;
  var month0 = (monthkey & 15) - 1;
  if (month0 < 0 || month0 > 11) { return; }

  var urls = state.look.DOTS_ENABLED ? state.calendars : [];
  var bytes = [];
  var daysInMonth = new Date(year, month0 + 1, 0).getDate();
  for (var i = 0; i < 31; i++) { bytes.push(0); }

  var pending = 0;
  var failed = false;
  var statusEntries = [];
  var finish = function() {
    if (--pending > 0) { return; }
    saveDotsStatus(statusEntries);
    if (failed) {
      // Never overwrite the watch's previously-correct mask with zeros
      // because a calendar was unreachable; the watch keeps its cached
      // dots, shows a stale badge, and re-requests later.
      console.log('monthgrid: dots send skipped (a calendar failed); sending status only');
      sendWithRetry({ DOTS_STATUS: 1 }, 'dots-status');
      return;
    }
    sendWithRetry({ DOTS_MONTH: monthkey, DOTS_DATA: bytes, DOTS_STATUS: 0 }, 'dots');
  };

  var any = false;
  for (var cal = 0; cal < 3; cal++) {
    if (urls[cal]) { any = true; pending++; }
  }
  if (!any) {
    // Dots disabled or no calendars configured: send the empty mask so
    // stale dots clear and the watch stops re-requesting this month.
    saveDotsStatus([]);
    sendWithRetry({ DOTS_MONTH: monthkey, DOTS_DATA: bytes, DOTS_STATUS: 0 }, 'dots');
    return;
  }

  urls.forEach(function(url, cal) {
    if (!url) { return; }
    fetchUrl(url, function(res) {
      var entry = { cal: cal + 1, ts: Date.now() };
      if (res.ok) {
        try {
          var marks = ics.scanMonth(res.text, year, month0);
          var matched = 0;
          for (var d = 0; d < daysInMonth; d++) {
            // Two bits per calendar: how many events that day, capped at 3.
            var n = marks.count[d];
            if (n > 3) { n = 3; }
            if (n > 0) {
              bytes[d] |= (n << (2 * cal));
              matched++;
            }
          }
          entry.ok = true;
          entry.detail = Math.round(res.text.length / 1024) + ' KB, ' + matched + ' days marked this month';
        } catch (e) {
          entry.ok = false;
          entry.detail = 'couldn’t read it: ' + e;
          failed = true;
        }
      } else {
        entry.ok = false;
        entry.detail = res.error;
        failed = true;
      }
      console.log('monthgrid: calendar ' + entry.cal + ': ' + entry.detail);
      statusEntries.push(entry);
      finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// Settings saved while the watch was unreachable stay marked unsent and
// go again on the next launch, so phone and watch cannot permanently disagree.
var UNSENT_KEY = 'monthgrid-settings-unsent';

function sendSettings() {
  var dict = Model.toWatch(loadState(), bridge.units);
  try { localStorage.setItem(UNSENT_KEY, '1'); } catch (e) {}
  var sent = function() {
    try { localStorage.removeItem(UNSENT_KEY); } catch (e) {}
  };
  Pebble.sendAppMessage(dict, sent, function() {
    setTimeout(function() {
      Pebble.sendAppMessage(dict, sent, function() {
        console.log('monthgrid: settings undelivered, will retry on next launch');
      });
    }, 2000);
  });
}

Pebble.addEventListener('ready', function() {
  console.log('monthgrid: pkjs ready');
  var unsent = null;
  try { unsent = localStorage.getItem(UNSENT_KEY); } catch (e) {}
  // The first launch after the old settings page: the watch gets the new
  // settings (item options, event placement) once.
  var migrating = !localStorage.getItem(STATE_KEY) && localStorage.getItem('clay-settings');
  loadState();
  if (unsent || migrating) {
    console.log('monthgrid: sending settings the watch hasn’t confirmed');
    sendSettings();
  }
  syncSources();
  pushDots();
  setInterval(function() { pushDots(); }, DOTS_REFRESH_MS);
});

Pebble.addEventListener('appmessage', function(e) {
  var p = e.payload || {};
  if (p.WEATHER_REQUEST && !bridge.answerWeatherRequest()) { pushWeather(); }
  if (p.PLUGIN_REQUEST) { bridge.answerPluginRequest(); }
  if (p.DOTS_REQUEST) { pushDots(p.DOTS_REQUEST); }
});

// What the settings page needs to know about this watch and phone.
function watchInfo() {
  var platform = 'emery';
  try {
    var info = Pebble.getActiveWatchInfo && Pebble.getActiveWatchInfo();
    if (info && info.platform) { platform = info.platform; }
  } catch (e) {}
  var bw = ['aplite', 'diorite', 'flint'].indexOf(platform) >= 0;
  return {
    platform: platform,
    color: !bw,
    shape: platform === 'chalk' || platform === 'gabbro' ? 'round' : 'rect',
    health: platform !== 'aplite',
    // Heart-rate sensors: Pebble 2 HR, Pebble Time 2, Pebble Round 2.
    hrm: ['diorite', 'emery', 'gabbro'].indexOf(platform) >= 0,
    // Older platforms can't read the watch's alarms.
    alarms: ['emery', 'flint', 'gabbro'].indexOf(platform) >= 0,
  };
}

function pageContext() {
  var ctx = watchInfo();
  ctx.served = bridge.served();
  ctx.units = bridge.units;
  ctx.readings = bridge.readingList();
  ctx.calendarSync = loadDotsStatus();
  ctx.returnTo = 'pebblejs://close#';
  return ctx;
}

Pebble.addEventListener('showConfiguration', function() {
  var boot = JSON.stringify({ state: loadState(), ctx: pageContext() }).replace(/</g, '\\u003c');
  var html = page.html.replace(page.boot, boot);
  Pebble.openURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) { return; }
  var state;
  try {
    var text = e.response;
    state = Model.normalize(JSON.parse(/^\{/.test(text) ? text : decodeURIComponent(text)));
  } catch (err) {
    console.log('monthgrid: bad settings from the page: ' + err);
    return;
  }
  saveState(state);
  sendSettings();
  // Refresh data under the new settings.
  syncSources();
  pushDots();
});
