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

// cb({ temp_c, cond }) on success; cb(null) on failure.
function fetch(cb) {
  locate(function(coords) {
    if (!coords) {
      cb(null);
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + coords.lat.toFixed(4) +
        '&longitude=' + coords.lon.toFixed(4) +
        '&current=temperature_2m,weather_code';
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
      try {
        var json = JSON.parse(xhr.responseText);
        cb({
          temp_c: Math.round(json.current.temperature_2m),
          cond: mapWmoCode(json.current.weather_code),
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

module.exports = { fetch: fetch };
