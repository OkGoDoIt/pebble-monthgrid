#include "common.h"

// bg, fg, accent, on_accent, dim — chosen for legibility with the
// backlight off: light foregrounds on dark grounds (or the inverse), with
// one saturated accent for the banner and today's box.
const ThemeSpec g_themes[THEME_COUNT] = {
  { GColorBlackARGB8, GColorWhiteARGB8, GColorWhiteARGB8, GColorBlackARGB8,
    GColorDarkGrayARGB8 },                                        // Classic
  { GColorWhiteARGB8, GColorBlackARGB8, GColorBlackARGB8, GColorWhiteARGB8,
    GColorLightGrayARGB8 },                                       // Paper
  { GColorBlackARGB8, GColorChromeYellowARGB8, GColorChromeYellowARGB8,
    GColorBlackARGB8, GColorWindsorTanARGB8 },                    // Amber
  { GColorBlackARGB8, GColorWhiteARGB8, GColorVividCeruleanARGB8,
    GColorBlackARGB8, GColorDarkGrayARGB8 },                      // Ice
  { GColorBlackARGB8, GColorWhiteARGB8, GColorRedARGB8, GColorWhiteARGB8,
    GColorDarkGrayARGB8 },                                        // Crimson
  { GColorOxfordBlueARGB8, GColorWhiteARGB8, GColorChromeYellowARGB8,
    GColorBlackARGB8, GColorLibertyARGB8 },                       // Midnight
};

void settings_set_defaults(Settings *s) {
  *s = (Settings) {
    .version = SETTINGS_VERSION,
    .theme = THEME_CLASSIC,
    .time_format = TIME_FMT_SYSTEM,
    .time_size = TIME_SIZE_LARGE,
    .time_font = TIME_FONT_ROBOTO,
    .start_day = START_SUNDAY,
    .show_seconds = 0,
    .show_adjacent = 0,
    .dots_enabled = 1,
    .dots_style = DOTS_STYLE_BAR,
    .banner_content = BANNER_MONTH,
    .vibe_disconnect = 0,
    .temp_fahrenheit = 1,
    .dist_miles = 1,
    .metrics = { METRIC_BATTERY, METRIC_WEATHER, METRIC_NONE, METRIC_NONE, METRIC_NONE,
                 METRIC_NONE, METRIC_NONE, METRIC_NONE },
    .cal_colors = { GColorRedARGB8, GColorBlueMoonARGB8, GColorIslamicGreenARGB8 },
  };
}

void settings_sanitize(Settings *s) {
  if (s->theme >= THEME_COUNT) { s->theme = THEME_CLASSIC; }
  if (s->time_format > TIME_FMT_24H) { s->time_format = TIME_FMT_SYSTEM; }
  if (s->time_size > TIME_SIZE_SMALL) { s->time_size = TIME_SIZE_LARGE; }
  if (s->time_font >= TIME_FONT_COUNT) { s->time_font = TIME_FONT_ROBOTO; }
  if (s->start_day > START_SATURDAY) { s->start_day = START_SUNDAY; }
  if (s->dots_style > DOTS_STYLE_SQUARES) { s->dots_style = DOTS_STYLE_BAR; }
  if (s->banner_content >= BANNER_CONTENT_COUNT) { s->banner_content = BANNER_MONTH; }
  for (int i = 0; i < NUM_METRIC_SLOTS; i++) {
    if (s->metrics[i] >= METRIC_TYPE_COUNT) { s->metrics[i] = METRIC_NONE; }
  }
}

void settings_load(Settings *s) {
  settings_set_defaults(s);
  if (persist_exists(PERSIST_KEY_SETTINGS)) {
    Settings loaded;
    int read = persist_read_data(PERSIST_KEY_SETTINGS, &loaded, sizeof(loaded));
    if (read == (int) sizeof(loaded) && loaded.version == SETTINGS_VERSION) {
      *s = loaded;
    }
  }
  settings_sanitize(s);
}

void settings_save(const Settings *s) {
  persist_write_data(PERSIST_KEY_SETTINGS, s, sizeof(*s));
}
