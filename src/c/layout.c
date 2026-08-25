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

#if defined(PBL_ROUND)
  #if PBL_DISPLAY_WIDTH >= 200   // gabbro 260x260
    #define TOP_INSET 24
    #define BOTTOM_INSET 26
    #define GRID_W_MAX 170
  #else                          // chalk 180x180
    #define TOP_INSET 16
    #define BOTTOM_INSET 16
    #define GRID_W_MAX 113
  #endif
#else
  #define TOP_INSET 2
  #define BOTTOM_INSET 2
  #define GRID_W_MAX (PBL_DISPLAY_WIDTH - 4)
#endif

// Time font per (user size + compression shrink), clamped.
typedef struct {
  const char *font_key;
  int16_t height;
} TimeFontSpec;

static const TimeFontSpec TIME_FONTS[3] = {
#if PBL_DISPLAY_WIDTH >= 200 && !defined(PBL_ROUND)      // emery
  { FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM, 62 },
  { FONT_KEY_LECO_42_NUMBERS, 46 },
  { FONT_KEY_LECO_36_BOLD_NUMBERS, 40 },
#elif PBL_DISPLAY_WIDTH >= 200 && defined(PBL_ROUND)     // gabbro
  { FONT_KEY_LECO_42_NUMBERS, 46 },
  { FONT_KEY_LECO_36_BOLD_NUMBERS, 40 },
  { FONT_KEY_LECO_32_BOLD_NUMBERS, 36 },
#elif defined(PBL_ROUND)                                 // chalk
  { FONT_KEY_LECO_36_BOLD_NUMBERS, 40 },
  { FONT_KEY_LECO_32_BOLD_NUMBERS, 36 },
  { FONT_KEY_LECO_28_LIGHT_NUMBERS, 32 },
#else                                                    // 144x168 rect
  { FONT_KEY_LECO_38_BOLD_NUMBERS, 42 },
  { FONT_KEY_LECO_32_BOLD_NUMBERS, 36 },
  { FONT_KEY_LECO_28_LIGHT_NUMBERS, 32 },
#endif
};

static bool prv_any_metric_selected(void) {
  for (int i = 0; i < NUM_METRIC_SLOTS; i++) {
    if (g_settings.metrics[i] != METRIC_NONE) {
      return true;
    }
  }
  return false;
}

void layout_compute(Layer *root_layer) {
  GRect full = layer_get_bounds(root_layer);
  GRect ub = layer_get_unobstructed_bounds(root_layer);
  Layout *l = &g_layout;
  memset(l, 0, sizeof(*l));
  l->bounds = ub;

  bool want_status = prv_any_metric_selected();
  int16_t avail = ub.size.h - TOP_INSET - BOTTOM_INSET;

  // Compression cascade: 0 = full; 1 = smaller time; 2 = drop status;
  // 3 = drop month banner; 4 = drop weekday header. The 6-row grid always
  // survives — it is compressed, never cropped.
  int stage;
  int time_idx = g_settings.time_size;
  for (stage = 0; stage <= 4; stage++) {
    time_idx = g_settings.time_size + (stage >= 1 ? 1 : 0);
    if (time_idx > 2) { time_idx = 2; }
    l->status_visible = want_status && stage < 2;
    l->banner_visible = stage < 3;
    l->header_visible = stage < 4;

    int16_t needed = TIME_FONTS[time_idx].height + SECTION_GAP;
    if (l->status_visible) { needed += STATUS_H + SECTION_GAP; }
    if (l->banner_visible) { needed += BANNER_H + SECTION_GAP; }
    if (l->header_visible) { needed += HEADER_H; }
    needed += PITCH_MIN * 6;
    if (needed <= avail || stage == 4) {
      break;
    }
  }

  l->time_font = fonts_get_system_font(TIME_FONTS[time_idx].font_key);
  l->time_font_h = TIME_FONTS[time_idx].height;

  // Fixed height excluding the grid, then give the grid what remains
  // (capped so the calendar doesn't get too airy).
  int16_t fixed = TIME_FONTS[time_idx].height + SECTION_GAP;
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
  l->time_zone = GRect(ub.origin.x, y, ub.size.w, TIME_FONTS[time_idx].height);
  y += TIME_FONTS[time_idx].height + gap_time;

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
