#include "common.h"

// The big time readout. 12h mode never shows a leading zero on the hour;
// AM/PM (and the optional seconds) render as a small side column to the
// right of the digits, and the whole group is centered.

#if PBL_DISPLAY_WIDTH >= 200
  #define SIDE_GAP 4
#else
  #define SIDE_GAP 3
#endif
// Side labels use the small bold Gothic; box tall enough for its line box.
#define SIDE_TEXT_H (SMALL_DIGIT_H + SMALL_TOP_PAD + 8)

static bool prv_use_24h(void) {
  switch (g_settings.time_format) {
    case TIME_FMT_12H: return false;
    case TIME_FMT_24H: return true;
    default: return clock_is_24h_style();
  }
}

void draw_time_update_proc(Layer *layer, GContext *ctx) {
  (void) layer;
  const GRect zone = g_layout.time_zone;
  const GColor fg = theme_fg();
  const GColor bg = theme_bg();
  (void) bg;

  char time_buf[8];
  char ampm_buf[4] = "";
  char sec_buf[4] = "";
  bool use_24h = prv_use_24h();
  if (use_24h) {
    snprintf(time_buf, sizeof(time_buf), "%02d:%02d", g_now.tm_hour, g_now.tm_min);
  } else {
    int hour = g_now.tm_hour % 12;
    if (hour == 0) { hour = 12; }
    snprintf(time_buf, sizeof(time_buf), "%d:%02d", hour, g_now.tm_min);
    strncpy(ampm_buf, g_now.tm_hour < 12 ? "AM" : "PM", sizeof(ampm_buf));
  }
  if (g_settings.show_seconds) {
    snprintf(sec_buf, sizeof(sec_buf), "%02d", g_now.tm_sec);
  }

  const GRect measure_box = GRect(0, 0, 32767, 32767);
  GSize time_size = graphics_text_layout_get_content_size(
      time_buf, g_layout.time_font, measure_box, GTextOverflowModeFill, GTextAlignmentLeft);

  int16_t side_w = 0;
  GSize ampm_size = GSizeZero;
  GSize sec_size = GSizeZero;
  if (ampm_buf[0]) {
    ampm_size = graphics_text_layout_get_content_size(
        ampm_buf, g_font_small_bold, measure_box, GTextOverflowModeFill, GTextAlignmentLeft);
    side_w = ampm_size.w;
  }
  if (sec_buf[0]) {
    sec_size = graphics_text_layout_get_content_size(
        sec_buf, g_font_small_bold, measure_box, GTextOverflowModeFill, GTextAlignmentLeft);
    if (sec_size.w > side_w) { side_w = sec_size.w; }
  }

  // The digits are centered on their own; AM/PM and seconds hang off to the
  // right without affecting the centering (like the original watchface).
  // Only if the side column would run off-screen is the group nudged left.
  int16_t x0 = zone.origin.x + (zone.size.w - time_size.w) / 2;
  if (side_w > 0) {
    int16_t overflow = (x0 + time_size.w + SIDE_GAP + side_w)
        - (zone.origin.x + zone.size.w - 1);
    if (overflow > 0) { x0 -= overflow; }
  }
  if (x0 < zone.origin.x) { x0 = zone.origin.x; }

  graphics_context_set_text_color(ctx, fg);
  // Fonts leave differing headroom inside their line box; the per-font trim
  // makes the digits hug the top of the zone.
  int16_t digits_y = zone.origin.y - g_layout.time_trim;
  graphics_draw_text(ctx, time_buf, g_layout.time_font,
                     GRect(x0, digits_y, time_size.w + 2, zone.size.h + 8),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);

  // Side-label placement works in *visual* tops (the font's top bearing is
  // subtracted only at draw time).
  int16_t side_x = x0 + time_size.w + SIDE_GAP;
  int16_t ampm_top, sec_top;
#if defined(PBL_ROUND)
  // On round screens the top arc is narrow; center the side column on the
  // zone's vertical middle where the chord is widest.
  {
    int16_t total = (ampm_buf[0] && sec_buf[0]) ? 2 * SMALL_DIGIT_H + 3 : SMALL_DIGIT_H;
    int16_t base = zone.origin.y + (zone.size.h - total) / 2;
    ampm_top = base;
    sec_top = ampm_buf[0] ? base + SMALL_DIGIT_H + 3 : base;
  }
#else
  ampm_top = zone.origin.y + 1;
  sec_top = ampm_buf[0]
      ? zone.origin.y + zone.size.h - SMALL_DIGIT_H - 1
      : zone.origin.y + (zone.size.h - SMALL_DIGIT_H) / 2;
  // Short time zones (e.g. the smallest Pixel size): keep the seconds clear
  // of the AM/PM label even if they dip below the zone.
  if (ampm_buf[0] && sec_buf[0] && sec_top < ampm_top + SMALL_DIGIT_H + 2) {
    sec_top = ampm_top + SMALL_DIGIT_H + 2;
  }
#endif
  if (ampm_buf[0]) {
    graphics_draw_text(ctx, ampm_buf, g_font_small_bold,
                       GRect(side_x, ampm_top - SMALL_TOP_PAD,
                             ampm_size.w + 2, SIDE_TEXT_H),
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  }
  if (sec_buf[0]) {
    graphics_draw_text(ctx, sec_buf, g_font_small_bold,
                       GRect(side_x, sec_top - SMALL_TOP_PAD,
                             sec_size.w + 2, SIDE_TEXT_H),
                       GTextOverflowModeFill, GTextAlignmentLeft, NULL);
  }
}
