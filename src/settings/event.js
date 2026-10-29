// The next event where the renderer doesn't draw it: in the month bar
// (bar.js works out the words) or on its own line under the status line.
(function (global) {
  'use strict';
  function F() { return global.MonthGridFace; }
  function Bar() { return global.MGBar; }

  // Where status-size text sits in a band, as draw_status.c places it.
  function textBox(P, band, x, w) {
    var y = band.y + Math.floor((band.h - 2 - P.SMALL_DIGIT_H) / 2) - P.SMALL_TOP_PAD;
    return F().rect(x, y, w, P.SMALL_DIGIT_H + P.SMALL_TOP_PAD + P.TEXT_BOX_SLACK);
  }
  // "Standup in 12m", "Standup tomorrow at 9:00a", "Sam's birthday".
  function sentence(name, w) { return w.full ? name + ' ' + w.full : name; }
  // The own line's words: the whole sentence, then the short form, then the
  // name shortened from its end. The time always stays.
  function lineText(name, w, font, room) {
    var width = function (t) { return F().measureText(t, font).w; };
    var full = sentence(name, w), compact = w.text ? name + ' ' + w.text : name;
    if (width(full) <= room) { return full; }
    if (width(compact) <= room) { return compact; }
    var cps = Array.from(name.replace(/…$/, ''));
    for (var n = cps.length - 1; n >= 3; n--) {
      var t = cps.slice(0, n).join('').replace(/[\s,.;:–—-]+$/, '') + '…' + (w.text ? ' ' + w.text : '');
      if (width(t) <= room) { return t; }
    }
    return w.text;
  }

  var MGEvent = {
    // Room reserved under the status line for the event's own line.
    band: function () { return { height: 22 }; },

    // Paints whatever the plan puts in the bar or on the own line onto render r.
    draw: function (r, p, data) {
      var L = r.layout, th = L.theme, sf = r.surface, P = F().PLATFORMS.emery;
      var ev = p.event;
      if (!ev) { return; }
      ev.shown = false;
      if (ev.place === 'bar' && L.banner) {
        var res = Bar().compose({ watch: 'emery', content: p.settings.BANNER_CONTENT || 0, locale: 'en-US',
          now: data.now, event: ev.ev, h24: p.h24, stale: !!data.dotsStale, fixCase: true });
        Bar().paint(sf, 'emery', L.banner, th, p.settings.BANNER_STYLE || 0, res);
        var ew = Bar().width(res.event, 'GOTHIC_18') + (res.glyph ? 12 : 0);
        r.barEvent = { x: res.span[1] - res.staleW - ew, w: ew, res: res };
        ev.shown = true;
      } else if (ev.place === 'own' && L.extra) {
        var band = L.extra, room = band.w - 12 - 12;
        var text = lineText(ev.name, ev.when, P.fonts.small, room);
        var w = F().measureText(text, P.fonts.small).w + 12;
        var x = band.x + Math.floor((band.w - w) / 2);
        Bar().calMark(sf, x, band.y + Math.floor((band.h - 2 - 9) / 2), 9, th.fg);
        F().drawText(sf, text, P.fonts.small, textBox(P, band, x + 12, w), th.fg, 'left');
        ev.shown = true;
      }
      if (ev.shown) { r.pixels = F().toRGBA(sf); }
    },
    sentence: sentence,
    lineText: lineText,
  };

  global.MGEvent = MGEvent;
})(typeof window !== 'undefined' ? window : globalThis);
