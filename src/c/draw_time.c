#include "common.h"

// The big time readout. 12h mode never shows a leading zero on the hour;
// AM/PM (and the optional seconds) render as a small side column to the
// right of the digits. The digits are centered on their own, like the
// original watchface; only when the column would reach the edge of the
// screen is the whole group nudged left.

// Side labels use the small bold Gothic; box tall enough for its line box.
#define SIDE_TEXT_H (SMALL_DIGIT_H + SMALL_TOP_PAD + 8)
// Ink to ink, between the digits and the labels.
#define SIDE_GAP (TIME_SIDE_GAP + 1)
// The labels and the digits stay this far inside the screen's edge.
#define EDGE 2

int16_t text_width(const char *text, GFont font) {
  return graphics_text_layout_get_content_size(text, font, GRect(0, 0, 32767, 32767),
                                               GTextOverflowModeFill, GTextAlignmentLeft).w;
}

#if defined(PBL_ROUND)
static int16_t prv_isqrt(int32_t n) {
  int32_t r = 0;
  while ((r + 1) * (r + 1) <= n) { r++; }
  return (int16_t) r;
}

// Half the circle's width at height y (above the middle).
static int16_t prv_half_chord(int16_t y) {
  const int32_t r = PBL_DISPLAY_WIDTH / 2, d = r - y;
  return prv_isqrt(r * r - d * d);
}

// The right edge a label may reach when its top is at y.
static int16_t prv_reach(GRect zone, int16_t y) {
  (void) zone;
  return PBL_DISPLAY_WIDTH / 2 + prv_half_chord(y) - EDGE;
}
#else
static int16_t prv_reach(GRect zone, int16_t y) {
  (void) y;
  return zone.origin.x + zone.size.w - EDGE;
}
#endif

bool time_place(GRect zone, int16_t w, int16_t ampm_w, int16_t sec_w, TimePlace *out) {
  const int16_t top = zone.origin.y, h = zone.size.h;
#if defined(PBL_ROUND)
  // On round screens the top arc is narrow, so the labels sit low, on the
  // digits' baseline, where the curve is wider: a two-line AM/PM + seconds
  // stack ends there too, though never starting above the digits' top.
  if (ampm_w && sec_w) {
    const int16_t stack = 2 * SMALL_DIGIT_H + 3;
    out->ampm_top = top + (h > stack ? h - stack : 0);
    out->sec_top = out->ampm_top + SMALL_DIGIT_H + 3;
  } else {
    out->ampm_top = out->sec_top = top + h - SMALL_DIGIT_H;
  }
  const int16_t left = PBL_DISPLAY_WIDTH / 2 - prv_half_chord(top) + EDGE;
#else
  out->ampm_top = top + 1;
  out->sec_top = ampm_w ? top + h - SMALL_DIGIT_H - 1 : top + (h - SMALL_DIGIT_H) / 2;
  // Short time zones (e.g. the smallest Pixel size): keep the seconds clear
  // of the AM/PM label even if they dip below the zone.
  if (ampm_w && sec_w && out->sec_top < out->ampm_top + SMALL_DIGIT_H + 2) {
    out->sec_top = out->ampm_top + SMALL_DIGIT_H + 2;
  }
  const int16_t left = zone.origin.x + EDGE;
#endif
  // If the seconds still can't fit (very short zones, Quick View
  // compression), they hide rather than collide with the content below.
  out->sec_shown = sec_w && out->sec_top + SMALL_DIGIT_H <= top + h + 6;
  if (!out->sec_shown) { sec_w = 0; }

  int16_t x = zone.origin.x + (zone.size.w - w) / 2;
  int16_t over = 0;
  if (ampm_w) { over = x + w + SIDE_GAP + ampm_w - prv_reach(zone, out->ampm_top); }
  if (sec_w) {
    int16_t o = x + w + SIDE_GAP + sec_w - prv_reach(zone, out->sec_top);
    if (o > over) { over = o; }
  }
  if (over > 0) { x -= over; }
  out->x = x;
  out->side_x = x + w + SIDE_GAP;
  return x >= left;
}

static void prv_draw(GContext *ctx, const char *text, GFont font, int16_t x, int16_t y,
                     int16_t w, int16_t h) {
  graphics_draw_text(ctx, text, font, GRect(x, y, w + 2, h), GTextOverflowModeFill,
                     GTextAlignmentLeft, NULL);
}

void draw_time_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  const GRect zone = g_layout.time_zone;
  const GFont font = g_layout.time_font;

  char time_buf[8];
  char ampm[3] = "";
  char sec[4] = "";
  if (use_24h()) {
    snprintf(time_buf, sizeof(time_buf), "%02d:%02d", g_now.tm_hour, g_now.tm_min);
  } else {
    int hour = g_now.tm_hour % 12;
    snprintf(time_buf, sizeof(time_buf), "%d:%02d", hour ? hour : 12, g_now.tm_min);
    ampm[0] = g_now.tm_hour < 12 ? 'A' : 'P';
    ampm[1] = g_layout.time_letter ? '\0' : 'M';
  }
  if (g_settings.show_seconds) {
    snprintf(sec, sizeof(sec), "%02d", g_now.tm_sec);
  }

  // The glyphs draw one by one so the gaps between them can narrow (layout.c
  // decides when); the font's blank side bearings don't count toward the
  // width.
  const int16_t tight = g_layout.time_tight, pad = g_layout.time_pad;
  const int16_t w = text_width(time_buf, font) - tight * ((int16_t) strlen(time_buf) - 1) - 2 * pad;
  const int16_t ampm_w = ampm[0] ? text_width(ampm, g_font_small_bold) : 0;
  const int16_t sec_w = sec[0] ? text_width(sec, g_font_small_bold) : 0;
  TimePlace place;
  time_place(zone, w, ampm_w, sec_w, &place);

  graphics_context_set_text_color(ctx, theme_fg());
  // Fonts leave differing headroom inside their line box; the per-font trim
  // makes the digits hug the top of the zone.
  const int16_t y = zone.origin.y - g_layout.time_trim;
  const int16_t h = zone.size.h + g_layout.time_trim + 16;
  int16_t x = place.x - pad;
  for (const char *c = time_buf; *c; c++) {
    const char glyph[2] = { *c, '\0' };
    const int16_t glyph_w = text_width(glyph, font);
    prv_draw(ctx, glyph, font, x, y, glyph_w, h);
    x += glyph_w - tight;
  }

  // Side-label placement works in *visual* tops (the font's top bearing is
  // subtracted only at draw time).
  if (ampm[0]) {
    prv_draw(ctx, ampm, g_font_small_bold, place.side_x, place.ampm_top - SMALL_TOP_PAD,
             ampm_w, SIDE_TEXT_H);
  }
  if (sec[0] && place.sec_shown) {
    prv_draw(ctx, sec, g_font_small_bold, place.side_x, place.sec_top - SMALL_TOP_PAD,
             sec_w, SIDE_TEXT_H);
  }
}
