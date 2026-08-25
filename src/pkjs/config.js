// Clay configuration page for MonthGrid.
// Select values are numbers so they arrive on the watch as int32 tuples.

var METRIC_OPTIONS = [
  { label: 'None', value: 0 },
  { label: 'Battery', value: 1 },
  { label: 'Weather', value: 2 },
  { label: 'Steps', value: 3 },
  { label: 'Distance walked', value: 4 },
  { label: 'Heart rate', value: 5 },
  { label: 'Active minutes', value: 6 },
  { label: 'Calories (active)', value: 7 },
  { label: 'Sleep last night', value: 8 },
  { label: 'Week number', value: 9 },
  { label: 'Disconnected alert', value: 10 },
  { label: 'Next alarm', value: 11 },
];

module.exports = [
  {
    type: 'heading',
    defaultValue: 'MonthGrid',
  },
  {
    type: 'text',
    defaultValue: 'Your month at a glance.',
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Theme & Layout' },
      {
        type: 'toggle',
        messageKey: 'THEME_INVERT',
        label: 'Inverted theme (white background)',
        defaultValue: false,
      },
      {
        type: 'select',
        messageKey: 'TIME_FORMAT',
        label: 'Time format',
        defaultValue: 0,
        options: [
          { label: 'System default', value: 0 },
          { label: '12-hour', value: 1 },
          { label: '24-hour', value: 2 },
        ],
      },
      {
        type: 'select',
        messageKey: 'TIME_FONT',
        label: 'Time font',
        defaultValue: 0,
        options: [
          { label: 'Roboto (classic bold)', value: 0 },
          { label: 'Digital (LECO)', value: 1 },
          { label: 'Pixel (Silkscreen)', value: 2 },
          { label: 'Bitham bold', value: 3 },
          { label: 'Bitham light', value: 4 },
        ],
      },
      {
        type: 'select',
        messageKey: 'TIME_SIZE',
        label: 'Time font size',
        defaultValue: 0,
        options: [
          { label: 'Large', value: 0 },
          { label: 'Medium', value: 1 },
          { label: 'Small', value: 2 },
        ],
      },
      {
        type: 'toggle',
        messageKey: 'SHOW_SECONDS',
        label: 'Show seconds',
        description: 'Updates every second while enabled, which uses noticeably more battery.',
        defaultValue: false,
      },
      {
        type: 'select',
        messageKey: 'START_DAY',
        label: 'Calendar start day',
        defaultValue: 0,
        options: [
          { label: 'Sunday', value: 0 },
          { label: 'Monday', value: 1 },
          { label: 'Saturday', value: 2 },
        ],
      },
      {
        type: 'select',
        messageKey: 'BANNER_CONTENT',
        label: 'Banner shows',
        description: 'What the inverted bar above the calendar displays. Weekday and ' +
            'month automatically shorten when the full text would not fit. Round ' +
            'watches always show the compact month column.',
        defaultValue: 0,
        options: [
          { label: 'Month name', value: 0 },
          { label: 'Month + day', value: 1 },
          { label: 'Weekday, month + day', value: 2 },
          { label: 'Month + day, year', value: 3 },
          { label: 'Weekday, month + day, year', value: 4 },
          { label: 'Numeric (8/25/2026)', value: 5 },
        ],
      },
      {
        type: 'toggle',
        messageKey: 'SHOW_ADJACENT',
        label: 'Show adjacent months',
        description: 'Fills the first and last weeks with dimmed days from the previous and next month.',
        defaultValue: false,
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Status Line' },
      {
        type: 'text',
        defaultValue: 'Pick up to four items, in priority order. As many as fit are shown; ' +
            'items with nothing to report (no weather yet, no heart-rate sensor, ...) are ' +
            'skipped automatically.',
      },
      { type: 'select', messageKey: 'METRIC1', label: 'Item 1', defaultValue: 1, options: METRIC_OPTIONS },
      { type: 'select', messageKey: 'METRIC2', label: 'Item 2', defaultValue: 2, options: METRIC_OPTIONS },
      { type: 'select', messageKey: 'METRIC3', label: 'Item 3', defaultValue: 0, options: METRIC_OPTIONS },
      { type: 'select', messageKey: 'METRIC4', label: 'Item 4', defaultValue: 0, options: METRIC_OPTIONS },
      {
        type: 'select',
        messageKey: 'TEMP_UNIT',
        label: 'Temperature unit',
        defaultValue: 1,
        options: [
          { label: 'Fahrenheit (°F)', value: 1 },
          { label: 'Celsius (°C)', value: 0 },
        ],
      },
      {
        type: 'select',
        messageKey: 'DIST_UNIT',
        label: 'Distance unit',
        defaultValue: 1,
        options: [
          { label: 'Miles', value: 1 },
          { label: 'Kilometers', value: 0 },
        ],
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Calendar Event Dots' },
      {
        type: 'text',
        defaultValue: 'Marks days that have events, using up to three calendar subscriptions ' +
            '(iCal/ICS URLs — e.g. Google Calendar’s “Secret address in iCal format”). ' +
            'Days with events get a marker under the date, color-coded per calendar on ' +
            'color watches. The URLs never leave your phone; only a per-day yes/no ' +
            'reaches the watch.',
      },
      {
        type: 'toggle',
        messageKey: 'DOTS_ENABLED',
        label: 'Show event markers',
        defaultValue: false,
      },
      {
        type: 'select',
        messageKey: 'DOTS_STYLE',
        label: 'Marker style',
        defaultValue: 0,
        options: [
          { label: 'Underline (splits per calendar)', value: 0 },
          { label: 'Small squares', value: 1 },
        ],
      },
      {
        type: 'input',
        messageKey: 'CAL1_URL',
        label: 'Calendar 1 URL',
        attributes: { placeholder: 'https://…/basic.ics', type: 'url' },
        defaultValue: '',
      },
      {
        type: 'color',
        messageKey: 'CAL1_COLOR',
        label: 'Calendar 1 color',
        defaultValue: '0xFF0000',
        sunlight: true,
        capabilities: ['COLOR'],
      },
      {
        type: 'input',
        messageKey: 'CAL2_URL',
        label: 'Calendar 2 URL',
        attributes: { placeholder: 'https://…/basic.ics', type: 'url' },
        defaultValue: '',
      },
      {
        type: 'color',
        messageKey: 'CAL2_COLOR',
        label: 'Calendar 2 color',
        defaultValue: '0x0055FF',
        sunlight: true,
        capabilities: ['COLOR'],
      },
      {
        type: 'input',
        messageKey: 'CAL3_URL',
        label: 'Calendar 3 URL',
        attributes: { placeholder: 'https://…/basic.ics', type: 'url' },
        defaultValue: '',
      },
      {
        type: 'color',
        messageKey: 'CAL3_COLOR',
        label: 'Calendar 3 color',
        defaultValue: '0x00AA00',
        sunlight: true,
        capabilities: ['COLOR'],
      },
    ],
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Alerts' },
      {
        type: 'toggle',
        messageKey: 'VIBE_DISCONNECT',
        label: 'Vibrate on disconnect',
        description: 'A short pulse when the phone connection is lost.',
        defaultValue: false,
      },
    ],
  },
  {
    type: 'submit',
    defaultValue: 'Save Settings',
  },
];
