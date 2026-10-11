// -----------------------------------------------------------------------------
// Device type: DYSON FAN / PURIFIER (every supported product).
//
// One Gladys device per Dyson product, keyed on its serial number. The
// features depend on the model (src/dyson/models.js): a heater gets the
// heating switch and target temperature, a humidifier the humidification
// switch, the 2018+ models the particulate / NO2 / VOC sensors.
//
// The fan controls use the Gladys FAN types where Gladys has a list for them,
// like the Matter fans: the mode list (off / low / medium / high / auto) and
// the airflow direction. Oscillation and night mode stay on/off switches: the
// fan rock / wind settings render as two-entry lists, clumsier than a toggle.
// The oscillation angle (45° / 90° / 180° / 350°, like the Dyson app) is a
// `text` / `select` list, the only Gladys list with labels of our own.
//
// Controls have `has_feedback: true`: a command only SENDS the change, and the
// STATE-CHANGE the device answers with is what Gladys displays. A command the
// device refused never shows as done.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  celsiusToKelvinTenths,
  kelvinTenthsToCelsius,
  pad4,
  readNumber,
} from '../dyson/protocol.js';

// "fan" + serial: the external id of a device, forever (see CLAUDE.md).
export const DEVICE_TYPE = 'fan';

// Feature keys are part of the external ids: never rename one.
export const FEATURES = {
  POWER: 'power',
  SPEED: 'speed',
  AUTO: 'auto',
  OSCILLATION: 'oscillation',
  NIGHT_MODE: 'night-mode',
  HEATING: 'heating',
  TARGET_TEMPERATURE: 'target-temperature',
  HUMIDIFICATION: 'humidification',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  PM25: 'pm25',
  PM10: 'pm10',
  VOC: 'voc',
  NO2: 'no2',
  FORMALDEHYDE: 'formaldehyde',
  HEPA_FILTER: 'hepa-filter',
  CARBON_FILTER: 'carbon-filter',
  FILTER: 'filter',
  FAN_MODE: 'fan-mode',
  AIRFLOW_DIRECTION: 'airflow-direction',
  OSCILLATION_ANGLE: 'oscillation-angle',
};

export const SPEED_MIN = 1;
export const SPEED_MAX = 10;
export const TARGET_TEMPERATURE_MIN = 1;
export const TARGET_TEMPERATURE_MAX = 37;

// Gladys FAN_MODE values (server/utils/constants.js), the Matter fan modes.
export const FAN_MODES = { OFF: 0, LOW: 1, MEDIUM: 2, HIGH: 3, AUTO: 4 };
// The speed each mode of the list sets, and the speeds each mode shows.
const MODE_SPEEDS = { [FAN_MODES.LOW]: 1, [FAN_MODES.MEDIUM]: 5, [FAN_MODES.HIGH]: 10 };
const LOW_MAX_SPEED = 3;
const MEDIUM_MAX_SPEED = 6;

// Gladys FAN_AIRFLOW_DIRECTION values: forward is the Dyson front airflow.
export const AIRFLOW = { FORWARD: 0, REVERSE: 1 };

// The oscillation widths of the Dyson app, in degrees. The option values are
// stored by Gladys and the scenes: never change one. The labels are one string
// for every language, hence no "off" entry: the oscillation switch does that.
export const OSCILLATION_ANGLES = [45, 90, 180, 350];
// The device takes angles from 5 to 355 (180 is straight ahead).
const ANGLE_MIN = 5;
const ANGLE_MAX = 355;

const control = (name, category, type, min, max, extra = {}) => ({
  name,
  category,
  type,
  min,
  max,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  ...extra,
});

const sensor = (name, category, type, unit, min, max) => ({
  name,
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const binary = (name) => control(name, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, 0, 1);

// Every feature declares min/max: Gladys stores them NOT NULL.
const DEFINITIONS = {
  [FEATURES.POWER]: () => binary('Power'),
  [FEATURES.SPEED]: () =>
    control('Fan speed', CATEGORIES.FAN, TYPES.FAN.SPEED, SPEED_MIN, SPEED_MAX, { step: 1 }),
  [FEATURES.AUTO]: () => binary('Auto mode'),
  [FEATURES.FAN_MODE]: () =>
    control('Mode', CATEGORIES.FAN, TYPES.FAN.MODE, FAN_MODES.OFF, FAN_MODES.AUTO),
  [FEATURES.OSCILLATION]: () => binary('Oscillation'),
  [FEATURES.NIGHT_MODE]: () => binary('Night mode'),
  // A text state has no history in Gladys.
  [FEATURES.OSCILLATION_ANGLE]: () =>
    control('Oscillation angle', CATEGORIES.TEXT, TYPES.TEXT.SELECT, 0, 350, {
      keep_history: false,
      supported_options: OSCILLATION_ANGLES.map((angle) => ({
        value: String(angle),
        label: `${angle}°`,
      })),
    }),
  [FEATURES.AIRFLOW_DIRECTION]: () =>
    control(
      'Airflow direction',
      CATEGORIES.FAN,
      TYPES.FAN.AIRFLOW_DIRECTION,
      AIRFLOW.FORWARD,
      AIRFLOW.REVERSE,
    ),
  [FEATURES.HEATING]: () => binary('Heating'),
  [FEATURES.TARGET_TEMPERATURE]: () =>
    control(
      'Target temperature',
      CATEGORIES.THERMOSTAT,
      TYPES.THERMOSTAT.TARGET_TEMPERATURE,
      TARGET_TEMPERATURE_MIN,
      TARGET_TEMPERATURE_MAX,
      { unit: UNITS.CELSIUS, step: 1 },
    ),
  [FEATURES.HUMIDIFICATION]: () => binary('Humidification'),
  [FEATURES.TEMPERATURE]: () =>
    sensor(
      'Temperature',
      CATEGORIES.TEMPERATURE_SENSOR,
      TYPES.SENSOR.DECIMAL,
      UNITS.CELSIUS,
      -20,
      60,
    ),
  // Humidity and particles are "decimal" even if Dyson sends whole numbers:
  // Gladys only knows that type for these categories, an "integer" one gets
  // no label nor icon (empty chip in the Discover tab, empty icon on the
  // dashboard).
  [FEATURES.HUMIDITY]: () =>
    sensor('Humidity', CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PERCENT, 0, 100),
  [FEATURES.PM25]: () =>
    sensor(
      'PM2.5',
      CATEGORIES.PM25_SENSOR,
      TYPES.SENSOR.DECIMAL,
      UNITS.MICROGRAM_PER_CUBIC_METER,
      0,
      1000,
    ),
  [FEATURES.PM10]: () =>
    sensor(
      'PM10',
      CATEGORIES.PM10_SENSOR,
      TYPES.SENSOR.DECIMAL,
      UNITS.MICROGRAM_PER_CUBIC_METER,
      0,
      1000,
    ),
  // VOC and NO2: Dyson indexes from 0 (clean) to 10, not concentrations.
  [FEATURES.VOC]: () =>
    sensor('VOC index', CATEGORIES.VOC_INDEX_SENSOR, TYPES.VOC_INDEX_SENSOR.INTEGER, null, 0, 10),
  [FEATURES.NO2]: () =>
    sensor('NO2 index', CATEGORIES.NO2_SENSOR, TYPES.SENSOR.DECIMAL, null, 0, 10),
  [FEATURES.FORMALDEHYDE]: () =>
    sensor(
      'Formaldehyde',
      CATEGORIES.FORMALDEHYD_SENSOR,
      TYPES.SENSOR.DECIMAL,
      UNITS.MILLIGRAM_PER_CUBIC_METER,
      0,
      10,
    ),
  [FEATURES.HEPA_FILTER]: () =>
    sensor(
      'HEPA filter life',
      CATEGORIES.MAINTENANCE,
      TYPES.MAINTENANCE.LIFE_REMAINING,
      UNITS.PERCENT,
      0,
      100,
    ),
  [FEATURES.CARBON_FILTER]: () =>
    sensor(
      'Carbon filter life',
      CATEGORIES.MAINTENANCE,
      TYPES.MAINTENANCE.LIFE_REMAINING,
      UNITS.PERCENT,
      0,
      100,
    ),
  // The Link models count the filter life in hours (4300 when new).
  [FEATURES.FILTER]: () =>
    sensor(
      'Filter life',
      CATEGORIES.MAINTENANCE,
      TYPES.MAINTENANCE.LIFE_REMAINING,
      UNITS.HOURS,
      0,
      10000,
    ),
};

/**
 * The features a model has, in display order.
 * @param {ReturnType<import('../dyson/models.js').describeModel>} model
 * @returns {string[]}
 */
export function featureKeys(model) {
  const keys = [FEATURES.POWER, FEATURES.FAN_MODE, FEATURES.SPEED, FEATURES.AUTO];
  keys.push(FEATURES.OSCILLATION);
  if (model.angles) {
    keys.push(FEATURES.OSCILLATION_ANGLE);
  }
  keys.push(FEATURES.NIGHT_MODE);
  if (model.airflow) {
    keys.push(FEATURES.AIRFLOW_DIRECTION);
  }
  if (model.heater) {
    keys.push(FEATURES.HEATING, FEATURES.TARGET_TEMPERATURE);
  }
  if (model.humidifier) {
    keys.push(FEATURES.HUMIDIFICATION);
  }
  keys.push(FEATURES.TEMPERATURE, FEATURES.HUMIDITY);
  if (model.protocol === 'pure') {
    keys.push(FEATURES.PM25, FEATURES.PM10, FEATURES.VOC, FEATURES.NO2);
  } else {
    keys.push(FEATURES.VOC);
  }
  if (model.formaldehyde) {
    keys.push(FEATURES.FORMALDEHYDE);
  }
  if (model.protocol === 'pure') {
    keys.push(FEATURES.HEPA_FILTER, FEATURES.CARBON_FILTER);
  } else {
    keys.push(FEATURES.FILTER);
  }
  return keys;
}

export function deviceIds(gladys, serial) {
  return gladys.externalIds(DEVICE_TYPE, serial);
}

/**
 * The Gladys device of a Dyson product.
 * @param {object} gladys SDK instance
 * @param {{serial: string, name: string|null, productType: string}} dysonDevice
 * @param {ReturnType<import('../dyson/models.js').describeModel>} model
 */
export function buildDevice(gladys, dysonDevice, model) {
  const ids = deviceIds(gladys, dysonDevice.serial);
  return {
    name: dysonDevice.name ?? `Dyson ${model.name}`,
    external_id: ids.device,
    // No Gladys polling: the device pushes its state changes, and the link
    // asks for the sensor data at the configured interval.
    should_poll: false,
    params: [
      { name: 'DYSON_SERIAL', value: dysonDevice.serial },
      { name: 'DYSON_PRODUCT_TYPE', value: model.productType },
      { name: 'DYSON_MODEL', value: model.name },
    ],
    features: featureKeys(model).map((key) => ({
      ...DEFINITIONS[key](),
      external_id: ids.feature(key),
    })),
  };
}

/**
 * Which feature of the device an external id designates.
 * @returns {string|null} a FEATURES value
 */
export function featureKeyOf(gladys, serial, featureExternalId) {
  const ids = deviceIds(gladys, serial);
  return Object.values(FEATURES).find((key) => ids.feature(key) === featureExternalId) ?? null;
}

const onOff = (value) => (value === 'ON' ? 1 : value === 'OFF' ? 0 : null);

/**
 * The Gladys fan mode of a product state.
 * @param {object} model
 * @param {object} state flat product state, as complete as known
 * @returns {number|null} a FAN_MODES value, null when the state does not say
 */
export function fanModeOf(model, state) {
  if (model.protocol === 'link') {
    if (state.fmod === 'OFF') {
      return FAN_MODES.OFF;
    }
    if (state.fmod === 'AUTO') {
      return FAN_MODES.AUTO;
    }
    if (state.fmod !== 'FAN') {
      return null;
    }
  } else {
    if (state.fpwr === 'OFF') {
      return FAN_MODES.OFF;
    }
    if (state.auto === 'ON') {
      return FAN_MODES.AUTO;
    }
    if (state.fpwr !== 'ON') {
      return null;
    }
  }
  // Manual: the speed picks the entry of the list, so the slider and the
  // list always agree (1-3 low, 4-6 medium, 7-10 high).
  const speed = readNumber(state.fnsp);
  if (speed === null) {
    return null;
  }
  if (speed <= LOW_MAX_SPEED) {
    return FAN_MODES.LOW;
  }
  return speed <= MEDIUM_MAX_SPEED ? FAN_MODES.MEDIUM : FAN_MODES.HIGH;
}

/**
 * The oscillation width the device is set to, as an option value.
 * @param {object} state flat product state, as complete as known
 * @returns {string|null} "45", "90", "180", "350", or null for another width
 */
export function oscillationAngleOf(state) {
  // The remote, the buttons and the 2021+ app keep the preset in `ancp` and
  // leave an old range in osal / osau: the preset wins.
  const preset = readNumber(state.ancp);
  if (OSCILLATION_ANGLES.includes(preset)) {
    return String(preset);
  }
  const low = readNumber(state.osal);
  const high = readNumber(state.osau);
  if (low === null || high === null) {
    return null;
  }
  // 5..355 is the app's 350°; a few degrees off is still the preset.
  const angle = OSCILLATION_ANGLES.find((width) => Math.abs(high - low - width) <= 3);
  return angle === undefined ? null : String(angle);
}

/**
 * The STATE-SET of an oscillation width: a range of that width around the
 * current centre, the way the Dyson app sets a preset on a 438. `ancp` CUST
 * makes the device use osal / osau. Choosing a width starts the oscillation.
 */
function oscillationAngleCommand(width, current) {
  const low = readNumber(current.osal);
  const high = readNumber(current.osau);
  const centre = low === null || high === null ? 180 : Math.round((low + high) / 2);
  let from = Math.round(centre - width / 2);
  from = Math.min(ANGLE_MAX - width, Math.max(ANGLE_MIN, from));
  const oson = current.oson === 'OION' || current.oson === 'OIOF' ? 'OION' : 'ON';
  return { oson, ancp: 'CUST', osal: pad4(from), osau: pad4(from + width) };
}

/**
 * Feature values carried by a product state message.
 * @param {object} model
 * @param {object} values flat product state (`fpwr`, `fnsp`...)
 * @param {object} [state] every value known so far, `values` included: the
 *   fan mode depends on several keys a STATE-CHANGE may not all repeat
 * @returns {Array<{key: string, value?: number, text?: string}>} `text` for a
 *   text feature (the oscillation angle)
 */
export function statesFromProductState(model, values, state = values) {
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined && !Number.isNaN(value)) {
      states.push({ key, value });
    }
  };

  if (model.protocol === 'link') {
    if (values.fmod !== undefined) {
      add(FEATURES.POWER, values.fmod === 'OFF' ? 0 : 1);
      add(FEATURES.AUTO, values.fmod === 'AUTO' ? 1 : 0);
    }
    add(FEATURES.FILTER, readNumber(values.filf));
  } else {
    add(FEATURES.POWER, onOff(values.fpwr));
    add(FEATURES.AUTO, onOff(values.auto));
    add(FEATURES.HEPA_FILTER, readNumber(values.hflr));
    add(FEATURES.CARBON_FILTER, readNumber(values.cflr));
  }
  // "AUTO" while the auto mode drives the fan: no speed to show.
  add(FEATURES.SPEED, readNumber(values.fnsp));
  // The 2021+ models say OION / OIOF instead of ON / OFF.
  add(
    FEATURES.OSCILLATION,
    values.oson === 'ON' || values.oson === 'OION'
      ? 1
      : values.oson === 'OFF' || values.oson === 'OIOF'
        ? 0
        : null,
  );
  add(FEATURES.NIGHT_MODE, onOff(values.nmod));
  add(FEATURES.FAN_MODE, fanModeOf(model, state));
  if (model.angles && ['ancp', 'osal', 'osau'].some((key) => values[key] !== undefined)) {
    const angle = oscillationAngleOf(state);
    if (angle !== null) {
      states.push({ key: FEATURES.OSCILLATION_ANGLE, text: angle });
    }
  }
  if (model.airflow) {
    add(
      FEATURES.AIRFLOW_DIRECTION,
      values.fdir === 'ON' ? AIRFLOW.FORWARD : values.fdir === 'OFF' ? AIRFLOW.REVERSE : null,
    );
  }
  if (model.heater) {
    add(FEATURES.HEATING, values.hmod === 'HEAT' ? 1 : values.hmod === 'OFF' ? 0 : null);
    add(FEATURES.TARGET_TEMPERATURE, kelvinTenthsToCelsius(values.hmax));
  }
  if (model.humidifier) {
    add(FEATURES.HUMIDIFICATION, values.hume === 'HUMD' ? 1 : values.hume === 'OFF' ? 0 : null);
  }
  return states;
}

// The MyDyson app shows p25r / p10r / hchr. pm25 / pm10 / hcho are older
// fields that read differently (pm25/pm10 are capped at 149, their PM10 often
// below PM2.5): used only by a firmware without the new ones. Chosen by
// presence: "INIT" in the new field is no reading, not a reason to fall back.
const pick = (values, key, legacy) => (values[key] !== undefined ? values[key] : values[legacy]);

// VOC / NO2: the device sends ten times the index, the app shows it truncated.
function appIndex(raw) {
  const value = readNumber(raw);
  return value === null ? null : Math.floor(value / 10);
}

/**
 * Feature values carried by a sensor data message.
 * @returns {Array<{key: string, value: number}>}
 */
export function statesFromEnvironment(model, values) {
  const readings = [
    [FEATURES.TEMPERATURE, kelvinTenthsToCelsius(values.tact)],
    [FEATURES.HUMIDITY, readNumber(values.hact)],
  ];
  if (model.protocol === 'pure') {
    readings.push(
      [FEATURES.PM25, readNumber(pick(values, 'p25r', 'pm25'))],
      [FEATURES.PM10, readNumber(pick(values, 'p10r', 'pm10'))],
      [FEATURES.VOC, appIndex(values.va10)],
      [FEATURES.NO2, appIndex(values.noxl)],
    );
  } else {
    readings.push([FEATURES.VOC, readNumber(values.vact)]);
  }
  if (model.formaldehyde) {
    readings.push([FEATURES.FORMALDEHYDE, readNumber(pick(values, 'hchr', 'hcho'), 1000)]);
  }
  return readings.filter(([, value]) => value !== null).map(([key, value]) => ({ key, value }));
}

/**
 * The STATE-SET data for a Gladys command.
 * @param {object} model
 * @param {string} key a FEATURES value
 * @param {number|string} value value sent by Gladys (a string for a text feature)
 * @param {object} [current] last product state known (to speak the device's dialect)
 * @returns {object} STATE-SET `data`
 */
export function commandFor(model, key, value, current = {}) {
  const on = Number(value) > 0;
  const link = model.protocol === 'link';

  switch (key) {
    case FEATURES.POWER:
      return link ? { fmod: on ? 'FAN' : 'OFF' } : { fpwr: on ? 'ON' : 'OFF' };
    case FEATURES.AUTO:
      return link ? { fmod: on ? 'AUTO' : 'FAN' } : { auto: on ? 'ON' : 'OFF' };
    case FEATURES.FAN_MODE: {
      const mode = Math.round(Number(value));
      if (mode === FAN_MODES.OFF) {
        return commandFor(model, FEATURES.POWER, 0, current);
      }
      if (mode === FAN_MODES.AUTO) {
        // From off too: the list says "auto", so the device runs.
        return link ? { fmod: 'AUTO' } : { fpwr: 'ON', auto: 'ON' };
      }
      if (MODE_SPEEDS[mode] !== undefined) {
        return commandFor(model, FEATURES.SPEED, MODE_SPEEDS[mode], current);
      }
      break;
    }
    case FEATURES.SPEED: {
      // Choosing a speed means "this speed, now": power on, auto mode off.
      const speed = pad4(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(Number(value)))));
      return link ? { fmod: 'FAN', fnsp: speed } : { fpwr: 'ON', auto: 'OFF', fnsp: speed };
    }
    case FEATURES.OSCILLATION:
      if (current.oson === 'OION' || current.oson === 'OIOF') {
        return { oson: on ? 'OION' : 'OIOF' };
      }
      return { oson: on ? 'ON' : 'OFF' };
    case FEATURES.NIGHT_MODE:
      return { nmod: on ? 'ON' : 'OFF' };
    case FEATURES.OSCILLATION_ANGLE: {
      const width = Number(value);
      if (model.angles && OSCILLATION_ANGLES.includes(width)) {
        return oscillationAngleCommand(width, current);
      }
      break;
    }
    case FEATURES.AIRFLOW_DIRECTION:
      if (model.airflow) {
        return { fdir: Number(value) === AIRFLOW.REVERSE ? 'OFF' : 'ON' };
      }
      break;
    case FEATURES.HEATING:
      if (model.heater) {
        return { hmod: on ? 'HEAT' : 'OFF' };
      }
      break;
    case FEATURES.TARGET_TEMPERATURE:
      if (model.heater) {
        const celsius = Math.min(
          TARGET_TEMPERATURE_MAX,
          Math.max(TARGET_TEMPERATURE_MIN, Number(value)),
        );
        return { hmax: celsiusToKelvinTenths(celsius) };
      }
      break;
    case FEATURES.HUMIDIFICATION:
      if (model.humidifier) {
        return { hume: on ? 'HUMD' : 'OFF' };
      }
      break;
    default:
      break;
  }
  throw new Error(`The feature "${key}" of a ${model.name} cannot be controlled`);
}
