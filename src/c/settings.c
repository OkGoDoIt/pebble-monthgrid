#include "common.h"

// bg, fg, accent, on_accent, dim — chosen for legibility with the
// backlight off: light foregrounds on dark grounds (or the inverse), with
// one saturated accent for the banner and today's box.
const ThemeSpec g_themes[THEME_BUILTIN_COUNT] = {
  { GColorBlackARGB8, GColorWhiteARGB8, GColorWhiteARGB8, GColorBlackARGB8,
    GColorDarkGrayARGB8 },                                        // Classic
  { GColorWhiteARGB8, GColorBlackARGB8, GColorBlackARGB8, GColorWhiteARGB8,
    GColorLightGrayARGB8 },                                       // Paper
  { GColorBlackARGB8, GColorChromeYellowARGB8, GColorOrangeARGB8,
    GColorBlackARGB8, GColorWindsorTanARGB8 },                    // Amber
  { GColorBlackARGB8, GColorWhiteARGB8, GColorVividCeruleanARGB8,
    GColorBlackARGB8, GColorDarkGrayARGB8 },                      // Ice
  { GColorBlackARGB8, GColorWhiteARGB8, GColorRedARGB8, GColorWhiteARGB8,
    GColorDarkGrayARGB8 },                                        // Crimson
  { GColorOxfordBlueARGB8, GColorWhiteARGB8, GColorChromeYellowARGB8,
    GColorBlackARGB8, GColorLibertyARGB8 },                       // Midnight
  { GColorBlackARGB8, GColorGreenARGB8, GColorIslamicGreenARGB8,
    GColorMintGreenARGB8, GColorDarkGreenARGB8 },                 // Terminal
  { GColorBlackARGB8, GColorWhiteARGB8, GColorOrangeARGB8, GColorBlackARGB8,
    GColorDarkGrayARGB8 },                                        // Sunset
  { GColorBlackARGB8, GColorWhiteARGB8, GColorVividVioletARGB8,
    GColorWhiteARGB8, GColorDarkGrayARGB8 },                      // Violet
  { GColorWhiteARGB8, GColorBlackARGB8, GColorDarkCandyAppleRedARGB8,
    GColorWhiteARGB8, GColorLightGrayARGB8 },                     // Newsprint
};

// Resolves the palette in use: the custom theme is assembled from the user's
// three colors (text-on-accent and the dimmed day color are derived so the
// settings page stays short), and black-and-white watches fall back to the
// two monochrome themes.
const ThemeSpec *theme_spec(void) {
  static ThemeSpec custom;
  uint8_t t = g_settings.theme;
#if defined(PBL_BW)
  // Light themes read as Paper on monochrome; everything else as Classic.
  if (t == THEME_NEWSPRINT) { t = THEME_PAPER; }
  else if (t != THEME_PAPER && t != THEME_CUSTOM) { t = THEME_CLASSIC; }
#endif
  if (t == THEME_CUSTOM) {
    GColor accent = (GColor) { .argb = g_settings.custom_accent };
    custom.bg = g_settings.custom_bg;
    custom.fg = g_settings.custom_fg;
    custom.accent = g_settings.custom_accent;
    custom.on_accent = gcolor_legible_over(accent).argb;
    // Dim adjacent days with the gray that reads against the background.
    GColor bg = (GColor) { .argb = g_settings.custom_bg };
    int lum = ((bg.argb >> 4) & 3) + ((bg.argb >> 2) & 3) + (bg.argb & 3);
    custom.dim = (lum >= 5) ? GColorLightGrayARGB8 : GColorDarkGrayARGB8;
    return &custom;
  }
  if (t >= THEME_BUILTIN_COUNT) { t = THEME_CLASSIC; }
  return &g_themes[t];
}

void settings_set_defaults(Settings *s) {
  *s = (Settings) {
    .version = SETTINGS_VERSION,
    .theme = THEME_CLASSIC,
    .banner_style = BANNER_STYLE_FILLED,
    .header_label = HEADER_LABEL_TWO,
    .custom_bg = GColorBlackARGB8,
    .custom_fg = GColorWhiteARGB8,
    .custom_accent = GColorVividCeruleanARGB8,
    .time_format = TIME_FMT_SYSTEM,
    .time_size = TIME_SIZE_LARGE,
    .time_font = TIME_FONT_ROBOTO,
    .start_day = START_SUNDAY,
    .show_seconds = 0,
    .show_adjacent = 0,
    .dots_enabled = 0,
    .dots_style = DOTS_STYLE_BAR,
    .banner_content = BANNER_MONTH,
    .vibe_disconnect = 0,
    .temp_fahrenheit = 1,
    .dist_miles = 1,
    .metrics = { METRIC_BATTERY, METRIC_WEATHER, METRIC_NONE, METRIC_NONE, METRIC_NONE,
                 METRIC_NONE, METRIC_NONE, METRIC_NONE },
    .cal_colors = { GColorRedARGB8, GColorBlueMoonARGB8, GColorIslamicGreenARGB8 },
    .grid_lines = 0,
    .grid_color = GColorDarkGrayARGB8,
  };
}

void settings_sanitize(Settings *s) {
  if (s->theme >= THEME_COUNT) { s->theme = THEME_CLASSIC; }
  if (s->banner_style >= BANNER_STYLE_COUNT) { s->banner_style = BANNER_STYLE_FILLED; }
  if (s->header_label >= HEADER_LABEL_COUNT) { s->header_label = HEADER_LABEL_TWO; }
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
