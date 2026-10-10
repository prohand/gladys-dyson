# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step) for
**Dyson** connected fans, purifiers, heaters and humidifiers. It runs in its own
sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
and to the devices through [`mqtt`](https://github.com/mqttjs/MQTT.js) — the two
runtime dependencies. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/link.test.js             # one file
node --test --test-name-pattern "cloud"   # tests whose name matches
LOG_LEVEL=silent npm test                 # same, without the integration logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24; pull requests also run the store checks and build the Docker
image. Run the three commands before pushing.

## Architecture

```
index.js                  SDK wiring only: handlers registered before connect()
src/config.js             DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/dyson/manager.js      account, addresses, one link per created device, states, badges
src/dyson/cloud.js        Dyson account API: e-mailed code, token, device list, IoT credentials
src/dyson/link.js         MQTT link to ONE device: local or cloud, fallback, retries
src/dyson/protocol.js     Dyson MQTT messages: topics, decoding, STATE-SET, unit conversions
src/dyson/models.js       ProductType -> protocol dialect (link / pure), heater, humidifier...
src/dyson/store.js        /data/dyson-account.json (token, device list, addresses), 0600
src/devices/fan.js        Gladys device + features of a model, states <-> Dyson values
gladys-assistant-integration.json  manifest: config_schema, actions, transports
docs/en.md, docs/fr.md    user documentation, re-hosted by Gladys (mandatory)
test/                     node --test; helpers fake Gladys, MQTT, timers and the Dyson API
.github/scripts/changelog-release.mjs  rolls CHANGELOG.md at release, tested in test/
```

### How it works

- **Sign-in**: `request_code` asks Dyson to e-mail a one-time code
  (`/v3/userregistration/email/auth`), `verify_code` exchanges code + password
  for a bearer token, saved in `/data`. A 401 later clears the token and the
  connection status asks for a new code.
- **The account gives the local passwords**: `LocalCredentials` of each product,
  AES-256-CBC with a fixed key (`decryptLocalCredentials`). The device never
  gives it itself, so the account is needed at least once.
- **Two transports per device** (`link.js`): local MQTT on `<ip>:1883` (user =
  serial, password = local password) or the Dyson AWS IoT broker over WebSocket
  (custom authorizer headers from `/v2/authorize/iot-credentials`). Same topics
  on both: `<ProductType>/<serial>/command` and `.../status/current`.
  `GLADYS_PREFER_LOCAL` picks the order; the link reports what it actually uses
  through `publishTransports`, `degraded` when it fell back for a fixable reason.
  The link owns reconnection (`reconnectPeriod: 0` in mqtt.js) because a lost
  session may have to change transport.
- **Addresses**: typed in `device_hosts` only. The devices announce
  `_dyson_mqtt._tcp` over mDNS, but the store schema refuses a `_` inside a
  `network_discovery` service name, so the mediated scan cannot be declared.
  No address → cloud, flagged degraded with a message pointing to the setting.
- **Two protocol dialects** (`models.js`): `link` (455, 469, 475: `fmod`
  FAN/AUTO/OFF) and `pure` (2018+: `fpwr`, `auto`). Values are 4-digit strings;
  "OFF"/"INIT" in sensor data mean no reading, never zero. Temperatures are
  tenths of kelvin.
- **Feedback**: controls have `has_feedback: true`; a command only sends a
  STATE-SET, the STATE-CHANGE the device answers is what gets published.
- Only devices **created in Gladys** get a link; states are published only for
  features the Gladys device has, and only when they change.

## Rules

- **External ids are forever.** `gladys.externalIds('fan', serial)` and the
  `FEATURES` keys of `src/devices/fan.js`. Renaming one orphans the user's
  device, history, scenes and dashboards. Same for manifest `config_schema` and
  `actions` keys.
- **Secrets**: never log the MyDyson password, the one-time code, the token or a
  local password. They only go to the Dyson API / the device broker. `/data` is
  the only writable path (read-only rootfs).
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or the manifest, nor the `docker_image` tag, by
  hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects (label,
  description, placeholder). Catalog `description`: 10 to 100 characters per
  language. `transports` stays `["local", "cloud"]`. `test/manifest.test.js`
  ties the manifest to the code (defaults, action handlers).
- **User-facing text** is bilingual (English and French): action messages,
  connection status, transport reasons, manifest texts, `docs/en.md` /
  `docs/fr.md` kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network: inject `fetchImpl`, `mqttConnect`,
  `timers`, `cloudFactory`, `store`.
