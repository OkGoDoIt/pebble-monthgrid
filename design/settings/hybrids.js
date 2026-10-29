// Round two: three ways to put pictures beside the controls (A) together
// with tapping the face (B). They share the parts, their summaries and their
// controls, and differ only in how you move between parts:
//   faceList  the face over a short list of parts; each part opens a page
//   folded    one page; the face over folded parts, one open at a time
//   docked    the face stays put with labeled tabs under it
(function (global) {
  'use strict';
  var MG = global.MG, el = MG.el;

  var PARTS = [
    { id: 'time', label: 'Time' },
    { id: 'status', label: 'Status line' },
    { id: 'month', label: 'Month bar' },
    { id: 'calendar', label: 'Days' },
    { id: 'colors', label: 'Colors' },
  ];
  // Controls whose choices are drawn; the rest are words.
  var PICTURED = ['THEME', 'TIME_FONT', 'TIME_SIZE', 'BANNER_STYLE', 'BANNER_CONTENT', 'DOTS_STYLE'];
  var CHEVRON = '<svg class="chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var BACK = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function chevron() { var s = el('span', { class: 'chevwrap' }); s.innerHTML = CHEVRON; return s; }
  function scrollerOf(frame) { return frame.closest('.phone') || frame; }
  function saveBar(frame) {
    return el('div', { class: 'savebar' }, [el('button', { type: 'button', class: 'save',
      onclick: function () { MG.toast(frame, 'Saved'); } }, ['Save'])]);
  }

  // ---- What each part is set to, in a few words ----------------------------
  function label(key, v) {
    for (var part in MG.CONTROLS) {
      var c = MG.CONTROLS[part].filter(function (x) { return x.key === key; })[0];
      if (c) { return c.choices.filter(function (ch) { return ch[0] === v; })[0][1]; }
    }
    return '';
  }
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function oxford(xs) {
    return xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ', and ' + xs[xs.length - 1];
  }
  function partSummary(state, id) {
    var L = state.look;
    switch (id) {
      case 'time': return [label('TIME_FONT', L.TIME_FONT), lower(label('TIME_SIZE', L.TIME_SIZE)),
        L.TIME_FORMAT ? label('TIME_FORMAT', L.TIME_FORMAT) : null, L.SHOW_SECONDS ? 'seconds' : null]
        .filter(Boolean).join(' · ');
      case 'status': {
        var names = state.status.map(function (x) { return MG.BY_ID[x].name; });
        if (!names.length) { return 'Nothing yet'; }
        return names.length > 3 ? names.slice(0, 3).join(', ') + ', and ' + (names.length - 3) + ' more' : oxford(names);
      }
      case 'month': {
        var ev = state.status.indexOf('event') >= 0 && MG.optValue(state, 'event', 'place') === 'bar';
        return label('BANNER_CONTENT', L.BANNER_CONTENT) + ' · ' + lower(label('BANNER_STYLE', L.BANNER_STYLE)) +
          (ev ? ' · next event' : '');
      }
      case 'calendar': return 'Weeks start on ' + label('START_DAY', L.START_DAY) + ' · ' +
        (L.DOTS_ENABLED ? 'event markers' : 'no event markers');
      case 'colors': return label('THEME', L.THEME);
    }
    return '';
  }

  // ---- Pictures of the parts ----------------------------------------------
  function union(a, b) {
    if (!a) { return b; }
    if (!b) { return a; }
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  function partRect(r, id, big) {
    var L = r.layout;
    switch (id) {
      case 'time': return MG.region(r, 'time', 2);
      case 'status': {
        var z = union(L.status, L.extra);
        return z && (big ? z : MG.trim(r, z, 3));
      }
      case 'month': return L.banner ? (big ? union(L.banner, L.header) : L.banner) : L.header;
      case 'calendar': {
        var g = L.grid, top = L.header || g;
        return { x: 0, y: top.y, w: r.width, h: (g.y - top.y) + L.rowPitch * (big ? 3 : 2) };
      }
      case 'colors': return MG.pictureRect(r, 'top');
    }
    return null;
  }
  // A part drawn at most maxW CSS px wide.
  function partPicture(r, id, maxW, big) {
    var rect = partRect(r, id, big);
    if (!rect) { return el('span', { class: 'thumb empty' }); }
    var c = MG.crop(r, rect, Math.min(big ? 2 : 1, maxW / rect.w));
    c.classList.add('thumb');
    return c;
  }
  function swatches(r) {
    var th = r.layout.theme, Face = global.MonthGridFace;
    return el('span', { class: 'swatches', 'aria-hidden': 'true' }, [th.bg, th.fg, th.accent].map(function (c) {
      return el('span', { style: 'background:' + Face.colorToCSS(c) });
    }));
  }

  // The face, with every part it shows a button. go(part, item) opens it.
  function faceStage(r, scale, go, selected) {
    var L = r.layout;
    var stage = el('div', { class: 'stage', style: 'width:' + Math.round(r.width * scale) + 'px' },
      [MG.crop(r, null, scale)]);
    var bar = r.barEvent && L.banner
      ? { x: r.barEvent.x - 4, y: L.banner.y, w: r.barEvent.w + 8, h: L.banner.h } : null;
    [
      { part: 'time', label: 'the time', rect: L.time },
      { part: 'status', label: 'the status line', rect: L.status },
      { part: 'status', item: 'event', label: 'the next event', rect: L.extra },
      { part: 'month', label: 'the month bar', rect: L.banner },
      { part: 'status', item: 'event', label: 'the next event', rect: bar },
      { part: 'calendar', label: 'the days', rect: union(L.header, L.grid) },
    ].forEach(function (h) {
      if (!h.rect) { return; }
      var on = selected === h.part && !h.item;
      stage.appendChild(el('button', { type: 'button', class: 'hit' + (on ? ' on' : ''), 'aria-label': 'Change ' + h.label,
        style: 'left:' + (h.rect.x / r.width * 100) + '%;top:' + (h.rect.y / r.height * 100) + '%;width:' +
          (h.rect.w / r.width * 100) + '%;height:' + (h.rect.h / r.height * 100) + '%',
        onclick: function () { go(h.part, h.item); } }));
    });
    return stage;
  }

  // ---- A part's controls ---------------------------------------------------
  // ui = {part, item, adding}; go(part, item) moves; render() redraws in place.
  function partBody(store, data, ui, go, render) {
    if (ui.part === 'status') {
      var list = MG.statusList(store, data, function (id) { ui.item = ui.item === id ? null : id; render(); },
        { open: ui.item, picW: 110 });
      return [list,
        el('button', { type: 'button', class: 'add', 'aria-expanded': String(ui.adding),
          onclick: function () { ui.adding = !ui.adding; render(); } }, [ui.adding ? 'Done adding' : '+ Add an item']),
        ui.adding ? MG.palette(store, data, function (id) { ui.adding = false; ui.item = id; render(); }) : null];
    }
    var out = [MG.lookControls(store, data, ui.part, PICTURED)];
    if (ui.part === 'month' && store.state.status.indexOf('event') >= 0 &&
        MG.optValue(store.state, 'event', 'place') === 'bar') {
      out.unshift(el('button', { type: 'button', class: 'xlink', onclick: function () { go('status', 'event'); } }, [
        el('span', { class: 'label' }, [el('span', { class: 'name', text: 'Next event shows here' }),
          el('span', { class: 'why', text: MG.summary(store.state, 'event') })]), chevron()]));
    }
    return out;
  }
  function partHead(id) { return PARTS.filter(function (p) { return p.id === id; })[0].label; }

  // ---- 1. The face over a list of parts; each opens its own page ------------
  function faceList(frame) {
    var store = new MG.Store(MG.defaultState()), data = MG.NOW.data;
    var ui = { part: null, item: null, adding: false };
    function go(part, item) { ui.part = part; ui.item = item || null; ui.adding = false; draw(true); }
    function render() { draw(false); }
    function draw(toTop) {
      var sc = scrollerOf(frame), y = sc.scrollTop;
      frame.textContent = '';
      var r = MG.draw(store.state, data);
      var root = el('div', { class: 'mg dir-d' });
      if (!ui.part) {
        root.appendChild(el('div', { class: 'facewrap' }, [faceStage(r, 1.5, go, null)]));
        root.appendChild(el('ul', { class: 'parts', 'aria-label': 'Parts of the face' }, PARTS.map(function (p) {
          // The face above is the picture of every part; only Colors adds its swatches.
          return el('li', {}, [el('button', { type: 'button', class: 'prow', onclick: function () { go(p.id); } }, [
            el('span', { class: 'label' }, [el('span', { class: 'name', text: p.label }),
              el('span', { class: 'why', text: partSummary(store.state, p.id) })]),
            p.id === 'colors' ? swatches(r) : null, chevron()])]);
        })));
      } else {
        var back = el('button', { type: 'button', class: 'back', onclick: function () { go(null); } }, [' All settings']);
        back.insertAdjacentHTML('afterbegin', BACK);
        root.appendChild(el('div', { class: 'pagehead' }, [back, el('h2', { text: partHead(ui.part) })]));
        root.appendChild(el('div', { class: 'zoom' }, [ui.part === 'colors' ? MG.crop(r, null, 1)
          : partPicture(r, ui.part, 340, true)]));
        root.appendChild(el('div', { class: 'pbody' }, partBody(store, data, ui, go, render)));
      }
      root.appendChild(saveBar(frame));
      frame.appendChild(root);
      sc.scrollTop = toTop ? 0 : y;
    }
    store.on(render);
    draw(true);
  }

  // ---- 2. One page: the face over folded parts, one open at a time ---------
  function folded(frame) {
    var store = new MG.Store(MG.defaultState()), data = MG.NOW.data;
    var ui = { part: null, item: null, adding: false };
    function go(part, item) {
      ui.part = part; ui.item = item || null; ui.adding = false;
      draw();
      var sc = scrollerOf(frame), fold = frame.querySelector('[data-part="' + part + '"]');
      if (fold) { sc.scrollTop += fold.getBoundingClientRect().top - sc.getBoundingClientRect().top - 4; }
    }
    function render() { draw(); }
    function draw() {
      var sc = scrollerOf(frame), y = sc.scrollTop;
      frame.textContent = '';
      var r = MG.draw(store.state, data);
      var root = el('div', { class: 'mg dir-e' });
      root.appendChild(el('div', { class: 'facewrap' }, [faceStage(r, 1.5, go, ui.part)]));
      PARTS.forEach(function (p) {
        var open = ui.part === p.id;
        // The open part's row stays pinned, with that part drawn large under it.
        var head = el('button', { type: 'button', class: 'fhead', 'aria-expanded': String(open),
          onclick: function () { if (open) { ui.part = null; draw(); } else { go(p.id); } } }, [
          el('span', { class: 'label' }, [el('span', { class: 'name', text: p.label }),
            el('span', { class: 'why', text: partSummary(store.state, p.id) })]),
          p.id === 'colors' ? swatches(r) : null, chevron()]);
        var sec = el('section', { class: 'psec' + (open ? ' open' : ''), 'data-part': p.id }, [
          el('div', { class: 'fstick' }, [head, open ? el('div', { class: 'fzoom' }, [p.id === 'colors'
            ? partPicture(r, 'colors', 300, false) : partPicture(r, p.id, 340, true)]) : null]),
          open ? el('div', { class: 'fbody' }, partBody(store, data, ui, go, render)) : null]);
        root.appendChild(sec);
      });
      root.appendChild(saveBar(frame));
      frame.appendChild(root);
      sc.scrollTop = y;
    }
    store.on(render);
    draw();
  }

  // ---- 3. The face stays put; labeled tabs under it ---------------------------
  function docked(frame) {
    var store = new MG.Store(MG.defaultState()), data = MG.NOW.data;
    var ui = { part: 'time', item: null, adding: false };
    function go(part, item) { ui.part = part; ui.item = item || null; ui.adding = false; draw(true); }
    function render() { draw(false); }
    function draw(toTop) {
      var sc = scrollerOf(frame), y = sc.scrollTop;
      frame.textContent = '';
      var r = MG.draw(store.state, data);
      var root = el('div', { class: 'mg dir-f' });
      var tabs = el('div', { class: 'ptabs', role: 'tablist', 'aria-label': 'Parts of the face' }, PARTS.map(function (p) {
        return el('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.part === p.id),
          onclick: function () { go(p.id); } }, [p.label]);
      }));
      root.appendChild(el('div', { class: 'dock' }, [el('div', { class: 'facewrap' }, [faceStage(r, 1, go, ui.part)]), tabs]));
      root.appendChild(el('div', { class: 'pbody', role: 'tabpanel', 'aria-label': partHead(ui.part) },
        partBody(store, data, ui, go, render)));
      root.appendChild(saveBar(frame));
      frame.appendChild(root);
      sc.scrollTop = toTop ? 0 : y;
      var sel = tabs.querySelector('[aria-selected="true"]');
      if (sel) { tabs.scrollLeft = sel.offsetLeft - (tabs.clientWidth - sel.offsetWidth) / 2; }
    }
    store.on(render);
    draw(true);
  }

  global.MGHybrids = { faceList: faceList, folded: folded, docked: docked, partSummary: partSummary };
})(typeof window !== 'undefined' ? window : globalThis);
