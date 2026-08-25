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
  graphics_draw_line(ctx, GPoint(c.x - r - 2, c.y), GPoint(c.x - r - 1, c.y));
  graphics_draw_line(ctx, GPoint(c.x + r + 1, c.y), GPoint(c.x + r + 2, c.y));
  graphics_draw_line(ctx, GPoint(c.x, c.y - r - 2), GPoint(c.x, c.y - r - 1));
  graphics_draw_line(ctx, GPoint(c.x, c.y + r + 1), GPoint(c.x, c.y + r + 2));
}

static void prv_icon_weather(GContext *ctx, GPoint o, int s, WeatherCond cond,
                             GColor fg, GColor bg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  switch (cond) {
    case COND_CLEAR:
      prv_draw_sun(ctx, GPoint(o.x + s / 2, o.y + s / 2), s / 4);
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

static void prv_icon_battery(GContext *ctx, GPoint o, int s, GColor fg) {
  BatteryChargeState st = battery_state_service_peek();
  int body_w = (s * 13) / 10;
  int body_h = s / 2 + 1;
  int y = o.y + (s - body_h) / 2;
  graphics_context_set_stroke_color(ctx, fg);
  graphics_context_set_fill_color(ctx, fg);
  graphics_draw_rect(ctx, GRect(o.x, y, body_w, body_h));
  graphics_fill_rect(ctx, GRect(o.x + body_w, y + body_h / 3, 2, body_h - (2 * body_h) / 3),
                     0, GCornerNone);
  int inner_w = body_w - 4;
  int fill_w = (inner_w * st.charge_percent) / 100;
  if (fill_w > 0) {
    graphics_fill_rect(ctx, GRect(o.x + 2, y + 2, fill_w, body_h - 4), 0, GCornerNone);
  }
  if (st.is_plugged) {
    // Small bolt poking above the body.
    int bx = o.x + body_w / 2;
    graphics_draw_line(ctx, GPoint(bx + 1, y - 2), GPoint(bx - 1, y + 1));
    graphics_draw_line(ctx, GPoint(bx - 1, y + 1), GPoint(bx + 1, y + 3));
  }
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

static void prv_icon_flame(GContext *ctx, GPoint o, int s, GColor fg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_color(ctx, fg);
  graphics_fill_circle(ctx, GPoint(o.x + s / 2, o.y + (s * 65) / 100), s / 4);
  prv_fill_triangle_rows(ctx, GPoint(o.x + (s * 55) / 100, o.y + s / 10),
                         o.y + (s * 65) / 100, s / 4, true);
}

static void prv_icon_moon(GContext *ctx, GPoint o, int s, GColor fg, GColor bg) {
  graphics_context_set_fill_color(ctx, fg);
  graphics_fill_circle(ctx, GPoint(o.x + s / 2, o.y + s / 2), (s * 38) / 100);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_circle(ctx, GPoint(o.x + (s * 7) / 10, o.y + (s * 4) / 10), (s * 34) / 100);
}

static void prv_icon_steps(GContext *ctx, GPoint o, int s, GColor fg) {
  graphics_context_set_fill_color(ctx, fg);
  int w = (s * 3) / 10 + 1;
  int h = (s * 45) / 100;
  graphics_fill_rect(ctx, GRect(o.x + s / 8, o.y + s / 10, w, h), w / 2, GCornersAll);
  graphics_fill_rect(ctx, GRect(o.x + (s * 55) / 100, o.y + (s * 45) / 100, w, h),
                     w / 2, GCornersAll);
}

static void prv_icon_active(GContext *ctx, GPoint o, int s, GColor fg) {
  graphics_context_set_stroke_color(ctx, fg);
  // Right-pointing play triangle, filled by vertical columns.
  int h = (s * 7) / 10;
  int x0 = o.x + s / 6;
  int y0 = o.y + (s - h) / 2;
  int w = (s * 6) / 10;
  for (int i = 0; i <= w; i++) {
    int shrink = (h * i) / (2 * w);
    graphics_draw_line(ctx, GPoint(x0 + i, y0 + shrink), GPoint(x0 + i, y0 + h - shrink));
  }
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

static void prv_icon_disconnected(GContext *ctx, GPoint o, int s, GColor fg) {
  graphics_context_set_stroke_color(ctx, fg);
  // Phone outline with a cross through it.
  int w = s / 2;
  graphics_draw_rect(ctx, GRect(o.x + s / 4, o.y + s / 10, w, s - s / 5));
  graphics_draw_line(ctx, GPoint(o.x, o.y), GPoint(o.x + s - 1, o.y + s - 1));
  graphics_draw_line(ctx, GPoint(o.x + s - 1, o.y), GPoint(o.x, o.y + s - 1));
}

int status_icon_width(uint8_t metric, int s) {
  switch (metric) {
    case METRIC_BATTERY:
      return (s * 13) / 10 + 4;  // body + terminal + gap
    case METRIC_WEATHER:
      return (g_weather.cond == COND_UNKNOWN) ? 0 : s + 2;
    case METRIC_HEART_RATE:
    case METRIC_CALORIES:
    case METRIC_SLEEP:
    case METRIC_STEPS:
    case METRIC_ACTIVE_MIN:
    case METRIC_NEXT_ALARM:
    case METRIC_CONNECTION:
      return s + 2;
    default:
      return 0;  // distance, week number: text only
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
    case METRIC_CALORIES:     prv_icon_flame(ctx, origin, s, fg); break;
    case METRIC_SLEEP:        prv_icon_moon(ctx, origin, s, fg, bg); break;
    case METRIC_STEPS:        prv_icon_steps(ctx, origin, s, fg); break;
    case METRIC_ACTIVE_MIN:   prv_icon_active(ctx, origin, s, fg); break;
    case METRIC_NEXT_ALARM:   prv_icon_alarm(ctx, origin, s, fg, bg); break;
    case METRIC_CONNECTION:   prv_icon_disconnected(ctx, origin, s, fg); break;
    default: break;
  }
}
