// -----------------------------------------------------------------------------
// Dyson MQTT messages: decoding what the device says, building what we send.
//
// Every product talks JSON over MQTT, on two topics:
//   <ProductType>/<serial>/command         -> what we publish
//   <ProductType>/<serial>/status/current  -> what the device publishes
// The same topics are used on the local broker (the device itself, port 1883)
// and on the Dyson cloud broker (AWS IoT).
//
// Values are strings, zero-padded to four digits ("0005"), and the sensors say
// "OFF" / "INIT" / "NONE" while they warm up or are switched off: those are
// "no reading", never zero.
// -----------------------------------------------------------------------------

export const MESSAGES = {
  REQUEST_STATE: 'REQUEST-CURRENT-STATE',
  REQUEST_ENVIRONMENT: 'REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA',
  SET_STATE: 'STATE-SET',
  CURRENT_STATE: 'CURRENT-STATE',
  STATE_CHANGE: 'STATE-CHANGE',
  ENVIRONMENT: 'ENVIRONMENTAL-CURRENT-SENSOR-DATA',
};

export function commandTopic(productType, serial) {
  return `${productType}/${serial}/command`;
}

export function statusTopic(productType, serial) {
  return `${productType}/${serial}/status/current`;
}

/**
 * Build a command payload.
 * @param {string} msg one of MESSAGES
 * @param {object} [data] the `STATE-SET` values
 * @param {Date} [now]
 * @returns {string} JSON payload
 */
export function buildCommand(msg, data, now = new Date()) {
  const payload = { msg, time: now.toISOString() };
  if (data) {
    // "LAPP": the change comes from the (local) app. The device records the
    // reason and some models ignore a STATE-SET without one.
    payload['mode-reason'] = 'LAPP';
    payload.data = data;
  }
  return JSON.stringify(payload);
}

/**
 * Decode a message received on the status topic.
 * @param {Buffer|string} raw
 * @returns {null | {kind: 'state', values: object} | {kind: 'environment', values: object}}
 *   null for a message we do not use (faults, hello, garbage)
 */
export function decodeMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') {
    return null;
  }
  if (message.msg === MESSAGES.CURRENT_STATE || message.msg === MESSAGES.STATE_CHANGE) {
    return { kind: 'state', values: flattenState(message['product-state']) };
  }
  if (message.msg === MESSAGES.ENVIRONMENT) {
    return { kind: 'environment', values: flattenState(message.data) };
  }
  return null;
}

// A STATE-CHANGE carries `[previous, current]` pairs, a CURRENT-STATE plain
// values: keep the current value either way.
function flattenState(state) {
  const values = {};
  if (!state || typeof state !== 'object') {
    return values;
  }
  for (const [key, value] of Object.entries(state)) {
    const current = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof current === 'string' || typeof current === 'number') {
      values[key] = String(current);
    }
  }
  return values;
}

/**
 * Read a numeric Dyson value.
 * @param {string|undefined} value e.g. "0045"
 * @param {number} [divisor]
 * @returns {number|null} null when the device has no reading ("OFF", "INIT"...)
 */
export function readNumber(value, divisor = 1) {
  if (value === undefined || value === null || !/^-?\d+(\.\d+)?$/.test(String(value).trim())) {
    return null;
  }
  return Number(value) / divisor;
}

/** "2950" (tenths of kelvin) -> 21.9 (°C, one decimal). */
export function kelvinTenthsToCelsius(value) {
  const kelvin = readNumber(value, 10);
  return kelvin === null ? null : Math.round((kelvin - 273.15) * 10) / 10;
}

/** 21 (°C) -> "2942" (tenths of kelvin, four digits). */
export function celsiusToKelvinTenths(celsius) {
  // 2731.5 rather than (c + 273.15) * 10: exact in floating point, so 21 °C
  // rounds to 2942 and not to 2941.4999...
  return pad4(Math.round(Number(celsius) * 10 + 2731.5));
}

/** 5 -> "0005". */
export function pad4(number) {
  return String(Math.trunc(number)).padStart(4, '0');
}
