// Three directions for MonthGrid's settings page, each mounted into a frame
// element that scrolls on its own. Every direction re-renders whole on each
// change: the page is small, and it keeps the code plain.
(function (global) {
  'use strict';
  var MG = global.MG, el = MG.el;

  // Re-rendering empties the frame for a moment; put the scroll back after.
  function keepScroll(frame, fn) {
    var scroller = frame.closest('.phone') || frame;
    var y = scroller.scrollTop;
    fn();
    scroller.scrollTop = y;
  }
  function saveBar(frame) {
    return el('div', { class: 'savebar' }, [el('button', { type: 'button', class: 'save',
      onclick: function () { MG.toast(frame, 'Saved'); } }, ['Save'])]);
  }

  // A: pictures beside the controls. No separate preview: each section opens
  // with that part of the face, and visual choices are drawn, not named.
  function pictures(frame) {
    var store = new MG.Store(MG.defaultState());
    var data = MG.NOW.data;
    var open = null, adding = false;
    function strip(r, region) {
      var rect = MG.pictureRect(r, region);
      var c = MG.crop(r, rect, 1);
      c.classList.add('strip');
      return c;
    }
    function render() {
      keepScroll(frame, function () {
        frame.textContent = '';
        var r = MG.draw(store.state, data);
        var root = el('div', { class: 'mg dir-a' });
        function section(title, region, body) {
          root.appendChild(el('section', { class: 'sec' }, [el('h2', { text: title }),
            region ? strip(r, region) : null].concat(body)));
        }
        section('Colors', null, [MG.lookControls(store, data, 'colors', true)]);
        section('Time', 'time', [MG.lookControls(store, data, 'time', true)]);

        var list = MG.statusList(store, data, function (id) { open = open === id ? null : id; render(); });
        if (open && store.state.status.indexOf(open) >= 0) {
          var row = list.querySelector('[data-id="' + open + '"]');
          row.classList.add('open');
          row.after(el('li', { class: 'inline-opts' }, [MG.optionsPanel(store, open)]));
        }
        section('Status line', 'status', [
          el('p', { class: 'note', text: 'In order of importance. The watch shows as many as fit, and skips any with nothing to show.' }),
          list,
          el('button', { type: 'button', class: 'add', 'aria-expanded': String(adding),
            onclick: function () { adding = !adding; render(); } }, [adding ? 'Done adding' : '+ Add an item']),
          adding ? MG.palette(store, data) : null,
        ]);
        section('Month bar', 'banner', [MG.lookControls(store, data, 'month', true)]);
        section('Calendar', 'grid', [MG.lookControls(store, data, 'calendar', true)]);
        root.appendChild(saveBar(frame));
        frame.appendChild(root);
      });
    }
    store.on(render);
    render();
  }

  // B: tap the face. The face is the menu: tap the time, the status line, the
  // month bar or the days to change that part, in a sheet under the face.
  function tapTheFace(frame) {
    var store = new MG.Store(MG.defaultState());
    var data = MG.NOW.data;
    var part = null, adding = false, openItem = null;
    var PARTS = [
      { id: 'time', label: 'Time', zone: 'time' },
      { id: 'status', label: 'Status line', zone: 'status' },
      { id: 'month', label: 'Month bar', zone: 'banner' },
      { id: 'calendar', label: 'Days', zone: 'grid' },
      { id: 'colors', label: 'Colors' },
    ];
    function sheetBody() {
      if (part === 'status') {
        if (openItem) {
          return [el('button', { type: 'button', class: 'back', onclick: function () { openItem = null; render(); } },
            ['‹ Status line']), el('h3', { text: MG.BY_ID[openItem].name }), MG.optionsPanel(store, openItem)];
        }
        return [MG.statusList(store, data, function (id) { openItem = id; render(); }),
          el('button', { type: 'button', class: 'add', onclick: function () { adding = !adding; render(); } },
            [adding ? 'Done adding' : '+ Add an item']),
          adding ? MG.palette(store, data) : null];
      }
      return [MG.lookControls(store, data, part, false)];
    }
    function render() { keepScroll(frame, renderNow); }
    function renderNow() {
      frame.textContent = '';
      var r = MG.draw(store.state, data);
      var root = el('div', { class: 'mg dir-b' + (part ? ' editing' : '') });
      var scale = part ? 1 : 1.75;
      var face = MG.crop(r, null, scale);
      var stage = el('div', { class: 'stage', style: 'width:' + (r.width * scale) + 'px' }, [face]);
      PARTS.forEach(function (p) {
        if (!p.zone) { return; }
        var z = MG.zone(r.layout, p.zone);
        if (!z) { return; }
        var hit = el('button', { type: 'button', class: 'hit' + (part === p.id ? ' on' : ''),
          'aria-label': 'Change ' + p.label.toLowerCase(),
          style: 'left:' + (z.x / r.width * 100) + '%;top:' + (z.y / r.height * 100) + '%;width:' +
            (z.w / r.width * 100) + '%;height:' + (z.h / r.height * 100) + '%',
          onclick: function () { part = p.id; openItem = null; adding = false; render(); } });
        stage.appendChild(hit);
      });
      root.appendChild(el('div', { class: 'facewrap' }, [stage]));
      if (!part) {
        root.appendChild(el('p', { class: 'hint', text: 'Tap any part of the face to change it.' }));
        root.appendChild(el('div', { class: 'parts' }, PARTS.map(function (p) {
          return el('button', { type: 'button', class: 'part', onclick: function () { part = p.id; render(); } }, [p.label]);
        })));
        root.appendChild(saveBar(frame));
      } else {
        var label = PARTS.filter(function (p) { return p.id === part; })[0].label;
        var body = el('div', { class: 'sheet-body' }, sheetBody());
        root.appendChild(el('div', { class: 'sheet', role: 'dialog', 'aria-label': label }, [
          el('div', { class: 'sheet-head' }, [el('h2', { text: label }),
            el('button', { type: 'button', class: 'done', onclick: function () { part = null; render(); } }, ['Done'])]),
          body]));
      }
      frame.appendChild(root);
    }
    store.on(render);
    render();
  }

  // C: a day on your wrist. The status line is shown at four moments of one
  // day, so rules like "only when low" or "2 hours before" are visible as
  // what appears when.
  function dayOnWrist(frame) {
    var store = new MG.Store(MG.defaultState());
    var sel = 1, open = null, adding = false, lookOpen = false;
    function render() {
      keepScroll(frame, function () {
        frame.textContent = '';
        var root = el('div', { class: 'mg dir-c' });
        var renders = MG.MOMENTS.map(function (m) { return MG.draw(store.state, m.data); });
        // The status line at each moment.
        var film = el('div', { class: 'film', role: 'list', 'aria-label': 'Your status line through the day' });
        MG.MOMENTS.forEach(function (m, i) {
          var r = renders[i];
          var t = MG.zone(r.layout, 'time'), s = MG.zone(r.layout, 'status');
          var bottom = s ? s.y + s.h : t.y + t.h;
          var pic = MG.crop(r, { x: 0, y: Math.max(0, t.y - 2), w: r.width, h: bottom - Math.max(0, t.y - 2) + 2 }, 1);
          var ownLine = r.layout.extra;
          if (ownLine) { pic = MG.crop(r, { x: 0, y: Math.max(0, t.y - 2), w: r.width, h: ownLine.y + ownLine.h - t.y + 4 }, 1); }
          film.appendChild(el('button', { type: 'button', role: 'listitem', class: 'moment' + (i === sel ? ' on' : ''),
            onclick: function () { sel = i; render(); } }, [
            el('span', { class: 'when' }, [el('b', { text: m.time }), ' ' + m.title]), pic]));
        });
        root.appendChild(el('section', { class: 'sec' }, [el('h2', { text: 'Your status line through a day' }), film]));

        // The list, with a mark per moment: drawn, waiting for room, or hidden.
        var plans = renders.map(function (r) { return r.plan.rows; });
        var list = el('ol', { class: 'clist', 'aria-label': 'Status items in priority order' });
        list.appendChild(el('li', { class: 'chead', 'aria-hidden': 'true' }, [el('span', {})].concat(
          MG.MOMENTS.map(function (m) { return el('span', { text: m.time }); }))));
        store.state.status.forEach(function (id, idx) {
          var it = MG.BY_ID[id];
          var marks = plans.map(function (rows, i) {
            var row = rows[idx];
            var cls = row.state === 'shown' ? 'm-on' : row.state === 'room' ? 'm-room' : 'm-off';
            var label = row.state === 'shown' ? 'shown' : row.state === 'room' ? 'waits for room' : 'hidden';
            return el('span', { class: 'mark ' + cls, title: MG.MOMENTS[i].time + ': ' + label,
              'aria-label': MG.MOMENTS[i].time + ': ' + label });
          });
          var li = el('li', { class: 'crow' + (open === id ? ' open' : ''), 'data-id': id }, [
            el('button', { type: 'button', class: 'cname', 'aria-expanded': String(open === id),
              onclick: function () { open = open === id ? null : id; render(); } }, [it.name])].concat(marks));
          list.appendChild(li);
          if (open === id) {
            list.appendChild(el('li', { class: 'inline-opts' }, [MG.optionsPanel(store, id),
              el('div', { class: 'row-actions' }, [
                el('button', { type: 'button', disabled: idx === 0, onclick: function () {
                  store.set(function (s) { s.status.splice(idx, 1); s.status.splice(idx - 1, 0, id); }); } }, ['Move up']),
                el('button', { type: 'button', disabled: idx === store.state.status.length - 1, onclick: function () {
                  store.set(function (s) { s.status.splice(idx, 1); s.status.splice(idx + 1, 0, id); }); } }, ['Move down']),
                el('button', { type: 'button', onclick: function () {
                  open = null; store.set(function (s) { s.status.splice(idx, 1); }); } }, ['Remove'])])]));
          }
        });
        root.appendChild(el('section', { class: 'sec' }, [
          el('h2', { text: 'What shows when' }),
          el('p', { class: 'legend' }, [el('span', { class: 'mark m-on' }), ' On the watch ',
            el('span', { class: 'mark m-room' }), ' Waits for room ', el('span', { class: 'mark m-off' }), ' Hidden']),
          list,
          el('button', { type: 'button', class: 'add', onclick: function () { adding = !adding; render(); } },
            [adding ? 'Done adding' : '+ Add an item']),
          adding ? MG.palette(store, MG.NOW.data) : null]));

        // The rest of the face, plainly.
        var face = MG.crop(renders[sel], null, 1);
        root.appendChild(el('section', { class: 'sec' }, [
          el('button', { type: 'button', class: 'disclose', 'aria-expanded': String(lookOpen),
            onclick: function () { lookOpen = !lookOpen; render(); } }, [el('h2', { text: 'Time, month and colors' }),
            el('span', { text: lookOpen ? 'Hide' : 'Show' })]),
          lookOpen ? el('div', { class: 'look' }, [el('div', { class: 'lookface' }, [face]),
            el('div', { class: 'lookctl' }, ['colors', 'time', 'month', 'calendar'].map(function (k) {
              return MG.lookControls(store, MG.MOMENTS[sel].data, k, false); }))]) : null]));
        root.appendChild(saveBar(frame));
        frame.appendChild(root);
      });
    }
    store.on(render);
    render();
  }

  global.MGDirections = { pictures: pictures, tapTheFace: tapTheFace, dayOnWrist: dayOnWrist };
})(typeof window !== 'undefined' ? window : globalThis);
