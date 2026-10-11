// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+). One instance shows ONE
// device, chosen in its settings (`"source": "devices"`):
//
//   dyson_air       the air: live tiles bound to the device features (PM2.5,
//                   PM10, VOC, NO2, temperature, humidity), each coloured by
//                   its pollutant level, the overall air quality level, and a
//                   "Refresh" button;
//   dyson_controls  the fan: a live speed gauge, a status list (mode,
//                   oscillation, night mode, airflow, connection, filters,
//                   sleep timer), and on/off, auto, speed - and speed +
//                   buttons that go through the device features (onSetValue).
//
// The tiles and the gauge follow the published states. The rest (colours,
// status rows, button values) is cached by the core until `ttl_seconds`; the
// manager nudges the widgets (requestWidgetRefresh) when a product state, the
// connection or a pollutant level changes.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES, SPEED_MAX, SPEED_MIN } from '../devices/fan.js';
import { kelvinTenthsToCelsius, readNumber } from '../dyson/protocol.js';

const logger = createLogger({ name: 'widget' });

// Widget keys are stored by the dashboards: never rename one.
export const AIR_WIDGET = 'dyson_air';
export const CONTROLS_WIDGET = 'dyson_controls';
export const WIDGETS = [AIR_WIDGET, CONTROLS_WIDGET];

export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

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

function modeStatus(model, state) {
  if (isOff(model, state)) {
    return { value: { en: 'Off', fr: 'Éteint' }, color: WIDGET_COLORS.NEUTRAL };
  }
  if (isAuto(model, state)) {
    return { value: { en: 'Auto', fr: 'Auto' }, color: WIDGET_COLORS.PRIMARY };
  }
  const speed = readNumber(state.fnsp);
  return {
    value:
      speed === null
        ? { en: 'On', fr: 'Allumé' }
        : { en: `Speed ${speed}`, fr: `Vitesse ${speed}` },
    color: WIDGET_COLORS.PRIMARY,
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

function settingItems(model, state) {
  const items = [
    ...switchItem(
      { en: 'Oscillation', fr: 'Oscillation' },
      'refresh-cw',
      state.oson,
      ['ON', 'OION'],
      ['OFF', 'OIOF'],
    ),
    ...switchItem({ en: 'Night mode', fr: 'Mode nuit' }, 'moon', state.nmod, ['ON'], ['OFF']),
  ];
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
  const { model, productState: state, features, status } = device;
  const reachable = status.transport !== 'unreachable';
  const components = [];

  if (features[FEATURES.SPEED]) {
    components.push({
      type: 'gauge',
      label: { en: 'Fan speed', fr: 'Vitesse' },
      device_feature: features[FEATURES.SPEED],
    });
  }

  const items = [];
  if (reachable) {
    items.push({ label: { en: 'Mode', fr: 'Mode' }, icon: 'sliders', ...modeStatus(model, state) });
    items.push(...settingItems(model, state));
  }
  items.push(connectionItem(status));
  if (reachable) {
    items.push(...filterItems(model, state), ...timerItems(state));
  }
  components.push({ type: 'status', items: items.slice(0, 10) });

  const off = isOff(model, state);
  if (features[FEATURES.POWER]) {
    components.push({
      type: 'button',
      label: off ? { en: 'Turn on', fr: 'Allumer' } : { en: 'Turn off', fr: 'Éteindre' },
      icon: 'power',
      style: off ? 'primary' : 'secondary',
      device_feature: features[FEATURES.POWER],
      value: off ? 1 : 0,
    });
  }
  if (features[FEATURES.AUTO]) {
    components.push({
      type: 'button',
      label: { en: 'Auto mode', fr: 'Mode auto' },
      icon: 'zap',
      style: 'secondary',
      device_feature: features[FEATURES.AUTO],
      value: 1,
    });
  }
  // A button carries a fixed value: one step from the current speed. Hidden
  // while the device is off or gives no speed (auto), and at the ends.
  const speed = readNumber(state.fnsp);
  if (features[FEATURES.SPEED] && reachable && !off && speed !== null) {
    if (speed > SPEED_MIN) {
      components.push({
        type: 'button',
        label: { en: 'Speed -', fr: 'Vitesse -' },
        icon: 'minus',
        style: 'secondary',
        device_feature: features[FEATURES.SPEED],
        value: speed - 1,
      });
    }
    if (speed < SPEED_MAX) {
      components.push({
        type: 'button',
        label: { en: 'Speed +', fr: 'Vitesse +' },
        icon: 'plus',
        style: 'secondary',
        device_feature: features[FEATURES.SPEED],
        value: speed + 1,
      });
    }
  }

  return { ttl_seconds: 120, components };
}

/** The content builder of each widget key. */
export const WIDGET_CONTENT = {
  [AIR_WIDGET]: buildAirContent,
  [CONTROLS_WIDGET]: buildControlsContent,
};

/**
 * A tapped `button` carrying an `action`. `params` are the ones this content
 * declared, never user input.
 */
export async function handleWidgetAction(dyson, { actionKey, params }) {
  logger.info(`onWidgetAction <- ${actionKey}`);
  if (actionKey !== WIDGET_ACTIONS.REFRESH) {
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  const refreshed = await dyson.refreshDevice(params?.device);
  return refreshed
    ? { en: 'Readings requested.', fr: 'Relevés demandés.' }
    : { en: 'The device is unreachable.', fr: "L'appareil est injoignable." };
}
