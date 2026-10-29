#include "common.h"

// The status line: the user's metrics in priority order. Items are measured
// first and appended while they fit; metrics with no meaningful data are
// skipped entirely. The next calendar event can be one of them, take the
// whole line in its last minutes, or have a line of its own under it.
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
  char text[48];            // room for an event name plus its time in a sentence
  int16_t icon_w;
  int16_t text_w;
} StatusItem;

// The most items one redraw can show: the line (or the two round columns)
// never fits more. The list itself has no limit; items past what fits wait.
#define MAX_SHOWN 8

// One redraw's items. Static, not on the stack: apps get a 2 KB stack on
// most platforms, and measuring text (the event name is measured repeatedly)
// runs deep enough that eight of these on the stack can overflow it.
static StatusItem s_items[MAX_SHOWN];

// Live readings from the phone stop showing once it has been silent for an
// hour (it answers the watch's requests every half hour while it's there).
static bool prv_plugin_stale(void) {
  return g_plugin.received_at == 0
      || time(NULL) - g_plugin.received_at > PLUGIN_STALE_SECONDS;
}

// "9:30a" / "21:30", or bare "9:30" in the narrow round column.
static bool prv_format_clock(char *buf, size_t len, time_t when, bool compact) {
  struct tm *lt = localtime(&when);
  if (!lt) { return false; }
  if (use_24h() || compact) {
    snprintf(buf, len, "%d:%02d", lt->tm_hour, lt->tm_min);
  } else {
    int hour = lt->tm_hour % 12;
    if (hour == 0) { hour = 12; }
    snprintf(buf, len, "%d:%02d%c", hour, lt->tm_min, lt->tm_hour < 12 ? 'a' : 'p');
  }
  return true;
}

static int16_t prv_text_w(const char *text) {
  if (!text[0]) { return 0; }
  return graphics_text_layout_get_content_size(text, g_font_small, GRect(0, 0, 32767, 32767),
                                               GTextOverflowModeFill, GTextAlignmentLeft).w;
}

// "Standup 23m" (or a whole sentence: "Standup in 23m"). A name too long
// for max_w loses characters from its end, marked with an ellipsis, so the
// time always shows; one shorter than min_chars goes altogether.
static void prv_event_text_fitted(char *out, size_t len, int16_t *out_w, const char *full_name,
                                  const char *when, int16_t max_w, int min_chars) {
  char name[EVENT_NAME_LEN];
  strncpy(name, full_name, sizeof(name) - 1);
  name[sizeof(name) - 1] = '\0';
  size_t n = strlen(name);
  bool cut = false;
  for (;;) {
    if (n == 0) {
      snprintf(out, len, "%s", when);
    } else {
      snprintf(out, len, "%s%s%s%s", name, cut ? "\xe2\x80\xa6" : "", when[0] ? " " : "", when);
    }
    *out_w = prv_text_w(out);
    if (max_w <= 0 || *out_w <= max_w || n == 0) { return; }
    // Drop one UTF-8 character (and any space or punctuation it leaves).
    do { n--; } while (n > 0 && ((uint8_t) name[n] & 0xC0) == 0x80);
    name[n] = '\0';
    trim_name_end(name);
    if (utf8_count(name) < min_chars) { name[0] = '\0'; }
    n = strlen(name);
    cut = true;
  }
}

#if defined(PBL_HEALTH)
static bool prv_health_ok(HealthMetric metric) {
  time_t now = time(NULL);
  HealthServiceAccessibilityMask mask =
      health_service_metric_accessible(metric, time_start_of_today(), now);
  return (mask & HealthServiceAccessibilityMaskAvailable) != 0;
}

static void prv_format_count(char *buf, size_t len, int32_t v) {
  // Widths measured with graphics_text_layout_get_content_size in the real
  // status font (GOTHIC_18 / GOTHIC_14). A digit is 7px/6px but "." is only
  // 3px and "k" 6px, so "2.0k" (23px/21px) genuinely beats "1986" (28px/24px)
  // -- the compact form is not just a character-count wash.
  if (v < 1000) {
    snprintf(buf, len, "%d", (int) v);
  } else if (v < 10000) {
    // Round to the nearest tenth of a k rather than truncating, so 6792
    // reads 6.8k and not 6.7k.
    int32_t tenths = (v + 50) / 100;
    if (tenths % 10 == 0) {
      // A trailing ".0" carries no information and costs 10px, so 1986 -> 2k.
      snprintf(buf, len, "%dk", (int) (tenths / 10));
    } else {
      snprintf(buf, len, "%d.%dk", (int) (tenths / 10), (int) (tenths % 10));
    }
  } else {
    // 20px vs 35px here -- a much bigger saving than the band above.
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

// Steps compared with a usual day by this time: "+612", "-1.2k".
static bool prv_steps_vs_usual(char *buf, size_t len, HealthValue steps) {
  time_t now = time(NULL), start = time_start_of_today();
  HealthServiceAccessibilityMask mask = health_service_metric_averaged_accessible(
      HealthMetricStepCount, start, now, HealthServiceTimeScopeDailyWeekdayOrWeekend);
  if (!(mask & HealthServiceAccessibilityMaskAvailable)) { return false; }
  HealthValue usual = health_service_sum_averaged(HealthMetricStepCount, start, now,
                                                  HealthServiceTimeScopeDailyWeekdayOrWeekend);
  if (usual <= 0) { return false; }
  int32_t diff = steps - usual;
  char count[12];
  prv_format_count(count, sizeof(count), diff < 0 ? -diff : diff);
  snprintf(buf, len, "%c%s", diff < 0 ? '-' : '+', count);
  return true;
}

// When the last sleep ended (0 = not known, or still asleep). Asked of the
// health service at most every five minutes.
static bool prv_sleep_ended(HealthActivity activity, time_t start, time_t end, void *context) {
  (void) activity;
  (void) start;
  *(time_t *) context = end;
  return false;   // the newest session is all we need
}

static time_t prv_woke_at(void) {
  static time_t s_woke, s_checked;
  time_t now = time(NULL);
  if (now - s_checked >= 5 * 60) {
    s_checked = now;
    s_woke = 0;
    if (!(health_service_peek_current_activities() & HealthActivitySleep)) {
      health_service_activities_iterate(HealthActivitySleep, now - 24 * 3600, now,
                                        HealthIterationDirectionPast, prv_sleep_ended, &s_woke);
    }
  }
  return s_woke;
}
#endif

// A battery shows once it is at the user's threshold for it or below.
static bool prv_battery_low_enough(int percent, uint8_t below) {
  return below == 0 || percent <= below;
}

// Today's high and low, if the forecast arrived today.
static bool prv_forecast_today(void) {
  return g_forecast.received_at != 0
      && day_number(g_forecast.received_at) == day_number(time(NULL))
      && g_forecast.high_dc != TEMP_NONE && g_forecast.low_dc != TEMP_NONE;
}

// Returns false if this metric has no meaningful data right now (hidden).
// compact drops unit suffixes for the narrow round-crescent column, where
// the icon already carries the meaning.
static bool prv_metric_text(uint8_t metric, char *buf, size_t len, bool compact) {
  buf[0] = '\0';
  switch (metric) {
    case METRIC_BATTERY: {
      BatteryChargeState st = battery_state_service_peek();
      if (!prv_battery_low_enough(st.charge_percent, g_settings.battery_below)) { return false; }
      snprintf(buf, len, compact ? "%d" : "%d%%", st.charge_percent);
      return true;
    }
    case METRIC_WEATHER: {
      if (g_weather.fetched_at == 0) { return false; }
      time_t now = time(NULL);
      if (now - g_weather.fetched_at > WEATHER_STALE_SECONDS) { return false; }
      int t = temp_dc_display(g_weather.temp_dc);
      char unit = g_settings.temp_fahrenheit ? 'F' : 'C';
      if (compact) {
        snprintf(buf, len, "%d°", t);
      } else if (g_settings.weather_detail == WEATHER_RANGE && prv_forecast_today()) {
        snprintf(buf, len, "%d°%c %d/%d", t, unit, temp_dc_display(g_forecast.high_dc),
                 temp_dc_display(g_forecast.low_dc));
      } else if (g_settings.weather_detail == WEATHER_HOURS && g_forecast.hours_start) {
        // Now, then the hours still ahead of the forecast's three.
        int n = snprintf(buf, len, "%d°", t);
        for (int h = 0; h < FORECAST_HOURS && n < (int) len; h++) {
          if (g_forecast.hour_dc[h] == TEMP_NONE
              || g_forecast.hours_start + h * 3600 <= now) { continue; }
          n += snprintf(buf + n, len - n, " %d°", temp_dc_display(g_forecast.hour_dc[h]));
        }
      } else {
        snprintf(buf, len, "%d°%c", t, unit);
      }
      return true;
    }
#if defined(PBL_HEALTH)
    case METRIC_STEPS: {
      if (!prv_health_ok(HealthMetricStepCount)) { return false; }
      HealthValue steps = health_service_sum_today(HealthMetricStepCount);
      if (steps < 10) { return false; }   // not meaningful yet
      if (g_settings.steps_vs_usual && prv_steps_vs_usual(buf, len, steps)) { return true; }
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
      // on long days (10.4mi displayed as "10mi"). A zero tenth carries no
      // information though, so 7.0mi renders as 7mi.
      if (tenths >= 1000 || tenths % 10 == 0) {
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
      HealthMetric which = g_settings.sleep_deep ? HealthMetricSleepRestfulSeconds
                                                 : HealthMetricSleepSeconds;
      if (!prv_health_ok(which)) { return false; }
      if (g_settings.sleep_after_wake) {
        time_t woke = prv_woke_at();
        if (!woke || time(NULL) - woke > 3600) { return false; }
      }
      int32_t sec = health_service_sum_today(which);
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
      if (g_settings.alarm_within_h
          && when - time(NULL) > (time_t) g_settings.alarm_within_h * 3600) { return false; }
      return prv_format_clock(buf, len, when, compact);
    }
    // The watch can't read the phone's battery; the phone tells it.
    case METRIC_PHONE_BATTERY:
      if (g_plugin.phone_battery < 0 || prv_plugin_stale()
          || !prv_battery_low_enough(g_plugin.phone_battery, g_settings.phone_battery_below)) {
        return false;
      }
      snprintf(buf, len, compact ? "%d" : "%d%%", (int) g_plugin.phone_battery);
      return true;
    // Text only: a reading from any plugin has no glyph of its own.
    case METRIC_READING_1:
    case METRIC_READING_2:
    case METRIC_READING_3:
    case METRIC_READING_4:
    case METRIC_READING_5: {
      int r = metric - METRIC_READING_1;
      const char *text = g_plugin.reading_text[r];
      const char *label = g_plugin.reading_label[r];
      if (!text[0] || prv_plugin_stale()) { return false; }
      if (!compact && (g_settings.reading_labels & (1 << r)) && label[0]) {
        snprintf(buf, len, "%s %s", label, text);
      } else {
        snprintf(buf, len, "%s", text);
      }
      return true;
    }
    // Worded in prv_event_item, which can measure it.
    case METRIC_NEXT_EVENT:
      return false;
    case METRIC_CONNECTION:
      // Shows only as a warning: icon when disconnected, hidden when fine.
      return !g_connected;
    default:
      return false;
  }
}

// The next event as a status item: "Standup 23m", or its calendar mark and
// the time alone (time only, the round column). takeover: the whole line,
// worded as a sentence ("Standup in 12m"). max_w caps its width (0 = none).
static bool prv_event_item(StatusItem *item, bool compact, bool takeover, int16_t max_w) {
  EventView ev;
  if (!event_current(&ev)) { return false; }
  EventWhen w;
  event_when(&ev, &w, compact);
  item->metric = METRIC_NEXT_EVENT;
  item->icon_w = 0;
  bool time_only = compact || (!takeover && g_settings.event_time_only);
  if (takeover || time_only) { item->icon_w = status_icon_width(METRIC_NEXT_EVENT, ICON_S); }
  if (time_only && w.text[0]) {
    snprintf(item->text, sizeof(item->text), "%s", w.text);
    item->text_w = prv_text_w(item->text);
    return true;
  }
  if (max_w > 0 && item->icon_w) { max_w -= item->icon_w + ICON_TEXT_GAP; }
  prv_event_text_fitted(item->text, sizeof(item->text), &item->text_w, ev.name,
                        takeover ? w.full : w.text, max_w, 1);
  return item->text[0] != '\0';
}

// Collects the displayable items in priority order (deduped, no-data
// metrics skipped). Returns the count. max_event_w caps the next event's
// width (0 = no cap); line_w is the whole line, for a takeover.
static int prv_collect_items(StatusItem *items, bool compact, int16_t max_event_w, int16_t line_w) {
  if (event_takeover()) {
    return prv_event_item(&items[0], compact, true, compact ? 0 : line_w) ? 1 : 0;
  }
  int n = 0;
  // Where there's no month bar (or no room for the event in it), an event
  // set to show there leads the status items instead.
  if (event_leads_status() && prv_event_item(&items[n], compact, false, max_event_w)) { n++; }
  for (int slot = 0; slot < NUM_METRIC_SLOTS && n < MAX_SHOWN; slot++) {
    uint8_t metric = g_settings.metrics[slot];
    if (metric == METRIC_NONE || metric >= METRIC_TYPE_COUNT) { continue; }
    bool dup = false;
    for (int j = 0; j < n; j++) {
      if (items[j].metric == metric) { dup = true; break; }
    }
    if (dup) { continue; }
    StatusItem *item = &items[n];
    if (metric == METRIC_NEXT_EVENT) {
      if (g_settings.event_place == EVENT_LINE && prv_event_item(item, compact, false, max_event_w)) {
        n++;
      }
      continue;
    }
    item->metric = metric;
    if (!prv_metric_text(metric, item->text, sizeof(item->text), compact)) { continue; }
    item->icon_w = status_icon_width(metric, ICON_S);
    item->text_w = prv_text_w(item->text);
    n++;
  }
  return n;
}

static void prv_draw_horizontal(GContext *ctx, const GRect zone) {
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  StatusItem *items = s_items;
  const int16_t max_w = zone.size.w - 4;
  // An event name may take two thirds of the line, never all of it.
  int n_all = prv_collect_items(items, false, (max_w * 2) / 3, max_w);

  // Append in priority order while the line still fits.
  int n = 0;
  int16_t total_w = 0;
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
  StatusItem *fit[MAX_SHOWN];
  int16_t icon_x[MAX_SHOWN], text_x[MAX_SHOWN];
  int16_t item_h[MAX_SHOWN];
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

#if defined(EVENT_OWN_LINE)
// The event's own line: its calendar mark and the whole sentence, else the
// short form, else the name shortened; the time always stays.
static void prv_draw_event_line(GContext *ctx, const GRect band) {
  EventView ev;
  if (!event_current(&ev)) { return; }
  EventWhen w;
  event_when(&ev, &w, false);
  // The calendar mark (without its icon box's padding) and the gap after it.
  const int16_t mark = status_icon_width(METRIC_NEXT_EVENT, ICON_S) - 2 + ICON_TEXT_GAP;
  const int16_t room = band.size.w - mark - 12;
  static char text[48];
  int16_t text_w;
  snprintf(text, sizeof(text), "%s%s%s", ev.name, w.full[0] ? " " : "", w.full);
  text_w = prv_text_w(text);
  if (text_w > room) {
    prv_event_text_fitted(text, sizeof(text), &text_w, ev.name, w.text, room, MIN_NAME_CHARS);
  }
  int16_t x = band.origin.x + (band.size.w - mark - text_w) / 2;
  status_icon_draw(ctx, METRIC_NEXT_EVENT, GPoint(x, band.origin.y + (band.size.h - 2 - ICON_S) / 2),
                   ICON_S, theme_fg(), theme_bg());
  graphics_context_set_text_color(ctx, theme_fg());
  graphics_draw_text(ctx, text, g_font_small,
                     GRect(x + mark, band.origin.y + (band.size.h - 2 - SMALL_DIGIT_H) / 2 - SMALL_TOP_PAD,
                           text_w + 2, SMALL_DIGIT_H + SMALL_TOP_PAD + TEXT_BOX_SLACK),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}
#endif

void draw_status_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  graphics_context_set_antialiased(ctx, false);
#if defined(EVENT_OWN_LINE)
  if (g_layout.event_line) { prv_draw_event_line(ctx, g_layout.event_zone); }
#endif
  if (!g_layout.status_visible) { return; }
  if (!g_layout.side_columns) {
    prv_draw_horizontal(ctx, g_layout.status_zone);
    return;
  }

  StatusItem *items = s_items;
  int n_all = prv_collect_items(items, true, 0, 0);
  StatusItem *all[MAX_SHOWN];
  if (!g_layout.status_two_columns) {
    for (int i = 0; i < n_all; i++) { all[i] = &items[i]; }
    prv_draw_column(ctx, g_layout.status_zone, all, n_all, false);
    return;
  }

  // Two crescents: priority order alternates left, right, left, right...
  StatusItem *left[MAX_SHOWN];
  StatusItem *right[MAX_SHOWN];
  int nl = 0, nr = 0;
  for (int i = 0; i < n_all; i++) {
    if (i % 2 == 0) { left[nl++] = &items[i]; } else { right[nr++] = &items[i]; }
  }
  prv_draw_column(ctx, g_layout.status_zone_left, left, nl, true);
  prv_draw_column(ctx, g_layout.status_zone, right, nr, false);
}
