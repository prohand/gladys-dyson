# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]

## [0.0.1] - 2026-10-10

` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
  configuration, the Dyson cloud otherwise; the "Prefer the local connection" toggle picks the
  order, and each device shows its transport badge, flagged degraded on a
  fallback.
- "Test the connection" and "Sign out" actions.
- User documentation in English and French, `SECURITY.md`, `CLAUDE.md`.
- CI (format, lint, tests on Node 22 and 24, store checks and image build on
  pull requests), UI-driven Release workflow, multi-arch image build, GitHub
  Release per version, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-dyson/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/prohand/gladys-dyson/releases/tag/v0.0.1
