#include "common.h"

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

Settings g_settings;
WeatherCache g_weather;
PluginCache g_plugin;
ForecastCache g_forecast;
DotsCache g_dots;
Layout g_layout;
struct tm g_now;
bool g_connected;

GFont g_font_small;
GFont g_font_small_bold;
GFont g_font_header;
GFont g_font_banner;

static Window *s_window;
static Layer *s_time_layer;
static Layer *s_status_layer;
static Layer *s_calendar_layer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static bool prv_metric_selected(uint8_t metric) {
  for (int i = 0; i < NUM_METRIC_SLOTS; i++) {
    if (g_settings.metrics[i] == metric) { return true; }
  }
  return false;
}

// Status items whose data the phone reads from the Pebble app's plugins.
static bool prv_plugin_metric_selected(void) {
  for (int i = 0; i < NUM_METRIC_SLOTS; i++) {
    uint8_t m = g_settings.metrics[i];
    if (m == METRIC_NEXT_EVENT || m == METRIC_PHONE_BATTERY
        || (m >= METRIC_READING_1 && m <= METRIC_READING_5)) { return true; }
  }
  return false;
}

static bool prv_plugin_data_old(void) {
  return g_plugin.received_at == 0
      || time(NULL) - g_plugin.received_at > PLUGIN_REFRESH_SECONDS;
}

static uint16_t prv_current_monthkey(void) {
  return (uint16_t) ((g_now.tm_year + 1900) * 16 + g_now.tm_mon + 1);
}

static void prv_relayout(void) {
  Layer *root = window_get_root_layer(s_window);
  window_set_background_color(s_window, theme_bg());
  layout_compute(root);
  layer_mark_dirty(root);
}

static void prv_subscribe_tick(void);

// Reads any integer-typed tuple regardless of declared width, plus numeric
// strings (Clay select values can arrive either way).
static int32_t prv_tuple_int(const Tuple *t) {
  switch (t->type) {
    case TUPLE_CSTRING:
      return atoi(t->value->cstring);
    case TUPLE_UINT:
      if (t->length == 1) { return t->value->uint8; }
      if (t->length == 2) { return t->value->uint16; }
      return (int32_t) t->value->uint32;
    case TUPLE_INT:
      if (t->length == 1) { return t->value->int8; }
      if (t->length == 2) { return t->value->int16; }
      return t->value->int32;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Phone requests
// ---------------------------------------------------------------------------

static void prv_send_requests(bool weather, uint16_t dots_monthkey, bool plugins) {
  if (!g_connected || (!weather && !dots_monthkey && !plugins)) { return; }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) { return; }
  if (weather) {
    dict_write_uint8(iter, MESSAGE_KEY_WEATHER_REQUEST, 1);
  }
  if (dots_monthkey) {
    dict_write_uint32(iter, MESSAGE_KEY_DOTS_REQUEST, dots_monthkey);
  }
  if (plugins) {
    dict_write_uint8(iter, MESSAGE_KEY_PLUGIN_REQUEST, 1);
  }
  app_message_outbox_send();
}

static void prv_periodic_requests(void) {
  // Spread requests off the exact minute-0 to be kind to the phone.
  if (g_now.tm_min % 5 != 2) { return; }
  bool want_weather = prv_metric_selected(METRIC_WEATHER)
      && (g_weather.fetched_at == 0
          || time(NULL) - g_weather.fetched_at > WEATHER_REFRESH_SECONDS);
  uint16_t want_dots = 0;
  if (g_settings.dots_enabled && g_dots.monthkey != prv_current_monthkey()) {
    want_dots = prv_current_monthkey();
  }
  bool want_plugins = prv_plugin_metric_selected() && prv_plugin_data_old();
  prv_send_requests(want_weather, want_dots, want_plugins);
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------

static void prv_copy_cstring(char *dst, size_t len, const Tuple *t) {
  if (t->type != TUPLE_CSTRING) { return; }
  strncpy(dst, t->value->cstring, len - 1);
  dst[len - 1] = '\0';
}

// READINGn_TEXT / READINGn_LABEL: true when t was one of them.
static bool prv_read_reading(const Tuple *t) {
  const uint32_t text_keys[NUM_READINGS] = {
    MESSAGE_KEY_READING1_TEXT, MESSAGE_KEY_READING2_TEXT, MESSAGE_KEY_READING3_TEXT,
    MESSAGE_KEY_READING4_TEXT, MESSAGE_KEY_READING5_TEXT,
  };
  const uint32_t label_keys[NUM_READINGS] = {
    MESSAGE_KEY_READING1_LABEL, MESSAGE_KEY_READING2_LABEL, MESSAGE_KEY_READING3_LABEL,
    MESSAGE_KEY_READING4_LABEL, MESSAGE_KEY_READING5_LABEL,
  };
  for (int i = 0; i < NUM_READINGS; i++) {
    if (t->key == text_keys[i]) {
      prv_copy_cstring(g_plugin.reading_text[i], READING_TEXT_LEN, t);
      return true;
    }
    if (t->key == label_keys[i]) {
      prv_copy_cstring(g_plugin.reading_label[i], READING_LABEL_LEN, t);
      return true;
    }
  }
  return false;
}

// FC_* keys: true when t was one of them.
static bool prv_read_forecast(const Tuple *t) {
  const uint32_t hour_keys[FORECAST_HOURS] = {
    MESSAGE_KEY_FC_HOUR1_DC, MESSAGE_KEY_FC_HOUR2_DC, MESSAGE_KEY_FC_HOUR3_DC,
  };
  if (t->key == MESSAGE_KEY_FC_HIGH_DC) {
    g_forecast.high_dc = (int16_t) prv_tuple_int(t);
  } else if (t->key == MESSAGE_KEY_FC_LOW_DC) {
    g_forecast.low_dc = (int16_t) prv_tuple_int(t);
  } else if (t->key == MESSAGE_KEY_FC_PRECIP) {
    g_forecast.precip = (uint8_t) prv_tuple_int(t);
  } else if (t->key == MESSAGE_KEY_FC_HOURS_START) {
    g_forecast.hours_start = prv_tuple_int(t);
  } else {
    for (int i = 0; i < FORECAST_HOURS; i++) {
      if (t->key == hour_keys[i]) {
        g_forecast.hour_dc[i] = (int16_t) prv_tuple_int(t);
        return true;
      }
    }
    return false;
  }
  return true;
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  (void) context;
  bool settings_changed = false;
  bool weather_changed = false;
  bool plugin_changed = false;
  bool forecast_changed = false;
  // Whole degrees and tenths can arrive in the same message, in any order;
  // the tenths win.
  int32_t temp_c = INT32_MIN, temp_dc = INT32_MIN;
  int32_t dots_month = -1;
  uint8_t dots_days[31];
  bool dots_data_seen = false;

  for (Tuple *t = dict_read_first(iter); t; t = dict_read_next(iter)) {
    if (t->key == MESSAGE_KEY_THEME) {
      g_settings.theme = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_TIME_FORMAT) {
      g_settings.time_format = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_TIME_SIZE) {
      g_settings.time_size = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_TIME_FONT) {
      g_settings.time_font = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_SHOW_SECONDS) {
      g_settings.show_seconds = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_START_DAY) {
      g_settings.start_day = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_SHOW_ADJACENT) {
      g_settings.show_adjacent = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_DOTS_ENABLED) {
      g_settings.dots_enabled = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_HEADER_LABEL) {
      g_settings.header_label = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_BANNER_STYLE) {
      g_settings.banner_style = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CUSTOM_BG) {
      g_settings.custom_bg = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CUSTOM_FG) {
      g_settings.custom_fg = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CUSTOM_ACCENT) {
      g_settings.custom_accent = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_BANNER_CONTENT) {
      g_settings.banner_content = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_DOTS_STYLE) {
      g_settings.dots_style = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_VIBE_DISCONNECT) {
      g_settings.vibe_disconnect = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_TEMP_UNIT) {
      g_settings.temp_fahrenheit = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_DIST_UNIT) {
      g_settings.dist_miles = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC1) {
      g_settings.metrics[0] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC2) {
      g_settings.metrics[1] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC3) {
      g_settings.metrics[2] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC4) {
      g_settings.metrics[3] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC5) {
      g_settings.metrics[4] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC6) {
      g_settings.metrics[5] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC7) {
      g_settings.metrics[6] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_METRIC8) {
      g_settings.metrics[7] = prv_tuple_int(t); settings_changed = true;
    } else if (t->key == MESSAGE_KEY_GRID_LINES) {
      g_settings.grid_lines = prv_tuple_int(t) ? 1 : 0; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_GRID_COLOR) {
      g_settings.grid_color = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CAL1_COLOR) {
      g_settings.cal_colors[0] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CAL2_COLOR) {
      g_settings.cal_colors[1] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CAL3_COLOR) {
      g_settings.cal_colors[2] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_WEATHER_TEMP_C) {
      temp_c = prv_tuple_int(t); weather_changed = true;
    } else if (t->key == MESSAGE_KEY_WEATHER_TEMP_DC) {
      temp_dc = prv_tuple_int(t); weather_changed = true;
    } else if (t->key == MESSAGE_KEY_WEATHER_COND) {
      g_weather.cond = prv_tuple_int(t); weather_changed = true;
    } else if (t->key == MESSAGE_KEY_EVENT_NAME) {
      prv_copy_cstring(g_plugin.event_name, EVENT_NAME_LEN, t);
      plugin_changed = true;
    } else if (t->key == MESSAGE_KEY_EVENT_START) {
      g_plugin.event_start = prv_tuple_int(t); plugin_changed = true;
    } else if (t->key == MESSAGE_KEY_EVENT_END) {
      g_plugin.event_end = prv_tuple_int(t); plugin_changed = true;
    } else if (t->key == MESSAGE_KEY_EVENT_ALL_DAY) {
      g_plugin.event_all_day = prv_tuple_int(t) ? 1 : 0; plugin_changed = true;
    } else if (t->key == MESSAGE_KEY_PHONE_BATTERY) {
      int32_t pct = prv_tuple_int(t);
      g_plugin.phone_battery = (pct < 0 || pct > 100) ? -1 : (int8_t) pct;
      plugin_changed = true;
    } else if (prv_read_reading(t)) {
      plugin_changed = true;
    } else if (prv_read_forecast(t)) {
      forecast_changed = true;
    } else if (t->key == MESSAGE_KEY_DOTS_MONTH) {
      dots_month = prv_tuple_int(t);
    } else if (t->key == MESSAGE_KEY_DOTS_STATUS) {
      g_dots.status = (uint8_t) prv_tuple_int(t);
      persist_write_data(PERSIST_KEY_DOTS, &g_dots, sizeof(g_dots));
      layer_mark_dirty(s_calendar_layer);
    } else if (t->key == MESSAGE_KEY_DOTS_DATA) {
      if (t->type == TUPLE_BYTE_ARRAY && t->length <= sizeof(dots_days)) {
        memset(dots_days, 0, sizeof(dots_days));
        memcpy(dots_days, t->value->data, t->length);
        dots_data_seen = true;
      }
    }
  }

  if (settings_changed) {
    settings_sanitize(&g_settings);
    settings_save(&g_settings);
    prv_subscribe_tick();
    prv_relayout();
    // A settings change can affect which data we need.
    prv_send_requests(prv_metric_selected(METRIC_WEATHER) && g_weather.fetched_at == 0,
                      (g_settings.dots_enabled
                       && g_dots.monthkey != prv_current_monthkey())
                          ? prv_current_monthkey() : 0,
                      prv_plugin_metric_selected() && prv_plugin_data_old());
  }
  if (forecast_changed) {
    g_forecast.version = FORECAST_VERSION;
    g_forecast.received_at = time(NULL);
    persist_write_data(PERSIST_KEY_FORECAST, &g_forecast, sizeof(g_forecast));
  }
  if (plugin_changed) {
    // Any of it arriving means the phone is answering; it sends the rest
    // only when it changes.
    g_plugin.version = PLUGIN_VERSION;
    g_plugin.received_at = time(NULL);
    layer_mark_dirty(s_status_layer);
  }
  if (weather_changed) {
    if (temp_dc != INT32_MIN) {
      g_weather.temp_dc = (int16_t) temp_dc;
    } else if (temp_c != INT32_MIN) {
      g_weather.temp_dc = (int16_t) (temp_c * 10);
    }
    g_weather.version = WEATHER_VERSION;
    g_weather.fetched_at = time(NULL);
    persist_write_data(PERSIST_KEY_WEATHER, &g_weather, sizeof(g_weather));
    layer_mark_dirty(s_status_layer);
  }
  if (dots_data_seen && dots_month > 0) {
    g_dots.version = DOTS_VERSION;
    g_dots.status = 0;
    g_dots.monthkey = (uint16_t) dots_month;
    memcpy(g_dots.days, dots_days, sizeof(g_dots.days));
    persist_write_data(PERSIST_KEY_DOTS, &g_dots, sizeof(g_dots));
    layer_mark_dirty(s_calendar_layer);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  (void) context;
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped: %d", (int) reason);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

static void prv_tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  bool month_rolled = (g_now.tm_mon != tick_time->tm_mon)
      || (g_now.tm_year != tick_time->tm_year);
  g_now = *tick_time;
  layer_mark_dirty(s_time_layer);
  if (units_changed & MINUTE_UNIT) {
    layer_mark_dirty(s_status_layer);
    prv_periodic_requests();
  }
  if (units_changed & DAY_UNIT) {
    // The layout depends on the month's row count (bottom-aligned grid).
    prv_relayout();
    if (month_rolled && g_settings.dots_enabled) {
      prv_send_requests(false, prv_current_monthkey(), false);
    }
  }
}

static void prv_subscribe_tick(void) {
  tick_timer_service_subscribe(g_settings.show_seconds ? SECOND_UNIT : MINUTE_UNIT,
                               prv_tick_handler);
}

static void prv_battery_handler(BatteryChargeState state) {
  (void) state;
  layer_mark_dirty(s_status_layer);
}

static void prv_connection_handler(bool connected) {
  bool was_connected = g_connected;
  g_connected = connected;
  if (was_connected && !connected && g_settings.vibe_disconnect) {
    vibes_short_pulse();
  }
  layer_mark_dirty(s_status_layer);
}

#if defined(PBL_HEALTH)
static void prv_health_handler(HealthEventType event, void *context) {
  (void) event;
  (void) context;
  layer_mark_dirty(s_status_layer);
}
#endif

// On aplite the subscribe call is an SDK no-op macro (Quick View never
// appears there), so the handlers would be unused.
#if !defined(PBL_PLATFORM_APLITE)
static void prv_unobstructed_change(AnimationProgress progress, void *context) {
  (void) progress;
  (void) context;
  prv_relayout();
}

static void prv_unobstructed_did_change(void *context) {
  (void) context;
  prv_relayout();
}
#endif

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_calendar_layer = layer_create(bounds);
  layer_set_update_proc(s_calendar_layer, draw_calendar_update_proc);
  layer_add_child(root, s_calendar_layer);

  s_status_layer = layer_create(bounds);
  layer_set_update_proc(s_status_layer, draw_status_update_proc);
  layer_add_child(root, s_status_layer);

  s_time_layer = layer_create(bounds);
  layer_set_update_proc(s_time_layer, draw_time_update_proc);
  layer_add_child(root, s_time_layer);

  // Handles Quick View already being up at launch.
  prv_relayout();
}

static void prv_window_unload(Window *window) {
  (void) window;
  layer_destroy(s_time_layer);
  layer_destroy(s_status_layer);
  layer_destroy(s_calendar_layer);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

static void prv_plugin_reset(void) {
  memset(&g_plugin, 0, sizeof(g_plugin));
  g_plugin.phone_battery = -1;
}

static void prv_forecast_reset(void) {
  memset(&g_forecast, 0, sizeof(g_forecast));
  g_forecast.high_dc = g_forecast.low_dc = TEMP_NONE;
  g_forecast.precip = PRECIP_NONE;
  for (int i = 0; i < FORECAST_HOURS; i++) { g_forecast.hour_dc[i] = TEMP_NONE; }
}

static void prv_load_caches(void) {
  memset(&g_weather, 0, sizeof(g_weather));
  prv_plugin_reset();
  prv_forecast_reset();
  if (persist_read_data(PERSIST_KEY_FORECAST, &g_forecast, sizeof(g_forecast))
          != (int) sizeof(g_forecast)
      || g_forecast.version != FORECAST_VERSION) {
    prv_forecast_reset();
  }
  memset(&g_dots, 0, sizeof(g_dots));
  WeatherCache w;
  bool w_read = persist_read_data(PERSIST_KEY_WEATHER, &w, sizeof(w)) == (int) sizeof(w);
  if (w_read && w.version == WEATHER_VERSION) {
    g_weather = w;
  } else if (w_read && w.version == 1) {
    // Version 1 held whole degrees in the same layout; keep the fix rather
    // than hiding the weather until the next fetch.
    g_weather = w;
    g_weather.version = WEATHER_VERSION;
    g_weather.temp_dc = (int16_t) (w.temp_dc * 10);
  }
  // Plugin data is a cache like the rest: written on exit rather than on
  // every update (phone battery alone changes many times a day).
  if (persist_read_data(PERSIST_KEY_PLUGIN, &g_plugin, sizeof(g_plugin))
          != (int) sizeof(g_plugin)
      || g_plugin.version != PLUGIN_VERSION) {
    prv_plugin_reset();
  }
  DotsCache d;
  if (persist_read_data(PERSIST_KEY_DOTS, &d, sizeof(d)) == (int) sizeof(d)
      && d.version == DOTS_VERSION) {
    g_dots = d;
  }
}

static void prv_load_fonts(void) {
#if PBL_DISPLAY_WIDTH >= 200
  g_font_small = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  g_font_small_bold = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  g_font_header = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  g_font_banner = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
#else
  g_font_small = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  g_font_small_bold = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  // The tiny 9px Gothic added in the Core Devices era; on very old firmware
  // fonts_get_system_font falls back to a legible default.
  g_font_header = fonts_get_system_font(FONT_KEY_GOTHIC_09);
  g_font_banner = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
#endif
}

static void prv_init(void) {
  setlocale(LC_ALL, "");
  settings_load(&g_settings);
  prv_load_caches();

  time_t now = time(NULL);
  g_now = *localtime(&now);
  g_connected = connection_service_peek_pebble_app_connection();

  prv_load_fonts();

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_set_background_color(s_window, theme_bg());
  window_stack_push(s_window, true);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_open(512, 64);

  prv_subscribe_tick();
  battery_state_service_subscribe(prv_battery_handler);
  connection_service_subscribe((ConnectionHandlers) {
    .pebble_app_connection_handler = prv_connection_handler,
  });
#if defined(PBL_HEALTH)
  health_service_events_subscribe(prv_health_handler, NULL);
#endif
#if !defined(PBL_PLATFORM_APLITE)
  unobstructed_area_service_subscribe((UnobstructedAreaHandlers) {
    .change = prv_unobstructed_change,
    .did_change = prv_unobstructed_did_change,
  }, NULL);
#endif
}

static void prv_deinit(void) {
  if (g_plugin.version == PLUGIN_VERSION) {
    persist_write_data(PERSIST_KEY_PLUGIN, &g_plugin, sizeof(g_plugin));
  }
  unobstructed_area_service_unsubscribe();
#if defined(PBL_HEALTH)
  health_service_events_unsubscribe();
#endif
  connection_service_unsubscribe();
  battery_state_service_unsubscribe();
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
  layout_unload_fonts();
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
