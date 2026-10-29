// Next-event placements the watch doesn't draw yet, painted onto a render:
// time only (with a calendar mark), in the month bar, on its own line, or
// taking over the status line. Used by the prototypes and the review page.
(function (global) {
  'use strict';
  var MG = global.MG;
  function F() { return global.MonthGridFace; }

  // A 9x9 calendar mark, drawn the way icons.c draws its glyphs.
  var CAL = ['111111111', '101000101', '111111111', '100000001', '101010101', '100000001',
    '101010101', '100000001', '111111111'];
  function glyph(sf, x, y, color) {
    CAL.forEach(function (row, j) {
      for (var i = 0; i < row.length; i++) {
        if (row[i] === '1') { F().fillRect(sf, F().rect(x + i, y + j, 1, 1), color); }
      }
    });
  }
  // Where status-size text sits in a band, as draw_status.c places it.
  function textBox(P, band, x, w) {
    var y = band.y + Math.floor((band.h - 2 - P.SMALL_DIGIT_H) / 2) - P.SMALL_TOP_PAD;
    return F().rect(x, y, w, P.SMALL_DIGIT_H + P.SMALL_TOP_PAD + P.TEXT_BOX_SLACK);
  }
  // A 7x11 phone, for the phone's battery (the watch has no glyph for it yet).
  var PHONE = ['0111110', '1111111', '1000001', '1000001', '1000001', '1000001', '1000001', '1000001',
    '1111111', '1110111', '0111110'];
  function phone(sf, x, y, color) {
    PHONE.forEach(function (row, j) {
      for (var i = 0; i < row.length; i++) {
        if (row[i] === '1') { F().fillRect(sf, F().rect(x + i, y + j, 1, 1), color); }
      }
    });
  }
  // "Standup in 23m", "Standup at 2:30p", "Standup now".
  function sentence(ev) {
    if (ev.when === 'now') { return ev.name + ' now'; }
    return ev.name + (ev.when.indexOf(':') > 0 ? ' at ' : ' in ') + ev.when;
  }

  var MGEvent = {
    // Room reserved under the status line for the event's own line.
    band: function () { return { height: 22 }; },

    // Paints whatever the plan asks for onto render r.
    draw: function (r, p, data) {
      var L = r.layout, th = L.theme, sf = r.surface, P = F().PLATFORMS.emery, painted = false;
      if (r.drawn[MG.M.EVENT] && MG.optValue(p.state, 'event', 'style') === 'short') {
        var st = L.status;
        glyph(sf, r.drawn[MG.M.EVENT].x, st.y + Math.floor((st.h - 2 - 9) / 2), th.fg);
        painted = true;
      }
      if (r.drawn[MG.M.PHONE_BATTERY] && L.status) {
        phone(sf, r.drawn[MG.M.PHONE_BATTERY].x, L.status.y + Math.floor((L.status.h - 2 - 11) / 2), th.fg);
        painted = true;
      }
      var ev = p.event;
      if (ev && ev.place === 'bar' && L.banner) {
        var b = L.banner, filled = p.settings.BANNER_STYLE === 0;
        F().fillRect(sf, F().rect(b.x, b.y + 1, b.w, b.h - 2), filled ? th.accent : th.bg);
        var color = filled ? th.onAccent : th.fg;
        var month = data.now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
        var box = F().rect(b.x + 6, b.y - P.BANNER_TEXT_LIFT, b.w - 12, b.h + 6);
        F().drawText(sf, month, P.fonts.banner, box, color, 'left');
        F().drawText(sf, sentence(ev), P.fonts.small, F().rect(b.x + 6, b.y - P.BANNER_TEXT_LIFT, b.w - 12, b.h + 6),
          color, 'right', 'ellipsis');
        painted = true;
      } else if (ev && ev.place === 'own' && L.extra) {
        var band = L.extra, text = sentence(ev);
        var w = F().measureText(text, P.fonts.small).w + 12;
        var x = band.x + Math.floor((band.w - w) / 2);
        glyph(sf, x, band.y + Math.floor((band.h - 2 - 9) / 2), th.fg);
        F().drawText(sf, text, P.fonts.small, textBox(P, band, x + 12, w), th.fg, 'left');
        painted = true;
      }
      if (painted) { r.pixels = F().toRGBA(sf); }
    },
  };

  // ---- The review page's comparison: one day, Standup at 10:00-10:15 ----
  var START = new Date(2026, 9, 29, 10, 0);
  function base() {
    var s = MG.defaultState();
    s.opts.event = { within: '2h', style: 'full', place: 'line' };
    return s;
  }
  MGEvent.moment = function (rel) {
    var now = new Date(START.getTime() + rel * 60000);
    var data = MG.merge(MG.NOW.data, { now: now });
    var mins = -rel;
    var what = rel < 0 ? 'Standup in ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' minutes')
      : rel < 15 ? 'Standup has started' : 'Standup is over';
    return { data: data, label: MG.clock(now) + ' · ' + what };
  };
  function withEvent(opts) {
    return function (data) {
      var s = base();
      Object.keys(opts).forEach(function (k) { s.opts.event[k] = opts[k]; });
      return MG.draw(s, data);
    };
  }
  MGEvent.placements = [
    { id: 'short', title: 'Time only, in the line', render: withEvent({ style: 'short' }),
      note: 'A calendar mark and the countdown, sized like any other item. The name stays off the watch.' },
    { id: 'bar', title: 'In the month bar', render: withEvent({ place: 'bar' }),
      note: 'The month moves left and the event sits on the right. Costs no height, and the status line keeps its room.' },
    { id: 'own', title: 'On its own line', render: withEvent({ place: 'own' }),
      note: 'A second line appears while an event is near. The days get a little shorter while it shows.' },
    { id: 'take', title: 'Takes over the line', render: function (data) {
        var s = base(), ev = data.event;
        var soon = ev && data.now >= new Date(ev.start - 15 * 60000) && data.now < ev.end;
        s.status = soon ? ['event'] : s.status.filter(function (id) { return id !== 'event'; });
        return MG.draw(s, data);
      },
      note: 'In the 15 minutes before, the status line shows only the event. The other items come back when it ends.' },
  ];

  global.MGEvent = MGEvent;
})(typeof window !== 'undefined' ? window : globalThis);
