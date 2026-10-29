// MonthGrid's settings page: the face docked at the top, a tab for each
// part under it, and that part's controls below. Tapping a part of the face
// opens its tab. Plain script; needs monthgrid-face.js, model.js, bar.js,
// core.js and event.js. MGPage.mount(frame, {state, ctx}) builds it into frame.
//
// ctx says what this watch and phone can do (see defaultCtx); the phone
// fills it in, and without it the page shows everything (for development).
(function (global) {
  'use strict';
  var MG = global.MG, Model = global.MGModel, el = MG.el, Face = global.MonthGridFace;

  var TABS = [
    { id: 'time', label: 'Time' }, { id: 'status', label: 'Status' }, { id: 'event', label: 'Event' },
    { id: 'month', label: 'Month' }, { id: 'days', label: 'Days' }, { id: 'colors', label: 'Colors' },
  ];
  var CUSTOM = 10;   // THEME value for your own colors

  function defaultCtx() {
    return { platform: 'emery', color: true, shape: 'rect', health: true, hrm: true, alarms: true,
      served: { event: true, phone: true }, units: null,
      readings: [{ n: 1, label: 'AAPL', what: 'AAPL price', text: '$232.14' }], calendarSync: [], returnTo: null };
  }

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
    chev: '<svg class="chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    updown: '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 6l3-3 3 3M2 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function icon(name, cls) { return el('span', { class: 'ico ' + (cls || ''), html: ICON[name] }); }

  // ---- Controls ------------------------------------------------------------
  // A segmented control: one track, equal parts, never wraps.
  function seg(choices, cur, onPick, label) {
    return el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label,
      style: 'grid-template-columns:repeat(' + choices.length + ',minmax(0,1fr))' }, choices.map(function (c) {
      return el('button', { type: 'button', role: 'radio', 'aria-checked': String(c[0] === cur),
        onclick: function () { if (c[0] !== cur) { onPick(c[0]); } } }, [c[1]]);
    }));
  }
  // A row of a group: label on the left, control on the right.
  function row(label, control, sub, cls) {
    return el('div', { class: 'row ' + (cls || '') }, [
      el('span', { class: 'label' }, [el('span', { class: 'name', text: label }),
        sub ? el('span', { class: 'why', text: sub }) : null]), control]);
  }
  // A pop-up menu: the value and ⌃⌄ on the right; the whole row opens the
  // phone's own menu.
  function menu(label, choices, cur, onPick) {
    var sel = el('select', { 'aria-label': label, onchange: function () { onPick(choices[sel.selectedIndex][0]); } },
      choices.map(function (c) { return el('option', { text: c[1] }); }));
    choices.forEach(function (c, i) { if (c[0] === cur) { sel.selectedIndex = i; } });
    var shown = choices.filter(function (c) { return c[0] === cur; })[0];
    var r = row(label, el('span', { class: 'menuval' }, [el('span', { text: shown ? shown[1] : '' }), icon('updown')]),
      null, 'menu');
    r.appendChild(sel);
    return r;
  }
  // An on/off switch row.
  function toggle(label, on, onFlip, sub) {
    var box = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label,
      onchange: function () { onFlip(box.checked); } });
    box.checked = !!on;
    return row(label, el('span', { class: 'switch' }, [box, el('span', { class: 'knob', 'aria-hidden': 'true' })]),
      sub, 'toggle');
  }
  // A segmented control with its label above, as one row.
  function segRow(label, choices, cur, onPick) {
    return el('div', { class: 'row segrow' }, [el('span', { class: 'flabel', text: label }), seg(choices, cur, onPick, label)]);
  }
  function group(rows, title, note) {
    return el('section', { class: 'group' + (title ? '' : ' untitled') }, [
      title ? el('h3', { class: 'ghead', text: title }) : null,
      el('div', { class: 'card' }, rows.filter(Boolean)),
      note ? el('p', { class: 'note' + (note.warn ? ' warn' : ''), text: note.text || note }) : null]);
  }
  // Choices drawn as the part of the face they change.
  function pictures(choices, cur, onPick, label, cols, picture) {
    return el('div', { class: 'pics cols' + cols, role: 'radiogroup', 'aria-label': label }, choices.map(function (c) {
      return el('button', { type: 'button', role: 'radio', class: 'pic', 'aria-checked': String(c[0] === cur),
        onclick: function () { onPick(c[0]); } }, [picture(c[0]), el('span', { text: c[1] })]);
    }));
  }
  function field(label, control) {
    return el('section', { class: 'group' }, [el('h3', { class: 'ghead', text: label }), control]);
  }

  // ---- Bits shared by every tab --------------------------------------------
  function clone(state) { return JSON.parse(JSON.stringify(state)); }
  function union(a, b) {
    if (!a) { return b; }
    if (!b) { return a; }
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  // Where the next event is on a render, if it's showing.
  function eventRect(r) {
    var L = r.layout, d = r.drawn[MG.M.EVENT];
    if (r.barEvent && L.banner) { return { x: r.barEvent.x - 3, y: L.banner.y, w: r.barEvent.w + 6, h: L.banner.h }; }
    if (L.extra && r.plan.event && r.plan.event.shown) { return L.extra; }
    if (d && L.status) { return { x: d.x - 2, y: L.status.y, w: d.w + 4, h: L.status.h }; }
    return null;
  }
  // What the watch can do with an option or item (needs in model.js).
  function can(c, needs) { return Model.canShow(needs, c.ctx); }
  function reading(c, n) { return c.ctx.readings.filter(function (r) { return r.n === n; })[0] || null; }
  function itemName(c, id) {
    var it = Model.BY_ID[id];
    if (it.reading) { var r = reading(c, it.reading); return r ? r.what || r.label : it.name; }
    return it.name;
  }
  function optionsOf(c, id) {
    return (Model.BY_ID[id].options || []).filter(function (o) { return can(c, o.needs); });
  }
  // An item's choices in a few words, for its row: "Now, high, and low · °F".
  function summary(c, id) {
    var st = c.store.state;
    if (id === 'event') {
      return Model.eventWhen(st.event) + (st.event.style === 'short' ? ' · time only' : '');
    }
    var parts = [];
    var opts = optionsOf(c, id);
    opts.forEach(function (o) {
      var v = Model.value(st, id, o.key);
      // A switch that's off says so only when it's all there is to say.
      if (o.kind === 'switch' && v === o.choices[0][0] && opts.length > 1) { return; }
      parts.push(MG.choiceText(o, v));
    });
    return parts.map(function (p, i) { return i ? p.charAt(0).toLowerCase() + p.slice(1) : p; }).join(' · ');
  }
  // The state as this watch shows it: a black-and-white watch has two themes
  // and draws markers and borders in its text color.
  function view(c, state) {
    if (c.ctx.color) { return state; }
    var s = clone(state), paper = s.look.THEME === 1 || s.look.THEME === 9;
    s.look.THEME = paper ? 1 : 0;
    ['GRID_COLOR', 'CAL1_COLOR', 'CAL2_COLOR', 'CAL3_COLOR'].forEach(function (k) { s.look[k] = paper ? 0 : 63; });
    return s;
  }
  function render(c, state, data, ctx) { return MG.draw(view(c, state), data || c.data, ctx || c.ctx); }

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
        var r = render(c, s);
        return MG.crop(r, MG.region(r, 'time', 2), 1);
      })),
      group([
        segRow('Size', [[0, 'Large'], [1, 'Medium'], [2, 'Small']], look.TIME_SIZE, c.setLook('TIME_SIZE')),
        segRow('Hours', [[0, 'Auto'], [1, '12-hour'], [2, '24-hour']], look.TIME_FORMAT, c.setLook('TIME_FORMAT')),
        toggle('Show seconds', look.SHOW_SECONDS, c.setLook('SHOW_SECONDS')),
      ], null, look.SHOW_SECONDS ? 'Showing seconds uses noticeably more battery.' : null),
    ];
  }

  // ---- Status ----------------------------------------------------------------
  // Two lists: what's on the watch, most important first, and everything
  // else. The minus moves an item down, the plus moves it up; nothing is
  // lost either way, and Undo puts a removed item back where it was.
  // Why a chosen item can't show, when it isn't the watch's doing.
  var MISSING = { event: 'Needs the Pebble app’s calendar', phoneBattery: 'Needs a newer Pebble app' };
  function statusTab(c) {
    var store = c.store, ui = c.ui, rows = c.r.plan.rows;
    var lastShown = -1, anyRoom = rows.some(function (r) { return r.state === 'room'; });
    rows.forEach(function (r, i) { if (r.state === 'shown') { lastShown = i; } });
    var list = el('ol', { class: 'slist', 'aria-label': 'On your watch, most important first' });
    rows.forEach(function (r, i) {
      var id = r.id, name = itemName(c, id), open = ui.open === id;
      // Chosen on another watch, or the phone can't serve it now.
      var missing = !can(c, Model.BY_ID[id].needs);
      if (missing) { r.state = 'hidden'; }
      var hasOptions = !missing && (id === 'event' || optionsOf(c, id).length > 0);
      var line2 = missing ? MISSING[id] || 'Not on this watch'
        : hasOptions ? summary(c, id)
        : r.state === 'room' ? 'Waits for room on the watch' : r.state === 'hidden' ? r.why : '';
      var pic = MG.chip(view(c, store.state), id, c.data, c.ctx, 104);
      if (pic) { pic.classList.add('chip'); }
      var body = [el('span', { class: 'label' }, [el('span', { class: 'name', text: name }),
        line2 ? el('span', { class: 'why', text: line2 }) : null]), pic, hasOptions ? icon('chev', 'chevwrap') : null];
      var li = el('li', { class: 'srow' + (r.state === 'shown' ? '' : ' off') + (open ? ' open' : '') +
          (ui.flash === id ? ' flash' : ''), 'data-id': id }, [
        el('button', { type: 'button', class: 'minus', 'aria-label': 'Remove ' + name,
          onclick: function () { c.remove(id); } }, [icon('minus')]),
        hasOptions
          ? el('button', { type: 'button', class: 'main', 'aria-expanded': String(open),
            onclick: function () { ui.open = open ? null : id; c.render(); } }, body)
          : el('div', { class: 'main' }, body),
        el('button', { type: 'button', class: 'handle', 'aria-label': 'Move ' + name }, [icon('grip')]),
      ]);
      dragToReorder(li, list, store);
      list.appendChild(li);
      if (open) { list.appendChild(el('li', { class: 'opts' }, [itemOptions(c, id)])); }
      if (anyRoom && i === lastShown) {
        list.appendChild(el('li', { class: 'fold', 'aria-hidden': 'true', text: 'Room on the watch ends here' }));
      }
    });
    if (!rows.length) { list.appendChild(el('li', { class: 'empty', text: 'Nothing on the watch yet. Add items below.' })); }

    var more = el('ul', { class: 'mlist', 'aria-label': 'More items' });
    function addRow(id, name, sub) {
      var pic = MG.chip(view(c, store.state), id, c.data, c.ctx, 104);
      if (pic) { pic.classList.add('chip'); }
      more.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mrow', 'aria-label': 'Add ' + name,
        onclick: function () { c.add(id); } }, [icon('plus', 'plus'),
        el('span', { class: 'label' }, [el('span', { class: 'name', text: name }),
          sub ? el('span', { class: 'why', text: sub }) : null]), pic])]));
    }
    var st = store.state, E = st.event;
    if (E.place !== 'line' && can(c, 'event')) { addRow('event', 'Next event', ELSEWHERE[E.place]); }
    Model.ITEMS.forEach(function (it) {
      if (it.reading || st.status.indexOf(it.id) >= 0 || !can(c, it.needs)) { return; }
      addRow(it.id, it.name);
    });
    var readings = c.ctx.readings.filter(function (r) { return st.status.indexOf('reading' + r.n) < 0; });
    more.appendChild(el('li', { class: 'mgroup', text: 'From other apps' }));
    readings.forEach(function (r) { addRow('reading' + r.n, r.what || r.label); });
    more.appendChild(el('li', { class: 'mnote', text: 'Readings from other apps are picked in the Pebble app, under Complications.' }));

    return [
      el('div', { class: 'listhead' }, [el('h3', { text: 'On your watch' }), el('span', { text: 'Most important first' })]),
      list,
      el('div', { class: 'listhead' }, [el('h3', { text: 'More items' })]),
      more,
    ];
  }
  // An item's options, in place under its row.
  function itemOptions(c, id) {
    if (id === 'event') { return eventControls(c); }
    var st = c.store.state, note = null;
    var rows = optionsOf(c, id).map(function (o) {
      var v = Model.value(st, id, o.key), pick = function (x) { c.store.setOpt(id, o.key, x); };
      if (o.note && o.note(st)) { note = o.note(st); }
      if (o.kind === 'switch') {
        return toggle(o.label, v === o.choices[1][0], function (on) { pick(o.choices[on ? 1 : 0][0]); });
      }
      if (o.kind === 'menu') { return menu(o.label, o.choices, v, pick); }
      return segRow(o.label, o.choices, v, pick);
    });
    return group(rows, null, note);
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
  var PLACE_LABELS = { off: 'Off', bar: 'In the month bar', own: 'On its own line', line: 'In the status line',
    take: 'Takes over the status line' };
  function placeLabel(p) { return PLACE_LABELS[p]; }
  // Where the event is when it isn't in the status line, for its More row.
  var ELSEWHERE = { off: null, bar: 'Shows in the month bar', own: 'Shows on its own line',
    take: 'Takes over the status line' };
  // The places this watch has: Pebble Time Round has no month bar, a round
  // watch has no line under the status line, and the original Pebble has
  // room for neither (src/c/common.h, EVENT_IN_BAR and EVENT_OWN_LINE).
  function places(c) {
    var x = c.ctx;
    return Model.PLACES.filter(function (p) {
      if (p === 'bar') { return x.platform !== 'aplite' && (x.shape !== 'round' || x.platform === 'gabbro'); }
      if (p === 'own') { return x.platform !== 'aplite' && x.shape !== 'round'; }
      return true;
    });
  }
  // When the event shows: ahead of time (a slider of lead times) or any
  // time today; and, in the status line, its name or just its time.
  function eventControls(c) {
    var E = c.store.state.event, rows = [];
    rows.push(segRow('Show it', [[false, 'Before it starts'], [true, 'Any time today']], E.today, c.setEvent('today')));
    if (!E.today) { rows.push(leadSlider(c)); }
    if (E.place === 'line') {
      rows.push(segRow('Show', [['full', 'Name and time'], ['short', 'Time only']], E.style, c.setEvent('style')));
    }
    return group(rows);
  }
  function leadSlider(c) {
    var E = c.store.state.event, stops = Model.LEAD_STOPS, at = Math.max(0, stops.indexOf(E.minutes));
    var out = el('output', { class: 'leadval', text: Model.leadLabel(stops[at]) + ' before' });
    var input = el('input', { type: 'range', min: '0', max: String(stops.length - 1), step: '1', value: String(at),
      'aria-label': 'How long before it starts', 'aria-valuetext': Model.leadLabel(stops[at]) + ' before',
      oninput: function () {
        var t = Model.leadLabel(stops[input.value]) + ' before';
        out.textContent = t;
        input.setAttribute('aria-valuetext', t);
        input.style.setProperty('--fill', (input.value / (stops.length - 1) * 100) + '%');
      },
      onchange: function () { c.setEvent('minutes')(stops[input.value]); } });
    input.style.setProperty('--fill', (at / (stops.length - 1) * 100) + '%');
    return el('div', { class: 'row sliderrow' }, [out, input,
      el('div', { class: 'scale', 'aria-hidden': 'true' }, [el('span', { text: '15 min' }), el('span', { text: '24 hours' })])]);
  }
  function eventTab(c) {
    var E = c.store.state.event, out = [];
    if (!c.ctx.served.event) {
      out.push(el('div', { class: 'callout' }, [el('h3', { text: 'Your calendar isn’t available' }),
        el('p', { text: 'Turn on plugins in the Pebble app’s settings to show your next event.' })]));
    }
    var soon = MG.whenShown('event', c.store.state, c.data);
    // The pictures show a sample event even before the calendar can be read.
    var sample = MG.merge(c.ctx, { served: { event: true, phone: c.ctx.served.phone } });
    out.push(field('Where', pictures(places(c).map(function (p) { return [p, placeLabel(p)]; }), E.place,
      c.setPlace, 'Where', 2, function (v) {
        var s = clone(c.store.state);
        s.event.place = v;
        s = Model.normalize(s);
        var r = render(c, s, soon, sample), L = r.layout;
        var low = L.banner || L.extra || L.status, y0 = Math.max(0, L.time.y - 3);
        return MG.crop(r, { x: 0, y: y0, w: r.width, h: Math.min(r.height, low.y + low.h + 3) - y0 }, 1);
      })));
    if (E.place === 'take') {
      out.push(el('p', { class: 'note', text: 'In the ' + Model.TAKE_MIN + ' minutes before it starts, the event is all the status line shows.' }));
    } else if (E.place !== 'off') {
      out.push(eventControls(c));
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
        var r = render(c, s, calm), b = MG.region(r, 'banner', 2);
        if (narrow) { b = { x: b.x + 45, y: b.y, w: b.w - 90, h: b.h }; }
        return MG.crop(r, b, 1);
      };
    }
    var out = [];
    if (E.place === 'bar') {
      out.push(el('button', { type: 'button', class: 'xlink', onclick: function () { c.go('event'); } }, [
        el('span', { class: 'label' }, [el('span', { class: 'name', text: 'Your next event shows here' }),
          el('span', { class: 'why', text: Model.eventWhen(E) })]), icon('chev', 'chevwrap')]));
    }
    // Pebble Time Round spells the month down its side instead.
    if (c.ctx.platform !== 'chalk') {
      out.push(field('Shows', pictures(SHOWS, look.BANNER_CONTENT, c.setLook('BANNER_CONTENT'), 'Shows', 2, bar('BANNER_CONTENT'))));
    }
    out.push(field('Style', pictures(STYLES, look.BANNER_STYLE, c.setLook('BANNER_STYLE'), 'Style', 3, bar('BANNER_STYLE', true))));
    return out;
  }

  // ---- Days --------------------------------------------------------------------
  function daysTab(c) {
    var look = c.store.state.look, out = [];
    out.push(group([
      segRow('Weeks start on', [[0, 'Sunday'], [1, 'Monday'], [2, 'Saturday']], look.START_DAY, c.setLook('START_DAY')),
      c.ctx.platform !== 'chalk'
        ? segRow('Weekday letters', [[0, 'Two'], [1, 'One']], look.HEADER_LABEL, c.setLook('HEADER_LABEL')) : null,
      toggle('Days from last and next month', look.SHOW_ADJACENT, c.setLook('SHOW_ADJACENT')),
      toggle('Borders', look.GRID_LINES, c.setLook('GRID_LINES')),
      look.GRID_LINES && c.ctx.color ? colorRow(c, 'Border color', 'GRID_COLOR') : null,
    ]));
    if (look.GRID_LINES && c.ctx.color && c.ui.color === 'GRID_COLOR') { out.push(palette(c, 'GRID_COLOR')); }
    out.push(group([
      toggle('Event markers', look.DOTS_ENABLED, c.setLook('DOTS_ENABLED'), look.DOTS_ENABLED ? null
        : 'Marks the days that have events, from calendar links.'),
      look.DOTS_ENABLED ? segRow('Marker style', [[0, 'Underline'], [1, 'Squares']], look.DOTS_STYLE, c.setLook('DOTS_STYLE')) : null,
    ]));
    if (look.DOTS_ENABLED) { out.push(calendars(c)); }
    return out;
  }
  function calendars(c) {
    var look = c.store.state.look, rows = [];
    [0, 1, 2].forEach(function (i) {
      var key = 'CAL' + (i + 1) + '_COLOR', open = c.ui.color === key;
      var input = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off',
        spellcheck: 'false', placeholder: 'Calendar link (.ics)', value: c.store.state.calendars[i],
        'aria-label': 'Calendar ' + (i + 1) + ' link',
        oninput: function () { c.store.state.calendars[i] = input.value.trim(); } });
      rows.push(el('div', { class: 'row cal' }, [c.ctx.color
        ? el('button', { type: 'button', class: 'swatchbtn', 'aria-expanded': String(open),
          'aria-label': 'Calendar ' + (i + 1) + ' color: ' + COLOR_NAMES[look[key]],
          onclick: function () { c.ui.color = open ? null : key; c.render(); } }, [swatch(look[key])])
        : el('span', { class: 'calnum', text: String(i + 1) }), input]));
      if (open) { rows.push(el('div', { class: 'row palrow' }, [palette(c, key)])); }
    });
    return group(rows, 'Calendars', syncNote(c));
  }
  // How the last calendar refresh went, when there's something to say.
  function syncNote(c) {
    var entries = c.ctx.calendarSync || [];
    var bad = entries.filter(function (e) { return !e.ok; });
    if (bad.length) {
      return { warn: true, text: bad.map(function (e) { return 'Calendar ' + e.cal + ' didn’t refresh (' + e.detail + ').'; })
        .join(' ') + ' Check that the link is the calendar’s full iCal address. The watch shows a “!” until it refreshes.' };
    }
    return 'Paste a calendar’s secret iCal address. Links stay on your phone.';
  }

  // ---- Colors ------------------------------------------------------------------
  function swatch(v) {
    return el('span', { class: 'swatch', style: 'background:' + Face.colorToCSS(v) });
  }
  // Pebble's 64 colors as a wheel: hues around the edge, grays in the
  // middle, lighter toward the outside.
  var WHEEL = (function () {
    var rows = [
      '- - 55ff00 aaff55 - ffff55 ffffaa - -',
      '- aaffaa 55ff55 00ff00 aaff00 ffff00 ffaa55 ffaaaa -',
      '55ffaa 00ff55 00aa00 55aa00 aaaa55 aaaa00 ffaa00 ff5500 ff5555',
      'aaffff 00ffaa 00aa55 55aa55 005500 555500 aa5500 ff0000 ff0055',
      '- 55aaaa 00aaaa 005555 ffffff 000000 aa5555 aa0000 -',
      '55ffff 00ffff 00aaff 0055aa aaaaaa 555555 550000 aa0055 ff55aa',
      '55aaff 0055ff 0000ff 0000aa 000055 550055 aa00aa ff00aa ffaaff',
      '- 5555aa 5555ff 5500ff 5500aa aa00ff ff00ff ff55ff -',
      '- - - aaaaff aa55ff aa55aa - - -',
    ];
    return rows.map(function (r) {
      return r.split(' ').map(function (h) { return h === '-' ? null : Model.fromHex(h); });
    });
  })();
  function palette(c, key) {
    var cur = c.store.state.look[key], pick = c.setLook(key);
    var wheel = el('div', { class: 'palette', role: 'radiogroup', 'aria-label': 'Colors' });
    WHEEL.forEach(function (r) {
      r.forEach(function (v) {
        if (v === null) { wheel.appendChild(el('span', { class: 'pgap' })); return; }
        wheel.appendChild(el('button', { type: 'button', role: 'radio', class: 'pcolor', 'aria-checked': String(v === cur),
          'aria-label': COLOR_NAMES[v], title: COLOR_NAMES[v], style: 'background:' + Face.colorToCSS(v),
          onclick: function () { pick(v); } }));
      });
    });
    return wheel;
  }
  function colorRow(c, label, key, warn) {
    var v = c.store.state.look[key], open = c.ui.color === key;
    return el('button', { type: 'button', class: 'row crow', 'aria-expanded': String(open),
      onclick: function () { c.ui.color = open ? null : key; c.render(); } }, [
      el('span', { class: 'label' }, [el('span', { class: 'name', text: label }),
        el('span', { class: 'why' + (warn ? ' warn' : ''), text: warn || COLOR_NAMES[v] })]), swatch(v), icon('chev', 'chevwrap')]);
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
    var themes = c.ctx.color ? Face.THEME_NAMES.map(function (n, i) { return i; }) : [0, 1];
    var cur = c.ctx.color ? look.THEME : (look.THEME === 1 || look.THEME === 9 ? 1 : 0);
    var grid = el('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Colors' });
    themes.forEach(function (i) {
      var s = clone(c.store.state);
      s.look.THEME = i;
      var pic = MG.crop(render(c, s, calm), null, 1);
      pic.classList.add('mini');
      grid.appendChild(el('button', { type: 'button', role: 'radio', class: 'theme', 'aria-checked': String(cur === i),
        onclick: function () { c.setLook('THEME')(i); } }, [pic, el('span', { text: i === CUSTOM ? 'Your colors' : Face.THEME_NAMES[i] })]));
    });
    var out = [grid];
    if (c.ctx.color && look.THEME === CUSTOM) {
      var rows = [];
      [['Background', 'CUSTOM_BG', null],
        ['Text', 'CUSTOM_FG', contrast(look.CUSTOM_FG, look.CUSTOM_BG) < 3 ? 'Hard to read on this background' : null],
        ['Accent', 'CUSTOM_ACCENT', contrast(look.CUSTOM_ACCENT, look.CUSTOM_BG) < 1.6 ? 'Hard to see on this background' : null],
      ].forEach(function (f) {
        rows.push(colorRow(c, f[0], f[1], f[2]));
        if (c.ui.color === f[1]) { rows.push(el('div', { class: 'row palrow' }, [palette(c, f[1])])); }
      });
      out.push(group(rows, 'Your colors'));
    }
    return out;
  }

  // ---- The page ------------------------------------------------------------------
  var PANELS = { time: timeTab, status: statusTab, event: eventTab, month: monthTab, days: daysTab, colors: colorsTab };

  function mount(frame, opts) {
    opts = opts || {};
    var ctx = MG.merge(defaultCtx(), opts.ctx || {});
    var state = Model.normalize(opts.state || Model.defaultState());
    // Where the watch has no room for the event where it's set, it shows
    // first in the status line: say so here.
    if (places({ ctx: ctx }).indexOf(state.event.place) < 0) {
      state.event.place = 'line';
      state.status.unshift('event');
    }
    var store = new MG.Store(state);
    var data = MG.merge(MG.BASE, { readings: [1, 2, 3, 4, 5].map(function (n) {
      var r = ctx.readings.filter(function (x) { return x.n === n; })[0];
      return r ? { label: r.label, text: r.text } : null;
    }) });
    var ui = { tab: opts.tab || 'time', open: null, color: null, flash: null };
    var savebar;
    function scroller() { return frame.closest('.phone') || frame; }
    var c = {
      store: store, data: data, ui: ui, ctx: ctx,
      setLook: function (key) { return function (v) { store.set(function (s) { s.look[key] = v; }); }; },
      setEvent: function (key) { return function (v) { store.set(function (s) { s.event[key] = v; }); }; },
      // Moving the event into or out of the status line adds or removes its row.
      setPlace: function (v) {
        store.set(function (s) {
          s.event.place = v;
          var at = s.status.indexOf('event');
          if (v === 'line' && at < 0) { s.status.unshift('event'); }
          if (v !== 'line' && at >= 0) { s.status.splice(at, 1); }
        });
      },
      go: function (tab) { ui.tab = tab; ui.open = null; ui.color = null; draw(true); },
      render: function () { draw(false); },
      add: function (id) {
        ui.flash = id;
        store.set(function (s) {
          if (id === 'event') { s.event.place = 'line'; }
          s.status.push(id);
        });
        ui.flash = null;
      },
      remove: function (id) {
        var at = store.state.status.indexOf(id), name = itemName(c, id), place = store.state.event.place;
        if (ui.open === id) { ui.open = null; }
        store.set(function (s) {
          s.status.splice(at, 1);
          if (id === 'event') { s.event.place = 'off'; }
        });
        MG.toast(savebar, name + ' removed', { label: 'Undo', run: function () {
          store.set(function (s) {
            s.status.splice(Math.min(at, s.status.length), 0, id);
            if (id === 'event') { s.event.place = place; }
          });
        } });
      },
      save: function () {
        var json = JSON.stringify(store.state);
        if (ctx.returnTo) { location.href = ctx.returnTo + encodeURIComponent(json); return; }
        MG.toast(savebar, 'Saved');
      },
    };
    function draw(toTop) {
      var sc = scroller(), y = sc.scrollTop;
      var keepToast = savebar && savebar.querySelector('.toast');
      frame.textContent = '';
      c.r = render(c, store.state);
      var root = el('div', { class: 'mg settings' });
      root.appendChild(dock(c.r, ui.tab, c.go));
      root.appendChild(el('div', { class: 'panel', role: 'tabpanel', 'aria-label': ui.tab }, PANELS[ui.tab](c)));
      savebar = el('div', { class: 'savebar' }, [keepToast,
        el('button', { type: 'button', class: 'save', onclick: c.save }, ['Save'])]);
      root.appendChild(savebar);
      frame.appendChild(root);
      sc.scrollTop = toTop ? 0 : y;
    }
    store.on(c.render);
    draw(true);
    return c;
  }

  global.MGPage = { mount: mount, COLOR_NAMES: COLOR_NAMES, contrast: contrast, defaultCtx: defaultCtx };
})(typeof window !== 'undefined' ? window : globalThis);
