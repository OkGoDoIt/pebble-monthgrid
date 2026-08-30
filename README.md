# MonthGrid

**Your month at a glance.** A retro calendar watchface for Pebble: big time on top, a
prioritized status line, and a full month grid with today highlighted — a from-scratch
re-implementation (and extension) of the abandoned *CalendaWatch*, built on the current
official Pebble SDK.

<p align="center">
  <img src="screenshots/storefront/emery/1_ice_overview.png" alt="Pebble Time 2" />
</p>

Every Pebble, its own look — one scene per model:

| Pebble Time 2 (emery) | Pebble Time (basalt) | Pebble Round 2 (gabbro) | Pebble Time Round (chalk) |
|:---:|:---:|:---:|:---:|
| ![emery](screenshots/storefront/emery/1_ice_overview.png) | ![basalt](screenshots/storefront/basalt/2_events_dots.png) | ![gabbro](screenshots/storefront/gabbro/4_events_lines.png) | ![chalk](screenshots/storefront/chalk/5_timeline_peek.png) |
| Ice theme, full-date banner, heart rate & weather | Event dots, ruled banner, adjacent months, Digital font | Newsprint theme, custom marker colors, seconds | Midnight theme, Pixel font, round crescent layout |

| Pebble 2 HR (diorite) | Pebble 2 Duo (flint) | Pebble Classic (aplite) |
|:---:|:---:|:---:|
| ![diorite](screenshots/storefront/diorite/3_international.png) | ![flint](screenshots/storefront/flint/5_timeline_peek.png) | ![aplite](screenshots/storefront/aplite/1_ice_overview.png) |
| Paper theme, 24-hour, Monday start, metric units | Compressed under a Timeline Peek | Classic look with week number on the original Pebble |

## Features

- **Full month calendar** with today inverted; optional dimmed previous/next-month days
  filling the whole grid.
- **Banner options** — the inverted bar shows the month name (default) or full dates:
  month+day, weekday+month+day, with or without the year. Ordering follows your region
  (US: `AUGUST 25`; elsewhere: `25 AUGUST`), names are localized, and long combinations
  automatically shorten (`WEDNESDAY, SEPTEMBER 30` → `WED, SEP 30`) so nothing clips.
- **Big time display** with five selectable font styles — Roboto (default), Digital
  (LECO), Pixel (Silkscreen), Bitham bold / light — in three sizes.
  12-hour mode **never shows a leading zero**. Optional seconds (off by default; the
  face ticks once a minute unless enabled).
- **Prioritized status line** — add as many items as you like (up to 8) in priority
  order; the settings page grows a new row as you fill the last one and closes gaps
  when you set a row to Remove. As many as fit on the watch are shown. Items with nothing to report are hidden automatically. Choose from:
  - Battery (icon + %, charge bolt while plugged)
  - Weather (condition icon + temperature, °F/°C)
  - Steps, Distance walked (mi/km), Heart rate, Active minutes, Calories, Sleep
  - Week number (ISO), Next alarm, Disconnected alert
- **Weather** via [Open-Meteo](https://open-meteo.com/) (the pattern recommended by the
  official Pebble docs — no API key, no account). Cached on the watch, refreshed every
  30 minutes, shown only while fresh (<3 h).
- **Calendar event markers** — up to three iCal/ICS subscriptions (e.g. Google
  Calendar's *Secret address in iCal format*) mark days with events. Two styles: a
  1px underline that splits into per-calendar color sections, or small squares —
  color-coded per calendar on color watches, sized per display density. The squares
  show up to three markers per day based on how many events you have, prioritising
  one marker per calendar before doubling up. The URLs stay
  on your phone; the watch only ever receives a per-day bitmask.
- **Timeline Quick View aware** — when the system overlay appears, the face compresses
  (smaller time, then status, banner, header yield) instead of cropping the grid.
- **Round-native layout** on Pebble Time Round and Pebble Round 2: time on the top arc,
  single-letter weekday header, grid across the wide middle of the circle, month stacked
  in the left crescent, status metrics stacked in the right crescent.
- **Ten color themes plus Custom** — Classic (white-on-black, default), Paper, Amber
  terminal, Ice, Crimson, Midnight, Terminal green, Sunset, Violet and Newsprint, all
  high-contrast and legible with the backlight off. Custom lets you pick the
  background, text and accent yourself (those pickers only appear when Custom is
  selected). B&W watches use Classic/Paper.
- **Month banner styles** — filled bar (default), plain text, or ruled with a 1px line
  above and below.
- Sunday / Monday / Saturday week start, vibrate-on-disconnect.

## Settings

Everything is configured from the phone (Settings → MonthGrid). Settings apply as
soon as you hit Save — the Save button stays pinned to the bottom of the page, so
it's always one tap away. All examples below are on Pebble Time 2.

### Color themes

Ten built-in themes plus **Custom**. The accent colors the month banner and today's
box; text stays high-contrast so every theme reads with the backlight off.
Black-and-white watches automatically use Classic (or Paper for light themes).

| Classic (default) | Paper | Amber | Ice | Crimson | Midnight |
|:---:|:---:|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/th_classic.png) | ![](screenshots/settings/th_paper.png) | ![](screenshots/settings/th_amber.png) | ![](screenshots/settings/th_ice.png) | ![](screenshots/settings/th_crimson.png) | ![](screenshots/settings/th_midnight.png) |

| Terminal | Sunset | Violet | Newsprint | Custom |
|:---:|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/th_terminal.png) | ![](screenshots/settings/th_sunset.png) | ![](screenshots/settings/th_violet.png) | ![](screenshots/settings/th_newsprint.png) | ![](screenshots/settings/th_custom.png) |

Picking **Custom** reveals three color pickers (background, text, accent); the
remaining colors are derived automatically for contrast.

### Month banner

**Style** — a solid accent bar (default), plain text, or thin rules above and below
(a rounded outline on round watches). **Content** — from just the month name up to
full dates, ordered for your region and automatically shortened when space is tight.

| Filled bar (default) | Plain text | Ruled |
|:---:|:---:|:---:|
| ![](screenshots/settings/th_classic.png) | ![](screenshots/settings/bs_plain.png) | ![](screenshots/settings/bs_ruled.png) |

| Month + day | Weekday, month + day | Month + day, year | Weekday + full date | Numeric |
|:---:|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/bc_month_day.png) | ![](screenshots/settings/bc_wd_md.png) | ![](screenshots/settings/bc_md_year.png) | ![](screenshots/settings/bc_wd_md_year.png) | ![](screenshots/settings/bc_numeric.png) |

### Time display

Five fonts, three sizes, optional seconds, and 12/24-hour (or follow the watch).
12-hour mode never shows a leading zero.

| Roboto (default) | Digital | Pixel | Bitham bold | Bitham light |
|:---:|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/th_classic.png) | ![](screenshots/settings/font_digital.png) | ![](screenshots/settings/font_pixel.png) | ![](screenshots/settings/font_bithamb.png) | ![](screenshots/settings/font_bithaml.png) |

| Medium size | Small size | Seconds on | 24-hour (+ °C) |
|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/size_medium.png) | ![](screenshots/settings/size_small.png) | ![](screenshots/settings/secs_on.png) | ![](screenshots/settings/fmt_24h.png) |

### Calendar grid

Start the week on Sunday (default), Monday, or Saturday; two- or one-letter weekday
headers (Pebble Time Round always uses one letter); optionally fill the first and
last weeks with dimmed days from the neighboring months.

| Monday start | Saturday start | One-letter header | Adjacent months |
|:---:|:---:|:---:|:---:|
| ![](screenshots/settings/start_monday.png) | ![](screenshots/settings/start_saturday.png) | ![](screenshots/settings/hdr_one.png) | ![](screenshots/settings/adj_on.png) |

### Status line

Add items in priority order — the settings page grows a new row as you fill the
last one, and a row set to "Remove" closes up the list (up to 8). As many as fit
are shown; items with nothing to report (no weather yet, no heart-rate sensor,
steps still at zero) hide instead of showing clutter. Choose from battery, weather,
steps, distance (mi/km), heart rate, active minutes, calories, sleep, ISO week
number, next alarm, and a disconnected alert.

| Battery + weather (default) | Battery, weather, steps + more queued |
|:---:|:---:|
| ![](screenshots/settings/th_classic.png) | ![](screenshots/settings/status_five.png) |

### Calendar event markers

Paste up to three iCal/ICS subscription URLs (e.g. Google Calendar's *Secret
address in iCal format*) and days with events get a marker under the date, color
coded per calendar. Two styles: a thin underline that splits into per-calendar
segments, or up to three small squares reflecting how many events the day holds.
The URLs never leave your phone — the watch only receives a per-day summary — and
the settings page shows a plain-language diagnostic (with a "!" on the watch) if a
calendar ever fails to refresh.

| Underline (default) | Squares |
|:---:|:---:|
| ![](screenshots/settings/mk_underline.png) | ![](screenshots/settings/mk_squares.png) |

### And the rest

- **Temperature / distance units** — °F or °C, miles or kilometers.
- **Vibrate on disconnect** — a short pulse when the phone link drops.

## Platforms

All seven: `aplite`, `basalt`, `chalk`, `diorite`, `emery` (Pebble Time 2), `flint`
(Pebble 2 Duo), `gabbro` (Pebble Round 2). Health metrics need a health-capable watch;
heart rate needs a watch with an HRM (detected at runtime, hidden otherwise).

## Building

Requires the official [Pebble SDK](https://developer.repebble.com/) (`pebble-tool` ≥ 5,
SDK core ≥ 4.33):

```sh
pebble build
```

Run in the emulator:

```sh
pebble install --emulator basalt
pebble emu-set-timeline-quick-view on    # test the Quick View compression
pebble emu-app-config                    # open the settings page
```

Install on a watch (Dev Connect / Developer Connection in the official app):

```sh
pebble install --cloudpebble             # or: pebble install --phone <PHONE_IP>
```

The sideloadable bundle is `build/monthgrid.pbw`.

## Tests

The ICS recurrence engine (the trickiest part of the phone-side JS) has a Node test
suite — plain CommonJS, no dependencies:

```sh
node tools/test_ics.js
```

## Calendar-dot limitations (best-effort ICS)

The phone JS runtime has no timezone database, so `TZID`/floating event times are
treated as phone-local (UTC times are converted properly). The RRULE subset covers
FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (weekly),
BYMONTHDAY (single), and EXDATE; events with ordinal BYDAY (e.g. "2nd Tuesday"),
BYSETPOS, and other exotica mark only their first instance rather than guessing.

## Bundled fonts

The Silkscreen font (used for the "Pixel" time style) is included under its own
license — see `resources/fonts/OFL-Silkscreen.txt`.
