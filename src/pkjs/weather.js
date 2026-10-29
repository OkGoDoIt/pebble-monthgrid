// Weather via Open-Meteo (the pattern recommended by the official watchface
// tutorial: free, no API key). Returns Celsius + a WMO condition code that we
// map onto the watch's small condition enum.

var COND = {
  UNKNOWN: 0, CLEAR: 1, PARTLY: 2, CLOUDY: 3, FOG: 4,
  RAIN: 5, SNOW: 6, THUNDER: 7, WIND: 8,
};

function mapWmoCode(code) {
  if (code === 0) return COND.CLEAR;
  if (code === 1 || code === 2) return COND.PARTLY;
  if (code === 3) return COND.CLOUDY;
  if (code === 45 || code === 48) return COND.FOG;
  if (code >= 51 && code <= 67) return COND.RAIN;
  if (code >= 71 && code <= 77) return COND.SNOW;
  if (code >= 80 && code <= 82) return COND.RAIN;
  if (code === 85 || code === 86) return COND.SNOW;
  if (code >= 95 && code <= 99) return COND.THUNDER;
  return COND.UNKNOWN;
}

var COORDS_KEY = 'monthgrid-coords';

function saveCoords(lat, lon) {
  try {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lat: lat, lon: lon, ts: Date.now() }));
  } catch (e) {}
}

function cachedCoords() {
  try {
    return JSON.parse(localStorage.getItem(COORDS_KEY));
  } catch (e) {
    return null;
  }
}

function locate(cb) {
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      saveCoords(pos.coords.latitude, pos.coords.longitude);
      cb({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    function(err) {
      console.log('monthgrid: geolocation failed (' + err.code + '), using cached coords');
      var cached = cachedCoords();
      cb(cached ? { lat: cached.lat, lon: cached.lon } : null);
    },
    { timeout: 15000, maximumAge: 30 * 60 * 1000 }
  );
}

var TEMP_NONE = -32768;     // TEMP_NONE on the watch
var PRECIP_NONE = 255;

function tenths(v) {
  return typeof v === 'number' && isFinite(v) ? Math.round(v * 10) : TEMP_NONE;
}

// Today's high and low, the chance of rain, and the next three whole hours,
// in the same message keys the Pebble app's weather fills. Open-Meteo gives
// local times (timezone=auto) plus their offset from UTC.
function forecastOf(json, nowMs) {
  var daily = json.daily, hourly = json.hourly;
  if (!daily || !hourly || !hourly.time) { return null; }
  var offset = (json.utc_offset_seconds || 0) * 1000;
  var dict = {
    FC_HIGH_DC: tenths(daily.temperature_2m_max && daily.temperature_2m_max[0]),
    FC_LOW_DC: tenths(daily.temperature_2m_min && daily.temperature_2m_min[0]),
    FC_PRECIP: PRECIP_NONE,
    FC_HOURS_START: 0,
    FC_HOUR1_DC: TEMP_NONE,
    FC_HOUR2_DC: TEMP_NONE,
    FC_HOUR3_DC: TEMP_NONE,
  };
  var precip = daily.precipitation_probability_max && daily.precipitation_probability_max[0];
  if (typeof precip === 'number') { dict.FC_PRECIP = Math.max(0, Math.min(100, Math.round(precip))); }
  for (var i = 0; i < hourly.time.length; i++) {
    var m = /^(\d+)-(\d+)-(\d+)T(\d+):/.exec(hourly.time[i]);
    if (!m) { continue; }
    var at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) - offset;
    if (at <= nowMs) { continue; }
    dict.FC_HOURS_START = Math.floor(at / 1000);
    for (var h = 0; h < 3; h++) {
      dict['FC_HOUR' + (h + 1) + '_DC'] = tenths(hourly.temperature_2m[i + h]);
    }
    break;
  }
  return dict;
}

// cb({ temp_c, temp_dc, cond, forecast }) on success; cb(null) on failure.
function fetch(cb) {
  locate(function(coords) {
    if (!coords) {
      cb(null);
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + coords.lat.toFixed(4) +
        '&longitude=' + coords.lon.toFixed(4) +
        '&current=temperature_2m,weather_code' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&hourly=temperature_2m&forecast_days=2&timezone=auto';
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
      try {
        var json = JSON.parse(xhr.responseText);
        var t = json.current.temperature_2m;
        cb({
          temp_c: Math.round(t),
          temp_dc: Math.round(t * 10),
          cond: mapWmoCode(json.current.weather_code),
          forecast: forecastOf(json, Date.now()),
        });
      } catch (e) {
        console.log('monthgrid: weather parse error: ' + e);
        cb(null);
      }
    };
    xhr.onerror = function() {
      console.log('monthgrid: weather request failed');
      cb(null);
    };
    xhr.open('GET', url);
    xhr.send();
  });
}

module.exports = { fetch: fetch, _test: { forecastOf: forecastOf } };
