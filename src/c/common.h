#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// Shared types and globals for MonthGrid.
// ---------------------------------------------------------------------------

typedef enum {
  THEME_CLASSIC = 0,   // white on black (the original look; default)
  THEME_PAPER = 1,     // black on white
  THEME_AMBER = 2,     // amber terminal on black
  THEME_ICE = 3,       // white on black, cyan accent
  THEME_CRIMSON = 4,   // white on black, red accent
  THEME_MIDNIGHT = 5,  // white on oxford blue, gold accent
  THEME_COUNT = 6,
} ThemeOpt;

// Colors as GColor8 .argb values. accent fills the banner bar and today's
// box; on_accent is legible text on the accent; dim is for adjacent days.
typedef struct {
  uint8_t bg, fg, accent, on_accent, dim;
} ThemeSpec;
extern const ThemeSpec g_themes[THEME_COUNT];

typedef enum {
  TIME_FMT_SYSTEM = 0,
  TIME_FMT_12H = 1,
  TIME_FMT_24H = 2,
} TimeFmt;

typedef enum {
  TIME_SIZE_LARGE = 0,
  TIME_SIZE_MEDIUM = 1,
  TIME_SIZE_SMALL = 2,
} TimeSizeOpt;

typedef enum {
  TIME_FONT_ROBOTO = 0,         // Roboto Bold (default; Gothic bold when small)
  TIME_FONT_DIGITAL = 1,        // LECO
  TIME_FONT_PIXEL = 2,          // Silkscreen Bold (retro pixel)
  TIME_FONT_CLASSIC_BOLD = 3,   // Bitham Bold
  TIME_FONT_CLASSIC_LIGHT = 4,  // Bitham Light
  TIME_FONT_COUNT = 5,
} TimeFontOpt;

typedef enum {
  START_SUNDAY = 0,
  START_MONDAY = 1,
  START_SATURDAY = 2,
} StartDayOpt;

typedef enum {
  METRIC_NONE = 0,
  METRIC_BATTERY = 1,
  METRIC_WEATHER = 2,
  METRIC_STEPS = 3,
  METRIC_DISTANCE = 4,
  METRIC_HEART_RATE = 5,
  METRIC_ACTIVE_MIN = 6,
  METRIC_CALORIES = 7,
  METRIC_SLEEP = 8,
  METRIC_WEEK_NUM = 9,
  METRIC_CONNECTION = 10,
  METRIC_NEXT_ALARM = 11,
  METRIC_TYPE_COUNT = 12,
} MetricType;

typedef enum {
  BANNER_MONTH = 0,          // just the month name (default, like the original)
  BANNER_MONTH_DAY = 1,      // AUGUST 25 / 25 AUGUST
  BANNER_WD_MONTH_DAY = 2,   // TUESDAY, AUGUST 25 (degrades to TUE, AUG 25)
  BANNER_MONTH_DAY_YEAR = 3, // AUGUST 25, 2026
  BANNER_WD_MD_YEAR = 4,     // TUE, AUG 25, 2026
  BANNER_NUMERIC = 5,        // 8/25/2026 (US) / 25/8/2026 (elsewhere)
  BANNER_CONTENT_COUNT = 6,
} BannerContentOpt;

typedef enum {
  DOTS_STYLE_BAR = 0,    // 1px underline split into per-calendar sections
  DOTS_STYLE_SQUARES = 1,
} DotsStyleOpt;

typedef enum {
  COND_UNKNOWN = 0,
  COND_CLEAR = 1,
  COND_PARTLY = 2,
  COND_CLOUDY = 3,
  COND_FOG = 4,
  COND_RAIN = 5,
  COND_SNOW = 6,
  COND_THUNDER = 7,
  COND_WIND = 8,
} WeatherCond;

#define NUM_METRIC_SLOTS 5
#define NUM_CALENDARS 3

#define SETTINGS_VERSION 1
#define WEATHER_VERSION 1
#define DOTS_VERSION 1

#define PERSIST_KEY_SETTINGS 1
#define PERSIST_KEY_WEATHER 2
#define PERSIST_KEY_DOTS 3

// Weather older than this is treated as "no data" (metric hidden).
#define WEATHER_STALE_SECONDS (3 * 3600)
// How often to ask the phone for fresh weather.
#define WEATHER_REFRESH_SECONDS (30 * 60)

typedef struct __attribute__((__packed__)) {
  uint8_t version;
  uint8_t theme;            // ThemeOpt
  uint8_t time_format;      // TimeFmt
  uint8_t time_size;        // TimeSizeOpt
  uint8_t time_font;        // TimeFontOpt
  uint8_t start_day;        // StartDayOpt
  uint8_t show_seconds;
  uint8_t show_adjacent;    // dimmed prev/next-month days
  uint8_t dots_enabled;     // calendar event dots
  uint8_t dots_style;       // DotsStyleOpt
  uint8_t banner_content;   // BannerContentOpt (rect banner only)
  uint8_t vibe_disconnect;
  uint8_t temp_fahrenheit;  // 1 = °F (default), 0 = °C
  uint8_t dist_miles;       // 1 = miles (default), 0 = km
  uint8_t metrics[NUM_METRIC_SLOTS];   // MetricType, priority order
  uint8_t cal_colors[NUM_CALENDARS];   // GColor8 .argb per calendar
} Settings;

typedef struct __attribute__((__packed__)) {
  uint8_t version;
  int16_t temp_c;
  uint8_t cond;             // WeatherCond
  int32_t fetched_at;       // time_t of the fix
} WeatherCache;

// monthkey = year * 16 + month(1..12); fits uint16_t until year 4095.
typedef struct __attribute__((__packed__)) {
  uint8_t version;
  uint16_t monthkey;
  // Last refresh outcome from the phone: 0 = ok, nonzero = the most recent
  // calendar fetch/parse failed (cached days below stay valid).
  uint8_t status;
  // Per day-of-month bitmask: bits 0..2 = timed event in calendar 1..3,
  // bits 3..5 = all-day event in calendar 1..3.
  uint8_t days[31];
} DotsCache;

#define DOT_TIMED_BIT(cal) (1 << (cal))
#define DOT_ALLDAY_BIT(cal) (1 << ((cal) + 3))

// ---------------------------------------------------------------------------
// Layout: computed from the current unobstructed bounds + settings.
// ---------------------------------------------------------------------------

typedef struct {
  GRect bounds;             // unobstructed bounds used for this layout
  GRect time_zone;
  GRect status_zone;
  GRect banner_zone;
  GRect header_zone;
  GRect grid_zone;          // holds rows_max * row_pitch
  bool status_visible;
  bool banner_visible;
  // Compressed alternative to the banner bar: the month name drawn in the
  // empty leading cells of the first grid row (costs no extra height).
  bool banner_inline;
  bool header_visible;
  // Round layout: banner_zone is a vertical month column in the left
  // crescent and status_zone a vertical metric column in the right one;
  // the weekday header uses single letters.
  bool side_columns;
  int16_t row_pitch;
  int16_t cell_w;
  int16_t grid_x;           // left edge of the 7 * cell_w block
  GFont time_font;
  int16_t time_font_h;      // visual digit height for vertical placement
  int16_t time_trim;        // px to nudge digits up (per-font internal padding)
} Layout;

// ---------------------------------------------------------------------------
// Globals (defined in main.c)
// ---------------------------------------------------------------------------

extern Settings g_settings;
extern WeatherCache g_weather;
extern DotsCache g_dots;
extern Layout g_layout;
extern struct tm g_now;
extern bool g_connected;

// System Raster Gothic everywhere for small text — the crisp hand-hinted
// bitmaps the original face used. Sizes step up on the 200px+ displays.
extern GFont g_font_small;        // grid digits & status text (GOTHIC_14 / _18)
extern GFont g_font_small_bold;   // AM/PM, seconds, month tiles (bold variants)
extern GFont g_font_header;       // weekday header (GOTHIC_09 / GOTHIC_14)
extern GFont g_font_banner;       // month banner (GOTHIC_14_BOLD / _18_BOLD)

// Visual metrics of the small font: digit ink height and the top bearing
// above it inside the font's line box (needed to place text by its visible
// pixels rather than its line box). Measured from the actual firmware
// fonts: GOTHIC_14 digits are 9px ink below a 5px bearing; GOTHIC_18 is
// 11px below 7px.
#if PBL_DISPLAY_WIDTH >= 200
  #define SMALL_DIGIT_H 11
  #define SMALL_TOP_PAD 7
#else
  #define SMALL_DIGIT_H 9
  #define SMALL_TOP_PAD 5
#endif

// Theme access. B&W platforms map every color theme onto Classic/Paper.
static inline const ThemeSpec *theme_spec(void) {
#if defined(PBL_BW)
  uint8_t t = (g_settings.theme <= THEME_PAPER) ? g_settings.theme : THEME_CLASSIC;
#else
  uint8_t t = (g_settings.theme < THEME_COUNT) ? g_settings.theme : THEME_CLASSIC;
#endif
  return &g_themes[t];
}
static inline GColor theme_bg(void) { return (GColor) { .argb = theme_spec()->bg }; }
static inline GColor theme_fg(void) { return (GColor) { .argb = theme_spec()->fg }; }
static inline GColor theme_accent(void) { return (GColor) { .argb = theme_spec()->accent }; }
static inline GColor theme_on_accent(void) { return (GColor) { .argb = theme_spec()->on_accent }; }
static inline GColor theme_dim(void) {
#if defined(PBL_COLOR)
  return (GColor) { .argb = theme_spec()->dim };
#else
  return theme_fg();
#endif
}

// settings.c
void settings_set_defaults(Settings *s);
void settings_sanitize(Settings *s);
void settings_load(Settings *s);
void settings_save(const Settings *s);

// layout.c
void layout_compute(Layer *root_layer);
void layout_unload_fonts(void);

// draw_time.c
void draw_time_update_proc(Layer *layer, GContext *ctx);

// draw_status.c
void draw_status_update_proc(Layer *layer, GContext *ctx);

// draw_calendar.c
void draw_calendar_update_proc(Layer *layer, GContext *ctx);

// icons.c — procedural status-line icons. Icons draw inside a box of height
// s at origin; status_icon_width reports the horizontal space one needs
// (0 = this metric has no icon).
int status_icon_width(uint8_t metric, int s);
void status_icon_draw(GContext *ctx, uint8_t metric, GPoint origin, int s,
                      GColor fg, GColor bg);

// util shared by drawing code
int days_in_month(int year, int month0);   // month0: 0..11, year: full year
int iso_week_number(const struct tm *t);
int start_wday_setting(void);              // 0=Sun per the user's start-day setting
int month_rows_for(const struct tm *t, int start_wday);  // 4..6
int month_lead_for(const struct tm *t, int start_wday);  // 0..6
