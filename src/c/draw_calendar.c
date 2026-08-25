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

static const char *const WEEKDAY_LABELS[7] = { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };
static const char *const WEEKDAY_LETTERS[7] = { "S", "M", "T", "W", "T", "F", "S" };
static const char *const MONTH_ABBR[12] = {
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
};

static int prv_start_wday(void) {
  switch (g_settings.start_day) {
    case START_MONDAY: return 1;
    case START_SATURDAY: return 6;
    default: return 0;
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

  int n = 0;
  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    if (mask & (DOT_TIMED_BIT(cal) | DOT_ALLDAY_BIT(cal))) { n++; }
  }
  if (n == 0) { return; }
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
    if (!(mask & (DOT_TIMED_BIT(cal) | DOT_ALLDAY_BIT(cal)))) { continue; }
#if defined(PBL_COLOR)
    GColor c = (GColor) { .argb = g_settings.cal_colors[cal] };
    if (on_today_box && gcolor_equal(c, theme_fg())) { c = theme_bg(); }
#else
    GColor c = on_today_box ? theme_bg() : theme_fg();
#endif
    graphics_context_set_fill_color(ctx, c);
    if (bar_style) {
      // A 1px bar split into equal per-calendar sections (single solid bar
      // on B&W).
      int16_t w = bar_w / n + (seg == n - 1 ? bar_w % n : 0);
      graphics_fill_rect(ctx, GRect(x, marker_y, w, DOT_BAR_H), 0, GCornerNone);
      x += w;
    } else {
      graphics_fill_rect(ctx, GRect(x, marker_y, DOT_SQ_W, sq_h), 0, GCornerNone);
      x += DOT_SQ_W + DOT_GAP;
    }
    seg++;
  }
}

void draw_calendar_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  graphics_context_set_antialiased(ctx, false);

  // ---- Month banner / month column ------------------------------------
  if (g_layout.banner_visible && g_layout.side_columns) {
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
    graphics_context_set_fill_color(ctx, fg);
    graphics_fill_rect(ctx, bar, 3, GCornersAll);
    graphics_context_set_text_color(ctx, bg);
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
    char month_buf[24];
    strftime(month_buf, sizeof(month_buf), "%B", &g_now);
    // Uppercase ASCII only; leave multi-byte (localized) glyphs untouched.
    for (char *p = month_buf; *p; p++) {
      if (*p >= 'a' && *p <= 'z') { *p -= 32; }
    }
    graphics_context_set_fill_color(ctx, fg);
    graphics_fill_rect(ctx, g_layout.banner_zone, 0, GCornerNone);
    graphics_context_set_text_color(ctx, bg);
    GRect text_box = g_layout.banner_zone;
    text_box.origin.y -= (PBL_DISPLAY_WIDTH >= 200 ? 3 : 2);
    text_box.size.h += 6;
    graphics_draw_text(ctx, month_buf, g_font_banner, text_box,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

  // ---- Weekday header -------------------------------------------------
  int start_wday = prv_start_wday();
  if (g_layout.header_visible) {
    graphics_context_set_text_color(ctx, fg);
    for (int i = 0; i < 7; i++) {
      int day_i = (start_wday + i) % 7;
      const char *label = g_layout.side_columns ? WEEKDAY_LETTERS[day_i]
                                                : WEEKDAY_LABELS[day_i];
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
      // visible top), so it stays optically centered at every pitch.
      // On low-DPI it rides 1px higher (and keeps 1px clear at the cell
      // bottom even when clamped) — it read one pixel low otherwise.
#if PBL_DISPLAY_WIDTH >= 200
      const int16_t lift = 0;
#else
      const int16_t lift = 1;
#endif
      int16_t digit_top = dots_current
          ? cell.origin.y
          : cell.origin.y + (cell.size.h - 1 - SMALL_DIGIT_H) / 2;
      GRect box = GRect(cell.origin.x + 1, digit_top - 2 - lift,
                        cell.size.w - 2, SMALL_DIGIT_H + 5);
      if (box.origin.y < cell.origin.y) { box.origin.y = cell.origin.y; }
      int16_t max_bottom = cell.origin.y + cell.size.h - lift;
      if (box.origin.y + box.size.h > max_bottom) {
        box.size.h = max_bottom - box.origin.y;
      }
      graphics_context_set_fill_color(ctx, fg);
      graphics_fill_rect(ctx, box, 2, GCornersAll);
      prv_draw_day_number(ctx, day, cell, bg, dots_current);
    } else {
      prv_draw_day_number(ctx, day, cell, fg, dots_current);
    }
    if (dots_current) {
      prv_draw_dots(ctx, day, cell, is_today);
    }
  }
}
