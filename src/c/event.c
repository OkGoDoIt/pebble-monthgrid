#include "common.h"

// The next calendar event: which one shows right now, how its time is worded,
// and where it goes. The phone sends two (the next timed event and the first
// all-day one); the watch decides from its own clock, so the countdown keeps
// going while the phone is away.

bool use_24h(void) {
  return (g_settings.time_format == TIME_FMT_24H)
      || (g_settings.time_format == TIME_FMT_SYSTEM && clock_is_24h_style());
}

// Local midnight of the day t falls on.
static time_t prv_day_start(time_t t) {
  struct tm lt = *localtime(&t);
  lt.tm_hour = 0;
  lt.tm_min = 0;
  lt.tm_sec = 0;
  return mktime(&lt);
}

// A timed event shows from its lead time (or, with "any time today", from
// the start of its day) until it ends; an all-day event shows on its day, and
// the day before when that is within the lead time.
static bool prv_visible(time_t start, time_t end, time_t now) {
  if (!start || (end && now >= end)) { return false; }
  if (now >= start) { return true; }
  if (g_settings.event_within == 0) { return prv_day_start(start) == prv_day_start(now); }
  return start - now <= (time_t) g_settings.event_within * 60;
}

// Unlike the other readings, an event keeps showing while the phone is away:
// its start time is all the watch needs.
bool event_current(EventView *ev) {
  if (g_settings.event_place == EVENT_OFF) { return false; }
  time_t now = time(NULL);
  if (g_plugin.event_name[0]
      && prv_visible(g_plugin.event_start, g_plugin.event_end, now)) {
    *ev = (EventView) { g_plugin.event_name, g_plugin.event_start, g_plugin.event_end,
                        g_plugin.event_all_day != 0 };
    return true;
  }
  if (g_plugin.allday_name[0]
      && prv_visible(g_plugin.allday_start, g_plugin.allday_end, now)) {
    *ev = (EventView) { g_plugin.allday_name, g_plugin.allday_start, g_plugin.allday_end, true };
    return true;
  }
  return false;
}

// "9:30a" / "21:30", or bare "9:30" where room is tight.
static void prv_clock(char *buf, size_t len, time_t when, bool compact) {
  struct tm *lt = localtime(&when);
  if (use_24h() || compact) {
    snprintf(buf, len, "%d:%02d", lt->tm_hour, lt->tm_min);
  } else {
    int hour = lt->tm_hour % 12;
    snprintf(buf, len, "%d:%02d%c", hour ? hour : 12, lt->tm_min, lt->tm_hour < 12 ? 'a' : 'p');
  }
}

// A countdown while it's close ("23m", "1h05"), then the time ("2:30p"),
// "tmrw" for tomorrow, "now" once it has begun. compact is the narrow round
// column: the shortest form of each.
void event_when(const EventView *ev, EventWhen *w, bool compact) {
  time_t now = time(NULL);
  bool tomorrow = prv_day_start(ev->start) > prv_day_start(now);
  w->text[0] = w->full[0] = '\0';
  if (ev->all_day) {
    if (tomorrow) {
      snprintf(w->text, sizeof(w->text), "tmrw");
      snprintf(w->full, sizeof(w->full), "tomorrow");
    }
    return;
  }
  if (now >= ev->start) {
    snprintf(w->text, sizeof(w->text), "now");
    snprintf(w->full, sizeof(w->full), "now");
    return;
  }
  int32_t minutes = (int32_t) ((ev->start - now + 59) / 60);
  if (minutes < 120) {
    if (minutes < 60) {
      snprintf(w->text, sizeof(w->text), "%dm", (int) minutes);
    } else {
      snprintf(w->text, sizeof(w->text), "%dh%02d", (int) (minutes / 60), (int) (minutes % 60));
    }
    snprintf(w->full, sizeof(w->full), "in %s", w->text);
    return;
  }
  char clock[8];
  prv_clock(clock, sizeof(clock), ev->start, compact);
  if (tomorrow) {
    snprintf(w->text, sizeof(w->text), compact ? "tmrw" : "tmrw %s", clock);
    snprintf(w->full, sizeof(w->full), "tomorrow at %s", clock);
  } else {
    snprintf(w->text, sizeof(w->text), "%s", clock);
    snprintf(w->full, sizeof(w->full), "at %s", clock);
  }
}

// In its last minutes before it starts, an event set to take over the
// status line is the line's only item.
bool event_takeover(void) {
  if (g_settings.event_place != EVENT_TAKE) { return false; }
  EventView ev;
  if (!event_current(&ev) || ev.all_day) { return false; }
  time_t left = ev.start - time(NULL);
  return left > 0 && left <= EVENT_TAKE_MIN * 60;
}

// The own line is a rectangular-watch thing; layout.c keeps it only while it
// costs the face nothing else.
bool event_own_line_wanted(void) {
#if defined(EVENT_OWN_LINE)
  EventView ev;
  return g_settings.event_place == EVENT_OWN && event_current(&ev);
#else
  return false;
#endif
}

// The month bar takes the event when it is set there, and when its own line
// didn't fit (on Round 2 it never does).
bool event_in_bar(void) {
#if defined(EVENT_IN_BAR)
  return g_settings.event_place == EVENT_BAR
      || (g_settings.event_place == EVENT_OWN && !g_layout.event_line);
#else
  return false;
#endif
}

// Where the watch has neither, the event leads the status items.
bool event_leads_status(void) {
#if defined(EVENT_IN_BAR)
  return false;
#else
  return g_settings.event_place == EVENT_BAR || g_settings.event_place == EVENT_OWN;
#endif
}

// ---------------------------------------------------------------------------
// Cutting names
// ---------------------------------------------------------------------------

size_t utf8_prefix(const char *s, int n) {
  size_t i = 0;
  while (s[i] && n > 0) {
    i++;
    while (((uint8_t) s[i] & 0xC0) == 0x80) { i++; }
    n--;
  }
  return i;
}

int utf8_count(const char *s) {
  int n = 0;
  for (; *s; s++) {
    if (((uint8_t) *s & 0xC0) != 0x80) { n++; }
  }
  return n;
}

// Drops what a cut name shouldn't end on: spaces, punctuation, dashes, and
// an ellipsis the phone already added.
void trim_name_end(char *s) {
  size_t n = strlen(s);
  for (;;) {
    if (n && strchr(" ,.;:-", s[n - 1])) { n--; continue; }
    // U+2013, U+2014 (dashes) and U+2026 (ellipsis): E2 80 93 / 94 / A6.
    if (n >= 3 && (uint8_t) s[n - 3] == 0xE2 && (uint8_t) s[n - 2] == 0x80
        && ((uint8_t) s[n - 1] == 0x93 || (uint8_t) s[n - 1] == 0x94
            || (uint8_t) s[n - 1] == 0xA6)) {
      n -= 3;
      continue;
    }
    break;
  }
  s[n] = '\0';
}
