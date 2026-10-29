#include <stddef.h>
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
    .metrics = { METRIC_BATTERY, METRIC_WEATHER },
    .cal_colors = { GColorRedARGB8, GColorBlueMoonARGB8, GColorIslamicGreenARGB8 },
    .grid_lines = 0,
    .grid_color = GColorDarkGrayARGB8,
    .weather_detail = WEATHER_NOW,
    .event_place = EVENT_BAR,
    .event_within = 120,
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
  if (s->battery_below > 100) { s->battery_below = 0; }
  if (s->weather_detail >= WEATHER_DETAIL_COUNT) { s->weather_detail = WEATHER_NOW; }
  if (s->event_place >= EVENT_PLACE_COUNT) { s->event_place = EVENT_BAR; }
  if (s->event_within > 24 * 60) { s->event_within = 24 * 60; }
}

// Version 1 (MonthGrid 1.3 and earlier): eight status slots and none of the
// item options. Read once after an update, then saved as version 2.
typedef struct __attribute__((__packed__)) {
  uint8_t version;
  uint8_t theme, time_format, time_size, time_font, start_day, show_seconds, show_adjacent;
  uint8_t dots_enabled, dots_style, banner_content, banner_style, header_label;
  uint8_t custom_bg, custom_fg, custom_accent;
  uint8_t vibe_disconnect, temp_fahrenheit, dist_miles;
  uint8_t metrics[8];
  uint8_t cal_colors[NUM_CALENDARS];
  uint8_t grid_lines, grid_color;
} SettingsV1;

static void prv_from_v1(Settings *s, const SettingsV1 *v) {
  // The fields before the status slots are laid out the same.
  memcpy(s, v, offsetof(SettingsV1, metrics));
  s->version = SETTINGS_VERSION;
  memset(s->metrics, METRIC_NONE, sizeof(s->metrics));
  bool had_event = false;
  for (int i = 0; i < 8; i++) {
    s->metrics[i] = v->metrics[i];
    if (v->metrics[i] == METRIC_NEXT_EVENT) { had_event = true; }
  }
  memcpy(s->cal_colors, v->cal_colors, sizeof(s->cal_colors));
  s->grid_lines = v->grid_lines;
  s->grid_color = v->grid_color;
  // The event stays where it was: in the status line, or nowhere.
  s->event_place = had_event ? EVENT_LINE : EVENT_OFF;
}

void settings_load(Settings *s) {
  settings_set_defaults(s);
  if (persist_exists(PERSIST_KEY_SETTINGS)) {
    Settings loaded;
    int read = persist_read_data(PERSIST_KEY_SETTINGS, &loaded, sizeof(loaded));
    if (read == (int) sizeof(loaded) && loaded.version == SETTINGS_VERSION) {
      *s = loaded;
    } else if (read == (int) sizeof(SettingsV1) && loaded.version == 1) {
      prv_from_v1(s, (const SettingsV1 *) &loaded);
    }
  }
  settings_sanitize(s);
}

void settings_save(const Settings *s) {
  persist_write_data(PERSIST_KEY_SETTINGS, s, sizeof(*s));
}
