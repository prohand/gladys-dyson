# Dyson

This integration connects Gladys to your connected **Dyson purifiers, fans and
heaters** (Pure Cool, Purifier Cool, Hot+Cool, Humidify+Cool, Big+Quiet and
the older "Link" models). Turn them on and off, set the speed, oscillation,
night mode and heating, and follow the air quality they measure.

## What you need

- A **MyDyson** account (the Dyson mobile app), with your devices already
  added and connected to Wi-Fi.
- The e-mail address and password of that account.
- Access to the account's mailbox: Dyson e-mails a **one-time code** at every
  sign-in.

## Local and cloud

The integration can reach a device in two ways:

- **Local**: straight over your network (MQTT, port 1883). Fast, and it works
  without Internet. Give the device address in the configuration (see
  **Settings** below).
- **Dyson cloud**: through Dyson's servers, from anywhere. Needs Internet and
  a signed-in account.

The Dyson account is always needed once: it gives the list of devices and the
local password of each one.

On the Configuration screen, the **Prefer the local connection** toggle (on by
default) picks the path tried first. The other one is the fallback. Each
device shows a **badge** with the path in use: local, cloud or unreachable. An
**orange dot** on the badge means "it works, but through the fallback": hover
it to see why.

## Getting started

1. In Gladys, open **Integrations → Dyson → Configuration**.
2. Fill in:
   - **MyDyson e-mail**: the e-mail of your account;
   - **MyDyson password**;
   - **Account country**: the two-letter code of the country chosen when the
     account was created (`FR`, `BE`, `CH`, `GB`, `US`...).
3. Click **Save**.
4. Click **Receive a code**. Dyson e-mails you a 6-digit code.
5. In **Validate the code**, type that code and confirm. The message says how
   many devices were found.
6. Open the **Discover** tab and add your devices.
7. For the local connection, type the address of each device in **Device
   addresses** (see **Settings**), then save.

The session is kept: no new code is needed after a restart. If Dyson ends the
session (a password change, for instance), the connection status asks for a
new code.

## What you get

Depending on the model:

| Feature               | Models                                   |
| --------------------- | ---------------------------------------- |
| On / off              | all                                      |
| Speed (1 to 10)       | all                                      |
| Auto mode             | all                                      |
| Oscillation           | all                                      |
| Night mode            | all                                      |
| Heating + target (°C) | Hot+Cool                                 |
| Humidification        | Humidify+Cool                            |
| Temperature, humidity | all                                      |
| PM2.5, PM10 (µg/m³)   | 2018 and later models                    |
| VOC index, NO2 index  | 2018 and later models (VOC only on Link) |
| Formaldehyde (mg/m³)  | "Formaldehyde" models (K suffix)         |
| Filter life           | % (HEPA, carbon), hours on Link models   |

The VOC and NO2 indexes are Dyson's: from 0 (clean air) to 10.

Choosing a speed turns the device on and the auto mode off, like the remote
does. In auto mode, no speed is shown.

Gladys shows the state the device **confirms**: an order the device refused
never shows as done. A change made with the remote or the Dyson app shows up
in Gladys too.

## Scenes

### Triggers

In the scene editor, **Integrations** category:

- **Air quality changed**: the level measured by a device changes. Levels:
  good, fair, poor, very poor. The worst of PM2.5, PM10, VOC and NO2 decides,
  with the bands of the Dyson app (PM2.5: 35 / 53 / 70 µg/m³; PM10: 50 / 75 /
  100 µg/m³; VOC and NO2: 3 / 6 / 8). Variables: `level`, `previous_level`,
  `pm25`, `pm10`, `voc`, `no2`.
- **Filter to replace soon**: a filter goes under 10 % (400 hours on the Link
  models). Variables: `filter` (`hepa`, `carbon`, `combined`), `remaining`.
- **Connection changed**: a device switches to local, to the cloud, or
  becomes unreachable. Variables: `transport`, `previous_transport`,
  `degraded`.

Each trigger can be limited to one device. One event per change. At startup,
the first value is the reference: a restart does not run your scenes again.

### Actions

- **Apply Dyson settings**: power, mode (auto / manual), speed, oscillation
  and night mode, in one order. An empty field changes nothing. "Off" ignores
  the other settings.
- **Set the sleep timer**: the device turns itself off after N minutes (1 to
  540); 0 cancels the timer.

Both return `sent` (order sent or not) and `transport` (connection used). An
unreachable device does not fail the scene: `sent` is then `false`.

## Dashboard widget

The **Dyson air quality** widget shows one device, chosen in its settings:

- 4 live tiles: PM2.5, VOC, temperature, humidity (depending on the model);
- the status: air quality, connection, mode, filters, sleep timer;
- buttons: turn on / off, auto mode, refresh the readings.

## Settings

- **Device addresses (local)**: the address of each device on your network,
  as `serial=IP`, separated by commas. Example:
  `NK6-EU-MHA0000A=192.168.1.20`. A device without an address here goes
  through the Dyson cloud (badge with an orange dot). The serial number is on
  the device label and in the MyDyson app. Give the device a fixed address in
  your router so it does not change.
- **Sensor refresh (s)**: how often the air quality sensors are read, from 15
  to 3600 seconds (60 by default). Power, speed and other changes arrive at
  once, without waiting.

## Buttons

- **Receive a code** / **Validate the code**: sign in to the Dyson account.
- **Test the connection**: reads the account's device list again and shows,
  for each device, the path in use (local, Dyson cloud, unreachable).
- **Sign out**: deletes the token and the device list kept by the
  integration. The devices stay in Gladys.

## Troubleshooting

- **"Dyson refused the code or the password"**: check the saved password,
  then ask for a new code. A code is only valid for a few minutes.
- **No code received**: look in the spam folder, and check the e-mail and the
  country of the account.
- **"cloud" badge with an orange dot**: the device address is missing from
  **Device addresses**, or the local connection was refused (wrong address,
  device on another network Gladys cannot reach). A factory reset changes the device's local password: click
  **Test the connection** to read it again.
- **"unreachable" badge**: the device is unplugged, off Wi-Fi, or neither the
  local network nor the cloud answers. The integration keeps retrying.
- **A sensor stays empty**: some sensors need a few minutes after power-up. A
  model without that sensor never sends a value.

The integration logs (**Supervision** tab) give the details. They never
contain your password or your token.

## Privacy

Your e-mail and password are only sent to Dyson (`appapi.cp.dyson.com`). The
session token and the device list are kept in the integration's data volume,
readable by the integration only.
