#include "common.h"

// Month banner + weekday header + the day grid, with today inverted,
// optional dimmed adjacent-month days and optional per-day event dots.

#if PBL_DISPLAY_WIDTH >= 200
  #define GRID_TEXT_H 18
  #define DOT_S 4
  #define DOT_GAP 2
  #define MIN_PITCH_FOR_DOTS 16
#else
  #define GRID_TEXT_H 11
  #define DOT_S 3
  #define DOT_GAP 1
  #define MIN_PITCH_FOR_DOTS 11
#endif

static const char *const WEEKDAY_LABELS[7] = { "SU", "MO", "TU", "WE", "TH", "FR", "SA" };

static int prv_start_wday(void) {
  switch (g_settings.start_day) {
    case START_MONDAY: return 1;
    case START_SATURDAY: return 6;
    default: return 0;
  }
}

// 50%-checkerboard "gray" for B&W platforms: punch background-colored pixels
// over whatever was just drawn in this rect.
#if defined(PBL_BW)
static void prv_dither_rect(GContext *ctx, GRect rect, GColor bg) {
  graphics_context_set_stroke_color(ctx, bg);
  for (int16_t y = rect.origin.y; y < rect.origin.y + rect.size.h; y++) {
    for (int16_t x = rect.origin.x; x < rect.origin.x + rect.size.w; x++) {
      if (((x + y) & 1) == 0) {
        graphics_draw_pixel(ctx, GPoint(x, y));
      }
    }
  }
}
#endif

static void prv_draw_day_number(GContext *ctx, int day, GRect cell, GColor color) {
  char buf[4];
  snprintf(buf, sizeof(buf), "%d", day);
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, buf, g_font_small,
                     GRect(cell.origin.x, cell.origin.y, cell.size.w, GRID_TEXT_H + 4),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void prv_draw_dots(GContext *ctx, int day, GRect cell, bool on_today_box) {
  if (!g_settings.dots_enabled || g_layout.row_pitch < MIN_PITCH_FOR_DOTS) { return; }
  if (day < 1 || day > 31) { return; }
  uint8_t mask = g_dots.days[day - 1];
  if (!mask) { return; }

  // One marker per calendar: solid square = timed event, hollow = all-day.
  int n = 0;
  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    if (mask & (DOT_TIMED_BIT(cal) | DOT_ALLDAY_BIT(cal))) { n++; }
  }
  int16_t total_w = n * DOT_S + (n - 1) * DOT_GAP;
  int16_t x = cell.origin.x + (cell.size.w - total_w) / 2;
  int16_t y = cell.origin.y + cell.size.h - DOT_S - 1;

  for (int cal = 0; cal < NUM_CALENDARS; cal++) {
    bool timed = mask & DOT_TIMED_BIT(cal);
    bool allday = mask & DOT_ALLDAY_BIT(cal);
    if (!timed && !allday) { continue; }
#if defined(PBL_COLOR)
    GColor c = (GColor) { .argb = g_settings.cal_colors[cal] };
    if (on_today_box && gcolor_equal(c, theme_fg())) { c = theme_bg(); }
#else
    GColor c = on_today_box ? theme_bg() : theme_fg();
#endif
    GRect dot = GRect(x, y, DOT_S, DOT_S);
    if (timed) {
      graphics_context_set_fill_color(ctx, c);
      graphics_fill_rect(ctx, dot, 0, GCornerNone);
    } else {
      graphics_context_set_stroke_color(ctx, c);
      graphics_draw_rect(ctx, dot);
    }
    x += DOT_S + DOT_GAP;
  }
}

void draw_calendar_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  graphics_context_set_antialiased(ctx, false);

  // ---- Month banner ---------------------------------------------------
  if (g_layout.banner_visible) {
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
      const char *label = WEEKDAY_LABELS[(start_wday + i) % 7];
      GRect box = GRect(g_layout.header_zone.origin.x + i * g_layout.cell_w,
                        g_layout.header_zone.origin.y,
                        g_layout.cell_w, g_layout.header_zone.size.h + 4);
      graphics_draw_text(ctx, label, g_font_small_bold, box,
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
      && g_dots.monthkey == (uint16_t) (year * 16 + mon + 1);

  for (int cell_i = 0; cell_i < rows * 7; cell_i++) {
    int day = cell_i - lead + 1;
    int col = cell_i % 7;
    int row = cell_i / 7;
    GRect cell = GRect(g_layout.grid_zone.origin.x + col * g_layout.cell_w,
                       g_layout.grid_zone.origin.y + row * g_layout.row_pitch,
                       g_layout.cell_w, g_layout.row_pitch);

    if (day < 1 || day > ndays) {
      if (!g_settings.show_adjacent) { continue; }
      int shown = (day < 1) ? prev_ndays + day : day - ndays;
#if defined(PBL_COLOR)
      prv_draw_day_number(ctx, shown, cell, theme_dim());
#else
      prv_draw_day_number(ctx, shown, cell, fg);
      prv_dither_rect(ctx, GRect(cell.origin.x, cell.origin.y, cell.size.w, GRID_TEXT_H),
                      bg);
#endif
      continue;
    }

    bool is_today = (day == today);
    if (is_today) {
      GRect box = GRect(cell.origin.x + 1, cell.origin.y,
                        cell.size.w - 2, cell.size.h - 1);
      graphics_context_set_fill_color(ctx, fg);
      graphics_fill_rect(ctx, box, 2, GCornersAll);
      prv_draw_day_number(ctx, day, cell, bg);
    } else {
      prv_draw_day_number(ctx, day, cell, fg);
    }
    if (dots_current) {
      prv_draw_dots(ctx, day, cell, is_today);
    }
  }
}
