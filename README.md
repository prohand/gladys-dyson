# Dyson — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com)
to **Dyson** connected purifiers, fans, heaters and humidifiers, over the local
network (MQTT) or through the Dyson cloud.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md).

## What it does

| Dyson range (ProductType)                          | Gladys features                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Pure Cool / Purifier Cool (438, 438E, 438K, 520)   | power, speed, auto, oscillation, night mode + air quality sensors                   |
| Pure Hot+Cool / Purifier Hot+Cool (527, 527E/K)    | the above + heating and target temperature                                          |
| Pure Humidify+Cool / Purifier H+C (358, 358E/K)    | the above + humidification                                                          |
| Purifier Big+Quiet (664)                           | power, speed, auto, oscillation, night mode + air quality sensors                   |
| Pure Cool Link, Pure Hot+Cool Link (475, 469, 455) | power, speed, auto, oscillation, night mode (+ heating), temperature, humidity, VOC |

Air quality sensors: temperature, humidity, PM2.5, PM10, VOC and NO2 indexes,
formaldehyde on the `K` models, filter life.

Gladys 5.1 capabilities:

| Kind          | Key                   | What                                                                               |
| ------------- | --------------------- | ---------------------------------------------------------------------------------- |
| Scene trigger | `air_quality_changed` | air quality level changed (good / fair / poor / very poor)                         |
| Scene trigger | `filter_low`          | a filter went under 10 % (400 h on Link models)                                    |
| Scene trigger | `connection_changed`  | a device went local / cloud / unreachable                                          |
| Scene action  | `apply_settings`      | power, mode, speed, oscillation, night mode in one order                           |
| Scene action  | `set_sleep_timer`     | the device turns itself off after N minutes                                        |
| Widget        | `dyson_air`           | live air tiles, status, on/off, auto and refresh buttons                           |
| Widget        | `dyson_controls`      | fan tile, drawing, status, 3 button sets (one with a sleep timer form, Gladys 5.2) |

## Local and cloud

The manifest declares both transports (`"transports": ["local", "cloud"]`):

- **local** — MQTT straight to the device (`<ip>:1883`), at the address typed
  in the configuration (`device_hosts`). Dyson devices announce themselves over
  mDNS as `_dyson_mqtt._tcp`, but the store schema does not accept a `_` inside
  a `network_discovery` service name yet, so the mediated scan is not declared;
- **cloud** — the Dyson AWS IoT broker, with per-device credentials from the
  Dyson account.

Gladys shows the standard **Prefer the local connection** toggle; the other
transport is the fallback, and each device reports the one it uses as a badge
(orange dot when it fell back for a reason the user can fix). The MyDyson
account is needed in both cases: it gives the device list and each device's
local MQTT password. Sign-in uses the one-time code Dyson e-mails.

## Project structure

```
.
├─ index.js                       # SDK bootstrap + handlers (no Dyson logic)
├─ src/
│  ├─ config.js                   # config defaults + normalization
│  ├─ dyson/
│  │  ├─ manager.js               # account, addresses, links, states, badges
│  │  ├─ cloud.js                 # Dyson account API (code, token, devices, IoT)
│  │  ├─ link.js                  # MQTT link to one device, local / cloud
│  │  ├─ protocol.js              # Dyson MQTT messages
│  │  ├─ models.js                # ProductType -> capabilities
│  │  └─ store.js                 # /data/dyson-account.json
│  ├─ devices/fan.js              # Gladys device + features, value mapping
│  └─ capabilities/               # Gladys 5.1: scene triggers, scene actions, widget
├─ docs/en.md, docs/fr.md         # user documentation (re-hosted by Gladys)
├─ test/                          # unit tests (`node --test`), no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                     # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                   # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                      # project rules for coding assistants & contributors
├─ SECURITY.md                    # how to report a vulnerability privately
├─ .github/workflows/ci.yml       # format, lint, tests (Node 22 + 24), store checks, Docker build
├─ .github/workflows/release.yml  # UI-driven release: bump + changelog + tag + build
├─ .github/workflows/build.yml    # multi-arch build (git tag or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # rolls CHANGELOG.md at release
├─ .github/scripts/device-pictures.mjs # draws assets/devices (controls widget pictures)
├─ assets/devices/                # product drawings served to the controls widget
├─ .github/dependabot.yml         # npm / GitHub Actions / Docker updates
└─ cover.png                      # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="dyson" \
DYSON_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor inside the
container. `DYSON_DATA_DIR` (default `/data`) is where the account token is
kept.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test (LOG_LEVEL=silent for quiet output)
npx github:GladysAssistant/integration-store --skip-image-check .   # store rules
```

The CI runs the first three on Node 22 and 24 on every push and pull request;
pull requests also run the store checks and build the image.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`
   (`major` gives the first stable version, `1.0.0`).
3. The workflow bumps `package.json` and the manifest (`version` +
   `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-dyson`, and
   publishes the GitHub Release.

Once published: make the repository public, add the GitHub topic
`gladys-assistant-integration`, make the ghcr.io package public, and turn on
**Private vulnerability reporting** (see [`SECURITY.md`](SECURITY.md)).

## Credits

The Dyson protocol details (account API, local credentials, MQTT messages) come
from the community work on
[libdyson](https://github.com/shenxn/libdyson) and its successors. Dyson is a
trademark of Dyson Technology Limited; this project is not affiliated with
Dyson.

## License

Apache-2.0
