// MonthGrid's settings page: the face docked at the top, a tab for each
// part under it, and that part's controls below. Tapping a part of the face
// opens its tab. Plain script; needs monthgrid-face.js, bar.js, core.js and
// event.js. MGPage.mount(frame) builds it into frame.
(function (global) {
  'use strict';
  var MG = global.MG, el = MG.el, Face = global.MonthGridFace;

  var TABS = [
    { id: 'time', label: 'Time' }, { id: 'status', label: 'Status' }, { id: 'event', label: 'Event' },
    { id: 'month', label: 'Month' }, { id: 'days', label: 'Days' }, { id: 'colors', label: 'Colors' },
  ];
  var CUSTOM = 10;   // THEME value for your own colors
  // Pebble's names for its 64 colors, in GColor8 order (gcolor_definitions.h).
  var COLOR_NAMES = ['Black', 'Oxford blue', 'Duke blue', 'Blue', 'Dark green', 'Midnight green', 'Cobalt blue',
    'Blue moon', 'Islamic green', 'Jaeger green', 'Tiffany blue', 'Vivid cerulean', 'Green', 'Malachite',
    'Medium spring green', 'Cyan', 'Bulgarian rose', 'Imperial purple', 'Indigo', 'Electric ultramarine',
    'Army green', 'Dark gray', 'Liberty', 'Very light blue', 'Kelly green', 'May green', 'Cadet blue',
    'Picton blue', 'Bright green', 'Screamin green', 'Medium aquamarine', 'Electric blue',
    'Dark candy apple red', 'Jazzberry jam', 'Purple', 'Vivid violet', 'Windsor tan', 'Rose vale', 'Purpureus',
    'Lavender indigo', 'Limerick', 'Brass', 'Light gray', 'Baby blue eyes', 'Spring bud', 'Inchworm',
    'Mint green', 'Celeste', 'Red', 'Folly', 'Fashion magenta', 'Magenta', 'Orange', 'Sunset orange',
    'Brilliant rose', 'Shocking pink', 'Chrome yellow', 'Rajah', 'Melon', 'Rich brilliant lavender', 'Yellow',
    'Icterine', 'Pastel yellow', 'White'];

  var ICON = {
    minus: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="currentColor"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="currentColor"/><path d="M6.5 11h9M11 6.5v9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    grip: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    cal: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="4.5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h16M7.5 2.5v4M14.5 2.5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chev: '<svg class="chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function icon(name, cls) { return el('span', { class: 'ico ' + (cls || ''), html: ICON[name] }); }

  // ---- Bits shared by every tab --------------------------------------------
  function clone(state) { return JSON.parse(JSON.stringify(state)); }
  function union(a, b) {
    if (!a) { return b; }
    if (!b) { return a; }
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  function field(label, control, note) {
    return el('div', { class: 'field' }, [label ? el('span', { class: 'flabel', text: label }) : null, control,
      note ? el('p', { class: 'note', text: note }) : null]);
  }
  // Choices drawn as the part of the face they change.
  function pictures(choices, cur, onPick, label, cols, picture) {
    return el('div', { class: 'pics cols' + cols, role: 'group', 'aria-label': label }, choices.map(function (c) {
      return el('button', { type: 'button', class: 'pic', 'aria-pressed': String(c[0] === cur),
        onclick: function () { onPick(c[0]); } }, [picture(c[0]), el('span', { text: c[1] })]);
    }));
  }
  // Where the next event is on a render, if it's showing.
  function eventRect(r) {
    var L = r.layout, d = r.drawn[MG.M.EVENT];
    if (r.barEvent && L.banner) { return { x: r.barEvent.x - 3, y: L.banner.y, w: r.barEvent.w + 6, h: L.banner.h }; }
    if (L.extra && r.plan.event && r.plan.event.shown) { return L.extra; }
    if (d && L.status) { return { x: d.x - 2, y: L.status.y, w: d.w + 4, h: L.status.h }; }
    return null;
  }

  // ---- The dock: a window onto the face, and the tabs ---------------------------
  // The window is the same height on every tab, so the tabs never move: it
  // shows the time down to the first rows of days, and slides down to the
  // whole calendar on Days.
  function dock(r, tab, go) {
    var L = r.layout, cal = L.banner || L.header || L.grid;
    var head = Math.max(0, L.time.y - 4);
    // On Days a little of what's above the bar shows too, so its fade falls there.
    var h = Math.max(Math.min(r.height, L.grid.y + Math.round(L.rowPitch * 1.5)) - head, r.height - (cal.y - 16));
    var days = tab === 'days';
    var top = days ? r.height - h : head, bottom = Math.min(r.height, top + h);
    var rect = { x: 0, y: top, w: r.width, h: bottom - top };
    var stage = el('div', { class: 'stage ' + (days ? 'cut-top' : 'cut-bottom'), style: 'width:' + r.width + 'px' },
      [MG.crop(r, rect, 1)]);
    [
      { tab: 'time', label: 'the time', rect: L.time },
      { tab: 'status', label: 'the status line', rect: L.status },
      { tab: 'month', label: 'the month bar', rect: L.banner },
      { tab: 'days', label: 'the days', rect: union(L.header, L.grid) },
      { tab: 'event', label: 'the next event', rect: eventRect(r) },
    ].forEach(function (z) {
      if (!z.rect) { return; }
      var y0 = Math.max(z.rect.y, top), y1 = Math.min(z.rect.y + z.rect.h, bottom);
      if (y1 <= y0) { return; }
      stage.appendChild(el('button', { type: 'button', class: 'hit' + (z.tab === tab ? ' on' : ''),
        'aria-label': 'Change ' + z.label, tabindex: '-1',
        style: 'left:' + (z.rect.x / rect.w * 100) + '%;top:' + ((y0 - top) / rect.h * 100) + '%;width:' +
          (z.rect.w / rect.w * 100) + '%;height:' + ((y1 - y0) / rect.h * 100) + '%',
        onclick: function () { go(z.tab); } }));
    });
    var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Parts of the face' }, TABS.map(function (t) {
      return el('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab),
        onclick: function () { go(t.id); } }, [t.label]);
    }));
    return el('div', { class: 'dock' }, [el('div', { class: 'facewrap' }, [stage]), tabs]);
  }

  // ---- Time ------------------------------------------------------------------
  var FONTS = [[0, 'Roboto'], [1, 'Digital'], [2, 'Pixel'], [3, 'Bitham bold'], [4, 'Bitham light']];
  function timeTab(c) {
    var look = c.store.state.look;
    return [
      field('Font', pictures(FONTS, look.TIME_FONT, c.setLook('TIME_FONT'), 'Font', 2, function (v) {
        var s = clone(c.store.state);
        s.look.TIME_FONT = v;
        var r = MG.draw(s, c.data);
        return MG.crop(r, MG.region(r, 'time', 2), 1);
      })),
      field('Size', MG.segmented([[0, 'Large'], [1, 'Medium'], [2, 'Small']], look.TIME_SIZE, c.setLook('TIME_SIZE'), 'Size')),
      field('Hours', MG.segmented([[0, 'Like the phone'], [1, '12-hour'], [2, '24-hour']], look.TIME_FORMAT,
        c.setLook('TIME_FORMAT'), 'Hours')),
      field('Seconds', MG.segmented([[false, 'Hide'], [true, 'Show']], look.SHOW_SECONDS, c.setLook('SHOW_SECONDS'), 'Seconds'),
        look.SHOW_SECONDS ? 'Showing seconds uses noticeably more battery.' : null),
    ];
  }

  // ---- Status ----------------------------------------------------------------
  // Two lists: what's on the watch, most important first, and everything
  // else. The minus moves an item down, the plus moves it up; nothing is
  // lost either way, and Undo puts a removed item back where it was.
  function statusTab(c) {
    var store = c.store, ui = c.ui, rows = c.r.plan.rows;
    var lastShown = -1, anyRoom = rows.some(function (row) { return row.state === 'room'; });
    rows.forEach(function (row, i) { if (row.state === 'shown') { lastShown = i; } });
    var list = el('ol', { class: 'slist', 'aria-label': 'On your watch, most important first' });
    // An event set to show in the status line takes room there first; it's
    // set on the Event tab, so here it's a pinned row that leads there.
    var E = store.state.event;
    if (E.place === 'line' || E.place === 'take') {
      list.appendChild(el('li', { class: 'pinned' }, [el('button', { type: 'button', class: 'main',
        onclick: function () { c.go('event'); } }, [icon('cal', 'calico'),
        el('span', { class: 'label' }, [el('span', { class: 'name', text: 'Next event' }),
          el('span', { class: 'why', text: (E.place === 'take' ? 'The whole line, ' + MG.TAKE_MIN + ' minutes before'
            : 'First, ' + MG.choiceLabel(MG.EVENT.within, E.within).toLowerCase()) })]),
        icon('chev', 'chevwrap')])]));
    }
    rows.forEach(function (row, i) {
      var it = MG.BY_ID[row.id], open = ui.open === row.id, hasOptions = !!it.options;
      var line2 = hasOptions ? MG.summary(store.state, row.id)
        : row.state === 'room' ? 'Waits for room on the watch' : row.state === 'hidden' ? row.why : '';
      var pic = MG.chip(store.state, row.id, c.data, 104);
      if (pic) { pic.classList.add('chip'); }
      var body = [el('span', { class: 'label' }, [el('span', { class: 'name', text: it.name }),
        line2 ? el('span', { class: 'why', text: line2 }) : null]), pic, hasOptions ? icon('chev', 'chevwrap') : null];
      var li = el('li', { class: 'srow' + (row.state === 'shown' ? '' : ' off') + (open ? ' open' : '') +
          (ui.flash === row.id ? ' flash' : ''), 'data-id': row.id }, [
        el('button', { type: 'button', class: 'minus', 'aria-label': 'Remove ' + it.name,
          onclick: function () { c.remove(row.id); } }, [icon('minus')]),
        hasOptions
          ? el('button', { type: 'button', class: 'main', 'aria-expanded': String(open),
            onclick: function () { ui.open = open ? null : row.id; c.render(); } }, body)
          : el('div', { class: 'main' }, body),
        el('button', { type: 'button', class: 'handle', 'aria-label': 'Move ' + it.name }, [icon('grip')]),
      ]);
      dragToReorder(li, list, store);
      list.appendChild(li);
      if (open) { list.appendChild(el('li', { class: 'opts' }, optionFields(store, row.id))); }
      if (anyRoom && i === lastShown) {
        list.appendChild(el('li', { class: 'fold', 'aria-hidden': 'true', text: 'Room on the watch ends here' }));
      }
    });
    if (!rows.length) { list.appendChild(el('li', { class: 'empty', text: 'Nothing on the watch yet. Add items below.' })); }

    var more = el('ul', { class: 'mlist', 'aria-label': 'More items' });
    var group = null;
    MG.ITEMS.forEach(function (it) {
      if (store.state.status.indexOf(it.id) >= 0) { return; }
      if (it.group && it.group !== group) { group = it.group; more.appendChild(el('li', { class: 'mgroup', text: it.group })); }
      var pic = MG.chip(store.state, it.id, c.data, 104);
      if (pic) { pic.classList.add('chip'); }
      more.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mrow', 'aria-label': 'Add ' + it.name,
        onclick: function () { c.add(it.id); } }, [icon('plus', 'plus'),
        el('span', { class: 'label' }, [el('span', { class: 'name', text: it.name })]), pic])]));
    });
    if (group !== 'From other apps') { more.appendChild(el('li', { class: 'mgroup', text: 'From other apps' })); }
    more.appendChild(el('li', { class: 'mnote', text: 'Readings from other apps are picked in the Pebble app, under Complications.' }));

    return [
      el('div', { class: 'listhead' }, [el('h3', { text: 'On your watch' }), el('span', { text: 'Most important first' })]),
      list,
      el('div', { class: 'listhead' }, [el('h3', { text: 'More items' })]),
      more,
    ];
  }
  function optionFields(store, id) {
    return (MG.BY_ID[id].options || []).map(function (o) {
      var note = o.note && o.note(store.state);
      return field(o.label, MG.segmented(o.choices, MG.optValue(store.state, id, o.key),
        function (v) { store.setOpt(id, o.key, v); }, o.label), note);
    });
  }
  // Drag a row by its handle; the new order is kept when the finger lifts.
  function dragToReorder(li, list, store) {
    var handle = li.querySelector('.handle');
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      li.classList.add('dragging');
      var startY = e.clientY;
      function rowsNow() { return Array.prototype.filter.call(list.children, function (x) { return x.classList.contains('srow'); }); }
      // Swap past every row the finger has crossed, however fast it moved.
      function move(ev) {
        for (;;) {
          var dy = ev.clientY - startY, all = rowsNow(), i = all.indexOf(li), prev = all[i - 1], next = all[i + 1];
          if (next && dy > next.offsetHeight / 2) {
            list.insertBefore(next, li); startY += next.offsetHeight;
          } else if (prev && dy < -prev.offsetHeight / 2) {
            list.insertBefore(li, prev); startY -= prev.offsetHeight;
          } else { break; }
        }
        li.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        li.classList.remove('dragging');
        li.style.transform = '';
        var order = rowsNow().map(function (x) { return x.getAttribute('data-id'); });
        store.set(function (s) { s.status = order; });
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ---- Event -----------------------------------------------------------------
  function eventTab(c) {
    var E = c.store.state.event;
    var soon = MG.whenShown('event', c.store.state, c.data);
    var out = [field('Where', pictures(MG.EVENT.place.choices, E.place, c.setEvent('place'), 'Where', 2, function (v) {
      var s = clone(c.store.state);
      s.event.place = v;
      var r = MG.draw(s, soon), L = r.layout;
      var low = L.banner || L.extra || L.status, y0 = Math.max(0, L.time.y - 3);
      return MG.crop(r, { x: 0, y: y0, w: r.width, h: Math.min(r.height, low.y + low.h + 3) - y0 }, 1);
    }))];
    if (E.place !== 'off') {
      out.push(field('Show it', MG.segmented(MG.EVENT.within.choices, E.within, c.setEvent('within'), 'Show it')));
    }
    if (E.place === 'line') {
      out.push(field('Show', MG.segmented(MG.EVENT.style.choices, E.style, c.setEvent('style'), 'Show')));
    }
    return out;
  }

  // ---- Month -------------------------------------------------------------------
  var SHOWS = [[0, 'Month'], [1, 'Month and day'], [2, 'Weekday, month, and day'], [3, 'Month, day, and year'],
    [4, 'Weekday, date, and year'], [5, 'Numbers']];
  var STYLES = [[0, 'Bar'], [1, 'Plain'], [2, 'Ruled']];
  function monthTab(c) {
    var look = c.store.state.look, E = c.store.state.event;
    var calm = MG.merge(c.data, { event: null });   // the bar on its own, without an event in it
    // narrow: just the middle of the bar, for the three-across style choices.
    function bar(key, narrow) {
      return function (v) {
        var s = clone(c.store.state);
        s.look[key] = v;
        var r = MG.draw(s, calm), b = MG.region(r, 'banner', 2);
        if (narrow) { b = { x: b.x + 45, y: b.y, w: b.w - 90, h: b.h }; }
        return MG.crop(r, b, 1);
      };
    }
    var out = [];
    if (E.place === 'bar') {
      out.push(el('button', { type: 'button', class: 'xlink', onclick: function () { c.go('event'); } }, [
        el('span', { class: 'label' }, [el('span', { class: 'name', text: 'Your next event shows here' }),
          el('span', { class: 'why', text: MG.choiceLabel(MG.EVENT.within, E.within) })]), icon('chev', 'chevwrap')]));
    }
    out.push(field('Shows', pictures(SHOWS, look.BANNER_CONTENT, c.setLook('BANNER_CONTENT'), 'Shows', 2, bar('BANNER_CONTENT'))));
    out.push(field('Style', pictures(STYLES, look.BANNER_STYLE, c.setLook('BANNER_STYLE'), 'Style', 3, bar('BANNER_STYLE', true))));
    return out;
  }

  // ---- Days --------------------------------------------------------------------
  function daysTab(c) {
    var look = c.store.state.look, ui = c.ui, out = [
      field('Weeks start on', MG.segmented([[0, 'Sunday'], [1, 'Monday'], [2, 'Saturday']], look.START_DAY,
        c.setLook('START_DAY'), 'Weeks start on')),
      field('Weekday letters', MG.segmented([[0, 'Two'], [1, 'One']], look.HEADER_LABEL, c.setLook('HEADER_LABEL'),
        'Weekday letters')),
      field('Days from next and last month', MG.segmented([[false, 'Hide'], [true, 'Show']], look.SHOW_ADJACENT,
        c.setLook('SHOW_ADJACENT'), 'Days from next and last month')),
      field('Borders', MG.segmented([[false, 'None'], [true, 'Lines']], look.GRID_LINES, c.setLook('GRID_LINES'), 'Borders')),
    ];
    if (look.GRID_LINES) { out.push(colorField(c, 'Border color', 'GRID_COLOR')); }
    out.push(field('Event markers', MG.segmented([[false, 'Off'], [true, 'On']], look.DOTS_ENABLED,
      c.setLook('DOTS_ENABLED'), 'Event markers')));
    if (look.DOTS_ENABLED) {
      out.push(field('Marker style', MG.segmented([[0, 'Underline'], [1, 'Squares']], look.DOTS_STYLE,
        c.setLook('DOTS_STYLE'), 'Marker style')));
      var cals = el('div', { class: 'cals' });
      [0, 1, 2].forEach(function (i) {
        var key = 'CAL' + (i + 1) + '_COLOR', open = ui.color === key;
        var input = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'Calendar link (.ics)',
          value: c.store.state.calendars[i], 'aria-label': 'Calendar ' + (i + 1) + ' link',
          oninput: function () { c.store.state.calendars[i] = input.value; } });
        cals.appendChild(el('div', { class: 'cal' }, [
          el('button', { type: 'button', class: 'swatchbtn', 'aria-expanded': String(open),
            'aria-label': 'Calendar ' + (i + 1) + ' color: ' + COLOR_NAMES[look[key]],
            onclick: function () { ui.color = open ? null : key; c.render(); } }, [swatch(look[key])]),
          input]));
        if (open) { cals.appendChild(palette(look[key], function (v) { c.setLook(key)(v); })); }
      });
      out.push(field('Calendars', cals));
    }
    return out;
  }

  // ---- Colors ------------------------------------------------------------------
  function swatch(v) {
    return el('span', { class: 'swatch', style: 'background:' + Face.colorToCSS(v) });
  }
  // Pebble's 64 colors, grays first, then around the color wheel; within a
  // hue, light to dark.
  var PALETTE_ORDER = (function () {
    var list = [];
    for (var v = 0; v < 64; v++) {
      var r = (v >> 4) & 3, g = (v >> 2) & 3, b = v & 3, max = Math.max(r, g, b), min = Math.min(r, g, b);
      var hue = 0;
      if (max !== min) {
        var d = max - min;
        hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      }
      list.push({ v: v, gray: max === min, hue: Math.round(hue * 60), light: r + g + b });
    }
    list.sort(function (x, y) {
      if (x.gray !== y.gray) { return x.gray ? -1 : 1; }
      return x.gray ? x.light - y.light : x.hue - y.hue || y.light - x.light;
    });
    return list.map(function (x) { return x.v; });
  })();
  function palette(cur, onPick) {
    var grid = el('div', { class: 'palette', role: 'group', 'aria-label': 'Colors' });
    PALETTE_ORDER.forEach(function (v) {
      grid.appendChild(el('button', { type: 'button', class: 'pcolor', 'aria-pressed': String(v === cur),
        'aria-label': COLOR_NAMES[v], title: COLOR_NAMES[v], style: 'background:' + Face.colorToCSS(v),
        onclick: function () { onPick(v); } }));
    });
    return grid;
  }
  // warn: a line under the field when this color is hard to see.
  function colorField(c, label, key, warn) {
    var v = c.store.state.look[key], open = c.ui.color === key;
    return el('div', { class: 'colorfield' }, [
      el('button', { type: 'button', class: 'crow', 'aria-expanded': String(open),
        onclick: function () { c.ui.color = open ? null : key; c.render(); } }, [
        el('span', { class: 'label' }, [el('span', { class: 'name', text: label }),
          el('span', { class: 'why', text: COLOR_NAMES[v] })]), swatch(v), icon('chev', 'chevwrap')]),
      open ? palette(v, c.setLook(key)) : null, warn ? el('p', { class: 'note warn', text: warn }) : null]);
  }
  // WCAG contrast between two Pebble colors.
  function contrast(a, b) {
    function lum(v) {
      var ch = [(v >> 4) & 3, (v >> 2) & 3, v & 3].map(function (k) {
        var s = k / 3;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function colorsTab(c) {
    var look = c.store.state.look;
    var calm = MG.merge(c.data, { event: null });
    var grid = el('div', { class: 'themes', role: 'group', 'aria-label': 'Colors' });
    Face.THEME_NAMES.forEach(function (name, i) {
      var s = clone(c.store.state);
      s.look.THEME = i;
      var r = MG.draw(s, calm), pic = MG.crop(r, null, 1);
      pic.classList.add('mini');
      grid.appendChild(el('button', { type: 'button', class: 'theme', 'aria-pressed': String(look.THEME === i),
        onclick: function () { c.setLook('THEME')(i); } }, [pic, el('span', { text: i === CUSTOM ? 'Your colors' : name })]));
    });
    var out = [grid];
    if (look.THEME === CUSTOM) {
      out.push(el('div', { class: 'custom' }, [
        colorField(c, 'Background', 'CUSTOM_BG'),
        colorField(c, 'Text', 'CUSTOM_FG', contrast(look.CUSTOM_FG, look.CUSTOM_BG) < 3
          ? 'Text will be hard to read on this background.' : null),
        colorField(c, 'Accent', 'CUSTOM_ACCENT', contrast(look.CUSTOM_ACCENT, look.CUSTOM_BG) < 1.6
          ? 'The accent will be hard to see on this background.' : null)]));
    }
    return out;
  }

  // ---- The page ------------------------------------------------------------------
  var PANELS = { time: timeTab, status: statusTab, event: eventTab, month: monthTab, days: daysTab, colors: colorsTab };

  function mount(frame, opts) {
    opts = opts || {};
    var store = new MG.Store(opts.state || MG.defaultState());
    var data = opts.data || MG.BASE;
    var ui = { tab: opts.tab || 'time', open: null, color: null, flash: null };
    var savebar;
    function scroller() { return frame.closest('.phone') || frame; }
    var c = {
      store: store, data: data, ui: ui,
      setLook: function (key) { return function (v) { store.set(function (s) { s.look[key] = v; }); }; },
      setEvent: function (key) { return function (v) { store.set(function (s) { s.event[key] = v; }); }; },
      go: function (tab) { ui.tab = tab; ui.open = null; ui.color = null; draw(true); },
      render: function () { draw(false); },
      add: function (id) {
        ui.flash = id;
        store.set(function (s) { s.status.push(id); });
        ui.flash = null;
      },
      remove: function (id) {
        var at = store.state.status.indexOf(id), name = MG.BY_ID[id].name;
        if (ui.open === id) { ui.open = null; }
        store.set(function (s) { s.status.splice(at, 1); });
        MG.toast(savebar, name + ' removed', { label: 'Undo', run: function () {
          store.set(function (s) { s.status.splice(Math.min(at, s.status.length), 0, id); });
        } });
      },
    };
    function draw(toTop) {
      var sc = scroller(), y = sc.scrollTop;
      var keepToast = savebar && savebar.querySelector('.toast');
      frame.textContent = '';
      c.r = MG.draw(store.state, data);
      var root = el('div', { class: 'mg settings' });
      root.appendChild(dock(c.r, ui.tab, c.go));
      root.appendChild(el('div', { class: 'panel', role: 'tabpanel', 'aria-label': ui.tab }, PANELS[ui.tab](c)));
      savebar = el('div', { class: 'savebar' }, [keepToast,
        el('button', { type: 'button', class: 'save', onclick: function () { MG.toast(savebar, 'Saved'); } }, ['Save'])]);
      root.appendChild(savebar);
      frame.appendChild(root);
      sc.scrollTop = toTop ? 0 : y;
    }
    store.on(c.render);
    draw(true);
    return c;
  }

  global.MGPage = { mount: mount, COLOR_NAMES: COLOR_NAMES, contrast: contrast };
})(typeof window !== 'undefined' ? window : globalThis);
