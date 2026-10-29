#include "common.h"

// Month banner + weekday header + the day grid, with today inverted,
// optional dimmed adjacent-month days and optional per-day event dots.
// Small text is system Raster Gothic, placed by its visible pixel metrics
// (SMALL_DIGIT_H / SMALL_TOP_PAD) so rows stay optically centered.

// Event markers sit exactly 1px below the digit ink (digits are top-anchored
// while markers are active). On low-DPI screens the markers are a single
// pixel tall (squares 2x1) so they cannot crowd the row beneath; high-DPI
// gets 3x3 squares. The bar style is 1px tall everywhere.
#if PBL_DISPLAY_WIDTH >= 200
  #define TEXT_BOX_SLACK 12
  #define DOT_SQ_W 3
  #define DOT_SQ_H 3
  #define DOT_GAP 2
  #define MONTH_TILE 19
  #define HEADER_TOP_PAD 3    // GOTHIC_14 header font
#else
  #define TEXT_BOX_SLACK 10
  #define DOT_SQ_W 2
  #define DOT_SQ_H 1
  #define DOT_GAP 2
  #define MONTH_TILE 13
  #define HEADER_TOP_PAD 2    // GOTHIC_09 header font
#endif
#define DOT_BAR_H 1
// Digit ink + 1px gap + at least 1px of marker must fit the row pitch.
#define MIN_PITCH_FOR_DOTS (SMALL_DIGIT_H + 2)

#if !(defined(PBL_ROUND) && PBL_DISPLAY_WIDTH < 200)
static const char *const WEEKDAY_LABELS[7] = { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };
#endif
static const char *const WEEKDAY_LETTERS[7] = { "S", "M", "T", "W", "T", "F", "S" };
static const char *const MONTH_ABBR[12] = {
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
};

// Optional table borders around the date cells, like the classic calendar
// faces: 1px verticals and horizontals across the grid, drawn before the
// day numbers so today's filled box sits on top. Monochrome watches use the
// foreground color (the customizable color would just dither away).
static void prv_draw_grid_lines(GContext *ctx, GRect grid, int rows) {
  if (!g_settings.grid_lines) { return; }
#if defined(PBL_COLOR)
  GColor c = (GColor) { .argb = g_settings.grid_color };
#else
  GColor c = theme_fg();
#endif
  graphics_context_set_fill_color(ctx, c);
  int16_t cw = grid.size.w / 7;
  int16_t h = (int16_t) (g_layout.row_pitch * rows);
  for (int i = 0; i <= 7; i++) {
    graphics_fill_rect(ctx, GRect(grid.origin.x + i * cw, grid.origin.y, 1, h),
                       0, GCornerNone);
  }
  for (int r = 0; r <= rows; r++) {
    graphics_fill_rect(ctx, GRect(grid.origin.x, grid.origin.y + r * g_layout.row_pitch,
                                  (int16_t) (cw * 7 + 1), 1),
                       0, GCornerNone);
  }
}

static void prv_draw_day_number(GContext *ctx, int day, GRect cell, GColor color,
                                bool top_anchor) {
  char buf[4];
  snprintf(buf, sizeof(buf), "%d", day);
  // top_anchor pushes the number up to make room for event dots below.
  int16_t y = top_anchor
      ? cell.origin.y - SMALL_TOP_PAD
      : cell.origin.y + (cell.size.h - 1 - SMALL_DIGIT_H) / 2 - SMALL_TOP_PAD;
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, buf, g_font_small,
                     GRect(cell.origin.x, y, cell.size.w,
                           SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void prv_draw_dots(GContext *ctx, int day, GRect cell, bool on_today_box) {
  if (day < 1 || day > 31) { return; }
  uint8_t mask = g_dots.days[day - 1];
  if (!mask) { return; }

  // Per-calendar event counts (2 bits each, saturating at 3).
  uint8_t counts[NUM_CALENDARS];
  int distinct = 0, total = 0;
  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    counts[cal] = DOT_COUNT(mask, cal);
    if (counts[cal]) { distinct++; total += counts[cal]; }
  }
  if (!distinct) { return; }

  // Marker slots: every calendar with an event gets one first, then any
  // spare slots go to calendars with more than one event (round-robin, so a
  // busy calendar can take two or three). Grouped by calendar so same-color
  // markers sit together.
  uint8_t slots[NUM_CALENDARS];
  int n = 0;
  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    slots[cal] = counts[cal] ? 1 : 0;
    n += slots[cal];
  }
  for (bool progress = true; n < DOT_MAX_MARKERS && progress; ) {
    progress = false;
    for (int cal = 0; cal < NUM_CALENDARS && n < DOT_MAX_MARKERS; cal++) {
      if (slots[cal] && slots[cal] < counts[cal]) {
        slots[cal]++;
        n++;
        progress = true;
      }
    }
  }
  (void) total;
  bool bar_style = g_settings.dots_style == DOTS_STYLE_BAR;
  int seg = 0;

  // One blank row below the digit ink, never touching either neighbor.
  int16_t marker_y = cell.origin.y + SMALL_DIGIT_H + 1;
  int16_t avail_h = cell.size.h - SMALL_DIGIT_H - 1;
  if (avail_h < 1) { return; }
  int16_t sq_h = DOT_SQ_H < avail_h ? DOT_SQ_H : avail_h;
  int16_t x, bar_w = cell.size.w - 7;
  if (bar_style) {
    x = cell.origin.x + (cell.size.w - bar_w) / 2;
  } else {
    int16_t total_w = n * DOT_SQ_W + (n - 1) * DOT_GAP;
    x = cell.origin.x + (cell.size.w - total_w) / 2;
  }

  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    int reps = bar_style ? (counts[cal] ? 1 : 0) : slots[cal];
    if (!reps) { continue; }
#if defined(PBL_COLOR)
    GColor c = (GColor) { .argb = g_settings.cal_colors[cal] };
    if (on_today_box && gcolor_equal(c, theme_accent())) { c = theme_on_accent(); }
#else
    GColor c = on_today_box ? theme_on_accent() : theme_fg();
#endif
    graphics_context_set_fill_color(ctx, c);
    for (int r = 0; r < reps; r++) {
      if (bar_style) {
        // A 1px bar split into equal per-calendar sections (single solid
        // bar on B&W).
        int16_t w = bar_w / distinct + (seg == distinct - 1 ? bar_w % distinct : 0);
        graphics_fill_rect(ctx, GRect(x, marker_y, w, DOT_BAR_H), 0, GCornerNone);
        x += w;
      } else {
        graphics_fill_rect(ctx, GRect(x, marker_y, DOT_SQ_W, sq_h), 0, GCornerNone);
        x += DOT_SQ_W + DOT_GAP;
      }
      seg++;
    }
  }
}

// Upper-cases ASCII and the Latin-1 letters the watch's languages use
// ("März" -> "MÄRZ", "décembre" -> "DÉCEMBRE"): U+00E0..U+00FE except U+00F7
// (the division sign) are 0xC3 0xA0..0xBE in UTF-8, and their capitals are
// 0x20 lower.
static void prv_uppercase(char *p) {
  for (; *p; p++) {
    if (*p >= 'a' && *p <= 'z') {
      *p -= 32;
    } else if ((uint8_t) p[0] == 0xC3 && (uint8_t) p[1] >= 0xA0 && (uint8_t) p[1] <= 0xBE
               && (uint8_t) p[1] != 0xB7) {
      p[1] -= 0x20;
      p++;
    }
  }
}

static bool prv_text_fits(const char *s, GFont font, int16_t max_w) {
  return text_width(s, font) <= max_w;
}

#define DATE_CANDIDATES 4
#define DATE_LEN 40
typedef char DateCandidates[DATE_CANDIDATES][DATE_LEN];

// The banner's date texts per the user's BANNER_CONTENT setting, longest
// first, upper-cased and without repeats. Month/weekday order follows the
// watch region (en_US: month first; elsewhere: day first), names are
// localized by the system locale. With an event in the bar one more rung
// follows: the month alone (the grid still marks today).
static int prv_date_candidates(DateCandidates cand, bool with_event) {
  char wd_full[16], wd_ab[8], mon_full[16], mon_ab[8];
  strftime(wd_full, sizeof(wd_full), "%A", &g_now);
  strftime(wd_ab, sizeof(wd_ab), "%a", &g_now);
  strftime(mon_full, sizeof(mon_full), "%B", &g_now);
  strftime(mon_ab, sizeof(mon_ab), "%b", &g_now);
  int day = g_now.tm_mday;
  int year = g_now.tm_year + 1900;
  const char *locale = i18n_get_system_locale();
  bool day_first = !(locale && strncmp(locale, "en_US", 5) == 0);

  int n = 0;
  switch (g_settings.banner_content) {
    case BANNER_MONTH_DAY:
      if (day_first) {
        snprintf(cand[n++], sizeof(cand[0]), "%d %s", day, mon_full);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s", day, mon_ab);
      } else {
        snprintf(cand[n++], sizeof(cand[0]), "%s %d", mon_full, day);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d", mon_ab, day);
      }
      break;
    case BANNER_WD_MONTH_DAY:
      if (day_first) {
        snprintf(cand[n++], sizeof(cand[0]), "%s, %d %s", wd_full, day, mon_full);
        snprintf(cand[n++], sizeof(cand[0]), "%s, %d %s", wd_ab, day, mon_ab);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s", day, mon_ab);
      } else {
        snprintf(cand[n++], sizeof(cand[0]), "%s, %s %d", wd_full, mon_full, day);
        snprintf(cand[n++], sizeof(cand[0]), "%s, %s %d", wd_ab, mon_ab, day);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d", mon_ab, day);
      }
      break;
    case BANNER_MONTH_DAY_YEAR:
      if (day_first) {
        snprintf(cand[n++], sizeof(cand[0]), "%d %s %d", day, mon_full, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s %d", day, mon_ab, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s", day, mon_ab);
      } else {
        snprintf(cand[n++], sizeof(cand[0]), "%s %d, %d", mon_full, day, year);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d, %d", mon_ab, day, year);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d", mon_ab, day);
      }
      break;
    case BANNER_NUMERIC:
      if (day_first) {
        snprintf(cand[n++], sizeof(cand[0]), "%d/%d/%d", day, g_now.tm_mon + 1, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d/%d", day, g_now.tm_mon + 1);
      } else {
        snprintf(cand[n++], sizeof(cand[0]), "%d/%d/%d", g_now.tm_mon + 1, day, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d/%d", g_now.tm_mon + 1, day);
      }
      break;
    case BANNER_WD_MD_YEAR:
      if (day_first) {
        snprintf(cand[n++], sizeof(cand[0]), "%s, %d %s %d", wd_ab, day, mon_ab, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s %d", day, mon_ab, year);
        snprintf(cand[n++], sizeof(cand[0]), "%d %s", day, mon_ab);
      } else {
        snprintf(cand[n++], sizeof(cand[0]), "%s, %s %d, %d", wd_ab, mon_ab, day, year);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d, %d", mon_ab, day, year);
        snprintf(cand[n++], sizeof(cand[0]), "%s %d", mon_ab, day);
      }
      break;
    default:
      snprintf(cand[n++], sizeof(cand[0]), "%s", mon_full);
      snprintf(cand[n++], sizeof(cand[0]), "%s", mon_ab);
      break;
  }

  if (with_event && g_settings.banner_content != BANNER_MONTH
      && g_settings.banner_content != BANNER_NUMERIC && n < DATE_CANDIDATES) {
    snprintf(cand[n++], DATE_LEN, "%s", mon_ab);
  }
  int kept = 0;
  for (int i = 0; i < n; i++) {
    prv_uppercase(cand[i]);
    bool repeat = false;
    for (int j = 0; j < kept; j++) {
      if (strcmp(cand[j], cand[i]) == 0) { repeat = true; break; }
    }
    if (!repeat) {
      if (kept != i) { memcpy(cand[kept], cand[i], DATE_LEN); }
      kept++;
    }
  }
  return kept;
}

// The banner on its own: the first date that fits wins, so nothing ever
// clips: e.g. WEDNESDAY, SEPTEMBER 30 -> WED, SEP 30 -> SEP 30.
static void prv_banner_text(char *buf, size_t len, GFont font, int16_t max_w) {
  static DateCandidates cand;
  int n = prv_date_candidates(cand, false);
  for (int i = 0; i < n; i++) {
    if (i == n - 1 || prv_text_fits(cand[i], font, max_w)) {
      strncpy(buf, cand[i], len - 1);
      buf[len - 1] = 0;
      return;
    }
  }
  buf[0] = 0;
}

#if defined(EVENT_IN_BAR)
// ---- The next event in the bar ------------------------------------------
// The date on the left in the bar's bold, the event on the right in the
// status line's regular weight. A ladder of (date, event) texts is tried in
// order and the first that fits wins (src/settings/bar.js is the same ladder,
// checked against every combination by design/preview/tools/bar-cases.js):
//   1. every date, longest first, each with the event as a sentence
//      ("Standup in 12m") and then short ("Standup 12m");
//   2. the shortest date, the name losing letters from its end ("Quarte… 9m");
//   3. the shortest date and the time alone, after a calendar mark.
// BAR_GLYPH_S: the status line's icon box, so the calendar mark is the
// status line's (9x9, 7x7 on the small screens).
#if PBL_DISPLAY_WIDTH >= 200
  #define BAR_PAD (PBL_IF_ROUND_ELSE(6, 5))
  #define BAR_GAP 8
  #define BAR_LIFT 3
  #define BAR_GLYPH_S 13
#else
  #define BAR_PAD 4
  #define BAR_GAP 6
  #define BAR_LIFT 2
  #define BAR_GLYPH_S 9
#endif

typedef struct {
  char date[DATE_LEN];
  char event[48];
  bool glyph;
} BarText;

// The span of the bar text may use, [left, right). On the round watch the
// bar runs edge to edge and the circle clips it, so the room is the circle's
// width at the letters' top edge.
static void prv_bar_span(GRect bz, int16_t *x0, int16_t *x1) {
#if defined(PBL_ROUND)
  const int32_t r = PBL_DISPLAY_WIDTH / 2;
  int32_t dy = r - (bz.origin.y + 3), v = r * r - dy * dy, half = 0;
  while ((half + 1) * (half + 1) <= v) { half++; }
  *x0 = (int16_t) (r - half + BAR_PAD);
  *x1 = (int16_t) (r + half - BAR_PAD);
#else
  *x0 = bz.origin.x + BAR_PAD;
  *x1 = bz.origin.x + bz.size.w - BAR_PAD;
#endif
}

static bool prv_bar_fits(const char *date, const char *event, bool glyph, int16_t avail) {
  int16_t glyph_w = glyph ? status_icon_width(METRIC_NEXT_EVENT, BAR_GLYPH_S) - 2 + 3 : 0;
  return text_width(date, g_font_banner) + BAR_GAP + glyph_w
      + text_width(event, g_font_small) <= avail;
}

static void prv_bar_compose(BarText *out, const EventView *ev, int16_t avail) {
  static DateCandidates dates;
  int n_dates = prv_date_candidates(dates, true);
  EventWhen w;
  event_when(ev, &w, false);
  static char forms[2][48];
  snprintf(forms[0], sizeof(forms[0]), "%s%s%s", ev->name, w.full[0] ? " " : "", w.full);
  snprintf(forms[1], sizeof(forms[1]), "%s%s%s", ev->name, w.text[0] ? " " : "", w.text);
  int n_forms = strcmp(forms[0], forms[1]) == 0 ? 1 : 2;
  out->glyph = false;
  for (int i = 0; i < n_dates; i++) {
    for (int j = 0; j < n_forms; j++) {
      if (prv_bar_fits(dates[i], forms[j], false, avail)) {
        snprintf(out->date, sizeof(out->date), "%s", dates[i]);
        memcpy(out->event, forms[j], sizeof(out->event));
        return;
      }
    }
  }
  const char *shortest = dates[n_dates - 1];
  snprintf(out->date, sizeof(out->date), "%s", shortest);
  char name[EVENT_NAME_LEN];
  snprintf(name, sizeof(name), "%s", ev->name);
  trim_name_end(name);
  for (int n = utf8_count(name) - 1; n >= MIN_NAME_CHARS; n--) {
    char cut[EVENT_NAME_LEN];
    size_t bytes = utf8_prefix(name, n);
    memcpy(cut, name, bytes);
    cut[bytes] = '\0';
    trim_name_end(cut);
    snprintf(out->event, sizeof(out->event), "%s\xe2\x80\xa6%s%s", cut, w.text[0] ? " " : "", w.text);
    if (prv_bar_fits(shortest, out->event, false, avail)) { return; }
  }
  if (w.text[0] && prv_bar_fits(shortest, w.text, true, avail)) {
    snprintf(out->event, sizeof(out->event), "%s", w.text);
    out->glyph = true;
    return;
  }
  // Nothing else fits (no watch gets here): the date steps aside.
  out->date[0] = '\0';
  snprintf(out->event, sizeof(out->event), "%s", w.text[0] ? w.text : ev->name);
  out->glyph = w.text[0] != '\0';
}

// Draws the date and the event into the bar zone (its fill or rules are
// already drawn). stale_w: room kept at the right for the "!".
static void prv_bar_draw_event(GContext *ctx, GRect bz, const EventView *ev, int16_t stale_w,
                               GColor date_color, GColor event_color) {
  int16_t x0, x1;
  prv_bar_span(bz, &x0, &x1);
  static BarText bt;
  prv_bar_compose(&bt, ev, x1 - x0 - stale_w);
  const int16_t ty = bz.origin.y - BAR_LIFT, th = bz.size.h + 6;
  if (bt.date[0]) {
    graphics_context_set_text_color(ctx, date_color);
    graphics_draw_text(ctx, bt.date, g_font_banner, GRect(x0, ty, x1 - x0, th),
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  }
  int16_t right = x1 - stale_w, ew = text_width(bt.event, g_font_small);
  graphics_context_set_text_color(ctx, event_color);
  graphics_draw_text(ctx, bt.event, g_font_small, GRect(right - ew, ty, ew + 1, th),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  if (bt.glyph) {
    int16_t gw = status_icon_width(METRIC_NEXT_EVENT, BAR_GLYPH_S) - 2;
    status_icon_draw(ctx, METRIC_NEXT_EVENT,
                     GPoint(right - ew - 3 - gw, bz.origin.y + (bz.size.h - BAR_GLYPH_S) / 2),
                     BAR_GLYPH_S, event_color, theme_bg());
  }
}
#endif

void draw_calendar_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  const GColor fg = theme_fg();
  graphics_context_set_antialiased(ctx, false);
  // Whether the next event is drawn in the month bar this time.
  bool bar_event = false;

  // ---- Month banner / month column ------------------------------------
  if (g_layout.banner_visible && g_layout.banner_column) {
    // Round: the month as ONE inverted rounded bar with the abbreviation
    // stacked inside — the round-native echo of the rectangular banner.
    const char *abbr = MONTH_ABBR[g_now.tm_mon];
    int n = strlen(abbr);
    const int16_t letter_pitch = SMALL_DIGIT_H + 3;
    const int16_t pad = 4;
    GRect col = g_layout.banner_zone;
    int16_t bar_h = n * letter_pitch - 3 + 2 * pad;
    GRect bar = GRect(col.origin.x + (col.size.w - MONTH_TILE) / 2,
                      col.origin.y + (col.size.h - bar_h) / 2,
                      MONTH_TILE, bar_h);
    if (g_settings.banner_style == BANNER_STYLE_FILLED) {
      graphics_context_set_fill_color(ctx, theme_accent());
      graphics_fill_rect(ctx, bar, 3, GCornersAll);
      graphics_context_set_text_color(ctx, theme_on_accent());
    } else {
      if (g_settings.banner_style == BANNER_STYLE_RULED) {
        // A rounded outline around the letter stack — the vertical column's
        // analogue of the filled bar (horizontal rules read as stray marks
        // against a tall, narrow shape).
        graphics_context_set_stroke_color(ctx, theme_accent());
        graphics_draw_round_rect(ctx, bar, 3);
      }
      graphics_context_set_text_color(ctx, theme_accent());
    }
    char letter[2] = { 0, 0 };
    for (int i = 0; i < n; i++) {
      letter[0] = abbr[i];
      graphics_draw_text(ctx, letter, g_font_small_bold,
                         GRect(bar.origin.x,
                               bar.origin.y + pad + i * letter_pitch - SMALL_TOP_PAD,
                               bar.size.w, SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
  } else if (g_layout.banner_visible) {
#if defined(EVENT_IN_BAR)
    GRect bz = g_layout.banner_zone;
    bool filled = g_settings.banner_style == BANNER_STYLE_FILLED;
    EventView ev;
    if (event_in_bar() && event_current(&ev)) {
      if (filled) {
        graphics_context_set_fill_color(ctx, theme_accent());
        graphics_fill_rect(ctx, bz, 0, GCornerNone);
      } else if (g_settings.banner_style == BANNER_STYLE_RULED) {
        graphics_context_set_fill_color(ctx, theme_accent());
        graphics_fill_rect(ctx, GRect(bz.origin.x, bz.origin.y, bz.size.w, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(bz.origin.x, bz.origin.y + bz.size.h - 1, bz.size.w, 1),
                           0, GCornerNone);
      }
      int16_t stale_w = (g_settings.dots_enabled && g_dots.status != 0)
          ? text_width("!", g_font_banner) + 4 : 0;
      prv_bar_draw_event(ctx, bz, &ev, stale_w, filled ? theme_on_accent() : theme_accent(),
                         filled ? theme_on_accent() : fg);
      bar_event = true;
    }
#endif
  }
  if (g_layout.banner_visible && !g_layout.banner_column && !bar_event) {
    char banner_buf[40];
    prv_banner_text(banner_buf, sizeof(banner_buf), g_font_banner,
                    g_layout.banner_zone.size.w - 6);
    GRect bz = g_layout.banner_zone;
    if (g_settings.banner_style == BANNER_STYLE_FILLED) {
      graphics_context_set_fill_color(ctx, theme_accent());
      graphics_fill_rect(ctx, bz, 0, GCornerNone);
      graphics_context_set_text_color(ctx, theme_on_accent());
    } else {
      if (g_settings.banner_style == BANNER_STYLE_RULED) {
        // A 1px rule above and below the text, spanning the same width the
        // filled bar would (full bleed on the round display).
        graphics_context_set_fill_color(ctx, theme_accent());
        graphics_fill_rect(ctx, GRect(bz.origin.x, bz.origin.y, bz.size.w, 1),
                           0, GCornerNone);
        graphics_fill_rect(ctx, GRect(bz.origin.x, bz.origin.y + bz.size.h - 1,
                                      bz.size.w, 1), 0, GCornerNone);
      }
      graphics_context_set_text_color(ctx, theme_accent());
    }
    GRect text_box = g_layout.banner_zone;
    text_box.origin.y -= (PBL_DISPLAY_WIDTH >= 200 ? 3 : 2);
    text_box.size.h += 6;
    graphics_draw_text(ctx, banner_buf, g_font_banner, text_box,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

  // A small "!" when event markers are on but the phone's last calendar
  // refresh failed (cached markers stay up; this says they may be stale).
  if (g_settings.dots_enabled && g_dots.status != 0) {
    if (g_layout.side_columns && g_layout.banner_column) {
      GRect col = g_layout.banner_zone;
      graphics_context_set_text_color(ctx, fg);
      graphics_draw_text(ctx, "!", g_font_small_bold,
                         GRect(col.origin.x, col.origin.y + col.size.h - SMALL_DIGIT_H
                                   - SMALL_TOP_PAD - 1,
                               col.size.w, SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    } else if (g_layout.banner_visible) {
      // Right edge of the banner; on a round display the bar is full-bleed,
      // so inset far enough to stay inside the circle's chord. With the event
      // in the bar it sits at the end of the text's span, after the event.
      GRect bz = g_layout.banner_zone;
      int16_t inset = PBL_IF_ROUND_ELSE(24, 5);
#if defined(EVENT_IN_BAR)
      if (bar_event) {
        int16_t x0, x1;
        prv_bar_span(bz, &x0, &x1);
        inset = bz.origin.x + bz.size.w - x1;
      }
#endif
      graphics_context_set_text_color(ctx, g_settings.banner_style == BANNER_STYLE_FILLED
                                           ? theme_on_accent() : theme_accent());
      graphics_draw_text(ctx, "!", g_font_banner,
                         GRect(bz.origin.x, bz.origin.y - (PBL_DISPLAY_WIDTH >= 200 ? 3 : 2),
                               bz.size.w - inset, bz.size.h + 6),
                         GTextOverflowModeFill, GTextAlignmentRight, NULL);
    }
  }

  // ---- Inline month (compressed view) ---------------------------------
  // When the banner bar is squeezed out but the month's first row has >=5
  // empty leading cells, the month lives there instead: an accent mini-bar
  // in the otherwise-empty space, costing no height.
  if (g_layout.banner_inline) {
    int ilead = month_lead_for(&g_now, start_wday_setting());
    if (ilead >= 2) {
      GRect bar = GRect(g_layout.grid_zone.origin.x,
                        g_layout.grid_zone.origin.y,
                        (int16_t) (ilead * g_layout.cell_w - 3),
                        (int16_t) (g_layout.row_pitch - 1));
      bool inline_filled = (g_settings.banner_style == BANNER_STYLE_FILLED);
      if (inline_filled) {
        graphics_context_set_fill_color(ctx, theme_accent());
        graphics_fill_rect(ctx, bar, 2, GCornersAll);
      } else if (g_settings.banner_style == BANNER_STYLE_RULED) {
        graphics_context_set_fill_color(ctx, theme_accent());
        graphics_fill_rect(ctx, GRect(bar.origin.x, bar.origin.y, bar.size.w, 1),
                           0, GCornerNone);
        graphics_fill_rect(ctx, GRect(bar.origin.x, bar.origin.y + bar.size.h - 1,
                                      bar.size.w, 1), 0, GCornerNone);
      }
      char inbuf[16];
      strftime(inbuf, sizeof(inbuf), "%B", &g_now);
      prv_uppercase(inbuf);
      if (!prv_text_fits(inbuf, g_font_small_bold, bar.size.w - 4)) {
        strncpy(inbuf, MONTH_ABBR[g_now.tm_mon], sizeof(inbuf) - 1);
        inbuf[sizeof(inbuf) - 1] = 0;
      }
      graphics_context_set_text_color(ctx, inline_filled ? theme_on_accent()
                                                        : theme_accent());
      graphics_draw_text(ctx, inbuf, g_font_small_bold,
                         GRect(bar.origin.x,
                               bar.origin.y + (bar.size.h - SMALL_DIGIT_H) / 2
                                   - SMALL_TOP_PAD,
                               bar.size.w, SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
  }

  // ---- Weekday header -------------------------------------------------
  int start_wday = start_wday_setting();
  if (g_layout.header_visible) {
    graphics_context_set_text_color(ctx, fg);
    for (int i = 0; i < 7; i++) {
      int day_i = (start_wday + i) % 7;
#if defined(PBL_ROUND) && PBL_DISPLAY_WIDTH < 200
      // 16px cells on the small round watch only fit one letter.
      const char *label = WEEKDAY_LETTERS[day_i];
#else
      const char *label = (g_settings.header_label == HEADER_LABEL_ONE)
          ? WEEKDAY_LETTERS[day_i] : WEEKDAY_LABELS[day_i];
#endif
      GRect box = GRect(g_layout.header_zone.origin.x + i * g_layout.cell_w,
                        g_layout.header_zone.origin.y - HEADER_TOP_PAD,
                        g_layout.cell_w,
                        g_layout.header_zone.size.h + HEADER_TOP_PAD + TEXT_BOX_SLACK);
      graphics_draw_text(ctx, label, g_font_header, box,
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
  }

  // ---- Day grid -------------------------------------------------------
  int year = g_now.tm_year + 1900;
  int mon = g_now.tm_mon;
  int today = g_now.tm_mday;
  int ndays = days_in_month(year, mon);
  int wday1 = (g_now.tm_wday - ((today - 1) % 7) + 7) % 7;  // weekday of the 1st
  int lead = (wday1 - start_wday + 7) % 7;
  int rows = (lead + ndays + 6) / 7;

  int prev_mon = (mon + 11) % 12;
  int prev_year = (mon == 0) ? year - 1 : year;
  int prev_ndays = days_in_month(prev_year, prev_mon);

  bool dots_current = g_settings.dots_enabled
      && g_layout.row_pitch >= MIN_PITCH_FOR_DOTS
      && g_dots.monthkey == (uint16_t) (year * 16 + mon + 1);

  prv_draw_grid_lines(ctx, g_layout.grid_zone,
                      g_settings.show_adjacent ? 6 : rows);

  // With adjacent days on, fill the whole reserved 6-row zone (a 4- or
  // 5-row month then shows the next month's first weeks dimmed).
  int total_cells = g_settings.show_adjacent ? 6 * 7 : rows * 7;
  for (int cell_i = 0; cell_i < total_cells; cell_i++) {
    int day = cell_i - lead + 1;
    int col = cell_i % 7;
    int row = cell_i / 7;
    GRect cell = GRect(g_layout.grid_zone.origin.x + col * g_layout.cell_w,
                       g_layout.grid_zone.origin.y + row * g_layout.row_pitch,
                       g_layout.cell_w, g_layout.row_pitch);

    if (day < 1 || day > ndays) {
      if (!g_settings.show_adjacent) { continue; }
      int shown = (day < 1) ? prev_ndays + day : day - ndays;
      // Gray on color displays; plain on B&W (dithering 1px glyphs would
      // destroy them).
      prv_draw_day_number(ctx, shown, cell, theme_dim(), dots_current);
      continue;
    }

    bool is_today = (day == today);
    if (is_today) {
      // The box is anchored to where the digits actually render (their
      // visible top) with symmetric 2px margins, so it stays optically
      // centered at every pitch and on every platform.
      int16_t digit_top = dots_current
          ? cell.origin.y
          : cell.origin.y + (cell.size.h - 1 - SMALL_DIGIT_H) / 2;
      GRect box = GRect(cell.origin.x + 1, digit_top - 2,
                        cell.size.w - 2, SMALL_DIGIT_H + 4);
      // The box may borrow one empty pixel row from the cell above so its
      // top border survives even at the tightest pitches.
      if (box.origin.y < cell.origin.y - 1) { box.origin.y = cell.origin.y - 1; }
      int16_t max_bottom = cell.origin.y + cell.size.h;
      if (box.origin.y + box.size.h > max_bottom) {
        box.size.h = max_bottom - box.origin.y;
      }
      graphics_context_set_fill_color(ctx, theme_accent());
      graphics_fill_rect(ctx, box, 2, GCornersAll);
      prv_draw_day_number(ctx, day, cell, theme_on_accent(), dots_current);
    } else {
      prv_draw_day_number(ctx, day, cell, fg, dots_current);
    }
    if (dots_current) {
      prv_draw_dots(ctx, day, cell, is_today);
    }
  }
}
