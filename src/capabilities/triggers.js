// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+): things that HAPPEN
// to a Dyson device, fired with `gladys.publishSceneEvent`.
//
//   air_quality_changed  the air quality level of a device changed
//   filter_low           a filter crossed its "replace soon" threshold
//   connection_changed   a device went local / cloud / unreachable
//
// One event per transition, never per reading: the tracker remembers the
// last level, filter side and transport of each device, and a first
// observation (after a restart) only sets the reference — a restart must not
// fire every scene again.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { FEATURES, statesFromEnvironment } from '../devices/fan.js';
import { readNumber } from '../dyson/protocol.js';

const logger = createLogger({ name: 'triggers' });

export const SCENE_TRIGGERS = {
  AIR_QUALITY_CHANGED: 'air_quality_changed',
  FILTER_LOW: 'filter_low',
  CONNECTION_CHANGED: 'connection_changed',
};

// The four levels of the Dyson app, best first. Keys stored by the scenes:
// never rename one.
export const AIR_QUALITY_LEVELS = ['good', 'fair', 'poor', 'very_poor'];

// Upper bound of each level but the last, per pollutant: the bands the Dyson
// app colours its graphs with (µg/m³ for particles, 0-10 index otherwise).
const BANDS = {
  [FEATURES.PM25]: [35, 53, 70],
  [FEATURES.PM10]: [50, 75, 100],
  [FEATURES.VOC]: [3, 6, 8],
  [FEATURES.NO2]: [3, 6, 8],
};

/**
 * Level of each pollutant read (the widget colours its tiles with them).
 * @param {object} readings feature key -> value (pm25, pm10, voc, no2)
 * @returns {object} feature key -> one of AIR_QUALITY_LEVELS, read ones only
 */
export function pollutantLevels(readings) {
  const levels = {};
  for (const [key, bands] of Object.entries(BANDS)) {
    const value = readings[key];
    if (typeof value === 'number') {
      const index = bands.findIndex((limit) => value <= limit);
      levels[key] = AIR_QUALITY_LEVELS[index === -1 ? bands.length : index];
    }
  }
  return levels;
}

/**
 * Air quality level of a set of readings: the worst pollutant decides.
 * @param {object} readings feature key -> value (pm25, pm10, voc, no2)
 * @returns {string|null} one of AIR_QUALITY_LEVELS, null without any reading
 */
export function airQualityLevel(readings) {
  const worst = Math.max(
    -1,
    ...Object.values(pollutantLevels(readings)).map((level) => AIR_QUALITY_LEVELS.indexOf(level)),
  );
  return worst === -1 ? null : AIR_QUALITY_LEVELS[worst];
}

// "Replace soon": 10 % on the 2018+ models, 400 hours (about 10 % of 4300) on
// the Link models.
export const FILTER_THRESHOLDS = {
  hepa: { key: 'hflr', limit: 10 },
  carbon: { key: 'cflr', limit: 10 },
  combined: { key: 'filf', limit: 400 },
};

/**
 * @param {object} gladys SDK instance (publishSceneEvent)
 * @param {object} [options]
 * @param {(serial: string) => void} [options.onLevelChange] the level of the
 *   device or of one of its pollutants changed: e.g. nudge the widget
 */
export function createTriggerTracker(gladys, { onLevelChange = () => {} } = {}) {
  /** serial -> { readings, levels, level, filters: { hepa: below? }, transport } */
  const devices = new Map();

  function stateOf(serial) {
    if (!devices.has(serial)) {
      devices.set(serial, {
        readings: {},
        levels: {},
        level: null,
        filters: {},
        transport: null,
      });
    }
    return devices.get(serial);
  }

  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      // A refused event (rate limit, older core) must never break the device.
      logger.warn(`Scene event ${key} not published: ${err.message}`);
    }
  }

  return {
    /** Sensor data received: maybe a new air quality level. */
    async onEnvironment(device, model, values) {
      const state = stateOf(device.serial);
      for (const { key, value } of statesFromEnvironment(model, values)) {
        state.readings[key] = value;
      }
      // A tile changes colour when its own pollutant changes level, even if
      // the worst one stays the same.
      const levels = pollutantLevels(state.readings);
      const changed = Object.keys({ ...levels, ...state.levels }).some(
        (key) => levels[key] !== state.levels[key],
      );
      state.levels = levels;
      if (changed) {
        onLevelChange(device.serial);
      }
      const level = airQualityLevel(state.readings);
      if (level === null || level === state.level) {
        return;
      }
      const previous = state.level;
      state.level = level;
      if (previous === null) {
        return;
      }
      await fire(SCENE_TRIGGERS.AIR_QUALITY_CHANGED, {
        device: device.externalId,
        level,
        previous_level: previous,
        pm25: state.readings[FEATURES.PM25] ?? null,
        pm10: state.readings[FEATURES.PM10] ?? null,
        voc: state.readings[FEATURES.VOC] ?? null,
        no2: state.readings[FEATURES.NO2] ?? null,
      });
    },

    /** Product state received: maybe a filter crossed its threshold. */
    async onProductState(device, values) {
      const state = stateOf(device.serial);
      for (const [filter, { key, limit }] of Object.entries(FILTER_THRESHOLDS)) {
        const remaining = readNumber(values[key]);
        if (remaining === null) {
          continue;
        }
        const below = remaining <= limit;
        const before = state.filters[filter];
        state.filters[filter] = below;
        if (below && before === false) {
          await fire(SCENE_TRIGGERS.FILTER_LOW, {
            device: device.externalId,
            filter,
            remaining,
          });
        }
      }
    },

    /** The link changed transport. */
    async onTransport(device, status) {
      const state = stateOf(device.serial);
      // The first connection after a start is not news: the reference is the
      // first transport the device was reached on.
      if (state.transport === null) {
        if (status.transport !== 'unreachable') {
          state.transport = status.transport;
        }
        return;
      }
      if (state.transport === status.transport) {
        return;
      }
      const previous = state.transport;
      state.transport = status.transport;
      await fire(SCENE_TRIGGERS.CONNECTION_CHANGED, {
        device: device.externalId,
        transport: status.transport,
        previous_transport: previous,
        degraded: status.degraded,
      });
    },

    levelOf(serial) {
      return devices.get(serial)?.level ?? null;
    },

    /** The last sensor readings and the level of each pollutant. */
    airOf(serial) {
      const state = devices.get(serial);
      return { readings: { ...state?.readings }, levels: { ...state?.levels } };
    },

    forget(serial) {
      devices.delete(serial);
    },
  };
}
