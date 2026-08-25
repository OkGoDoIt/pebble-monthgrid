#!/usr/bin/env node
// Unit tests for src/pkjs/ics.js (run: TZ=America/Los_Angeles node tools/test_ics.js).
// The module is plain CommonJS, so it runs in Node as-is.

var ics = require('../src/pkjs/ics');

var failures = 0;
var tests = 0;

function wrap(body) {
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + body + '\r\nEND:VCALENDAR\r\n';
}

function marked(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) { if (arr[i]) { out.push(i + 1); } }
  return out.join(',');
}

function check(name, body, year, month0, wantTimed, wantAllday) {
  tests++;
  var res = ics.scanMonth(wrap(body), year, month0);
  var gotTimed = marked(res.timed);
  var gotAllday = marked(res.allday);
  if (gotTimed !== wantTimed || gotAllday !== wantAllday) {
    failures++;
    console.log('FAIL ' + name);
    console.log('  timed:  got [' + gotTimed + '] want [' + wantTimed + ']');
    console.log('  allday: got [' + gotAllday + '] want [' + wantAllday + ']');
  } else {
    console.log('ok   ' + name);
  }
}

// --- basic events ----------------------------------------------------------

check('single timed event',
  'BEGIN:VEVENT\r\nDTSTART:20260812T140000\r\nDTEND:20260812T150000\r\nEND:VEVENT',
  2026, 7, '12', '');

check('single all-day event',
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260812\r\nDTEND;VALUE=DATE:20260813\r\nEND:VEVENT',
  2026, 7, '', '12');

check('multi-day all-day (DTEND exclusive)',
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260810\r\nDTEND;VALUE=DATE:20260813\r\nEND:VEVENT',
  2026, 7, '', '10,11,12');

// 03:00Z on Aug 12 lands on whatever local day the host timezone says
// (Aug 11 in America/Los_Angeles, Aug 12 in UTC and points east).
var utcLocalDay = String(new Date(Date.UTC(2026, 7, 12, 3, 0, 0)).getDate());
check('UTC time converts to local',
  'BEGIN:VEVENT\r\nDTSTART:20260812T030000Z\r\nDTEND:20260812T040000Z\r\nEND:VEVENT',
  2026, 7, utcLocalDay, '');

check('timed event ending exactly at midnight stays on its day',
  'BEGIN:VEVENT\r\nDTSTART:20260811T220000\r\nDTEND:20260812T000000\r\nEND:VEVENT',
  2026, 7, '11', '');

check('multi-day timed event',
  'BEGIN:VEVENT\r\nDTSTART:20260811T220000\r\nDTEND:20260813T020000\r\nEND:VEVENT',
  2026, 7, '11,12,13', '');

check('cancelled event ignored',
  'BEGIN:VEVENT\r\nDTSTART:20260812T140000\r\nSTATUS:CANCELLED\r\nEND:VEVENT',
  2026, 7, '', '');

check('event outside month ignored',
  'BEGIN:VEVENT\r\nDTSTART:20260712T140000\r\nDTEND:20260712T150000\r\nEND:VEVENT',
  2026, 7, '', '');

check('folded property line',
  'BEGIN:VEVENT\r\nDTSTART:2026081\r\n 2T140000\r\nEND:VEVENT',
  2026, 7, '12', '');

// --- recurrence ------------------------------------------------------------

check('weekly BYDAY=MO,WE',
  'BEGIN:VEVENT\r\nDTSTART:20260803T100000\r\nDTEND:20260803T110000\r\n' +
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEND:VEVENT',
  2026, 7, '3,5,10,12,17,19,24,26,31', '');

check('weekly without BYDAY uses start weekday',
  'BEGIN:VEVENT\r\nDTSTART:20260804T100000\r\nDTEND:20260804T110000\r\n' +   // a Tuesday
  'RRULE:FREQ=WEEKLY\r\nEND:VEVENT',
  2026, 7, '4,11,18,25', '');

check('biweekly from July reaches alternating August weeks',
  'BEGIN:VEVENT\r\nDTSTART:20260720T100000\r\nDTEND:20260720T110000\r\n' +   // Monday Jul 20
  'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO\r\nEND:VEVENT',
  2026, 7, '3,17,31', '');

check('daily COUNT crossing month boundary',
  'BEGIN:VEVENT\r\nDTSTART:20260730T090000\r\nDTEND:20260730T093000\r\n' +
  'RRULE:FREQ=DAILY;COUNT=5\r\nEND:VEVENT',
  2026, 7, '1,2,3', '');

check('monthly on the 15th',
  'BEGIN:VEVENT\r\nDTSTART:20260515T120000\r\nDTEND:20260515T130000\r\n' +
  'RRULE:FREQ=MONTHLY\r\nEND:VEVENT',
  2026, 7, '15', '');

check('monthly on the 31st skips short months but hits August',
  'BEGIN:VEVENT\r\nDTSTART:20260531T120000\r\nDTEND:20260531T130000\r\n' +
  'RRULE:FREQ=MONTHLY\r\nEND:VEVENT',
  2026, 7, '31', '');

check('monthly COUNT counts skipped months correctly',
  // Occurrences: May 31, Jul 31, Aug 31 (June skipped, no day 31). COUNT=3
  // includes Aug 31.
  'BEGIN:VEVENT\r\nDTSTART:20260531T120000\r\nDTEND:20260531T130000\r\n' +
  'RRULE:FREQ=MONTHLY;COUNT=3\r\nEND:VEVENT',
  2026, 7, '31', '');

check('yearly all-day (birthday-style) from 1990',
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:19900824\r\n' +
  'RRULE:FREQ=YEARLY\r\nEND:VEVENT',
  2026, 7, '', '24');

check('UNTIL before the month yields nothing',
  'BEGIN:VEVENT\r\nDTSTART:20260601T100000\r\nDTEND:20260601T110000\r\n' +
  'RRULE:FREQ=WEEKLY;UNTIL=20260715T000000Z\r\nEND:VEVENT',
  2026, 7, '', '');

check('EXDATE removes one weekly instance',
  'BEGIN:VEVENT\r\nDTSTART:20260803T100000\r\nDTEND:20260803T110000\r\n' +
  'RRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE:20260817T100000\r\nEND:VEVENT',
  2026, 7, '3,10,24,31', '');

check('unsupported ordinal BYDAY marks only the first instance',
  'BEGIN:VEVENT\r\nDTSTART:20260805T100000\r\nDTEND:20260805T110000\r\n' +
  'RRULE:FREQ=MONTHLY;BYDAY=1WE\r\nEND:VEVENT',
  2026, 7, '5', '');

check('recurring multi-day all-day event',
  // Weekend-long all-day event repeating weekly: Sat+Sun.
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260801\r\nDTEND;VALUE=DATE:20260803\r\n' +
  'RRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT',
  2026, 7, '', '1,2,8,9,15,16');

console.log('---');
console.log(tests + ' tests, ' + failures + ' failures');
process.exit(failures ? 1 : 0);
