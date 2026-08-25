#include "common.h"

// ---------------------------------------------------------------------------
// Per-platform layout constants. Everything vertical is computed from the
// unobstructed bounds at runtime; these are the design knobs.
// ---------------------------------------------------------------------------

#if PBL_DISPLAY_WIDTH >= 200
  #define STATUS_H 22
  #define BANNER_H 20
  #define HEADER_H 15
  #define PITCH_MIN 13
  #define PITCH_MAX 20
  #define SECTION_GAP 3
#elif defined(PBL_ROUND)   // chalk 180x180
  #define STATUS_H 13
  #define BANNER_H 14
  #define HEADER_H 10
  #define PITCH_MIN 9
  #define PITCH_MAX 12
  #define SECTION_GAP 2
#else                      // 144x168 rect
  #define STATUS_H 13
  #define BANNER_H 14
  #define HEADER_H 10
  #define PITCH_MIN 9
  #define PITCH_MAX 15
  #define SECTION_GAP 2
#endif

#define TOP_INSET 2
#define BOTTOM_INSET 2
#define GRID_W_MAX (PBL_DISPLAY_WIDTH - 4)

// Round layout: the grid sits in the wide middle band of the circle; the
// month (stacked letters) and the status metrics live in the side crescents.
#if defined(PBL_ROUND)
  #if PBL_DISPLAY_WIDTH >= 200   // gabbro 260x260
    #define R_TIME_TOP 22
    #define R_HEADER_H 12
    #define R_GAP 6
    #define R_PITCH 19
    #define R_CELL_W 24
    #define R_COL_INSET 14
  #else                          // chalk 180x180
    #define R_TIME_TOP 20
    #define R_HEADER_H 9
    #define R_GAP 4
    #define R_PITCH 11
    #define R_CELL_W 16
    #define R_COL_INSET 10
  #endif
#endif

// Time font per (user family, user size + compression shrink). Entries name
// either a system font key or a custom font resource (Silkscreen Bold, whose
// pixel grid stays crisp at multiples of 8).
typedef struct {
  const char *font_key;     // system font, or NULL when resource_id is used
  uint32_t resource_id;
  int16_t height;           // vertical zone the digits occupy
  int16_t trim;             // px to nudge up (internal top padding of the font)
} TimeFontSpec;

static const TimeFontSpec TIME_FONTS[TIME_FONT_COUNT][3] = {
#if PBL_DISPLAY_WIDTH >= 200 && !defined(PBL_ROUND)      // emery
  { { FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM, 0, 62, 9 },
    { FONT_KEY_LECO_42_NUMBERS, 0, 46, 7 },
    { FONT_KEY_LECO_36_BOLD_NUMBERS, 0, 40, 6 } },
  { { NULL, RESOURCE_ID_FONT_SILKTIME_48, 50, 2 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_32, 34, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 } },
  { { FONT_KEY_BITHAM_42_BOLD, 0, 46, 8 },
    { FONT_KEY_BITHAM_42_BOLD, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 } },
  { { FONT_KEY_BITHAM_42_LIGHT, 0, 46, 8 },
    { FONT_KEY_BITHAM_42_LIGHT, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 } },
#elif PBL_DISPLAY_WIDTH >= 200 && defined(PBL_ROUND)     // gabbro
  { { FONT_KEY_LECO_42_NUMBERS, 0, 46, 7 },
    { FONT_KEY_LECO_36_BOLD_NUMBERS, 0, 40, 6 },
    { FONT_KEY_LECO_32_BOLD_NUMBERS, 0, 36, 5 } },
  { { NULL, RESOURCE_ID_FONT_SILKTIME_32, 34, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 } },
  { { FONT_KEY_BITHAM_42_BOLD, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
  { { FONT_KEY_BITHAM_42_LIGHT, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
#elif defined(PBL_ROUND)                                 // chalk
  { { FONT_KEY_LECO_36_BOLD_NUMBERS, 0, 40, 6 },
    { FONT_KEY_LECO_32_BOLD_NUMBERS, 0, 36, 5 },
    { FONT_KEY_LECO_28_LIGHT_NUMBERS, 0, 32, 5 } },
  { { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_16, 18, 1 } },
  { { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
  { { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
#else                                                    // 144x168 rect
  { { FONT_KEY_LECO_38_BOLD_NUMBERS, 0, 42, 6 },
    { FONT_KEY_LECO_32_BOLD_NUMBERS, 0, 36, 5 },
    { FONT_KEY_LECO_28_LIGHT_NUMBERS, 0, 32, 5 } },
  { { NULL, RESOURCE_ID_FONT_SILKTIME_32, 34, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_24, 26, 1 },
    { NULL, RESOURCE_ID_FONT_SILKTIME_16, 18, 1 } },
  { { FONT_KEY_BITHAM_42_BOLD, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
  { { FONT_KEY_BITHAM_42_LIGHT, 0, 46, 8 },
    { FONT_KEY_BITHAM_34_MEDIUM_NUMBERS, 0, 38, 6 },
    { FONT_KEY_BITHAM_30_BLACK, 0, 34, 5 } },
#endif
};

// Lazy cache for custom time fonts; a platform uses at most three sizes.
static struct {
  uint32_t resource_id;
  GFont font;
} s_font_cache[3];

static GFont prv_resolve_font(const TimeFontSpec *spec) {
  if (spec->font_key) {
    return fonts_get_system_font(spec->font_key);
  }
  for (unsigned i = 0; i < ARRAY_LENGTH(s_font_cache); i++) {
    if (s_font_cache[i].resource_id == spec->resource_id) {
      return s_font_cache[i].font;
    }
    if (s_font_cache[i].resource_id == 0) {
      s_font_cache[i].resource_id = spec->resource_id;
      s_font_cache[i].font =
          fonts_load_custom_font(resource_get_handle(spec->resource_id));
      return s_font_cache[i].font;
    }
  }
  // Cache full (cannot happen with a 3-size ladder); fall back safely.
  return fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD);
}

void layout_unload_fonts(void) {
  for (unsigned i = 0; i < ARRAY_LENGTH(s_font_cache); i++) {
    if (s_font_cache[i].resource_id) {
      fonts_unload_custom_font(s_font_cache[i].font);
      s_font_cache[i].resource_id = 0;
      s_font_cache[i].font = NULL;
    }
  }
}

static bool prv_any_metric_selected(void) {
  for (int i = 0; i < NUM_METRIC_SLOTS; i++) {
    if (g_settings.metrics[i] != METRIC_NONE) {
      return true;
    }
  }
  return false;
}

#if defined(PBL_ROUND)
static void prv_layout_round(Layout *l, GRect ub) {
  const TimeFontSpec *spec = &TIME_FONTS[g_settings.time_font][g_settings.time_size];
  l->time_font = prv_resolve_font(spec);
  l->time_font_h = spec->height;
  l->time_trim = spec->trim;
  l->side_columns = true;
  l->status_visible = prv_any_metric_selected();
  l->banner_visible = true;
  l->header_visible = true;
  l->row_pitch = R_PITCH;
  l->cell_w = R_CELL_W;
  l->grid_x = ub.origin.x + (ub.size.w - R_CELL_W * 7) / 2;

  int16_t y = ub.origin.y + R_TIME_TOP;
  l->time_zone = GRect(ub.origin.x, y, ub.size.w, spec->height);
  y += spec->height + R_GAP;
  l->header_zone = GRect(l->grid_x, y, R_CELL_W * 7, R_HEADER_H);
  y += R_HEADER_H + 2;
  l->grid_zone = GRect(l->grid_x, y, R_CELL_W * 7, R_PITCH * 6);

  int16_t col_left = ub.origin.x + R_COL_INSET;
  l->banner_zone = GRect(col_left, y, l->grid_x - 2 - col_left, R_PITCH * 6);
  int16_t grid_right = l->grid_x + R_CELL_W * 7;
  l->status_zone = GRect(grid_right + 2, y,
                         ub.origin.x + ub.size.w - R_COL_INSET - (grid_right + 2),
                         R_PITCH * 6);
}
#endif

void layout_compute(Layer *root_layer) {
  GRect full = layer_get_bounds(root_layer);
  GRect ub = layer_get_unobstructed_bounds(root_layer);
  Layout *l = &g_layout;
  memset(l, 0, sizeof(*l));
  l->bounds = ub;

#if defined(PBL_ROUND)
  prv_layout_round(l, ub);
  (void) full;
  return;
#endif

  bool want_status = prv_any_metric_selected();
  int16_t avail = ub.size.h - TOP_INSET - BOTTOM_INSET;

  // Compression cascade: 0 = full; 1 = smaller time; 2 = smallest time +
  // drop status; 3 = drop month banner; 4 = drop weekday header. The 6-row
  // grid always survives — it is compressed, never cropped.
  const TimeFontSpec (*family)[3] = &TIME_FONTS[g_settings.time_font];
  int stage;
  int time_idx = g_settings.time_size;
  for (stage = 0; stage <= 4; stage++) {
    time_idx = g_settings.time_size + (stage >= 1 ? 1 : 0) + (stage >= 2 ? 1 : 0);
    if (time_idx > 2) { time_idx = 2; }
    l->status_visible = want_status && stage < 2;
    l->banner_visible = stage < 3;
    l->header_visible = stage < 4;

    int16_t needed = (*family)[time_idx].height + SECTION_GAP;
    if (l->status_visible) { needed += STATUS_H + SECTION_GAP; }
    if (l->banner_visible) { needed += BANNER_H + SECTION_GAP; }
    if (l->header_visible) { needed += HEADER_H; }
    needed += PITCH_MIN * 6;
    if (needed <= avail || stage == 4) {
      break;
    }
  }

  const TimeFontSpec *spec = &(*family)[time_idx];
  l->time_font = prv_resolve_font(spec);
  l->time_font_h = spec->height;
  l->time_trim = spec->trim;

  // Fixed height excluding the grid, then give the grid what remains
  // (capped so the calendar doesn't get too airy).
  int16_t fixed = spec->height + SECTION_GAP;
  if (l->status_visible) { fixed += STATUS_H + SECTION_GAP; }
  if (l->banner_visible) { fixed += BANNER_H + SECTION_GAP; }
  if (l->header_visible) { fixed += HEADER_H; }

  int16_t pitch = (avail - fixed) / 6;
  if (pitch < PITCH_MIN) { pitch = PITCH_MIN; }
  if (pitch > PITCH_MAX) { pitch = PITCH_MAX; }
  l->row_pitch = pitch;

  int16_t leftover = avail - fixed - pitch * 6;
  if (leftover < 0) { leftover = 0; }
  // Slack distribution: a bit above the time, a bit after it, rest at bottom.
  int16_t pad_top = TOP_INSET + leftover / 4;
  int16_t gap_time = SECTION_GAP + leftover / 4;

  l->cell_w = GRID_W_MAX / 7;
  l->grid_x = ub.origin.x + (ub.size.w - l->cell_w * 7) / 2;

  int16_t y = ub.origin.y + pad_top;
  l->time_zone = GRect(ub.origin.x, y, ub.size.w, spec->height);
  y += spec->height + gap_time;

  if (l->status_visible) {
    l->status_zone = GRect(ub.origin.x, y, ub.size.w, STATUS_H);
    y += STATUS_H + SECTION_GAP;
  }
  if (l->banner_visible) {
#if defined(PBL_ROUND)
    l->banner_zone = GRect(l->grid_x, y, l->cell_w * 7, BANNER_H);
#else
    l->banner_zone = GRect(ub.origin.x, y, ub.size.w, BANNER_H);
#endif
    y += BANNER_H + SECTION_GAP;
  }
  if (l->header_visible) {
    l->header_zone = GRect(l->grid_x, y, l->cell_w * 7, HEADER_H);
    y += HEADER_H;
  }
  l->grid_zone = GRect(l->grid_x, y, l->cell_w * 7, pitch * 6);

  (void) full;
}
