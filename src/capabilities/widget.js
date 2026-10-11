// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+). One instance shows ONE
// device, chosen in its settings (`"source": "devices"`):
//
//   dyson_air       the air: live tiles bound to the device features (PM2.5,
//                   PM10, VOC, NO2, temperature, humidity), each coloured by
//                   its pollutant level, the overall air quality level, and a
//                   "Refresh" button;
//   dyson_controls  the fan, as a remote: three tiles (the fan: off, auto or
//                   a live speed gauge; the air quality; the PM2.5), a status
//                   list (oscillation, night mode, airflow, connection,
//                   filters, sleep timer) and four buttons, chosen in the
//                   settings: on/off, auto, speed - and speed +; or on/off,
//                   oscillation, night mode and airflow.
//
// The tiles and the gauge follow the published states. The rest (colours,
// status rows, buttons) is cached by the core until `ttl_seconds`; the manager
// nudges the widgets (requestWidgetRefresh) when a product state, the
// connection or a pollutant level changes.
//
// The control buttons are widget ACTIONS, not device-feature buttons: the core
// refetches the content as soon as an action returns, and the action returns
// once the device answered, so a tap shows its result at once. A speed step
// is computed from the state at the tap, not from the content shown.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  AIRFLOW,
  FAN_MODES,
  FEATURES,
  SPEED_MAX,
  SPEED_MIN,
  fanModeOf,
  oscillationAngleOf,
} from '../devices/fan.js';
import { kelvinTenthsToCelsius, readNumber } from '../dyson/protocol.js';

const logger = createLogger({ name: 'widget' });

// Widget keys are stored by the dashboards: never rename one.
export const AIR_WIDGET = 'dyson_air';
export const CONTROLS_WIDGET = 'dyson_controls';
export const WIDGETS = [AIR_WIDGET, CONTROLS_WIDGET];

export const WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  POWER: 'power',
  AUTO: 'auto',
  SPEED_DOWN: 'speed_down',
  SPEED_UP: 'speed_up',
  OSCILLATION: 'oscillation',
  NIGHT_MODE: 'night_mode',
  AIRFLOW: 'airflow',
};

// Values of the `buttons` setting of the controls widget (stored by the
// dashboards: never rename one).
export const BUTTON_SETS = { SPEED: 'speed', SETTINGS: 'settings' };

// The content budget allows 6 tiles; with the status list and the button,
// 8 components. By priority: the pollutants, then the comfort readings. A
// formaldehyde reading that finds no tile goes to the status list.
const MAX_TILES = 6;
const TILES = [
  { key: FEATURES.PM25, label: { en: 'PM2.5', fr: 'PM2.5' }, icon: 'wind' },
  { key: FEATURES.PM10, label: { en: 'PM10', fr: 'PM10' }, icon: 'wind' },
  { key: FEATURES.VOC, label: { en: 'VOC', fr: 'COV' }, icon: 'cloud' },
  { key: FEATURES.NO2, label: { en: 'NO2', fr: 'NO2' }, icon: 'cloud' },
  {
    key: FEATURES.TEMPERATURE,
    label: { en: 'Temperature', fr: 'Température' },
    icon: 'thermometer',
  },
  { key: FEATURES.HUMIDITY, label: { en: 'Humidity', fr: 'Humidité' }, icon: 'droplet' },
  { key: FEATURES.FORMALDEHYDE, label: { en: 'Formaldehyde', fr: 'Formaldéhyde' }, icon: 'cloud' },
];

const LEVELS = {
  good: { value: { en: 'Good', fr: 'Bonne' }, color: WIDGET_COLORS.SUCCESS },
  fair: { value: { en: 'Fair', fr: 'Moyenne' }, color: WIDGET_COLORS.INFO },
  poor: { value: { en: 'Poor', fr: 'Mauvaise' }, color: WIDGET_COLORS.WARNING },
  very_poor: { value: { en: 'Very poor', fr: 'Très mauvaise' }, color: WIDGET_COLORS.DANGER },
};
// A tile value holds 12 characters at most.
const TILE_LEVEL_NAMES = { very_poor: { en: 'Very poor', fr: 'Très mauv.' } };

const TRANSPORTS = {
  local: { value: { en: 'Local', fr: 'Locale' }, color: WIDGET_COLORS.SUCCESS },
  cloud: { value: { en: 'Dyson cloud', fr: 'Cloud Dyson' }, color: WIDGET_COLORS.INFO },
  unreachable: { value: { en: 'Unreachable', fr: 'Injoignable' }, color: WIDGET_COLORS.DANGER },
};

const ON = { value: { en: 'On', fr: 'Activé' }, color: WIDGET_COLORS.PRIMARY };
const OFF = { value: { en: 'Off', fr: 'Désactivé' }, color: WIDGET_COLORS.NEUTRAL };

const message = (en, fr) => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'body', text: { en, fr } }],
});

const refreshButton = (device) => ({
  type: 'button',
  label: { en: 'Refresh', fr: 'Actualiser' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: WIDGET_ACTIONS.REFRESH, params: { device } },
});

function isOff(model, state) {
  return model.protocol === 'link'
    ? state.fmod === 'OFF'
    : state.fpwr === 'OFF' || state.fpwr === undefined;
}

function isAuto(model, state) {
  return model.protocol === 'link' ? state.fmod === 'AUTO' : state.auto === 'ON';
}

// The names Gladys gives the entries of the fan mode list.
const MODE_NAMES = {
  [FAN_MODES.LOW]: { en: 'Low', fr: 'Faible' },
  [FAN_MODES.MEDIUM]: { en: 'Medium', fr: 'Moyen' },
  [FAN_MODES.HIGH]: { en: 'High', fr: 'Fort' },
};

/**
 * The first tile: what the fan does. A live gauge while it runs at a manual
 * speed; a word when it is off or in auto, where the speed feature still
 * holds the last manual speed (Dyson keeps it, and 0 is out of its range).
 */
function fanTile(model, state, features) {
  const mode = fanModeOf(model, state);
  const word = (value, icon, color) => ({
    type: 'value',
    label: { en: 'Fan', fr: 'Ventilateur' },
    icon,
    value,
    color,
  });
  if (mode === FAN_MODES.OFF) {
    return word({ en: 'Off', fr: 'Éteint' }, 'power', WIDGET_COLORS.NEUTRAL);
  }
  if (mode === FAN_MODES.AUTO) {
    return word('Auto', 'zap', WIDGET_COLORS.PRIMARY);
  }
  if (MODE_NAMES[mode] && features[FEATURES.SPEED]) {
    return {
      type: 'gauge',
      label: { en: 'Fan speed', fr: 'Vitesse' },
      device_feature: features[FEATURES.SPEED],
    };
  }
  return null;
}

function airQualityTile(level) {
  if (!LEVELS[level]) {
    return null;
  }
  return {
    type: 'value',
    label: { en: 'Air quality', fr: "Qualité de l'air" },
    icon: 'wind',
    value: TILE_LEVEL_NAMES[level] ?? LEVELS[level].value,
    color: LEVELS[level].color,
  };
}

/** ON / OFF row, or nothing when the device did not say. */
function switchItem(label, icon, value, onValues, offValues) {
  if (onValues.includes(value)) {
    return [{ label, icon, ...ON }];
  }
  if (offValues.includes(value)) {
    return [{ label, icon, ...OFF }];
  }
  return [];
}

/**
 * @param {boolean} withSwitches false when the buttons already show the
 *   oscillation and night mode (filled when on)
 */
function settingItems(model, state, withSwitches = true) {
  const items = [];
  if (withSwitches) {
    const oscillation = switchItem(
      { en: 'Oscillation', fr: 'Oscillation' },
      'refresh-cw',
      state.oson,
      ['ON', 'OION'],
      ['OFF', 'OIOF'],
    );
    const angle = model.angles ? oscillationAngleOf(state) : null;
    if (oscillation.length > 0 && oscillation[0].color === ON.color && angle !== null) {
      oscillation[0] = {
        ...oscillation[0],
        value: { en: `On · ${angle}°`, fr: `Activé · ${angle}°` },
      };
    }
    items.push(
      ...oscillation,
      ...switchItem({ en: 'Night mode', fr: 'Mode nuit' }, 'moon', state.nmod, ['ON'], ['OFF']),
    );
  }
  if (model.airflow && (state.fdir === 'ON' || state.fdir === 'OFF')) {
    items.push({
      label: { en: 'Airflow', fr: "Flux d'air" },
      icon: 'repeat',
      value: state.fdir === 'ON' ? { en: 'Front', fr: 'Avant' } : { en: 'Back', fr: 'Arrière' },
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (model.heater) {
    const target = kelvinTenthsToCelsius(state.hmax);
    const heating = switchItem(
      { en: 'Heating', fr: 'Chauffage' },
      'thermometer',
      state.hmod,
      ['HEAT'],
      ['OFF'],
    );
    if (heating.length > 0 && state.hmod === 'HEAT' && target !== null) {
      heating[0] = { ...heating[0], value: `${target} °C` };
    }
    items.push(...heating);
  }
  if (model.humidifier) {
    items.push(
      ...switchItem(
        { en: 'Humidification', fr: 'Humidification' },
        'droplet',
        state.hume,
        ['HUMD'],
        ['OFF'],
      ),
    );
  }
  return items;
}

function connectionItem(status) {
  const transport = TRANSPORTS[status.transport];
  return {
    label: { en: 'Connection', fr: 'Connexion' },
    icon: 'wifi',
    ...(status.degraded
      ? {
          value: { en: `${transport.value.en} (fallback)`, fr: `${transport.value.fr} (secours)` },
          color: WIDGET_COLORS.WARNING,
        }
      : transport),
  };
}

function filterItems(model, state) {
  const items = [];
  const percent = (key, en, fr) => {
    const value = readNumber(state[key]);
    if (value !== null) {
      items.push({
        label: { en, fr },
        icon: 'filter',
        value: `${value} %`,
        color: value <= 10 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
  };
  if (model.protocol === 'link') {
    const hours = readNumber(state.filf);
    if (hours !== null) {
      items.push({
        label: { en: 'Filter', fr: 'Filtre' },
        icon: 'filter',
        value: `${hours} h`,
        color: hours <= 400 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
  } else {
    percent('hflr', 'HEPA filter', 'Filtre HEPA');
    percent('cflr', 'Carbon filter', 'Filtre charbon');
  }
  return items;
}

function timerItems(state) {
  const timer = readNumber(state.sltm);
  if (timer === null || timer <= 0) {
    return [];
  }
  return [
    {
      label: { en: 'Sleep timer', fr: 'Minuterie' },
      icon: 'clock',
      value: `${timer} min`,
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
}

/** The device of a widget instance, or the message to show instead. */
function deviceOf(dyson, settings) {
  if (!settings?.device) {
    return {
      content: message(
        'Choose a Dyson device in the widget settings.',
        'Choisissez un appareil Dyson dans les réglages du widget.',
      ),
    };
  }
  const device = dyson.deviceInfo(settings.device);
  if (!device) {
    return {
      content: message(
        'This Dyson device is not available: is it still in the account?',
        "Cet appareil Dyson n'est pas disponible : est-il toujours dans le compte ?",
      ),
    };
  }
  return { device };
}

/**
 * Content of one "Dyson air quality" instance.
 * @param {object} dyson the manager (deviceInfo)
 * @param {{settings: object}} request
 */
export function buildAirContent(dyson, { settings }) {
  const { device, content } = deviceOf(dyson, settings);
  if (!device) {
    return content;
  }
  const { features, status, level, readings = {}, levels = {} } = device;
  const components = [];

  const tiles = TILES.filter(({ key }) => features[key]).slice(0, MAX_TILES);
  for (const tile of tiles) {
    const tileLevel = LEVELS[levels[tile.key]];
    components.push({
      type: 'value',
      label: tile.label,
      icon: tile.icon,
      device_feature: features[tile.key],
      ...(tileLevel ? { color: tileLevel.color } : {}),
    });
  }

  const items = [];
  if (level) {
    items.push({
      label: { en: 'Air quality', fr: "Qualité de l'air" },
      icon: 'wind',
      ...LEVELS[level],
    });
  }
  const formaldehyde = readings[FEATURES.FORMALDEHYDE];
  if (
    features[FEATURES.FORMALDEHYDE] &&
    !tiles.some(({ key }) => key === FEATURES.FORMALDEHYDE) &&
    typeof formaldehyde === 'number'
  ) {
    items.push({
      label: { en: 'Formaldehyde', fr: 'Formaldéhyde' },
      icon: 'cloud',
      value: `${formaldehyde} mg/m³`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push(connectionItem(status));
  components.push({ type: 'status', items });
  components.push(refreshButton(settings.device));

  return { ttl_seconds: 120, components };
}

const actionButton = (device, key, label, icon, style, value) => ({
  type: 'button',
  label,
  icon,
  style,
  action: { key, params: value === undefined ? { device } : { device, value } },
});

const powerButton = (model, state, device) =>
  isOff(model, state)
    ? actionButton(
        device,
        WIDGET_ACTIONS.POWER,
        { en: 'Turn on', fr: 'Allumer' },
        'power',
        'primary',
        1,
      )
    : actionButton(
        device,
        WIDGET_ACTIONS.POWER,
        { en: 'Turn off', fr: 'Éteindre' },
        'power',
        'secondary',
        0,
      );

const autoButton = (device, value) =>
  value === 1
    ? actionButton(
        device,
        WIDGET_ACTIONS.AUTO,
        { en: 'Auto mode', fr: 'Mode auto' },
        'zap',
        'secondary',
        1,
      )
    : actionButton(
        device,
        WIDGET_ACTIONS.AUTO,
        { en: 'Manual mode', fr: 'Mode manuel' },
        'sliders',
        'secondary',
        0,
      );

/** On/off, auto (or back to manual), speed - and speed + (not past the ends). */
function speedButtons(model, state, device) {
  const buttons = [powerButton(model, state, device)];
  if (isOff(model, state)) {
    return [...buttons, autoButton(device, 1)];
  }
  if (isAuto(model, state)) {
    return [...buttons, autoButton(device, 0)];
  }
  buttons.push(autoButton(device, 1));
  const speed = readNumber(state.fnsp);
  if (speed !== null && speed > SPEED_MIN) {
    buttons.push(
      actionButton(
        device,
        WIDGET_ACTIONS.SPEED_DOWN,
        { en: 'Speed -', fr: 'Vitesse -' },
        'minus',
        'secondary',
      ),
    );
  }
  if (speed !== null && speed < SPEED_MAX) {
    buttons.push(
      actionButton(
        device,
        WIDGET_ACTIONS.SPEED_UP,
        { en: 'Speed +', fr: 'Vitesse +' },
        'plus',
        'secondary',
      ),
    );
  }
  return buttons;
}

/**
 * On/off, oscillation, night mode, then airflow (or auto on the models that
 * blow one way). A setting that is on is a filled button; a tap switches it.
 */
function settingButtons(model, state, device) {
  const toggle = (key, label, icon, on) =>
    actionButton(device, key, label, icon, on ? 'primary' : 'secondary', on ? 0 : 1);
  const buttons = [
    powerButton(model, state, device),
    toggle(
      WIDGET_ACTIONS.OSCILLATION,
      { en: 'Oscillation', fr: 'Oscillation' },
      'refresh-cw',
      state.oson === 'ON' || state.oson === 'OION',
    ),
    toggle(
      WIDGET_ACTIONS.NIGHT_MODE,
      { en: 'Night mode', fr: 'Mode nuit' },
      'moon',
      state.nmod === 'ON',
    ),
  ];
  if (model.airflow) {
    // The label says where a tap sends the air.
    const front = state.fdir !== 'OFF';
    buttons.push(
      actionButton(
        device,
        WIDGET_ACTIONS.AIRFLOW,
        front
          ? { en: 'Airflow to back', fr: "Flux vers l'arrière" }
          : { en: 'Airflow to front', fr: "Flux vers l'avant" },
        'repeat',
        'secondary',
        front ? AIRFLOW.REVERSE : AIRFLOW.FORWARD,
      ),
    );
  } else {
    buttons.push(
      toggle(
        WIDGET_ACTIONS.AUTO,
        { en: 'Auto mode', fr: 'Mode auto' },
        'zap',
        isAuto(model, state),
      ),
    );
  }
  return buttons;
}

/**
 * Content of one "Dyson controls" instance.
 * @param {object} dyson the manager (deviceInfo)
 * @param {{settings: object}} request
 */
export function buildControlsContent(dyson, { settings }) {
  const { device, content } = deviceOf(dyson, settings);
  if (!device) {
    return content;
  }
  const { model, productState: state, features, status, level } = device;
  const reachable = status.transport !== 'unreachable';
  const settingsButtons = settings.buttons === BUTTON_SETS.SETTINGS;
  const components = [];

  // Three tiles at most: with the status list and four buttons, the budget
  // of 8 components is full.
  if (reachable) {
    const tiles = [fanTile(model, state, features), airQualityTile(level)];
    if (features[FEATURES.PM25]) {
      tiles.push({
        type: 'value',
        label: { en: 'PM2.5', fr: 'PM2.5' },
        icon: 'wind',
        device_feature: features[FEATURES.PM25],
        ...(LEVELS[device.levels?.[FEATURES.PM25]]
          ? { color: LEVELS[device.levels[FEATURES.PM25]].color }
          : {}),
      });
    }
    components.push(...tiles.filter(Boolean).slice(0, 3));
  }

  const items = [];
  if (reachable) {
    items.push(...settingItems(model, state, !settingsButtons));
  }
  items.push(connectionItem(status));
  if (reachable) {
    items.push(...filterItems(model, state), ...timerItems(state));
  }
  components.push({ type: 'status', items: items.slice(0, 10) });

  if (reachable) {
    const buttons = settingsButtons
      ? settingButtons(model, state, settings.device)
      : speedButtons(model, state, settings.device);
    components.push(...buttons);
  }

  return { ttl_seconds: 120, components };
}

// The core drops a nudge that comes less than 10 s after the previous one of
// the same widget, and a dropped nudge leaves the widget stale until its TTL:
// a command answered 3 s after a sensor nudge would show minutes later. The
// nudges are paced here instead: one now, the next ones held and sent once.
export const NUDGE_MIN_INTERVAL_MS = 10500;

/**
 * Paced `requestWidgetRefresh`: never two nudges of a key within the core's
 * limit, and never a nudge lost — one asked during the quiet period is sent
 * at its end.
 * @param {(key: string) => void} request e.g. gladys.requestWidgetRefresh
 * @param {object} [options]
 * @param {object} [options.timers] injectable timers (tests)
 * @param {() => number} [options.now]
 * @returns {{nudge: (key: string) => void, stop: () => void}}
 */
export function createWidgetNudger(request, { timers = globalThis, now = Date.now } = {}) {
  /** key -> { last, timer } */
  const keys = new Map();

  function send(key, entry) {
    entry.last = now();
    entry.timer = null;
    try {
      request(key);
    } catch (err) {
      logger.debug(`Widget ${key} not nudged: ${err.message}`);
    }
  }

  return {
    nudge(key) {
      const entry = keys.get(key) ?? { last: -Infinity, timer: null };
      keys.set(key, entry);
      if (entry.timer) {
        return; // the held nudge will show this change too
      }
      const wait = entry.last + NUDGE_MIN_INTERVAL_MS - now();
      if (wait <= 0) {
        send(key, entry);
        return;
      }
      entry.timer = timers.setTimeout(() => send(key, entry), wait);
    },
    stop() {
      for (const entry of keys.values()) {
        if (entry.timer) {
          timers.clearTimeout(entry.timer);
          entry.timer = null;
        }
      }
    },
  };
}

/** The content builder of each widget key. */
export const WIDGET_CONTENT = {
  [AIR_WIDGET]: buildAirContent,
  [CONTROLS_WIDGET]: buildControlsContent,
};

const UNREACHABLE = { en: 'The device is unreachable.', fr: "L'appareil est injoignable." };

// The value a declared 0 / 1 param stands for, whatever its type on the way.
const flag = (params) => (Number(params?.value) === 1 ? 1 : 0);

const speedStep = (step) => (state) => {
  const speed = readNumber(state.fnsp);
  const next = speed === null ? null : speed + step;
  return next === null || next < SPEED_MIN || next > SPEED_MAX ? null : next;
};

/** Action key -> the feature it changes, and its value from the params or the state. */
const ACTION_COMMANDS = {
  [WIDGET_ACTIONS.POWER]: (params) => [FEATURES.POWER, () => flag(params)],
  [WIDGET_ACTIONS.AUTO]: (params) => [FEATURES.AUTO, () => flag(params)],
  [WIDGET_ACTIONS.SPEED_DOWN]: () => [FEATURES.SPEED, speedStep(-1)],
  [WIDGET_ACTIONS.SPEED_UP]: () => [FEATURES.SPEED, speedStep(1)],
  [WIDGET_ACTIONS.OSCILLATION]: (params) => [FEATURES.OSCILLATION, () => flag(params)],
  [WIDGET_ACTIONS.NIGHT_MODE]: (params) => [FEATURES.NIGHT_MODE, () => flag(params)],
  [WIDGET_ACTIONS.AIRFLOW]: (params) => [FEATURES.AIRFLOW_DIRECTION, () => flag(params)],
};

/**
 * A tapped `button` carrying an `action`. `params` are the ones this content
 * declared, never user input. A control resolves no toast when it worked: the
 * refetched content shows the result.
 */
export async function handleWidgetAction(dyson, { actionKey, params }) {
  logger.info(`onWidgetAction <- ${actionKey}`);
  if (actionKey === WIDGET_ACTIONS.REFRESH) {
    const refreshed = await dyson.refreshDevice(params?.device);
    return refreshed ? { en: 'Readings requested.', fr: 'Relevés demandés.' } : UNREACHABLE;
  }
  const command = ACTION_COMMANDS[actionKey];
  if (!command) {
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  const [key, valueOf] = command(params);
  const done = await dyson.command(params?.device, key, valueOf);
  return done ? undefined : UNREACHABLE;
}
