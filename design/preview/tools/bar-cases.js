#!/usr/bin/env node
'use strict';
// Runs the next-event month bar (settings/bar.js) through every combination
// of watch, bar content, language, date, event name, event time, clock and
// stale-calendar mark, and checks what must always hold:
//   - nothing overlaps or runs past the room (the circle's edge on Round 2)
//   - a timed event always shows its time, whole
//   - the date is never dropped
//   - a cut name keeps at least three letters
// Also reports which rung each watch lands on, and where today's date-only
// bar (no event) already runs past Round 2's circle.
//
//   node tools/bar-cases.js          # summary
//   node tools/bar-cases.js --json   # the summary as JSON, for the review page

const Bar = require('../../settings/bar.js');

const NAMES = ['', 'Gym', 'Standup', 'Design review', 'Dentist – Dr. Okafor', 'Café with Zoë',
  Bar.cutName('Quarterly planning with the leadership team'), Bar.cutBytes('Quarterly planning with the leadership team'),
  'Supercalifragilistic', 'WWWWWWWWWWWWWWWWWWWWWWW', 'MMMMMMMM MMMMMMMM'];
// Names people actually give events (the rest are there to break things).
const EVERYDAY = ['Gym', 'Standup', 'Design review', 'Dentist – Dr. Okafor', 'Café with Zoë', NAMES[6]];
// Minutes before the start (negative: started), plus all-day events.
const OFFSETS = [1, 23, 59, 65, 119, 150, 400, -2];
const DATES = [];
for (let m = 0; m < 12; m++) {
  [1, 28].forEach((d) => DATES.push(new Date(2026, m, d, 9, 0)));
  DATES.push(new Date(2026, m, 22, 9, 0));   // a different weekday
}
const WATCHES = [['emery', 0], ['basalt', 0], ['gabbro', 0], ['gabbro', 1], ['gabbro', 2]];

const out = { total: 0, failures: [], steps: {}, byWatch: {}, roundDateClips: [], caseFix: 0 };
const json = process.argv.includes('--json');

for (const [watch, timeSize] of WATCHES) {
  const key = watch + (Bar.WATCHES[watch].shape === 'round' ? ['/large', '/medium', '/small'][timeSize] : '');
  const tally = out.byWatch[key] = { cases: 0, steps: {}, everyday: {} };
  for (const locale of Object.keys(Bar.LOCALES)) {
    for (let content = 0; content <= 5; content++) {
      for (const now of DATES) {
        // No event: today's bar. On a round watch it may already pass the circle.
        const plain = Bar.compose({ watch, content, locale, now, event: null, timeSize });
        if (Bar.WATCHES[watch].shape === 'round') {
          const half = Math.floor(Bar.width(plain.date, Bar.WATCHES[watch].date) / 2), sp = plain.span;
          const mid = (sp[0] + sp[1]) / 2, pad = Bar.WATCHES[watch].pad;
          if (mid - half < sp[0] - pad || mid + half > sp[1] + pad) { out.roundDateClips.push(key + ' ' + locale + ' ' + plain.date); }
        }
        for (const name of NAMES) {
          for (const off of OFFSETS.concat(['allday'])) {
            const event = off === 'allday'
              ? { name, start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), allDay: true }
              : { name, start: new Date(now.getTime() + off * 60000), allDay: false };
            for (const h24 of [false, true]) {
              for (const stale of [false, true]) {
                const cfg = { watch, content, locale, now, event, h24, stale, timeSize };
                const r = Bar.compose(cfg);
                out.total++; tally.cases++;
                tally.steps[r.step] = (tally.steps[r.step] || 0) + 1;
                if (EVERYDAY.includes(name)) { tally.everyday[r.step] = (tally.everyday[r.step] || 0) + 1; }
                out.steps[r.step] = (out.steps[r.step] || 0) + 1;
                const w = Bar.WATCHES[watch];
                const used = Bar.width(r.date, w.date) + (r.date ? w.gap : 0) +
                  (r.glyph ? w.glyph + 3 : 0) + Bar.width(r.event, w.event);
                const room = r.span[1] - r.span[0] - r.staleW;
                const t = Bar.when(event, now, h24);
                const why = [];
                if (used > room) { why.push('overflows by ' + (used - room) + 'px'); }
                if (!r.date) { why.push('date dropped'); }
                if (t.text && !r.event.endsWith(t.text)) { why.push('time missing'); }
                const m = r.event.match(/^(.*)…/);
                if (m && Array.from(m[1]).length < 3 && r.step === 'cut') { why.push('name under 3 letters'); }
                if (why.length && out.failures.length < 40) {
                  out.failures.push({ key, locale, content, date: now.toDateString(), name, off, h24, stale,
                    shown: r.date + ' | ' + r.event, why: why.join(', ') });
                }
                if (Bar.dateLadder(content, locale, now, true, false).join() !==
                    Bar.dateLadder(content, locale, now, true, true).join()) { out.caseFix++; }
              }
            }
          }
        }
      }
    }
  }
}
out.roundDateClips = Array.from(new Set(out.roundDateClips));

if (json) { process.stdout.write(JSON.stringify(out, null, 1)); }
else {
  console.log('cases checked:', out.total);
  console.log('failures:', out.failures.length);
  out.failures.slice(0, 15).forEach((f) => console.log('  ', JSON.stringify(f)));
  console.log('steps overall:', out.steps);
  Object.keys(out.byWatch).forEach((k) => console.log('  ', k.padEnd(14), JSON.stringify(out.byWatch[k].steps)));
  console.log('everyday names only:');
  Object.keys(out.byWatch).forEach((k) => console.log('  ', k.padEnd(14), JSON.stringify(out.byWatch[k].everyday)));
  console.log('date-only bars past the circle on Round 2:', out.roundDateClips.length, out.roundDateClips.slice(0, 8));
  console.log('cases where upper-casing accented letters changes the text:', out.caseFix);
}
