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
  if (v < 1000) {
    snprintf(buf, len, "%d", (int) v);
  } else if (v < 10000) {
    snprintf(buf, len, "%d.%dk", (int) (v / 1000), (int) ((v % 1000) / 100));
  } else {
    snprintf(buf, len, "%dk", (int) (v / 1000));
  }
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
      prv_format_count(buf, len, health_service_sum_today(HealthMetricStepCount));
      return true;
    }
    case METRIC_DISTANCE: {
      if (!prv_health_ok(HealthMetricWalkedDistanceMeters)) { return false; }
      int32_t m = health_service_sum_today(HealthMetricWalkedDistanceMeters);
      const char *unit = g_settings.dist_miles ? "mi" : "km";
      int32_t tenths = g_settings.dist_miles ? (m * 10) / 16093 : m / 100;
      if (tenths >= 100) {
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

static void prv_draw_column(GContext *ctx, const GRect zone) {
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  StatusItem items[NUM_METRIC_SLOTS];
  int n_all = prv_collect_items(items, true);

  // Vertical fit: entries stack while there is room; entries wider than the
  // crescent are skipped (they would clip against the bezel).
  StatusItem *fit[NUM_METRIC_SLOTS];
  int n = 0;
  int16_t total_h = 0;
  // Tight icon-over-value pairs with generous space BETWEEN entries, so
  // each metric reads as one unit.
  const int16_t pair_gap = 1;
  const int16_t entry_gap = (PBL_DISPLAY_WIDTH >= 200) ? 13 : 9;
  for (int i = 0; i < n_all; i++) {
    StatusItem *item = &items[i];
    if (item->text_w > zone.size.w && item->icon_w == 0) { continue; }
    if (item->text_w > zone.size.w) { item->text[0] = '\0'; item->text_w = 0; }
    int16_t h = (item->icon_w ? ICON_S : 0)
        + (item->icon_w && item->text_w ? pair_gap : 0)
        + (item->text_w ? SMALL_DIGIT_H : 0);
    if (h == 0) { continue; }
    int16_t gap = n > 0 ? entry_gap : 0;
    if (total_h + gap + h > zone.size.h) { break; }
    fit[n] = item;
    total_h += gap + h;
    n++;
  }

  int16_t y = zone.origin.y + (zone.size.h - total_h) / 2;
  for (int i = 0; i < n; i++) {
    StatusItem *item = fit[i];
    if (item->icon_w) {
      int16_t ix = zone.origin.x + (zone.size.w - item->icon_w) / 2;
      status_icon_draw(ctx, item->metric, GPoint(ix, y), ICON_S, fg, bg);
      y += ICON_S + (item->text_w ? pair_gap : 0);
    }
    if (item->text_w) {
      graphics_context_set_text_color(ctx, fg);
      graphics_draw_text(ctx, item->text, g_font_small,
                         GRect(zone.origin.x, y - SMALL_TOP_PAD, zone.size.w,
                               SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                         GTextOverflowModeFill, GTextAlignmentCenter, NULL);
      y += SMALL_DIGIT_H;
    }
    y += entry_gap;
  }
}

void draw_status_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  if (!g_layout.status_visible) { return; }
  graphics_context_set_antialiased(ctx, false);
  if (g_layout.side_columns) {
    prv_draw_column(ctx, g_layout.status_zone);
  } else {
    prv_draw_horizontal(ctx, g_layout.status_zone);
  }
}
