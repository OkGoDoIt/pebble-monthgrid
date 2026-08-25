#include "common.h"

static bool prv_is_leap(int year) {
  return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
}

int days_in_month(int year, int month0) {
  static const uint8_t table[12] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
  if (month0 == 1 && prv_is_leap(year)) {
    return 29;
  }
  return table[month0];
}

int start_wday_setting(void) {
  switch (g_settings.start_day) {
    case START_MONDAY: return 1;
    case START_SATURDAY: return 6;
    default: return 0;
  }
}

// Empty leading cells in the month's first grid row (0..6).
int month_lead_for(const struct tm *t, int start_wday) {
  int wday1 = (t->tm_wday - ((t->tm_mday - 1) % 7) + 7) % 7;
  return (wday1 - start_wday + 7) % 7;
}

// Rows the current month occupies in the grid (4..6) for a given week start.
int month_rows_for(const struct tm *t, int start_wday) {
  int ndays = days_in_month(t->tm_year + 1900, t->tm_mon);
  return (month_lead_for(t, start_wday) + ndays + 6) / 7;
}

// Sakamoto's algorithm; 0 = Sunday. month is 1..12.
static int prv_day_of_week(int year, int month, int day) {
  static const int8_t offsets[12] = { 0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4 };
  if (month < 3) {
    year -= 1;
  }
  return (year + year / 4 - year / 100 + year / 400 + offsets[month - 1] + day) % 7;
}

// A year has 53 ISO weeks iff it starts on Thursday, or is a leap year
// starting on Wednesday; otherwise 52.
static int prv_iso_weeks_in_year(int year) {
  int jan1_mon = (prv_day_of_week(year, 1, 1) + 6) % 7;  // 0 = Monday
  if (jan1_mon == 3 || (prv_is_leap(year) && jan1_mon == 2)) {
    return 53;
  }
  return 52;
}

// ISO 8601 week number (1..53). Weeks start Monday; week 1 contains Jan 4th.
int iso_week_number(const struct tm *t) {
  int year = t->tm_year + 1900;
  int wday_mon = (t->tm_wday + 6) % 7;  // 0 = Monday
  int week = (t->tm_yday - wday_mon + 10) / 7;
  if (week < 1) {
    return prv_iso_weeks_in_year(year - 1);
  }
  if (week > prv_iso_weeks_in_year(year)) {
    return 1;
  }
  return week;
}
