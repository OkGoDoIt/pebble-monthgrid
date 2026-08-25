#include "common.h"

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

Settings g_settings;
WeatherCache g_weather;
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

static void prv_send_requests(bool weather, uint16_t dots_monthkey) {
  if (!g_connected || (!weather && !dots_monthkey)) { return; }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) { return; }
  if (weather) {
    dict_write_uint8(iter, MESSAGE_KEY_WEATHER_REQUEST, 1);
  }
  if (dots_monthkey) {
    dict_write_uint32(iter, MESSAGE_KEY_DOTS_REQUEST, dots_monthkey);
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
  prv_send_requests(want_weather, want_dots);
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  (void) context;
  bool settings_changed = false;
  bool weather_changed = false;
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
    } else if (t->key == MESSAGE_KEY_CAL1_COLOR) {
      g_settings.cal_colors[0] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CAL2_COLOR) {
      g_settings.cal_colors[1] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_CAL3_COLOR) {
      g_settings.cal_colors[2] = GColorFromHEX(prv_tuple_int(t)).argb; settings_changed = true;
    } else if (t->key == MESSAGE_KEY_WEATHER_TEMP_C) {
      g_weather.temp_c = prv_tuple_int(t); weather_changed = true;
    } else if (t->key == MESSAGE_KEY_WEATHER_COND) {
      g_weather.cond = prv_tuple_int(t); weather_changed = true;
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
                          ? prv_current_monthkey() : 0);
  }
  if (weather_changed) {
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
      prv_send_requests(false, prv_current_monthkey());
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

static void prv_load_caches(void) {
  memset(&g_weather, 0, sizeof(g_weather));
  memset(&g_dots, 0, sizeof(g_dots));
  WeatherCache w;
  if (persist_read_data(PERSIST_KEY_WEATHER, &w, sizeof(w)) == (int) sizeof(w)
      && w.version == WEATHER_VERSION) {
    g_weather = w;
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
