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

function fetchUrl(url, cb) {
  if (!url) { cb(null); return; }
  url = url.replace(/^webcal:\/\//i, 'https://');
  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    cb(xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : null);
  };
  xhr.onerror = function() { cb(null); };
  try {
    xhr.open('GET', url);
    xhr.send();
  } catch (e) {
    cb(null);
  }
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
  var finish = function() {
    if (--pending > 0) { return; }
    if (failed) {
      // Never overwrite the watch's previously-correct mask with zeros
      // because a calendar was unreachable; the watch keeps its cached
      // dots and re-requests later.
      console.log('monthgrid: dots send skipped (a calendar fetch failed)');
      return;
    }
    sendWithRetry({ DOTS_MONTH: monthkey, DOTS_DATA: bytes }, 'dots');
  };

  var any = false;
  for (var cal = 0; cal < 3; cal++) {
    if (urls[cal]) { any = true; pending++; }
  }
  if (!any) {
    // Dots disabled or no calendars configured: send the empty mask so
    // stale dots clear and the watch stops re-requesting this month.
    sendWithRetry({ DOTS_MONTH: monthkey, DOTS_DATA: bytes }, 'dots');
    return;
  }

  urls.forEach(function(url, cal) {
    if (!url) { return; }
    fetchUrl(url, function(text) {
      if (text) {
        try {
          var marks = ics.scanMonth(text, year, month0);
          for (var d = 0; d < daysInMonth; d++) {
            if (marks.timed[d]) { bytes[d] |= (1 << cal); }
            if (marks.allday[d]) { bytes[d] |= (1 << (cal + 3)); }
          }
        } catch (e) {
          console.log('monthgrid: ics parse failed for calendar ' + (cal + 1) + ': ' + e);
          failed = true;
        }
      } else {
        console.log('monthgrid: calendar ' + (cal + 1) + ' fetch failed');
        failed = true;
      }
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

Pebble.addEventListener('showConfiguration', function() {
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
