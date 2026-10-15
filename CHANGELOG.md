# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change in the Unreleased section below as you make it. The
Release workflow moves that section under the version it ships, and the section
becomes the notes of the version's GitHub Release.

## [Unreleased]

## [1.7.1] - 2026-10-15

### Fixed

- Formaldehyde sensor missing on the models whose product type does not tell it
  (Purifier Cool Formaldehyde TP09 seen as 438E, some PH04, Big+Quiet BP03): the
  feature is now added after the first reading. Use **Update** on the device in
  the Discover tab to get it.

## [1.7.0] - 2026-10-13

### Added

- German and Spanish translations (configuration screen, messages, widgets,
  documentation). Feature names of new devices are in German for an account in
  Germany, Austria or Liechtenstein, in Spanish for Spain and Spanish-speaking
  Latin America.

### Changed

- Documentation: the "Dyson controls" widget shows speed - and + only while the device
  is on and in manual mode.

### Fixed

- The English documentation names the Gladys screens as the Gladys interface does.

## [1.6.0] - 2026-10-12

### Changed

- `@gladysassistant/integration-sdk` updated to 0.15.0.
- Requires Gladys 5.2.0: the "Dyson controls" widget gets a third button set, "On/off,
  night mode, sleep timer", whose **Sleep timer** button opens a form asking the minutes
  (0 to 540, 0 cancels) and sets the same timer as the "Set the sleep timer" scene action.

## [1.5.0] - 2026-10-12

### Added

- "Dyson controls" widget: a drawing of the device (tower, Hot+Cool, desk fan,
  humidifier or Big+Quiet), with air lines while the fan runs. The new "Show
  the device drawing" setting hides it.

### Fixed

- "Dyson controls" widget description: it no longer lists the air quality and
  PM2.5, removed in 1.4.0.

## [1.4.0] - 2026-10-11

### Changed

- Feature names in French when the account country is French-speaking
  ("Mode nuit", "Angle d'oscillation"...), in English otherwise. Devices
  already added keep their names: rename them in the device page.
- "Dyson controls" widget: controls only. The air quality and PM2.5 tiles are
  gone (they are in the "Dyson air quality" widget), the filters too.
- "Dyson air quality" widget: the filter life is in its status list, after
  the connection.

## [1.3.0] - 2026-10-11

### Added

- Oscillation angle list on the Pure Cool, Purifier Cool and Hot+Cool towers:
  45°, 90°, 180° and 350°, like the Dyson app. Choosing one starts the
  oscillation.

### Changed

- Oscillation and night mode are on/off switches again: their two-entry lists
  were clumsier than a toggle.
- "Dyson controls" widget: three tiles (the fan: off, auto or a live speed
  gauge; the air quality level; the PM2.5) instead of one speed gauge that
  kept the last speed when the fan was off. The oscillation row gives the
  angle; with the oscillation buttons, the oscillation and night mode rows
  are left out.
- VOC and NO2 indexes are whole numbers, like in the Dyson app.

### Fixed

- PM2.5, PM10 and humidity showed as empty chips in the Discover tab, with no
  icon on the dashboard: they use the type Gladys knows for these sensors.
- PM2.5, PM10 and formaldehyde differed from the Dyson app (and from Matter):
  the integration read older fields of the device, the ones the app shows are
  now used.

Devices added before: click "Update" in the Discover tab.

## [1.2.1] - 2026-10-11

### Changed

- New store cover: a darker, cleaner look closer to the Dyson style.

## [1.2.0] - 2026-10-11

### Added

- "Dyson controls" widget: a "Buttons" setting to pick the four buttons, on/off,
  auto, speed - and + (default), or on/off, oscillation, night mode and airflow.
- Device addresses: the IP alone is enough when the account has a single Dyson
  device.
- On the cloud after a failed local connection (or the reverse), the
  integration tries the preferred one again every 4 minutes and goes back to
  it.

### Changed

- Mode list: Medium covers speeds 4 to 6 and High 7 to 10 (7 already blows
  hard).
- "Dyson controls" widget: a click updates the widget as soon as the device
  answered; the mode row says the mode list entry and the speed ("Medium ·
  speed 5"); in auto mode, a "Manual mode" button replaces "Auto mode".
- The fallback message and "Test the connection" give the serial to type in
  Device addresses.

### Fixed

- The Discover tab showed the features of the previous version, with no
  "Update" button: the device list is now published at every start.
- The widgets could stay stale up to 2 minutes after a change (night mode,
  speed, on/off): Gladys ignores a refresh request sent less than 10 s after
  the previous one, the integration now holds it and sends it then.

## [1.1.0] - 2026-10-11

### Added

- Mode list like the Matter fans: off, low (speed 1), medium (speed 5), high
  (speed 10), auto. It follows the speed, so the list and the slider agree.
- Airflow direction (front / back) on the Pure Cool, Purifier Cool and
  Hot+Cool models.
- "Dyson controls" dashboard widget: live speed gauge, mode, oscillation,
  night mode, airflow, connection, filters, sleep timer, and on/off, auto,
  speed - and speed + buttons.

### Changed

- Oscillation and night mode use the Gladys fan types: each control gets its
  own icon. Devices added before: click "Update" in the Discover tab.
- "Dyson air quality" widget: PM10 and NO2 tiles, each pollutant tile coloured
  by its level; the on/off and auto buttons moved to "Dyson controls".
- New cover image: a Dyson tower purifier silhouette.

### Fixed

- The GitHub Release of a new version gets its changelog section as notes: the
  workflow read the changelog of the commit before the version bump. A manual
  run with `refresh-notes` rewrites the notes of the existing releases.

## [1.0.0] - 2026-10-10

### Added

- Scene triggers (Gladys 5.1): air quality changed, filter to replace soon,
  connection changed.
- Scene actions: apply Dyson settings (power, mode, speed, oscillation, night
  mode in one order) and set the sleep timer.
- "Dyson air quality" dashboard widget: live air tiles, status (air quality,
  connection, mode, filters, sleep timer), on/off, auto and refresh buttons.

### Fixed

- The Release workflow no longer mistakes a mention of the Unreleased heading
  in the changelog introduction for the heading itself (it broke the 0.0.1
  notes).

## [0.0.1] - 2026-10-10

### Added

- Dyson integration for Gladys, built on the official JavaScript template.
- Sign-in to the MyDyson account with the one-time code Dyson e-mails
  ("Receive a code", then "Validate the code"); the session is kept in `/data`.
- Discovery of the fans, purifiers, heaters and humidifiers of the account:
  Pure Cool / Purifier Cool, Pure Hot+Cool / Purifier Hot+Cool, Pure
  Humidify+Cool / Purifier Humidify+Cool, Big+Quiet, and the Link models.
- Controls: power, speed, auto mode, oscillation, night mode, heating and target
  temperature, humidification — confirmed by the device before Gladys shows them.
- Sensors: temperature, humidity, PM2.5, PM10, VOC and NO2 indexes,
  formaldehyde, filter life.
- Local and cloud transports: local MQTT at the address typed in the
  configuration, the Dyson cloud otherwise; the "Prefer the local connection"
  toggle picks the order, and each device shows its transport badge, flagged
  degraded on a fallback.
- "Test the connection" and "Sign out" actions.
- User documentation in English and French, `SECURITY.md`, `CLAUDE.md`.
- CI (format, lint, tests on Node 22 and 24, store checks and image build on
  pull requests), UI-driven Release workflow, multi-arch image build, GitHub
  Release per version, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-dyson/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/prohand/gladys-dyson/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/prohand/gladys-dyson/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/prohand/gladys-dyson/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/prohand/gladys-dyson/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/prohand/gladys-dyson/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/prohand/gladys-dyson/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/prohand/gladys-dyson/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/prohand/gladys-dyson/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/prohand/gladys-dyson/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/prohand/gladys-dyson/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/prohand/gladys-dyson/releases/tag/v0.0.1
