#include "common.h"

// The status line: up to NUM_METRIC_SLOTS user-prioritized metrics. Items are
// measured first and appended in priority order while they fit; metrics with
// no meaningful data are skipped entirely. A dotted rule underlines the zone.

#if PBL_DISPLAY_WIDTH >= 200
  #define ICON_S 15
  #define ITEM_GAP 12
  #define ICON_TEXT_GAP 3
  #define TEXT_H 18
#else
  #define ICON_S 9
  #define ITEM_GAP 8
  #define ICON_TEXT_GAP 2
  #define TEXT_H 11
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
#endif

static void prv_format_count(char *buf, size_t len, int32_t v) {
  if (v < 1000) {
    snprintf(buf, len, "%d", (int) v);
  } else if (v < 10000) {
    snprintf(buf, len, "%d.%dk", (int) (v / 1000), (int) ((v % 1000) / 100));
  } else {
    snprintf(buf, len, "%dk", (int) (v / 1000));
  }
}

// Returns false if this metric has no meaningful data right now (hidden).
static bool prv_metric_text(uint8_t metric, char *buf, size_t len) {
  buf[0] = '\0';
  switch (metric) {
    case METRIC_BATTERY: {
      BatteryChargeState st = battery_state_service_peek();
      snprintf(buf, len, "%d%%", st.charge_percent);
      return true;
    }
    case METRIC_WEATHER: {
      if (g_weather.fetched_at == 0) { return false; }
      time_t now = time(NULL);
      if (now - g_weather.fetched_at > WEATHER_STALE_SECONDS) { return false; }
      int t = g_weather.temp_c;
      if (g_settings.temp_fahrenheit) {
        t = (t * 9 + (t >= 0 ? 2 : -2)) / 5 + 32;  // rounded C -> F
        snprintf(buf, len, "%d°F", t);
      } else {
        snprintf(buf, len, "%d°C", t);
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
      if (g_settings.dist_miles) {
        int32_t tenths = (m * 10) / 16093;
        if (tenths >= 100) {
          snprintf(buf, len, "%dmi", (int) (tenths / 10));
        } else {
          snprintf(buf, len, "%d.%dmi", (int) (tenths / 10), (int) (tenths % 10));
        }
      } else {
        int32_t tenths = m / 100;
        if (tenths >= 100) {
          snprintf(buf, len, "%dkm", (int) (tenths / 10));
        } else {
          snprintf(buf, len, "%d.%dkm", (int) (tenths / 10), (int) (tenths % 10));
        }
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
#if PBL_API_EXISTS(alarm_service_peek_next)
    case METRIC_NEXT_ALARM: {
      time_t when;
      if (!alarm_service_peek_next(&when)) { return false; }
      struct tm *lt = localtime(&when);
      if (!lt) { return false; }
      bool use_24h = (g_settings.time_format == TIME_FMT_24H)
          || (g_settings.time_format == TIME_FMT_SYSTEM && clock_is_24h_style());
      if (use_24h) {
        snprintf(buf, len, "%d:%02d", lt->tm_hour, lt->tm_min);
      } else {
        int hour = lt->tm_hour % 12;
        if (hour == 0) { hour = 12; }
        snprintf(buf, len, "%d:%02d%c", hour, lt->tm_min, lt->tm_hour < 12 ? 'a' : 'p');
      }
      return true;
    }
#endif
    case METRIC_CONNECTION:
      // Shows only as a warning: icon when disconnected, hidden when fine.
      return !g_connected;
    default:
      return false;
  }
}

void draw_status_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  if (!g_layout.status_visible) { return; }
  const GRect zone = g_layout.status_zone;
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  const GRect measure_box = GRect(0, 0, 32767, 32767);

  StatusItem items[NUM_METRIC_SLOTS];
  int n_items = 0;
  int16_t total_w = 0;
  const int16_t max_w = zone.size.w - 4;

  for (int slot = 0; slot < NUM_METRIC_SLOTS; slot++) {
    uint8_t metric = g_settings.metrics[slot];
    if (metric == METRIC_NONE || metric >= METRIC_TYPE_COUNT) { continue; }
    bool dup = false;
    for (int j = 0; j < n_items; j++) {
      if (items[j].metric == metric) { dup = true; break; }
    }
    if (dup) { continue; }

    StatusItem *item = &items[n_items];
    item->metric = metric;
    if (!prv_metric_text(metric, item->text, sizeof(item->text))) { continue; }
    item->icon_w = status_icon_width(metric, ICON_S);
    item->text_w = item->text[0]
        ? graphics_text_layout_get_content_size(item->text, g_font_small, measure_box,
                                                GTextOverflowModeFill,
                                                GTextAlignmentLeft).w
        : 0;
    int16_t w = item->icon_w + (item->icon_w && item->text_w ? ICON_TEXT_GAP : 0)
        + item->text_w;
    int16_t gap = n_items > 0 ? ITEM_GAP : 0;
    if (total_w + gap + w > max_w) {
      break;  // Priority order: once one doesn't fit, stop.
    }
    total_w += gap + w;
    n_items++;
  }

  graphics_context_set_antialiased(ctx, false);
  int16_t x = zone.origin.x + (zone.size.w - total_w) / 2;
  int16_t icon_y = zone.origin.y + (zone.size.h - 2 - ICON_S) / 2;
  int16_t text_y = zone.origin.y + (zone.size.h - 2 - TEXT_H) / 2 - 1;

  for (int i = 0; i < n_items; i++) {
    StatusItem *item = &items[i];
    if (i > 0) {
      // Small separator dot centered in the gap.
      graphics_context_set_fill_color(ctx, theme_dim());
      graphics_fill_rect(ctx, GRect(x - ITEM_GAP / 2 - 1, zone.origin.y + zone.size.h / 2 - 2,
                                    1, 1), 0, GCornerNone);
    }
    if (item->icon_w) {
      status_icon_draw(ctx, item->metric, GPoint(x, icon_y), ICON_S, fg, bg);
      x += item->icon_w + (item->text_w ? ICON_TEXT_GAP : 0);
    }
    if (item->text_w) {
      graphics_context_set_text_color(ctx, fg);
      graphics_draw_text(ctx, item->text, g_font_small,
                         GRect(x, text_y, item->text_w + 2, TEXT_H + 4),
                         GTextOverflowModeFill, GTextAlignmentLeft, NULL);
      x += item->text_w;
    }
    x += ITEM_GAP;
  }

  // Dotted rule at the bottom of the zone.
  graphics_context_set_stroke_color(ctx, fg);
  int16_t rule_y = zone.origin.y + zone.size.h - 1;
  for (int16_t rx = g_layout.grid_x; rx < g_layout.grid_x + g_layout.cell_w * 7; rx += 3) {
    graphics_draw_pixel(ctx, GPoint(rx, rule_y));
  }
}
