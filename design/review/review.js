// The review page: tabs on narrow screens, the three prototypes, the
// month-bar lab, the hard cases, and the own-line and Quick View moments.
(function () {
  'use strict';
  var Face = window.MonthGridFace, Bar = window.MGBar;
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) { return MG.el(tag, attrs, kids); }

  // Tabs only matter below the width where all three phones fit side by side.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      $(t.getAttribute('aria-controls')).classList.toggle('off', !on);
    });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { select(t); }); });
  select(tabs[0]);

  document.querySelectorAll('.mount').forEach(function (m) {
    try { MGHybrids[m.getAttribute('data-dir')](m); }
    catch (e) { m.textContent = 'This prototype failed to draw: ' + e.message; console.error(e); }
  });

  // A canvas of rgba pixels at a whole-pixel scale.
  function canvas(img, scale) {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.pixels), img.width, img.height), 0, 0);
    c.style.width = img.width * scale + 'px';
    return c;
  }

  // ---- The month-bar lab ------------------------------------------------------
  var DATES = [['Thu, Oct 29', new Date(2026, 9, 29, 9, 37)], ['Wed, Sep 30', new Date(2026, 8, 30, 9, 37)],
    ['Sat, Mar 28', new Date(2026, 2, 28, 9, 37)], ['Sun, Feb 1', new Date(2026, 1, 1, 9, 37)],
    ['Mon, May 4', new Date(2026, 4, 4, 9, 37)]];
  var WHENS = [['In 8 minutes', 8], ['In 23 minutes', 23], ['In 1 hour 5 minutes', 65], ['In 2½ hours', 150],
    ['Started 2 minutes ago', -2], ['All day', 'allday']];
  function fill(sel, pairs, value) {
    pairs.forEach(function (p) { sel.appendChild(el('option', { value: p[0], text: p[1] })); });
    sel.value = value;
  }
  fill($('lab-watch'), Object.keys(Bar.WATCHES).map(function (k) { return [k, Bar.WATCHES[k].name]; }), 'emery');
  fill($('lab-content'), MG.CONTROLS.month[1].choices.map(function (c) { return [c[0], c[1]]; }), '2');
  fill($('lab-locale'), Object.keys(Bar.LOCALES).map(function (k) { return [k, Bar.LOCALES[k].label]; }), 'en-US');
  fill($('lab-theme'), MG.CONTROLS.colors[0].choices.map(function (c) { return [c[0], c[1]]; }), '0');
  fill($('lab-date'), DATES.map(function (d, i) { return [i, d[0]]; }), '0');
  fill($('lab-when'), WHENS.map(function (w, i) { return [i, w[0]]; }), '2');

  function lab() {
    var watch = $('lab-watch').value, now = DATES[$('lab-date').value][1], w = WHENS[$('lab-when').value][1];
    var typed = $('lab-name').value.replace(/\s+/g, ' ').trim();
    var name = Bar.cutName(typed);
    var event = $('lab-none').checked ? null : w === 'allday'
      ? { name: name, start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), allDay: true }
      : { name: name, start: new Date(now.getTime() + w * 60000), allDay: false };
    var box = $('lab-strip'), steps = $('lab-steps'), sent = $('lab-sent');
    box.textContent = ''; steps.textContent = ''; sent.textContent = '';
    if (Bar.WATCHES[watch].bar === false) {
      box.appendChild(el('p', { class: 'sent', text: 'No month bar on this watch: the month is a column of letters. The event goes in the status line.' }));
      return;
    }
    var trace = [];
    var cfg = { watch: watch, content: Number($('lab-content').value), locale: $('lab-locale').value, now: now,
      event: event, h24: $('lab-h24').checked, stale: $('lab-stale').checked, timeSize: 0, fixCase: true, trace: trace };
    var img = Bar.strip(cfg, { BANNER_STYLE: Number($('lab-style').value), THEME: Number($('lab-theme').value) });
    var c = canvas(img, 2);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', (img.res.date + ' ' + (img.res.event || '')).trim());
    box.appendChild(c);
    if (event && name !== typed) {
      sent.appendChild(document.createTextNode('The phone sends the watch at most 23 bytes, so it receives '));
      sent.appendChild(el('b', { text: '“' + name + '”' }));
      sent.appendChild(document.createTextNode('.'));
    }
    if (!event) {
      sent.textContent = 'With no event coming up, the bar is as it is today: the longest date that fits, centered.';
      return;
    }
    // Every line tried, in order; a run of shortened names collapses to one row.
    var rows = [], cuts = 0;
    trace.forEach(function (t, i) {
      if (t.phase === 'cut' && !t.ok) { cuts++; return; }
      if (cuts) { rows.push({ note: cuts + ' shorter names didn’t fit' }); cuts = 0; }
      rows.push(t);
    });
    rows.forEach(function (t, i) {
      if (t.note) { steps.appendChild(el('li', {}, [el('span', { class: 'n', text: '…' }), el('span', { class: 't' }, [el('i', { text: t.note })]), el('span')])); return; }
      steps.appendChild(el('li', { class: t.ok ? 'win' : '' }, [
        el('span', { class: 'n', text: String(i + 1) }),
        el('span', { class: 't' }, [t.date || '', el('i', { text: '  ·  ' }), (t.glyph ? '[cal] ' : '') + t.event]),
        el('span', { class: 'w', text: t.used + ' of ' + t.room + ' px' + (t.ok ? ' ✓' : '') })]));
    });
  }
  ['lab-watch', 'lab-content', 'lab-style', 'lab-locale', 'lab-theme', 'lab-date', 'lab-when', 'lab-h24', 'lab-stale', 'lab-none']
    .forEach(function (id) { $(id).addEventListener('change', lab); });
  $('lab-name').addEventListener('input', lab);
  lab();

  // ---- Hard cases on each watch ---------------------------------------------------
  var OCT = new Date(2026, 9, 29, 9, 37);
  function ev(name, min, now) {
    now = now || OCT;
    return min === 'allday' ? { name: name, start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), allDay: true }
      : { name: name, start: new Date(now.getTime() + min * 60000), allDay: false };
  }
  var SEP = new Date(2026, 8, 30, 9, 37), MAR = new Date(2026, 2, 28, 9, 37);
  var CASES = [
    { title: 'The longest English date', note: 'Weekday, month, and day on Wednesday, September 30.',
      cfg: { content: 2, locale: 'en-US', now: SEP, event: ev('Design review', 65, SEP) }, style: 0 },
    { title: 'German, with the year', note: 'Month, day, and year; an event later this morning.',
      cfg: { content: 3, locale: 'de', now: MAR, event: ev('Zahnarzt', 150, MAR) }, style: 2 },
    { title: 'A long name', note: 'Cut by the phone at a word, then by the watch if it still doesn’t fit.',
      cfg: { content: 0, locale: 'en-US', now: OCT, event: ev(Bar.cutName('Quarterly planning with the leadership team'), 8) }, style: 0 },
    { title: 'One long word, and the “!”', note: 'Markers that couldn’t refresh keep their spot at the end.',
      cfg: { content: 1, locale: 'en-US', now: OCT, event: ev('Supercalifragilistic', 23), stale: true }, style: 1 },
    { title: 'Just started', note: 'French; shows “now” for 5 minutes, then the next event.',
      cfg: { content: 2, locale: 'fr', now: OCT, event: ev('Café avec Zoë', -2) }, style: 0 },
    { title: 'Numbers and a 24-hour clock', note: 'An event four hours out.',
      cfg: { content: 5, locale: 'en-US', now: OCT, event: ev('Dentist – Dr. Okafor', 240), h24: true }, style: 2 },
    { title: 'All day', note: 'The name alone, with Any time today.',
      cfg: { content: 0, locale: 'en-US', now: OCT, event: ev('Sam’s birthday', 'allday') }, style: 0 },
  ];
  var cases = $('cases');
  cases.textContent = '';
  CASES.forEach(function (k, i) {
    var strips = el('div', { class: 'strips' });
    ['emery', 'basalt', 'gabbro'].forEach(function (w) {
      var cfg = Object.assign({ watch: w, timeSize: 0, fixCase: true }, k.cfg);
      var img = Bar.strip(cfg, { BANNER_STYLE: k.style, THEME: [0, 3, 7][i % 3] });
      strips.appendChild(el('span', { text: Bar.WATCHES[w].name }));
      var c = canvas(img, 1.5);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', Bar.WATCHES[w].name + ': ' + img.res.date + ' ' + img.res.event);
      strips.appendChild(c);
    });
    cases.appendChild(el('div', { class: 'case' }, [el('h3', { text: k.title }), el('p', { text: k.note }), strips]));
  });

  // ---- Own line and Quick View moments ---------------------------------------------------
  // Quick View, sketched: a white card over the bottom 51 px.
  function quickView(r, title, sub) {
    var sf = r.surface, y = r.height - 51, C = Face.GColor;
    Face.fillRect(sf, Face.rect(0, y, r.width, 51), C.White);
    Face.fillRect(sf, Face.rect(0, y, 30, 51), C.LightGray);
    Bar.calMark(sf, 10, y + 21, 9, C.Black);
    Face.drawText(sf, title, 'GOTHIC_18_BOLD', Face.rect(36, y + 4, r.width - 40, 22), C.Black, 'left');
    Face.drawText(sf, sub, 'GOTHIC_18', Face.rect(36, y + 24, r.width - 40, 22), C.Black, 'left');
    r.pixels = Face.toRGBA(sf);
    return r;
  }
  function moment(place, now, qv, look) {
    var s = MG.defaultState();
    s.opts.event = { place: place };
    Object.keys(look || {}).forEach(function (k) { s.look[k] = look[k]; });
    var day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);
    var data = MG.merge(MG.NOW.data, { now: now, quickView: qv,
      event: { name: 'Standup', start: day, end: new Date(day.getTime() + 15 * 60000), allDay: false } });
    var r = MG.draw(s, data);
    if (qv) { quickView(r, 'Standup', 'In ' + Math.round((day - now) / 60000) + ' minutes'); }
    return r;
  }
  var AUG = new Date(2026, 7, 27, 9, 52);
  var MOMENTS = [
    { title: 'On its own line', note: '9:37, with Standup at 10:00. The status line keeps all four items.',
      r: moment('own', new Date(2026, 9, 29, 9, 37), false) },
    { title: 'Quick View comes up', note: '9:52. The own line would cost the weekday letters, so the event moves into the bar.',
      r: moment('own', new Date(2026, 9, 29, 9, 52), true) },
    { title: 'A six-row month', note: 'August, 9:52. Quick View squeezes the bar into the first row; the event leaves with it.',
      r: moment('bar', AUG, true) },
    { title: 'Takes over the status line', note: '9:48. Its last 15 minutes; the other items come back once it starts.',
      r: moment('take', new Date(2026, 9, 29, 9, 48), false) },
  ];
  var box = $('moments');
  box.textContent = '';
  MOMENTS.forEach(function (m) {
    var c = canvas(m.r, 1);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', m.title);
    box.appendChild(el('figure', { class: 'face' }, [c, el('h3', { text: m.title }), el('p', { text: m.note })]));
  });
})();
