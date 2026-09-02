#include "common.h"

// The status line: up to NUM_METRIC_SLOTS user-prioritized metrics. Items
// are measured first and appended in priority order while they fit; metrics
// with no meaningful data are skipped entirely.
//
// Rectangular watches render one horizontal line under the time with a
// dotted rule. Round watches render a vertical icon-over-value column in the
// right crescent beside the grid (layout sets side_columns), where the same
// fit rule applies vertically — and horizontally: an entry wider than the
// crescent is skipped.

#if PBL_DISPLAY_WIDTH >= 200
  #define ICON_S 13
  #define ITEM_GAP 10
  #define ICON_TEXT_GAP 3
  #define TEXT_BOX_SLACK 12
#else
  #define ICON_S 9
  #define ITEM_GAP 8
  #define ICON_TEXT_GAP 2
  #define TEXT_BOX_SLACK 10
#endif

typedef struct {
  uint8_t metric;
  char text[16];
  int16_t icon_w;
  int16_t text_w;
} StatusItem;

#if defined(PBL_HEALTH)
static bool prv_health_ok(HealthMetric metric) {
  time_t now = time(NULL);
  HealthServiceAccessibilityMask mask =
      health_service_metric_accessible(metric, time_start_of_today(), now);
  return (mask & HealthServiceAccessibilityMaskAvailable) != 0;
}

static void prv_format_count(char *buf, size_t len, int32_t v) {
  if (v < 10000) {
    // "1986" and "2.0k" are both four characters, so the compact form bought
    // no width below 10k while losing precision against the Health app.
    snprintf(buf, len, "%d", (int) v);
  } else {
    // Above 10k the short form is a genuine saving (3 chars vs 5); round
    // rather than truncate so 12893 reads 13k, not 12k.
    snprintf(buf, len, "%dk", (int) ((v + 500) / 1000));
  }
}

// Meters -> tenths of the display unit, matching the firmware health app's
// health_util_convert_fraction_to_whole_and_decimal_part() exactly (round,
// don't truncate) so the face and the Health app never disagree.
// METERS_PER_MILE is 1609 in the firmware, not 16093 -- see units.h.
#define METERS_PER_MILE 1609
#define METERS_PER_KM   1000

static int32_t prv_distance_tenths(int32_t meters, bool miles) {
  const int32_t denom = miles ? METERS_PER_MILE : METERS_PER_KM;
  return (meters * 100 + denom * 5) / (denom * 10);
}
#endif

// Returns false if this metric has no meaningful data right now (hidden).
// compact drops unit suffixes for the narrow round-crescent column, where
// the icon already carries the meaning.
static bool prv_metric_text(uint8_t metric, char *buf, size_t len, bool compact) {
  buf[0] = '\0';
  switch (metric) {
    case METRIC_BATTERY: {
      BatteryChargeState st = battery_state_service_peek();
      snprintf(buf, len, compact ? "%d" : "%d%%", st.charge_percent);
      return true;
    }
    case METRIC_WEATHER: {
      if (g_weather.fetched_at == 0) { return false; }
      time_t now = time(NULL);
      if (now - g_weather.fetched_at > WEATHER_STALE_SECONDS) { return false; }
      int t = g_weather.temp_c;
      if (g_settings.temp_fahrenheit) {
        t = (t * 9 + (t >= 0 ? 2 : -2)) / 5 + 32;  // rounded C -> F
        snprintf(buf, len, compact ? "%d°" : "%d°F", t);
      } else {
        snprintf(buf, len, compact ? "%d°" : "%d°C", t);
      }
      return true;
    }
#if defined(PBL_HEALTH)
    case METRIC_STEPS: {
      if (!prv_health_ok(HealthMetricStepCount)) { return false; }
      HealthValue steps = health_service_sum_today(HealthMetricStepCount);
      if (steps < 10) { return false; }   // not meaningful yet
      prv_format_count(buf, len, steps);
      return true;
    }
    case METRIC_DISTANCE: {
      if (!prv_health_ok(HealthMetricWalkedDistanceMeters)) { return false; }
      int32_t m = health_service_sum_today(HealthMetricWalkedDistanceMeters);
      const char *unit = g_settings.dist_miles ? "mi" : "km";
      int32_t tenths = prv_distance_tenths(m, g_settings.dist_miles);
      if (tenths < 1) { return false; }   // under 0.1 mi/km: not meaningful
      // Keep the tenth until 100 units; dropping it at 10 lost real precision
      // on long days (10.4mi displayed as "10mi").
      if (tenths >= 1000) {
        snprintf(buf, len, "%d%s", (int) (tenths / 10), unit);
      } else {
        snprintf(buf, len, "%d.%d%s", (int) (tenths / 10), (int) (tenths % 10), unit);
      }
      return true;
    }
    case METRIC_HEART_RATE: {
      HealthValue bpm = health_service_peek_current_value(HealthMetricHeartRateBPM);
      if (bpm <= 0) { return false; }
      snprintf(buf, len, "%d", (int) bpm);
      return true;
    }
    case METRIC_ACTIVE_MIN: {
      if (!prv_health_ok(HealthMetricActiveSeconds)) { return false; }
      int32_t min = health_service_sum_today(HealthMetricActiveSeconds) / 60;
      if (min >= 60) {
        snprintf(buf, len, "%dh%02d", (int) (min / 60), (int) (min % 60));
      } else {
        snprintf(buf, len, "%dm", (int) min);
      }
      return true;
    }
    case METRIC_CALORIES: {
      if (!prv_health_ok(HealthMetricActiveKCalories)) { return false; }
      prv_format_count(buf, len, health_service_sum_today(HealthMetricActiveKCalories));
      return true;
    }
    // Active + resting, which is what the on-watch Health app's calorie figure
    // shows (see health/data.c) and what phone health apps report.
    case METRIC_CALORIES_TOTAL: {
      if (!prv_health_ok(HealthMetricActiveKCalories)
          || !prv_health_ok(HealthMetricRestingKCalories)) { return false; }
      prv_format_count(buf, len, health_service_sum_today(HealthMetricActiveKCalories)
                                 + health_service_sum_today(HealthMetricRestingKCalories));
      return true;
    }
    case METRIC_SLEEP: {
      if (!prv_health_ok(HealthMetricSleepSeconds)) { return false; }
      int32_t sec = health_service_sum_today(HealthMetricSleepSeconds);
      if (sec <= 0) { return false; }
      snprintf(buf, len, "%dh%02d", (int) (sec / 3600), (int) ((sec % 3600) / 60));
      return true;
    }
#endif
    case METRIC_WEEK_NUM:
      snprintf(buf, len, "W%d", iso_week_number(&g_now));
      return true;
    // On pre-2025 platforms alarm_service_peek_next is an SDK stub that
    // always returns false, so the metric simply stays hidden there.
    case METRIC_NEXT_ALARM: {
      time_t when = 0;
      if (!alarm_service_peek_next(&when)) { return false; }
      struct tm *lt = localtime(&when);
      if (!lt) { return false; }
      bool use_24h = (g_settings.time_format == TIME_FMT_24H)
          || (g_settings.time_format == TIME_FMT_SYSTEM && clock_is_24h_style());
      if (use_24h || compact) {
        snprintf(buf, len, "%d:%02d", lt->tm_hour, lt->tm_min);
      } else {
        int hour = lt->tm_hour % 12;
        if (hour == 0) { hour = 12; }
        snprintf(buf, len, "%d:%02d%c", hour, lt->tm_min, lt->tm_hour < 12 ? 'a' : 'p');
      }
      return true;
    }
    case METRIC_CONNECTION:
      // Shows only as a warning: icon when disconnected, hidden when fine.
      return !g_connected;
    default:
      return false;
  }
}

// Collects up to NUM_METRIC_SLOTS displayable items in priority order
// (deduped, no-data metrics skipped). Returns the count.
static int prv_collect_items(StatusItem *items, bool compact) {
  const GRect measure_box = GRect(0, 0, 32767, 32767);
  int n = 0;
  for (int slot = 0; slot < NUM_METRIC_SLOTS; slot++) {
    uint8_t metric = g_settings.metrics[slot];
    if (metric == METRIC_NONE || metric >= METRIC_TYPE_COUNT) { continue; }
    bool dup = false;
    for (int j = 0; j < n; j++) {
      if (items[j].metric == metric) { dup = true; break; }
    }
    if (dup) { continue; }
    StatusItem *item = &items[n];
    item->metric = metric;
    if (!prv_metric_text(metric, item->text, sizeof(item->text), compact)) { continue; }
    item->icon_w = status_icon_width(metric, ICON_S);
    item->text_w = item->text[0]
        ? graphics_text_layout_get_content_size(item->text, g_font_small, measure_box,
                                                GTextOverflowModeFill,
                                                GTextAlignmentLeft).w
        : 0;
    n++;
  }
  return n;
}

static void prv_draw_horizontal(GContext *ctx, const GRect zone) {
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  StatusItem items[NUM_METRIC_SLOTS];
  int n_all = prv_collect_items(items, false);

  // Append in priority order while the line still fits.
  int n = 0;
  int16_t total_w = 0;
  const int16_t max_w = zone.size.w - 4;
  for (; n < n_all; n++) {
    StatusItem *item = &items[n];
    int16_t w = item->icon_w + (item->icon_w && item->text_w ? ICON_TEXT_GAP : 0)
        + item->text_w;
    int16_t gap = n > 0 ? ITEM_GAP : 0;
    if (total_w + gap + w > max_w) { break; }
    total_w += gap + w;
  }

  int16_t x = zone.origin.x + (zone.size.w - total_w) / 2;
  int16_t icon_y = zone.origin.y + (zone.size.h - 2 - ICON_S) / 2;
  int16_t text_y = zone.origin.y + (zone.size.h - 2 - SMALL_DIGIT_H) / 2 - SMALL_TOP_PAD;

  for (int i = 0; i < n; i++) {
    StatusItem *item = &items[i];
    if (i > 0) {
      // Small separator dot centered in the gap.
      graphics_context_set_fill_color(ctx, theme_dim());
      graphics_fill_rect(ctx, GRect(x - ITEM_GAP / 2 - 1,
                                    zone.origin.y + zone.size.h / 2 - 2, 1, 1),
                         0, GCornerNone);
    }
    if (item->icon_w) {
      status_icon_draw(ctx, item->metric, GPoint(x, icon_y), ICON_S, fg, bg);
      x += item->icon_w + (item->text_w ? ICON_TEXT_GAP : 0);
    }
    if (item->text_w) {
      graphics_context_set_text_color(ctx, fg);
      graphics_draw_text(ctx, item->text, g_font_small,
                         GRect(x, text_y, item->text_w + 2,
                               SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentLeft, NULL);
      x += item->text_w;
    }
    x += ITEM_GAP;
  }
}

// Half-width of the display circle at row y, with a 2px bezel margin
// (integer sqrt — no float math on the watch).
static int16_t prv_chord_half(int16_t y) {
  const int32_t r = PBL_DISPLAY_WIDTH / 2 - 2;
  int32_t dy = (int32_t) y - PBL_DISPLAY_WIDTH / 2;
  int32_t v = r * r - dy * dy;
  if (v <= 0) { return 0; }
  int32_t s = 0;
  while ((s + 1) * (s + 1) <= v) { s++; }
  return (int16_t) s;
}

// Places a run of width w, nominally centered in the zone, so it stays
// inside the circle at rows [y0, y1] without crossing into the grid.
// Returns the x to draw at, or -1 when it cannot fit.
static int16_t prv_crescent_x(const GRect zone, int16_t w, int16_t y0, int16_t y1,
                              bool left_column) {
  const int16_t c = PBL_DISPLAY_WIDTH / 2;
  int16_t dy0 = (int16_t) (y0 < c ? c - y0 : y0 - c);
  int16_t dy1 = (int16_t) (y1 < c ? c - y1 : y1 - c);
  int16_t half = prv_chord_half(c + (dy0 > dy1 ? dy0 : dy1));
  int16_t x = zone.origin.x + (zone.size.w - w) / 2;
  if (left_column) {
    int16_t min_x = c - half;
    if (x < min_x) { x = min_x; }
    if (x + w > zone.origin.x + zone.size.w) { return -1; }   // would hit the grid
  } else {
    int16_t max_x = c + half;
    if (x + w > max_x) { x = max_x - w; }
    if (x < zone.origin.x) { return -1; }                      // would hit the grid
  }
  return x;
}

static void prv_draw_column(GContext *ctx, const GRect zone,
                            StatusItem **picked, int n_all, bool left_column) {
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();

  // Vertical fit: entries stack while there is room; entries wider than the
  // crescent are skipped (they would clip against the bezel).
  StatusItem *fit[NUM_METRIC_SLOTS];
  int16_t icon_x[NUM_METRIC_SLOTS], text_x[NUM_METRIC_SLOTS];
  int16_t item_h[NUM_METRIC_SLOTS];
  int n = 0;
  int16_t total_h = 0;
  // Tight icon-over-value pairs with generous space BETWEEN entries, so
  // each metric reads as one unit.
  const int16_t pair_gap = 1;
  const int16_t entry_gap = (PBL_DISPLAY_WIDTH >= 200) ? 13 : 9;
  // Two-crescent mode anchors at the top of the band, where the circle is
  // widest; the single right column (chalk) stays vertically centered.
  const bool top_anchor = g_layout.status_two_columns;

  int16_t place_y = zone.origin.y;
  for (int i = 0; i < n_all; i++) {
    StatusItem *item = picked[i];
    if (item->text_w > zone.size.w && item->icon_w == 0) { continue; }
    if (item->text_w > zone.size.w) { item->text[0] = '\0'; item->text_w = 0; }
    int16_t h = (item->icon_w ? ICON_S : 0)
        + (item->icon_w && item->text_w ? pair_gap : 0)
        + (item->text_w ? SMALL_DIGIT_H : 0);
    if (h == 0) { continue; }
    int16_t gap = n > 0 ? entry_gap : 0;
    if (total_h + gap + h > zone.size.h) { break; }
    // Chord check at the rows this entry would occupy (top-anchored mode
    // only — the centered single column moves after selection, and its
    // right-crescent placement has always cleared the bezel there).
    int16_t iy = place_y + gap;
    int16_t ix = -1, tx = -1;
    if (top_anchor) {
      int16_t yy = iy;
      if (item->icon_w) {
        ix = prv_crescent_x(zone, item->icon_w, yy, yy + ICON_S, left_column);
        if (ix < 0) { break; }   // rows below are only narrower
        yy += ICON_S + (item->text_w ? pair_gap : 0);
      }
      if (item->text_w) {
        tx = prv_crescent_x(zone, item->text_w, yy, yy + SMALL_DIGIT_H, left_column);
        if (tx < 0) { break; }
      }
    }
    fit[n] = item;
    icon_x[n] = ix;
    text_x[n] = tx;
    item_h[n] = h;
    total_h += gap + h;
    place_y = iy + h;
    n++;
  }
  (void) item_h;

#if defined(PBL_ROUND)
  // Centered column (the 180px round watch): the selection above skipped
  // the chord check because the start y depends on the final content
  // height. Validate now — if the lowest entry would cross the bezel,
  // shift it inward, and when even that fails drop it and re-center.
  while (!top_anchor && n > 0) {
    int16_t yy = zone.origin.y + (zone.size.h - total_h) / 2;
    bool ok = true;
    for (int i = 0; i < n && ok; i++) {
      StatusItem *item = fit[i];
      if (i > 0) { yy += entry_gap; }
      int16_t ix = -1, tx = -1;
      if (item->icon_w) {
        ix = prv_crescent_x(zone, item->icon_w, yy, yy + ICON_S, left_column);
        if (ix < 0) { ok = false; break; }
        yy += ICON_S + (item->text_w ? pair_gap : 0);
      }
      if (item->text_w) {
        tx = prv_crescent_x(zone, item->text_w, yy, yy + SMALL_DIGIT_H, left_column);
        if (tx < 0) { ok = false; break; }
        yy += SMALL_DIGIT_H;
      }
      icon_x[i] = ix;
      text_x[i] = tx;
    }
    if (ok) { break; }
    n--;
    total_h -= item_h[n] + (n > 0 ? entry_gap : 0);
  }
#endif

  int16_t y = top_anchor ? zone.origin.y
                         : zone.origin.y + (zone.size.h - total_h) / 2;
  for (int i = 0; i < n; i++) {
    StatusItem *item = fit[i];
    if (item->icon_w) {
      int16_t ix = icon_x[i] >= 0 ? icon_x[i]
          : (int16_t) (zone.origin.x + (zone.size.w - item->icon_w) / 2);
      status_icon_draw(ctx, item->metric, GPoint(ix, y), ICON_S, fg, bg);
      y += ICON_S + (item->text_w ? pair_gap : 0);
    }
    if (item->text_w) {
      int16_t tx = text_x[i] >= 0 ? text_x[i]
          : (int16_t) (zone.origin.x + (zone.size.w - item->text_w) / 2);
      graphics_context_set_text_color(ctx, fg);
      graphics_draw_text(ctx, item->text, g_font_small,
                         GRect(tx, y - SMALL_TOP_PAD, item->text_w + 3,
                               SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentLeft, NULL);
      y += SMALL_DIGIT_H;
    }
    y += entry_gap;
  }
}

void draw_status_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  if (!g_layout.status_visible) { return; }
  graphics_context_set_antialiased(ctx, false);
  if (!g_layout.side_columns) {
    prv_draw_horizontal(ctx, g_layout.status_zone);
    return;
  }

  StatusItem items[NUM_METRIC_SLOTS];
  int n_all = prv_collect_items(items, true);
  if (!g_layout.status_two_columns) {
    StatusItem *all[NUM_METRIC_SLOTS];
    for (int i = 0; i < n_all; i++) { all[i] = &items[i]; }
    prv_draw_column(ctx, g_layout.status_zone, all, n_all, false);
    return;
  }

  // Two crescents: priority order alternates left, right, left, right...
  StatusItem *left[NUM_METRIC_SLOTS];
  StatusItem *right[NUM_METRIC_SLOTS];
  int nl = 0, nr = 0;
  for (int i = 0; i < n_all; i++) {
    if (i % 2 == 0) { left[nl++] = &items[i]; } else { right[nr++] = &items[i]; }
  }
  prv_draw_column(ctx, g_layout.status_zone_left, left, nl, true);
  prv_draw_column(ctx, g_layout.status_zone, right, nr, false);
}
