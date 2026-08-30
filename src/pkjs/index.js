// MonthGrid phone-side logic: Clay settings page, weather fetch, and
// calendar-dot computation. Calendar URLs live only in phone localStorage —
// the watch only ever receives a per-day bitmask.

var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var messageKeys = require('message_keys');
var weather = require('./weather');
var ics = require('./ics');

function clayCustomFn() {
  var clayConfig = this;
  var MAX_SLOTS = 8;
  var updating = false;

  function slotItems() {
    var out = [];
    for (var i = 1; i <= MAX_SLOTS; i++) {
      var item = clayConfig.getItemByMessageKey('METRIC' + i);
      if (item) { out.push(item); }
    }
    return out;
  }

  function refresh() {
    if (updating) { return; }
    updating = true;
    try {
      var items = slotItems();
      var filled = [];
      items.forEach(function(item) {
        var v = parseInt(item.get(), 10) || 0;
        if (v) { filled.push(v); }
      });
      // Compact: removing a row pulls the ones below it up.
      items.forEach(function(item, i) {
        var want = i < filled.length ? filled[i] : 0;
        if ((parseInt(item.get(), 10) || 0) !== want) { item.set(want); }
      });
      // Show every filled row plus one empty row to grow into.
      var visible = Math.min(filled.length + 1, MAX_SLOTS);
      items.forEach(function(item, i) {
        if (i < visible) { item.show(); } else { item.hide(); }
      });
      // A row that holds an item offers to remove it; the trailing empty
      // row is simply "None" — there is nothing there to remove yet.
      items.forEach(function(item, i) {
        var sel = item.$manipulatorTarget && item.$manipulatorTarget[0];
        if (!sel || !sel.options) { return; }
        var label = i < filled.length ? '\u2014 Remove \u2014' : 'None';
        var zero = null;
        for (var oi = 0; oi < sel.options.length; oi++) {
          if (sel.options[oi].value === '0') { zero = sel.options[oi]; break; }
        }
        if (!zero) { return; }
        if (zero.text !== label) { zero.text = label; }
        // Clay mirrors the selected option's label into a .value element and
        // only refreshes it on change, so update it directly when this row
        // is the one displaying the relabelled option.
        if (sel.value === '0') {
          var node = sel.parentNode;
          while (node && !(node.className &&
                 String(node.className).indexOf('component') !== -1)) {
            node = node.parentNode;
          }
          var disp = node && node.querySelector ? node.querySelector('.value') : null;
          if (disp && disp.innerHTML !== label) { disp.innerHTML = label; }
        }
      });
    } finally {
      updating = false;
    }
  }

  // The three custom-color pickers only appear when the Custom theme is
  // selected, so the page stays short for everyone else.
  function refreshTheme() {
    var themeItem = clayConfig.getItemByMessageKey('THEME');
    if (!themeItem) { return; }
    var custom = (parseInt(themeItem.get(), 10) || 0) === 10;
    ['CUSTOM_BG', 'CUSTOM_FG', 'CUSTOM_ACCENT'].forEach(function(key) {
      var item = clayConfig.getItemByMessageKey(key);
      if (!item) { return; }
      if (custom) { item.show(); } else { item.hide(); }
    });
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    slotItems().forEach(function(item) { item.on('change', refresh); });
    refresh();
    var themeItem = clayConfig.getItemByMessageKey('THEME');
    if (themeItem) { themeItem.on('change', refreshTheme); }
    refreshTheme();

    // Pin the submit button to the bottom of the viewport so settings can
    // be saved from anywhere on the page.
    var style = document.createElement('style');
    style.innerHTML =
        '.section--submit, .component-submit, .item-submit {' +
        ' position: sticky; position: -webkit-sticky; bottom: 0; z-index: 50; }' +
        '.section--submit button, .component-submit button, .item-submit button {' +
        ' box-shadow: 0 -2px 10px rgba(0,0,0,0.45); }';
    document.head.appendChild(style);
    var btn = document.querySelector('button[type=submit], .item-submit button, input[type=submit]');
    if (btn) {
      var host = btn.closest('div, section') || btn.parentNode;
      if (host && host.style) {
        host.style.position = 'sticky';
        host.style.bottom = '0';
        host.style.zIndex = '50';
      }
    }
  });
}

// Constructed once at module load so Clay's own 'ready' listener fires and
// fills clay.meta (watch platform, tokens). Rebuilding Clay later would
// leave meta empty, which downgrades the color pickers to black & white.
var clay = new Clay(clayConfig, clayCustomFn, { autoHandleEvents: false });

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
            // Two bits per calendar: how many events that day, capped at 3.
            var n = marks.count[d];
            if (n > 3) { n = 3; }
            if (n > 0) {
              bytes[d] |= (n << (2 * cal));
              matched++;
            }
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

// The settings page explains the calendar sync state: a quiet one-liner when
// things are fine, and a prominent callout (matching the "!" the watch shows)
// when the last refresh failed.
function dotsStatusItems() {
  var entries = loadDotsStatus();
  if (!entries.length) {
    return [{
      type: 'text',
      defaultValue: 'Calendar sync: nothing fetched yet in this session. Markers appear ' +
          'a few seconds after the watchface starts.',
    }];
  }
  var newest = 0;
  var failures = [];
  var lines = [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].ts > newest) { newest = entries[i].ts; }
    lines.push('Calendar ' + entries[i].cal + ': ' + entries[i].detail);
    if (!entries[i].ok) { failures.push(entries[i]); }
  }
  var mins = Math.max(0, Math.round((Date.now() - newest) / 60000));
  var ago = mins < 1 ? 'just now' : (mins + ' min ago');

  if (!failures.length) {
    return [{
      type: 'text',
      defaultValue: 'Calendar sync OK (' + ago + '). ' + lines.join(' · '),
    }];
  }

  var which = failures.map(function(f) { return 'Calendar ' + f.cal + ' — ' + f.detail; });
  return [
    { type: 'heading', defaultValue: '\u26A0 Calendar sync problem' },
    {
      type: 'text',
      defaultValue: 'Your watch is showing a “!” next to the month because the last ' +
          'calendar refresh failed (' + ago + '): ' + which.join('; ') + '. ' +
          'The markers on screen are from the last successful refresh, so they may be ' +
          'out of date — nothing was erased.',
    },
    {
      type: 'text',
      defaultValue: 'What to try: check the URL below is the full “Secret address in iCal ' +
          'format” (it should start with https:// and end in .ics), and that your phone ' +
          'has a connection. MonthGrid retries automatically every few hours and whenever ' +
          'the watchface restarts; the “!” clears itself once a refresh succeeds.',
    },
  ];
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
        var status = dotsStatusItems();
        items.splice.apply(items, [i + 1, 0].concat(status));
        s = config.length;
        break;
      }
    }
  }
  clay.config = config;
  // Clay only auto-populates meta in autoHandleEvents mode; do it here so the
  // color pickers see the real watch platform every time the page opens.
  try {
    clay.meta = {
      activeWatchInfo: Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null,
      accountToken: Pebble.getAccountToken(),
      watchToken: Pebble.getWatchToken(),
      userData: {},
    };
  } catch (e) {
    console.log('monthgrid: could not read watch info: ' + e);
  }
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
