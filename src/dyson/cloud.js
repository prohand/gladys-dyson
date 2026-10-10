// -----------------------------------------------------------------------------
// Dyson cloud account API (the one the MyDyson app uses).
//
// What the integration needs from it:
//   1. sign in: the account is protected by a one-time code sent by e-mail
//      (`requestCode`, then `verifyCode` with the code and the password),
//      which gives a long-lived bearer token;
//   2. the list of the products of the account, with the LOCAL MQTT password
//      of each one (`listDevices`): the cloud is what makes the local
//      connection possible, the device never tells it itself;
//   3. on demand, the credentials of the cloud MQTT broker for one product
//      (`iotCredentials`): the cloud transport.
//
// Never log the password, the token or the decrypted local passwords.
// -----------------------------------------------------------------------------

import { createDecipheriv } from 'node:crypto';

export const DYSON_API_HOSTS = {
  default: 'https://appapi.cp.dyson.com',
  // Mainland China accounts live on their own platform.
  CN: 'https://appapi.cp.dyson.cn',
};

// The API turns away requests that do not look like they come from the app.
const USER_AGENT = 'android client';

const PATHS = {
  provision: '/v1/provisioningservice/application/Android/version',
  userStatus: '/v3/userregistration/email/userstatus',
  requestCode: '/v3/userregistration/email/auth',
  verifyCode: '/v3/userregistration/email/verify',
  devices: '/v2/provisioningservice/manifest',
  iotCredentials: '/v2/authorize/iot-credentials',
};

export class DysonCloudError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {number} [details.status] HTTP status, when the API answered
   * @param {'unauthorized'|'rejected'|'unreachable'|'unexpected'} [details.code]
   */
  constructor(message, { status, code = 'unexpected' } = {}) {
    super(message);
    this.name = 'DysonCloudError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {string} options.country two-letter country code of the account
 * @param {Function} [options.fetchImpl] injectable `fetch` (tests)
 * @param {number} [options.timeoutMs]
 */
export function createDysonCloud({ country, fetchImpl = fetch, timeoutMs = 15000 }) {
  const host = DYSON_API_HOSTS[country] ?? DYSON_API_HOSTS.default;
  let provisioned = false;

  async function request(method, path, { query, body, token } = {}) {
    const url = new URL(path, host);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new DysonCloudError(`Dyson cloud unreachable (${err.message})`, {
        code: 'unreachable',
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status >= 500
            ? 'unreachable'
            : 'rejected';
      throw new DysonCloudError(`Dyson cloud answered HTTP ${response.status} on ${path}`, {
        status: response.status,
        code,
      });
    }
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      // The provisioning endpoint answers a bare version string.
      return text;
    }
  }

  // Since 2024 the account endpoints answer 401 to a client that has not
  // first asked for the current app version, like the app does at startup.
  async function provision() {
    if (provisioned) {
      return;
    }
    try {
      await request('GET', PATHS.provision);
      provisioned = true;
    } catch {
      // Best effort: the following call says whether it mattered.
    }
  }

  return {
    host,

    /**
     * Ask Dyson to e-mail a one-time code to the account.
     * @returns {Promise<string>} the challenge id to give back to verifyCode
     */
    async requestCode(email, culture) {
      await provision();
      const status = await request('POST', PATHS.userStatus, {
        query: { country },
        body: { email },
      });
      if (status?.accountStatus && status.accountStatus !== 'ACTIVE') {
        throw new DysonCloudError(`Dyson account status: ${status.accountStatus}`, {
          code: 'rejected',
        });
      }
      const answer = await request('POST', PATHS.requestCode, {
        query: { country, culture },
        body: { email },
      });
      if (!answer?.challengeId) {
        throw new DysonCloudError('Dyson cloud did not return a challenge id');
      }
      return answer.challengeId;
    },

    /**
     * Exchange the one-time code (and the password) for a bearer token.
     * @returns {Promise<string>} the token
     */
    async verifyCode({ email, password, challengeId, otpCode }) {
      await provision();
      const answer = await request('POST', PATHS.verifyCode, {
        body: { email, password, challengeId, otpCode },
      });
      if (!answer?.token) {
        throw new DysonCloudError('Dyson cloud did not return a token');
      }
      return answer.token;
    },

    /**
     * List the products of the account.
     * @returns {Promise<Array<{serial: string, name: string, productType: string,
     *   version: string|null, localPassword: string|null}>>}
     */
    async listDevices(token) {
      await provision();
      const answer = await request('GET', PATHS.devices, { token });
      if (!Array.isArray(answer)) {
        throw new DysonCloudError('Unexpected device list from the Dyson cloud');
      }
      return answer
        .filter((entry) => entry && typeof entry.Serial === 'string')
        .map((entry) => ({
          serial: entry.Serial.toUpperCase(),
          name: typeof entry.Name === 'string' && entry.Name.trim() ? entry.Name.trim() : null,
          productType: String(entry.ProductType ?? '').toUpperCase(),
          version: entry.Version ?? null,
          localPassword: decryptLocalCredentials(entry.LocalCredentials),
        }));
    },

    /**
     * Credentials of the Dyson cloud MQTT broker (AWS IoT) for one product.
     */
    async iotCredentials(token, serial) {
      await provision();
      const answer = await request('POST', PATHS.iotCredentials, {
        token,
        body: { Serial: serial },
      });
      const credentials = answer?.IoTCredentials;
      if (!answer?.Endpoint || !credentials?.ClientId) {
        throw new DysonCloudError('Dyson cloud did not return IoT credentials');
      }
      return {
        endpoint: answer.Endpoint,
        clientId: credentials.ClientId,
        authorizerName: credentials.CustomAuthorizerName,
        tokenKey: credentials.TokenKey,
        tokenValue: credentials.TokenValue,
        tokenSignature: credentials.TokenSignature,
      };
    },
  };
}

// The local MQTT password comes encrypted with a key and IV that are the same
// for every Dyson product (AES-256-CBC, key 0x01..0x20, zero IV): it is
// obfuscation, not protection, but it is how the app reads it too.
const LOCAL_CREDENTIALS_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const LOCAL_CREDENTIALS_IV = Buffer.alloc(16);

/**
 * Decrypt the `LocalCredentials` of a product.
 * @param {string} encrypted base64
 * @returns {string|null} the local MQTT password (`apPasswordHash`), null when
 *   the product has none (cloud-only products) or the value is unreadable
 */
export function decryptLocalCredentials(encrypted) {
  if (typeof encrypted !== 'string' || !encrypted) {
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-cbc', LOCAL_CREDENTIALS_KEY, LOCAL_CREDENTIALS_IV);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);
    // PKCS#7 padding in practice; strip every trailing control byte to stay
    // tolerant of the older null-padded values. The JSON ends with "}".
    let end = plain.length;
    while (end > 0 && plain[end - 1] < 0x20) {
      end -= 1;
    }
    const text = plain.subarray(0, end).toString('utf8');
    const password = JSON.parse(text).apPasswordHash;
    return typeof password === 'string' && password ? password : null;
  } catch {
    return null;
  }
}
