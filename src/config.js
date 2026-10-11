// -----------------------------------------------------------------------------
// Configuration: defaults (mirroring the manifest `config_schema`) and
// normalization of the raw values Gladys sends.
//
// `normalizeConfig` never throws: a half-filled form is the normal state of a
// fresh install, and the integration must keep running to say what is missing.
// -----------------------------------------------------------------------------

// Every key here mirrors a `config_schema` field (test/manifest.test.js keeps
// the defaults in sync with the manifest). `password` is a `secret` field: no
// default in the manifest, an empty string here.
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  country: 'FR',
  device_hosts: '',
  refresh_interval: 60,
};

export const REFRESH_INTERVAL_MIN = 15;
export const REFRESH_INTERVAL_MAX = 3600;

// French-speaking countries get the one-time code e-mail in French, the
// others in English: the Dyson API only uses the culture for that e-mail.
const FRENCH_COUNTRIES = new Set(['FR', 'BE', 'CH', 'LU', 'MC']);

/**
 * Normalize the configuration received from Gladys.
 * @param {object} [raw] values from `getConfig()` / `onConfigUpdated`
 * @returns {object} a complete, typed configuration
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const country = String(source.country ?? DEFAULT_CONFIG.country)
    .trim()
    .toUpperCase();
  const validCountry = /^[A-Z]{2}$/.test(country) ? country : DEFAULT_CONFIG.country;
  const deviceHosts = String(source.device_hosts ?? '');

  return {
    email: String(source.email ?? '')
      .trim()
      .toLowerCase(),
    password: String(source.password ?? ''),
    country: validCountry,
    culture: `${FRENCH_COUNTRIES.has(validCountry) ? 'fr' : 'en'}-${validCountry}`,
    device_hosts: deviceHosts,
    hosts: parseDeviceHosts(deviceHosts),
    bareHosts: parseBareHosts(deviceHosts),
    refresh_interval: clampInteger(
      source.refresh_interval,
      REFRESH_INTERVAL_MIN,
      REFRESH_INTERVAL_MAX,
      DEFAULT_CONFIG.refresh_interval,
    ),
    // Reserved key, rendered by Gladys because the manifest declares both
    // transports. A wish, not an order: see src/dyson/link.js.
    preferLocal: source.GLADYS_PREFER_LOCAL !== false,
  };
}

/**
 * Parse the "serial=address" list typed by the user: the local address of each
 * device (see hostOf in src/dyson/manager.js for why it is typed).
 * Entries are separated by commas, semicolons, spaces or new lines; an entry
 * that does not look like `SERIAL=host` is ignored rather than rejected.
 * @param {string} text e.g. "NK6-EU-MHA0000A=192.168.1.20, XX1-EU-ABC1234D=dyson.lan"
 * @returns {Map<string, string>} serial (upper case) -> host
 */
export function parseDeviceHosts(text) {
  const hosts = new Map();
  for (const entry of String(text ?? '').split(/[\s,;]+/)) {
    const match = /^([A-Za-z0-9-]+)=([A-Za-z0-9.-]+)$/.exec(entry);
    if (match) {
      hosts.set(match[1].toUpperCase(), match[2]);
    }
  }
  return hosts;
}

/**
 * The addresses typed WITHOUT a serial ("192.168.1.20"): the natural thing to
 * type with a single device. The manager uses one when the account has a
 * single device, since then there is no doubt about which one it is.
 * @param {string} text
 * @returns {string[]} hosts
 */
export function parseBareHosts(text) {
  return String(text ?? '')
    .split(/[\s,;]+/)
    .filter((entry) => /^[A-Za-z0-9.-]+$/.test(entry) && /[.]/.test(entry));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}
