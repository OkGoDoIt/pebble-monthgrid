// Minimal iCalendar (RFC 5545) event scanner: which days of a given month
// have events? Handles one-off and multi-day events, plus a pragmatic RRULE
// subset: FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
// BYDAY (weekly) and BYMONTHDAY (monthly), and EXDATE. Floating and TZID
// times are treated as phone-local time (no timezone database on the phone);
// UTC ("Z") times are converted. Documented as best-effort in the README.

var MS_PER_DAY = 86400000;
var MAX_WALK = 1600;      // iteration cap per rule (~4 years of daily steps)

// Day index = whole days since epoch for a *calendar date*. Computed with
// Date.UTC so it is exact integer arithmetic (no DST/offset artifacts).
function dayIndex(y, m0, d) {
  return Math.round(Date.UTC(y, m0, d) / MS_PER_DAY);
}

function dayIndexFromDate(dt) {
  return dayIndex(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function weekdayOfDayIndex(idx) {
  // Jan 1 1970 (idx 0) was a Thursday (4).
  return ((idx + 4) % 7 + 7) % 7;   // 0 = Sunday
}

// Returns { allDay, startIdx, durationDays, startsMidnight } or null.
function parseIcsDate(value, params) {
  var m = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})?(Z?))?$/.exec(value);
  if (!m) { return null; }
  var y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (!m[4] || (params && params.indexOf('VALUE=DATE') !== -1 && !m[4])) {
    return { allDay: true, idx: dayIndex(y, mo, d), midnight: true };
  }
  var hh = +m[5], mi = +m[6], ss = +(m[7] || 0);
  var dt = m[8] === 'Z'
      ? new Date(Date.UTC(y, mo, d, hh, mi, ss))
      : new Date(y, mo, d, hh, mi, ss);
  return {
    allDay: false,
    idx: dayIndexFromDate(dt),
    midnight: dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0,
  };
}

function parseRrule(value) {
  var rule = { freq: null, interval: 1, count: null, untilIdx: null, byday: null,
               bymonthday: null };
  var parts = value.split(';');
  var daymap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    var k = kv[0], v = kv[1];
    if (k === 'FREQ') { rule.freq = v; }
    else if (k === 'INTERVAL') { rule.interval = Math.max(1, parseInt(v, 10) || 1); }
    else if (k === 'COUNT') { rule.count = parseInt(v, 10) || null; }
    else if (k === 'UNTIL') {
      var u = parseIcsDate(v, '');
      if (u) { rule.untilIdx = u.idx; }
    } else if (k === 'BYDAY') {
      var days = v.split(',');
      rule.byday = [];
      for (var j = 0; j < days.length; j++) {
        // Ordinal prefixes (e.g. 2TU, -1FR) are beyond this subset — bail so
        // we don't mark wrong days.
        if (/^-?\d/.test(days[j])) { rule.byday = null; rule.unsupported = true; break; }
        if (daymap.hasOwnProperty(days[j])) { rule.byday.push(daymap[days[j]]); }
      }
    } else if (k === 'BYMONTHDAY') {
      if (v.indexOf(',') !== -1 || v.charAt(0) === '-') { rule.unsupported = true; }
      else { rule.bymonthday = parseInt(v, 10) || null; }
    } else if (k === 'BYSETPOS' || k === 'BYWEEKNO' || k === 'BYYEARDAY') {
      rule.unsupported = true;
    }
  }
  return rule;
}

// Parse the raw ICS text into simple event records.
function parseEvents(text) {
  var lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  var events = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === 'BEGIN:VEVENT') { cur = { exdates: {} }; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) { events.push(cur); }
      cur = null;
      continue;
    }
    if (!cur) { continue; }
    var colon = line.indexOf(':');
    if (colon < 0) { continue; }
    var left = line.slice(0, colon);
    var value = line.slice(colon + 1);
    var name = left.split(';')[0];
    var params = left.slice(name.length);
    if (name === 'DTSTART') {
      cur.start = parseIcsDate(value, params);
    } else if (name === 'DTEND') {
      cur.end = parseIcsDate(value, params);
    } else if (name === 'RRULE') {
      cur.rrule = parseRrule(value);
    } else if (name === 'EXDATE') {
      var vals = value.split(',');
      for (var j = 0; j < vals.length; j++) {
        var ex = parseIcsDate(vals[j], params);
        if (ex) { cur.exdates[ex.idx] = true; }
      }
    } else if (name === 'STATUS' && value === 'CANCELLED') {
      cur.cancelled = true;
    }
  }
  return events;
}

function eventDuration(ev) {
  // Duration in *days spanned beyond the first*, for marking purposes.
  if (!ev.end) { return 0; }
  var span = ev.end.idx - ev.start.idx;
  if (span <= 0) { return 0; }
  // DTEND is exclusive for all-day events; a timed event ending exactly at
  // midnight also doesn't occupy that day.
  if (ev.start.allDay || ev.end.midnight) { span -= 1; }
  return Math.max(0, span);
}

// Mark [startIdx .. startIdx+duration] ∩ month into out.{timed,allday}.
function markOccurrence(ev, startIdx, duration, monthStartIdx, daysInMonth, out) {
  var target = ev.start.allDay ? out.allday : out.timed;
  for (var d = startIdx; d <= startIdx + duration; d++) {
    var off = d - monthStartIdx;
    if (off >= 0 && off < daysInMonth) { target[off] = true; }
  }
}

function expandEvent(ev, monthStartIdx, daysInMonth, out) {
  if (ev.cancelled || !ev.start) { return; }
  var duration = eventDuration(ev);
  var winEnd = monthStartIdx + daysInMonth;   // exclusive
  var s0 = ev.start.idx;

  if (!ev.rrule || !ev.rrule.freq || ev.rrule.unsupported) {
    if (!ev.rrule || !ev.rrule.freq) {
      if (!ev.exdates[s0]) {
        markOccurrence(ev, s0, duration, monthStartIdx, daysInMonth, out);
      }
    }
    // Unsupported RRULEs: mark only the first instance (better than lying
    // about the pattern).
    if (ev.rrule && ev.rrule.unsupported && !ev.exdates[s0]) {
      markOccurrence(ev, s0, duration, monthStartIdx, daysInMonth, out);
    }
    return;
  }

  var rule = ev.rrule;
  var made = 0;
  var emit = function(idx) {
    made++;
    if (!ev.exdates[idx] && idx <= winEnd + duration) {
      markOccurrence(ev, idx, duration, monthStartIdx, daysInMonth, out);
    }
  };
  var done = function(idx) {
    if (rule.count !== null && made >= rule.count) { return true; }
    if (rule.untilIdx !== null && idx > rule.untilIdx) { return true; }
    return idx >= winEnd;
  };

  if (rule.freq === 'DAILY') {
    for (var i = 0, idx = s0; i < MAX_WALK && !done(idx); i++, idx += rule.interval) {
      emit(idx);
    }
  } else if (rule.freq === 'WEEKLY') {
    var byday = rule.byday && rule.byday.length ? rule.byday
        : [weekdayOfDayIndex(s0)];
    // Weeks start Monday (WKST default). Walk day by day from the series start.
    var week0 = s0 - ((weekdayOfDayIndex(s0) + 6) % 7);
    for (var w = 0, d2 = s0; w < MAX_WALK && !done(d2); w++, d2++) {
      var weekNo = Math.floor((d2 - week0) / 7);
      if (weekNo % rule.interval !== 0) { continue; }
      if (byday.indexOf(weekdayOfDayIndex(d2)) === -1) { continue; }
      emit(d2);
    }
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    var base = new Date(s0 * MS_PER_DAY);   // day index is UTC-based
    var y = base.getUTCFullYear();
    var mo = base.getUTCMonth();
    var mday = rule.bymonthday || base.getUTCDate();
    var stepMonths = rule.freq === 'MONTHLY' ? rule.interval : rule.interval * 12;
    for (var k = 0; k < MAX_WALK; k++) {
      var probe = new Date(y, mo + k * stepMonths, 1);
      var dim = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
      if (mday > dim) { continue; }   // month lacks that day: no occurrence
      var idx2 = dayIndex(probe.getFullYear(), probe.getMonth(), mday);
      if (idx2 < s0) { continue; }
      if (done(idx2)) { break; }
      emit(idx2);
    }
  }
}

// Public: which days of (year, month0) have events?
// Returns { timed: bool[daysInMonth], allday: bool[daysInMonth] }.
function scanMonth(icsText, year, month0) {
  var daysInMonth = new Date(year, month0 + 1, 0).getDate();
  var monthStartIdx = dayIndex(year, month0, 1);
  var out = { timed: [], allday: [] };
  for (var i = 0; i < daysInMonth; i++) { out.timed.push(false); out.allday.push(false); }
  var events = parseEvents(icsText);
  for (var e = 0; e < events.length; e++) {
    expandEvent(events[e], monthStartIdx, daysInMonth, out);
  }
  return out;
}

module.exports = {
  scanMonth: scanMonth,
  // Exported for tests:
  _parseEvents: parseEvents,
  _parseRrule: parseRrule,
  _dayIndex: dayIndex,
};
