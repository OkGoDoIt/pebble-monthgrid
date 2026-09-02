#include "common.h"

// Tiny procedural status-line icons. Every icon draws inside a box of height
// s whose top-left is `origin`; widths are reported by status_icon_width so
// the status line can be measured before drawing. Drawn with antialiasing
// off — these are meant to read as crisp pixel art.

static void prv_fill_triangle_rows(GContext *ctx, GPoint apex, int base_y, int half_base,
                                   bool point_up) {
  // Fill a vertical triangle by horizontal spans (avoids GPath allocations).
  int height = point_up ? (base_y - apex.y) : (apex.y - base_y);
  if (height <= 0) { return; }
  for (int i = 0; i <= height; i++) {
    int y = point_up ? (apex.y + i) : (apex.y - i);
    int half = (half_base * i) / height;
    graphics_draw_line(ctx, GPoint(apex.x - half, y), GPoint(apex.x + half, y));
  }
}

static void prv_draw_cloud(GContext *ctx, GPoint o, int s) {
  // Two puffs + a flat base, occupying the lower ~2/3 of the box.
  graphics_fill_circle(ctx, GPoint(o.x + (s * 3) / 10, o.y + (s * 6) / 10), s / 4);
  graphics_fill_circle(ctx, GPoint(o.x + (s * 6) / 10, o.y + (s * 45) / 100), s / 3);
  graphics_fill_rect(ctx, GRect(o.x + s / 5, o.y + (s * 55) / 100, (s * 13) / 20, s / 4),
                     0, GCornerNone);
}

static void prv_draw_sun(GContext *ctx, GPoint c, int r) {
  graphics_fill_circle(ctx, c, r);
  // Cardinal rays with a 1px gap off the disc; diagonals only when there is
  // room, so the small size stays a clean disc-with-rays, not a diamond.
  graphics_draw_line(ctx, GPoint(c.x - r - 3, c.y), GPoint(c.x - r - 2, c.y));
  graphics_draw_line(ctx, GPoint(c.x + r + 2, c.y), GPoint(c.x + r + 3, c.y));
  graphics_draw_line(ctx, GPoint(c.x, c.y - r - 3), GPoint(c.x, c.y - r - 2));
  graphics_draw_line(ctx, GPoint(c.x, c.y + r + 2), GPoint(c.x, c.y + r + 3));
  if (r >= 4) {
    int d = r + 1;
    graphics_draw_pixel(ctx, GPoint(c.x - d, c.y - d));
    graphics_draw_pixel(ctx, GPoint(c.x + d, c.y - d));
    graphics_draw_pixel(ctx, GPoint(c.x - d, c.y + d));
    graphics_draw_pixel(ctx, GPoint(c.x + d, c.y + d));
  }
}

static void prv_icon_weather(GContext *ctx, GPoint o, int s, WeatherCond cond,
                             GColor fg, GColor bg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  switch (cond) {
    case COND_CLEAR:
      prv_draw_sun(ctx, GPoint(o.x + s / 2, o.y + s / 2), s / 3);
      break;
    case COND_PARTLY:
      prv_draw_sun(ctx, GPoint(o.x + (s * 3) / 10, o.y + (s * 3) / 10), s / 5);
      graphics_context_set_fill_color(ctx, bg);
      graphics_fill_circle(ctx, GPoint(o.x + (s * 6) / 10, o.y + (s * 45) / 100), s / 3 + 1);
      graphics_context_set_fill_color(ctx, fg);
      prv_draw_cloud(ctx, o, s);
      break;
    case COND_CLOUDY:
      prv_draw_cloud(ctx, GPoint(o.x, o.y - s / 6), s);
      break;
    case COND_RAIN: {
      GPoint c = GPoint(o.x, o.y - s / 4);
      prv_draw_cloud(ctx, c, s);
      for (int i = 0; i < 3; i++) {
        int x = o.x + s / 4 + (i * s) / 4;
        graphics_draw_line(ctx, GPoint(x, o.y + (s * 7) / 10), GPoint(x - 1, o.y + s - 1));
      }
      break;
    }
    case COND_SNOW: {
      GPoint c = GPoint(o.x, o.y - s / 4);
      prv_draw_cloud(ctx, c, s);
      for (int i = 0; i < 3; i++) {
        int x = o.x + s / 4 + (i * s) / 4;
        graphics_draw_pixel(ctx, GPoint(x, o.y + (s * 75) / 100 + ((i == 1) ? s / 8 : 0)));
      }
      break;
    }
    case COND_THUNDER: {
      GPoint c = GPoint(o.x, o.y - s / 4);
      prv_draw_cloud(ctx, c, s);
      int bx = o.x + s / 2;
      int by = o.y + (s * 6) / 10;
      graphics_draw_line(ctx, GPoint(bx, by), GPoint(bx - s / 6, by + s / 5));
      graphics_draw_line(ctx, GPoint(bx - s / 6, by + s / 5), GPoint(bx + 1, by + (s * 2) / 5));
      break;
    }
    case COND_FOG:
      for (int i = 0; i < 3; i++) {
        int y = o.y + (s * 3) / 10 + (i * s) / 5;
        graphics_draw_line(ctx, GPoint(o.x + ((i == 1) ? 0 : s / 6), y),
                           GPoint(o.x + s - ((i == 1) ? s / 6 : 0), y));
      }
      break;
    case COND_WIND:
      for (int i = 0; i < 3; i++) {
        int y = o.y + (s * 3) / 10 + (i * s) / 5;
        graphics_draw_line(ctx, GPoint(o.x, y), GPoint(o.x + s - 1 - ((i * s) / 4), y));
      }
      break;
    default:
      break;
  }
}

// Charging bolt, hand-tuned pixel art so it stays crisp at watch sizes. Each
// row is a bitmask of columns (bit 0 = leftmost). Two down-left diagonals
// joined by a full-width jog — a silhouette nothing else in the status line
// shares, so "charging" reads at a glance instead of hiding in a 2px stub.
static const uint16_t s_bolt_large[13] = {
  0x70, 0x38, 0x1C, 0x0E, 0x07, 0x7F, 0x70, 0x38, 0x1C, 0x0E, 0x07, 0x03, 0x01,
};
static const uint16_t s_bolt_small[9] = {
  0x1C, 0x0E, 0x07, 0x1F, 0x1C, 0x0E, 0x07, 0x03, 0x01,
};

#define BOLT_LARGE_W 7
#define BOLT_SMALL_W 5

static int prv_bolt_width(int s) {
  return (s >= 12) ? BOLT_LARGE_W : BOLT_SMALL_W;
}

// Blit a row-bitmask glyph (bit 0 = leftmost column) at `o`, filling runs of
// set bits as rects. Shared by every hand-drawn pixel-art icon below.
static void prv_blit(GContext *ctx, GPoint o, const uint16_t *rows, int n_rows, int w) {
  for (int r = 0; r < n_rows; r++) {
    uint16_t bits = rows[r];
    int c = 0;
    while (c < w) {
      if (!(bits & (1 << c))) { c++; continue; }
      int run = 0;
      while (c + run < w && (bits & (1 << (c + run)))) { run++; }
      graphics_fill_rect(ctx, GRect(o.x + c, o.y + r, run, 1), 0, GCornerNone);
      c += run;
    }
  }
}

static void prv_draw_bolt(GContext *ctx, GPoint o, int s, GColor fg) {
  const bool large = (s >= 12);
  const uint16_t *rows = large ? s_bolt_large : s_bolt_small;
  const int n_rows = large ? 13 : 9;
  const int w = large ? BOLT_LARGE_W : BOLT_SMALL_W;
  graphics_context_set_fill_color(ctx, fg);
  // Vertically center when the icon box is taller than the glyph.
  prv_blit(ctx, GPoint(o.x, o.y + (s - n_rows) / 2), rows, n_rows, w);
}

// Semantic colour, used sparingly: battery level and the disconnect slash are
// the only two places where the colour IS the message. Everything else stays
// theme foreground. Black-and-white watches fall back to fg and lose nothing
// but the hue -- the shapes already carry the meaning.
#if defined(PBL_COLOR)
static bool prv_bg_is_dark(void) {
  GColor bg = theme_bg();
  return (bg.r + bg.g + bg.b) <= 4;   // 2 bits per channel, 0..3
}

static GColor prv_battery_color(int pct) {
  const bool dark = prv_bg_is_dark();
  if (pct <= 20) { return dark ? GColorRed : GColorDarkCandyAppleRed; }
  if (pct <= 50) { return dark ? GColorYellow : GColorOrange; }
  return dark ? GColorGreen : GColorIslamicGreen;
}

static GColor prv_alert_color(void) {
  return prv_bg_is_dark() ? GColorRed : GColorDarkCandyAppleRed;
}
#endif

static void prv_icon_battery(GContext *ctx, GPoint o, int s, GColor fg) {
  BatteryChargeState st = battery_state_service_peek();
  if (st.is_plugged) {
#if defined(PBL_COLOR)
    fg = prv_bg_is_dark() ? GColorGreen : GColorIslamicGreen;
#endif
    // Charging swaps the whole icon for the bolt: a nearly-square zigzag
    // beside a wide flat battery outline is unmistakable, where a bolt drawn
    // on top of the outline was not.
    prv_draw_bolt(ctx, o, s, fg);
    return;
  }
  int body_w = (s * 13) / 10;
  int body_h = s / 2 + 1;
  int y = o.y + (s - body_h) / 2;
  graphics_context_set_stroke_color(ctx, fg);
  graphics_context_set_fill_color(ctx, fg);
  graphics_draw_rect(ctx, GRect(o.x, y, body_w, body_h));
  graphics_fill_rect(ctx, GRect(o.x + body_w, y + body_h / 3, 2, body_h - (2 * body_h) / 3),
                     0, GCornerNone);
  // Proportional bar, but floored at a third of the width. Below that the
  // remaining sliver is too few pixels to carry a colour, and the colour is
  // the whole point of the warning -- so an empty battery still shows a
  // third-width red block rather than fading to nothing.
  const int inner_w = body_w - 4;
  const int min_w = inner_w / 3;
  int fill_w = (inner_w * st.charge_percent) / 100;
  if (fill_w < min_w) { fill_w = min_w; }
#if defined(PBL_COLOR)
  graphics_context_set_fill_color(ctx, prv_battery_color(st.charge_percent));
#endif
  graphics_fill_rect(ctx, GRect(o.x + 2, y + 2, fill_w, body_h - 4), 0, GCornerNone);
}

static void prv_icon_heart(GContext *ctx, GPoint o, int s, GColor fg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  int r = s / 5 + 1;
  graphics_fill_circle(ctx, GPoint(o.x + (s * 3) / 10, o.y + (s * 35) / 100), r);
  graphics_fill_circle(ctx, GPoint(o.x + (s * 7) / 10, o.y + (s * 35) / 100), r);
  prv_fill_triangle_rows(ctx, GPoint(o.x + s / 2, o.y + s - 1), o.y + (s * 4) / 10,
                         (s * 4) / 10, false);
}

// Teardrop flame: narrow tip leaning left, broad rounded base. The old
// circle-plus-triangle read as an anonymous blob at 13px.
// Two tongues of UNEQUAL height with a notch between them. Every symmetric
// variant -- smooth teardrop, twin horns, hollow core -- read as a droplet,
// an insect or a ring at 13px. The uneven split is what reads as fire.
static const uint16_t s_flame_large[13] = {
  0x08, 0x0C, 0x2C, 0x2E, 0x6E, 0x7E, 0x3F, 0x7F, 0x7F, 0x7F, 0x3F, 0x3E, 0x1C,
};
static const uint16_t s_flame_small[9] = {
  0x04, 0x06, 0x16, 0x1E, 0x1F, 0x1F, 0x1F, 0x1F, 0x0E,
};

static void prv_icon_flame(GContext *ctx, GPoint o, int s, GColor fg) {
  const bool large = (s >= 12);
  graphics_context_set_fill_color(ctx, fg);
  prv_blit(ctx, o, large ? s_flame_large : s_flame_small, large ? 13 : 9,
           large ? 7 : 5);
}

static void prv_icon_moon(GContext *ctx, GPoint o, int s, GColor fg, GColor bg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_fill_circle(ctx, GPoint(o.x + s / 2, o.y + s / 2), (s * 38) / 100);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_circle(ctx, GPoint(o.x + (s * 7) / 10, o.y + (s * 4) / 10), (s * 34) / 100);
}

// One foot: a small sole with the heel pad set off below it.
static const uint16_t s_foot_large[7] = { 0x6, 0xF, 0xF, 0xF, 0x6, 0x0, 0x6 };
static const uint16_t s_foot_small[5] = { 0x2, 0x7, 0x7, 0x0, 0x2 };

static void prv_icon_steps(GContext *ctx, GPoint o, int s, GColor fg) {
  const bool large = (s >= 12);
  const uint16_t *foot = large ? s_foot_large : s_foot_small;
  const int fh = large ? 7 : 5, fw = large ? 4 : 3;
  // Staggered: the second foot sits down and across, so the pair reads as a
  // stride rather than as a standing pair.
  const int dx = large ? 6 : 4, dy = large ? 5 : 4;
  graphics_context_set_fill_color(ctx, fg);
  const int x0 = o.x + (s - (fw + dx)) / 2;
  const int y0 = o.y + (s - (fh + dy)) / 2;
  prv_blit(ctx, GPoint(x0, y0), foot, fh, fw);
  prv_blit(ctx, GPoint(x0 + dx, y0 + dy), foot, fh, fw);
}

// Running figure -- used for DISTANCE WALKED, where a moving body is the
// obvious read. Active minutes gets the stopwatch below instead.
static const uint16_t s_run_large[13] = {
  0x030, 0x030, 0x000, 0x07C, 0x05E, 0x030, 0x078,
  0x05C, 0x0CE, 0x086, 0x183, 0x103, 0x001,
};
static const uint16_t s_run_small[9] = {
  0x18, 0x18, 0x00, 0x1E, 0x0F, 0x0C, 0x0E, 0x12, 0x21,
};

static void prv_icon_runner(GContext *ctx, GPoint o, int s, GColor fg) {
  const bool large = (s >= 12);
  graphics_context_set_fill_color(ctx, fg);
  prv_blit(ctx, o, large ? s_run_large : s_run_small, large ? 13 : 9,
           large ? 9 : 6);
}

// Active minutes: a dumbbell. A stopwatch is the obvious metaphor for a
// duration, but on a watch face a small round dial reads as "timer" -- or as
// the alarm clock two rows down -- rather than as exercise.
static const uint16_t s_dumb_large[8] = {
  0x202, 0x707, 0x707, 0x7FF, 0x7FF, 0x707, 0x707, 0x202,
};
static const uint16_t s_dumb_small[6] = { 0x42, 0xE7, 0xFF, 0xFF, 0xE7, 0x42 };

static void prv_icon_dumbbell(GContext *ctx, GPoint o, int s, GColor fg) {
  const bool large = (s >= 12);
  const int w = large ? 11 : 8, h = large ? 8 : 6;
  graphics_context_set_fill_color(ctx, fg);
  prv_blit(ctx, GPoint(o.x + (s - w) / 2, o.y + (s - h) / 2),
           large ? s_dumb_large : s_dumb_small, h, w);
}

static void prv_icon_alarm(GContext *ctx, GPoint o, int s, GColor fg, GColor bg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  graphics_fill_circle(ctx, GPoint(o.x + s / 2, o.y + (s * 45) / 100), (s * 35) / 100);
  // Clock hands carved out in bg.
  graphics_context_set_stroke_color(ctx, bg);
  graphics_draw_line(ctx, GPoint(o.x + s / 2, o.y + (s * 45) / 100),
                     GPoint(o.x + s / 2, o.y + s / 4));
  graphics_draw_line(ctx, GPoint(o.x + s / 2, o.y + (s * 45) / 100),
                     GPoint(o.x + (s * 65) / 100, o.y + (s * 45) / 100));
  // Feet.
  graphics_context_set_stroke_color(ctx, fg);
  graphics_draw_line(ctx, GPoint(o.x + s / 5, o.y + (s * 8) / 10),
                     GPoint(o.x + s / 3, o.y + (s * 7) / 10));
  graphics_draw_line(ctx, GPoint(o.x + (s * 4) / 5, o.y + (s * 8) / 10),
                     GPoint(o.x + (s * 2) / 3, o.y + (s * 7) / 10));
}

static void prv_icon_disconnected(GContext *ctx, GPoint o, int s, GColor fg, GColor bg) {
  // The Bluetooth rune, drawn as the single polyline it actually is, then
  // struck through. A phone-with-an-X named the wrong thing: what is lost is
  // the Bluetooth link, and the rune is the symbol people already know.
  const int w = (s * 70) / 100;          // rune is tall and narrow
  const int x = o.x + (s - w) / 2;
  const int cx = x + w / 2, rx = x + w - 1;
  const int t = o.y, b = o.y + s - 1;
  const int q1 = o.y + s / 3, q2 = o.y + (s * 2) / 3;
  const GPoint pts[6] = {
    GPoint(x, q1), GPoint(rx, q2), GPoint(cx, b),
    GPoint(cx, t), GPoint(rx, q1), GPoint(x, q2),
  };
  graphics_context_set_stroke_color(ctx, fg);
  // 2px strokes: a 1px rune loses too much of itself to the slash's moat.
  for (int i = 0; i < 5; i++) {
    graphics_draw_line(ctx, pts[i], pts[i + 1]);
    graphics_draw_line(ctx, GPoint(pts[i].x + 1, pts[i].y),
                       GPoint(pts[i + 1].x + 1, pts[i + 1].y));
  }

  // Strike-through with a 1px background moat either side, so the slash stays
  // legible against the rune's own diagonals instead of merging with them.
  const GPoint s0 = GPoint(o.x + s - 1, o.y + 1), s1 = GPoint(o.x, o.y + s - 2);
  graphics_context_set_stroke_color(ctx, bg);
  for (int d = -1; d <= 1; d++) {
    graphics_draw_line(ctx, GPoint(s0.x + d, s0.y), GPoint(s1.x + d, s1.y));
  }
#if defined(PBL_COLOR)
  graphics_context_set_stroke_color(ctx, prv_alert_color());
#else
  graphics_context_set_stroke_color(ctx, fg);
#endif
  graphics_draw_line(ctx, s0, s1);
}

int status_icon_width(uint8_t metric, int s) {
  switch (metric) {
    case METRIC_BATTERY:
      if (battery_state_service_peek().is_plugged) {
        return prv_bolt_width(s) + 4;  // bolt + gap
      }
      return (s * 13) / 10 + 4;  // body + terminal + gap
    case METRIC_WEATHER:
      return (g_weather.cond == COND_UNKNOWN) ? 0 : s + 2;
    case METRIC_HEART_RATE:
    case METRIC_DISTANCE:
    case METRIC_CALORIES:
    case METRIC_CALORIES_TOTAL:
    case METRIC_SLEEP:
    case METRIC_STEPS:
    case METRIC_ACTIVE_MIN:
    case METRIC_NEXT_ALARM:
    case METRIC_CONNECTION:
      return s + 2;
    default:
      return 0;  // week number: text only
  }
}

void status_icon_draw(GContext *ctx, uint8_t metric, GPoint origin, int s,
                      GColor fg, GColor bg) {
  switch (metric) {
    case METRIC_BATTERY:      prv_icon_battery(ctx, origin, s, fg); break;
    case METRIC_WEATHER:
      if (g_weather.cond != COND_UNKNOWN) {
        prv_icon_weather(ctx, origin, s, g_weather.cond, fg, bg);
      }
      break;
    case METRIC_HEART_RATE:   prv_icon_heart(ctx, origin, s, fg); break;
    case METRIC_CALORIES:
    case METRIC_CALORIES_TOTAL:
                              prv_icon_flame(ctx, origin, s, fg); break;
    case METRIC_SLEEP:        prv_icon_moon(ctx, origin, s, fg, bg); break;
    case METRIC_STEPS:        prv_icon_steps(ctx, origin, s, fg); break;
    case METRIC_ACTIVE_MIN:   prv_icon_dumbbell(ctx, origin, s, fg); break;
    case METRIC_DISTANCE:     prv_icon_runner(ctx, origin, s, fg); break;
    case METRIC_NEXT_ALARM:   prv_icon_alarm(ctx, origin, s, fg, bg); break;
    case METRIC_CONNECTION:   prv_icon_disconnected(ctx, origin, s, fg, bg); break;
    default: break;
  }
}
