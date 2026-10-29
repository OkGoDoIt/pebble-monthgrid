// The review page: tabs on narrow screens, the three prototypes, and the
// next-event comparison.
(function () {
  'use strict';

  // Tabs only matter below the width where all three phones fit side by side.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).classList.toggle('off', !on);
    });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { select(t); }); });
  select(tabs[0]);

  document.querySelectorAll('.mount').forEach(function (m) {
    try { MGDirections[m.getAttribute('data-dir')](m); }
    catch (e) { m.textContent = 'This prototype failed to draw: ' + e.message; console.error(e); }
  });

  // Next event: four placements at the slider's moment.
  var slider = document.getElementById('ev-min'), out = document.getElementById('ev-out');
  var box = document.getElementById('ev-faces');
  var faces = MGEvent.placements.map(function (p) {
    var canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 228;
    var fig = document.createElement('figure');
    fig.className = 'face';
    fig.style.margin = '0';
    var h = document.createElement('h3'); h.textContent = p.title;
    var note = document.createElement('p'); note.textContent = p.note;
    fig.appendChild(canvas); fig.appendChild(h); fig.appendChild(note);
    return { p: p, canvas: canvas, fig: fig };
  });
  box.textContent = '';
  faces.forEach(function (f) { box.appendChild(f.fig); });
  function update() {
    var rel = Number(slider.value);
    var moment = MGEvent.moment(rel);
    out.textContent = moment.label;
    faces.forEach(function (f) {
      var r = f.p.render(moment.data);
      f.canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.pixels), r.width, r.height), 0, 0);
      f.canvas.setAttribute('aria-label', f.p.title + ' at ' + moment.label);
    });
  }
  slider.addEventListener('input', update);
  update();
})();
