// What the watch doesn't draw yet, painted onto a render: the next event in
// the month bar (bar.js works out the words), on its own line, or with its
// calendar mark in the status line; and the phone's battery glyph.
(function (global) {
  'use strict';
  var MG = global.MG;
  function F() { return global.MonthGridFace; }
  function Bar() { return global.MGBar; }

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
  function sentence(name, when) {
    if (!when) { return name; }
    if (when === 'now') { return name + ' now'; }
    return name + (when.indexOf(':') > 0 ? ' at ' : ' in ') + when;
  }
  // The own line's words: the whole sentence, then without "in"/"at", then
  // the name shortened from its end. The time always stays.
  function lineText(name, when, font, room) {
    var w = function (t) { return F().measureText(t, font).w; };
    var full = sentence(name, when), compact = when ? name + ' ' + when : name;
    if (w(full) <= room) { return full; }
    if (w(compact) <= room) { return compact; }
    var cps = Array.from(name);
    for (var n = cps.length - 1; n >= 3; n--) {
      var t = cps.slice(0, n).join('').replace(/\s+$/, '') + '…' + (when ? ' ' + when : '');
      if (w(t) <= room) { return t; }
    }
    return when;
  }

  var MGEvent = {
    // Room reserved under the status line for the event's own line.
    band: function () { return { height: 22 }; },

    // Paints whatever the plan asks for onto render r.
    draw: function (r, p, data) {
      var L = r.layout, th = L.theme, sf = r.surface, P = F().PLATFORMS.emery, painted = false;
      if (r.drawn[MG.M.EVENT] && p.eventGlyph && L.status) {
        Bar().calMark(sf, r.drawn[MG.M.EVENT].x, L.status.y + Math.floor((L.status.h - 2 - 9) / 2), 9, th.fg);
        painted = true;
      }
      if (r.drawn[MG.M.PHONE_BATTERY] && L.status) {
        phone(sf, r.drawn[MG.M.PHONE_BATTERY].x, L.status.y + Math.floor((L.status.h - 2 - 11) / 2), th.fg);
        painted = true;
      }
      var ev = p.event;
      if (ev) { ev.shown = false; }
      if (ev && ev.place === 'bar' && L.banner) {
        var res = Bar().compose({ watch: 'emery', content: p.settings.BANNER_CONTENT || 0, locale: 'en-US',
          now: data.now, event: ev.ev, h24: p.h24, stale: !!data.dotsStale });
        Bar().paint(sf, 'emery', L.banner, th, p.settings.BANNER_STYLE || 0, res);
        var ew = Bar().width(res.event, 'GOTHIC_18') + (res.glyph ? 12 : 0);
        r.barEvent = { x: res.span[1] - res.staleW - ew, w: ew, res: res };
        ev.shown = painted = true;
      } else if (ev && ev.place === 'own' && L.extra) {
        var band = L.extra, room = band.w - 12 - 12;
        var text = lineText(ev.name, ev.ev.allDay ? '' : ev.when, P.fonts.small, room);
        var w = F().measureText(text, P.fonts.small).w + 12;
        var x = band.x + Math.floor((band.w - w) / 2);
        Bar().calMark(sf, x, band.y + Math.floor((band.h - 2 - 9) / 2), 9, th.fg);
        F().drawText(sf, text, P.fonts.small, textBox(P, band, x + 12, w), th.fg, 'left');
        ev.shown = painted = true;
      }
      if (painted) { r.pixels = F().toRGBA(sf); }
    },
    sentence: sentence,
  };

  global.MGEvent = MGEvent;
})(typeof window !== 'undefined' ? window : globalThis);
