// MonthGrid phone-side logic: Clay settings page, weather fetch, and
// calendar-dot computation. Calendar URLs live only in phone localStorage —
// the watch only ever receives a per-day bitmask.

var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
var messageKeys = require('message_keys');
var weather = require('./weather');
var ics = require('./ics');

var DOTS_REFRESH_MS = 6 * 60 * 60 * 1000;

function claySettings() {
  try {
    return JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (e) {
    return {};
  }
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

function pushWeather() {
  weather.fetch(function(result) {
    if (!result) { return; }
    sendWithRetry({
      WEATHER_TEMP_C: result.temp_c,
      WEATHER_COND: result.cond,
    }, 'weather');
  });
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
  var settings = claySettings();
  if (!monthkey) { monthkey = currentMonthkey(); }
  var year = monthkey >> 4;
  var month0 = (monthkey & 15) - 1;
  if (month0 < 0 || month0 > 11) { return; }

  var urls = settings.DOTS_ENABLED
      ? [settings.CAL1_URL, settings.CAL2_URL, settings.CAL3_URL]
      : [];
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
            if (marks.timed[d]) { bytes[d] |= (1 << cal); }
            if (marks.allday[d]) { bytes[d] |= (1 << (cal + 3)); }
            if (marks.timed[d] || marks.allday[d]) { matched++; }
          }
          entry.ok = true;
          entry.detail = 'OK — ' + Math.round(res.text.length / 1024) + 'kB, ' +
              matched + ' day(s) marked this month';
        } catch (e) {
          entry.ok = false;
          entry.detail = 'parse error: ' + e;
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

// Settings saved while the watch was unreachable are kept pending in
// localStorage and re-sent on the next launch, so phone and watch cannot
// permanently disagree.
var PENDING_SETTINGS_KEY = 'monthgrid-pending-settings';

function sendSettings(dict) {
  try { localStorage.setItem(PENDING_SETTINGS_KEY, JSON.stringify(dict)); } catch (e) {}
  var clearPending = function() {
    try { localStorage.removeItem(PENDING_SETTINGS_KEY); } catch (e) {}
  };
  Pebble.sendAppMessage(dict, clearPending, function() {
    setTimeout(function() {
      Pebble.sendAppMessage(dict, clearPending, function() {
        console.log('monthgrid: settings undelivered, will retry on next launch');
      });
    }, 2000);
  });
}

Pebble.addEventListener('ready', function() {
  console.log('monthgrid: pkjs ready');
  var pending = null;
  try { pending = localStorage.getItem(PENDING_SETTINGS_KEY); } catch (e) {}
  if (pending) {
    console.log('monthgrid: re-sending pending settings');
    try { sendSettings(JSON.parse(pending)); } catch (e) {}
  }
  pushWeather();
  pushDots();
  setInterval(function() { pushDots(); }, DOTS_REFRESH_MS);
});

Pebble.addEventListener('appmessage', function(e) {
  var p = e.payload || {};
  if (p.WEATHER_REQUEST) { pushWeather(); }
  if (p.DOTS_REQUEST) { pushDots(p.DOTS_REQUEST); }
});

// The settings page shows the outcome of the last calendar refresh, so a
// bad URL / network problem / parse failure is visible without needing
// developer logs.
function dotsStatusText() {
  var entries = loadDotsStatus();
  if (!entries.length) {
    return 'Diagnostics: no calendar refresh has run yet in this session.';
  }
  var newest = 0;
  var parts = [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].ts > newest) { newest = entries[i].ts; }
    parts.push('Calendar ' + entries[i].cal + ': ' + entries[i].detail);
  }
  var mins = Math.max(0, Math.round((Date.now() - newest) / 60000));
  return 'Diagnostics (last refresh ' + mins + ' min ago) — ' + parts.join(' · ');
}

Pebble.addEventListener('showConfiguration', function() {
  // Rebuild the page with the current diagnostics injected under the
  // markers toggle.
  var config = JSON.parse(JSON.stringify(clayConfig));
  for (var s = 0; s < config.length; s++) {
    var items = config[s].items;
    if (!items) { continue; }
    for (var i = 0; i < items.length; i++) {
      if (items[i].messageKey === 'DOTS_ENABLED') {
        items.splice(i + 1, 0, { type: 'text', defaultValue: dotsStatusText() });
        s = config.length;
        break;
      }
    }
  }
  clay = new Clay(config, null, { autoHandleEvents: false });
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) { return; }
  var dict;
  try {
    dict = clay.getSettings(e.response);
  } catch (err) {
    console.log('monthgrid: bad config response: ' + err);
    return;
  }
  // Phone-only keys: never send calendar URLs to the watch.
  delete dict[messageKeys.CAL1_URL];
  delete dict[messageKeys.CAL2_URL];
  delete dict[messageKeys.CAL3_URL];
  sendSettings(dict);
  // Refresh data under the new settings.
  pushWeather();
  pushDots();
});
