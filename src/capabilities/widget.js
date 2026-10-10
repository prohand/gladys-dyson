// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): "Dyson air quality".
//
// One instance shows ONE device, chosen in its settings (`"source":
// "devices"`):
//   - live tiles bound to the device features (temperature, humidity,
//     particles, VOC, NO2): they follow the published states, nothing to
//     refresh;
//   - a status list computed here: air quality level, connection, mode,
//     filters, sleep timer;
//   - buttons: on/off and auto mode go through the device features
//     (onSetValue), "Refresh" through onWidgetAction.
//
// The computed part is cached by the core until `ttl_seconds`; the manager
// nudges the widget (requestWidgetRefresh) when the mode, the connection or
// the air quality level changes.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES } from '../devices/fan.js';
import { readNumber } from '../dyson/protocol.js';

const logger = createLogger({ name: 'widget' });

export const AIR_WIDGET = 'dyson_air';

export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

// By priority: the content budget allows 8 components, and the status list
// and up to 3 buttons take 4 of them. PM10 and NO2 still weigh in the air
// quality level of the status list.
const MAX_TILES = 4;
const TILES = [
  { key: FEATURES.PM25, label: { en: 'PM2.5', fr: 'PM2.5' }, icon: 'wind' },
  { key: FEATURES.VOC, label: { en: 'VOC', fr: 'COV' }, icon: 'cloud' },
  {
    key: FEATURES.TEMPERATURE,
    label: { en: 'Temperature', fr: 'Température' },
    icon: 'thermometer',
  },
  { key: FEATURES.HUMIDITY, label: { en: 'Humidity', fr: 'Humidité' }, icon: 'droplet' },
  { key: FEATURES.PM10, label: { en: 'PM10', fr: 'PM10' }, icon: 'wind' },
  { key: FEATURES.NO2, label: { en: 'NO2', fr: 'NO2' }, icon: 'cloud' },
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

const message = (en, fr) => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'body', text: { en, fr } }],
});

function modeStatus(model, state) {
  const off =
    model.protocol === 'link'
      ? state.fmod === 'OFF'
      : state.fpwr === 'OFF' || state.fpwr === undefined;
  if (off) {
    return { value: { en: 'Off', fr: 'Éteint' }, color: WIDGET_COLORS.NEUTRAL };
  }
  const auto = model.protocol === 'link' ? state.fmod === 'AUTO' : state.auto === 'ON';
  if (auto) {
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

/**
 * Content of one widget instance.
 * @param {object} dyson the manager (deviceInfo)
 * @param {{settings: object}} request
 */
export function buildWidgetContent(dyson, { settings }) {
  if (!settings?.device) {
    return message(
      'Choose a Dyson device in the widget settings.',
      'Choisissez un appareil Dyson dans les réglages du widget.',
    );
  }
  const device = dyson.deviceInfo(settings.device);
  if (!device) {
    return message(
      'This Dyson device is not available: is it still in the account?',
      "Cet appareil Dyson n'est pas disponible : est-il toujours dans le compte ?",
    );
  }

  const { model, productState: state, features, status, level } = device;
  const components = [];

  for (const tile of TILES.filter(({ key }) => features[key]).slice(0, MAX_TILES)) {
    components.push({
      type: 'value',
      label: tile.label,
      icon: tile.icon,
      device_feature: features[tile.key],
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
  const transport = TRANSPORTS[status.transport];
  items.push({
    label: { en: 'Connection', fr: 'Connexion' },
    icon: 'wifi',
    ...(status.degraded
      ? {
          value: { en: `${transport.value.en} (fallback)`, fr: `${transport.value.fr} (secours)` },
          color: WIDGET_COLORS.WARNING,
        }
      : transport),
  });
  if (status.transport !== 'unreachable') {
    items.push({ label: { en: 'Mode', fr: 'Mode' }, icon: 'sliders', ...modeStatus(model, state) });
  }
  items.push(...filterItems(model, state));
  const timer = readNumber(state.sltm);
  if (timer !== null && timer > 0) {
    items.push({
      label: { en: 'Sleep timer', fr: 'Minuterie' },
      icon: 'clock',
      value: `${timer} min`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: items.slice(0, 10) });

  if (features[FEATURES.POWER]) {
    const isOn = modeStatus(model, state).value.en !== 'Off';
    components.push({
      type: 'button',
      label: isOn ? { en: 'Turn off', fr: 'Éteindre' } : { en: 'Turn on', fr: 'Allumer' },
      icon: 'power',
      style: isOn ? 'secondary' : 'primary',
      device_feature: features[FEATURES.POWER],
      value: isOn ? 0 : 1,
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
  components.push({
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH, params: { device: settings.device } },
  });

  return { ttl_seconds: 120, components };
}

/**
 * A tapped `button` carrying an `action`. `params` are the ones this content
 * declared, never user input.
 */
export async function handleWidgetAction(dyson, { actionKey, params }) {
  logger.info(`onWidgetAction <- ${AIR_WIDGET}.${actionKey}`);
  if (actionKey !== WIDGET_ACTIONS.REFRESH) {
    throw new Error(`Unknown widget action: ${actionKey}`);
  }
  const refreshed = await dyson.refreshDevice(params?.device);
  return refreshed
    ? { en: 'Readings requested.', fr: 'Relevés demandés.' }
    : { en: 'The device is unreachable.', fr: "L'appareil est injoignable." };
}
