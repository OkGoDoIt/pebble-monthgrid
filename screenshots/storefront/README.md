# Storefront screenshots — upload guide

One folder per hardware platform; upload each folder's five PNGs to that
platform's asset collection (both dev portals accept native-resolution,
unframed PNGs; numbering = suggested display order).

| # | File | Scene |
|---|---|---|
| 1 | 1_ice_overview.png | Ice theme, "AUGUST 27, 2026" banner, 12:13 PM, battery 90% · heart rate 72 · sunny 68°F |
| 2 | 2_events_dots.png | Event dots (squares) from 3 calendars, ruled "THURSDAY, SEPTEMBER 3" banner, adjacent months, LECO 4:20 PM, disconnected · battery 69% · alarm 9:30a · 3.8 mi |
| 3 | 3_international.png | Paper theme, 24h 17:30, Bitham bold, Monday start, plain SEPTEMBER banner, 7.8 km · 8,432 steps · 23°C · HR 81 |
| 4 | 4_events_lines.png | Newsprint theme, event underlines in custom colors (violet/teal/orange), numeric 2/13/2027 banner, Bitham light 9:45 AM with seconds, battery · 41°F · HR 64 |
| 5 | 5_timeline_peek.png | Midnight theme, Pixel font 1:23 PM, "MON, SEP 7, 2026", compressed under a Timeline Peek (rect models); rounds show the normal layout |

Per-model notes (all deliberate):
- Old-generation firmware (aplite/basalt/chalk/diorite) reports battery in
  10% steps, so 69%→70% and 84%→90% there; emery/gabbro/flint show exact
  values.
- Models without the relevant sensor hide those items ("show what fits,
  hide what's empty" is the product behavior): no HR on basalt/chalk,
  no health at all on aplite (its shots substitute the ISO week number).
- On the narrow 144px screens and the round crescents, later status items
  drop when the line is full — e.g. 3.8 mi doesn't fit on basalt's shot 2.
- Shot 5's peek band: emery uses a real Pebble Time 2 capture; the 144px
  models use the firmware's own golden test render ("Stock for p… /
  In 5 minutes"), colorized for basalt from the PT2 palette. Chalk and
  gabbro have no Timeline Quick View, so their fifth shot is uncompressed.
