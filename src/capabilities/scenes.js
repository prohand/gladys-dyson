// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+): operations a scene
// author places in a scene, registered by index.js with
// `gladys.onSceneAction(key, ...)`.
//
//   apply_settings   power, mode, speed, oscillation, night mode in ONE order
//                    (one STATE-SET), the "preset" a scene usually wants
//   set_sleep_timer  the device turns itself off after N minutes
//
// `fields` arrive resolved by the core; an empty field means "leave as is".
// A device that cannot be reached is an output (`sent: false`), never a
// thrown error: a scene action is not a condition, the scene author gates on
// the output.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { FEATURES, commandFor } from '../devices/fan.js';
import { pad4 } from '../dyson/protocol.js';

const logger = createLogger({ name: 'scenes' });

export const SLEEP_TIMER_MAX_MINUTES = 540;

const isSet = (value) => value !== undefined && value !== null && value !== '';

/**
 * The STATE-SET data of an `apply_settings` action.
 * @param {object} model
 * @param {object} fields resolved fields (power, mode, speed, oscillation, night_mode)
 * @param {object} [current] last product state, for the device's dialect
 * @returns {object|null} null when nothing is asked
 */
export function settingsCommand(model, fields, current = {}) {
  // Off is off: the other settings would turn the device back on (a speed
  // does, on every model).
  if (fields.power === 'off') {
    return commandFor(model, FEATURES.POWER, 0, current);
  }
  const data = {};
  const merge = (key, value) => Object.assign(data, commandFor(model, key, value, current));

  if (fields.power === 'on') {
    merge(FEATURES.POWER, 1);
  }
  if (fields.mode === 'auto') {
    merge(FEATURES.AUTO, 1);
  } else if (isSet(fields.speed) && Number.isFinite(Number(fields.speed))) {
    merge(FEATURES.SPEED, Number(fields.speed));
  } else if (fields.mode === 'manual') {
    merge(FEATURES.AUTO, 0);
  }
  if (fields.oscillation === 'on' || fields.oscillation === 'off') {
    merge(FEATURES.OSCILLATION, fields.oscillation === 'on' ? 1 : 0);
  }
  if (fields.night_mode === 'on' || fields.night_mode === 'off') {
    merge(FEATURES.NIGHT_MODE, fields.night_mode === 'on' ? 1 : 0);
  }
  return Object.keys(data).length > 0 ? data : null;
}

/** "OFF" or the 4-digit minutes of the Dyson sleep timer. */
export function sleepTimerCommand(minutes) {
  const value = Math.round(Number(minutes));
  if (!Number.isFinite(value) || value <= 0) {
    return { sltm: 'OFF' };
  }
  return { sltm: pad4(Math.min(SLEEP_TIMER_MAX_MINUTES, value)) };
}

/**
 * The handlers, keyed like the manifest. `dyson` is the manager
 * (src/dyson/manager.js).
 */
export const SCENE_ACTIONS = {
  async apply_settings(dyson, fields) {
    const device = dyson.deviceInfo(fields.device);
    if (!device) {
      logger.warn(`apply_settings: unknown device ${fields.device}`);
      return { sent: false, transport: 'unknown' };
    }
    const data = settingsCommand(device.model, fields, device.productState);
    if (!data) {
      return { sent: false, transport: device.status.transport };
    }
    return dyson.sendToDevice(fields.device, data);
  },

  async set_sleep_timer(dyson, fields) {
    if (!dyson.deviceInfo(fields.device)) {
      logger.warn(`set_sleep_timer: unknown device ${fields.device}`);
      return { sent: false, transport: 'unknown' };
    }
    return dyson.sendToDevice(fields.device, sleepTimerCommand(fields.minutes));
  },
};
