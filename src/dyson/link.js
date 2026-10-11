// -----------------------------------------------------------------------------
// The MQTT link to ONE Dyson device, over the local network or the Dyson cloud.
//
//   local: the device runs its own MQTT broker on port 1883. User name = serial,
//          password = the local password given by the Dyson account. Fast,
//          works without Internet, but needs the device address.
//   cloud: the Dyson broker on AWS IoT, over WebSocket, with per-device
//          credentials asked to the Dyson account. Works from anywhere, needs
//          Internet and the account token.
//
// The user's "Prefer the local connection" toggle (GLADYS_PREFER_LOCAL) picks
// which one is tried first; the other one is the fallback. The link reports
// what it ACTUALLY uses (event `transport`), flagged `degraded` when it had to
// fall back for a reason the user can fix (address unknown, local session
// refused, cloud unreachable).
//
// Events:
//   'state'       (values)  product state (fpwr, fnsp...), current values only
//   'environment' (values)  sensor data (tact, pm25...)
//   'transport'   (status)  { transport, degraded, message }
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { MESSAGES, buildCommand, commandTopic, decodeMessage, statusTopic } from './protocol.js';

const LOCAL_PORT = 1883;
const LOCAL_CONNECT_TIMEOUT_MS = 10000;
const CLOUD_CONNECT_TIMEOUT_MS = 15000;
// Retry delays after a failed connection, the last one repeated: quick at
// first (a device rebooting, a Wi-Fi hiccup), then gentle.
export const RETRY_DELAYS_MS = [5000, 15000, 60000, 300000];
// On the fallback after the preferred transport FAILED (device rebooting at
// start-up, Internet down for a while), try the preferred one again at this
// pace: without it the link would stay on the fallback until the next restart.
export const UPGRADE_DELAY_MS = 240000;

const REASONS = {
  // The serial is in the message: it is what the setting needs next to the IP.
  noHost: (serial) => ({
    degrade: true,
    message: {
      en: `Local address unknown: add ${serial}=<IP> to the Device addresses setting. Using the Dyson cloud.`,
      fr: `Adresse locale inconnue : ajoutez ${serial}=<IP> au réglage Adresses des appareils. Passage par le cloud Dyson.`,
    },
  }),
  localFailed: {
    degrade: true,
    failed: true,
    message: {
      en: 'Local connection refused or unreachable: using the Dyson cloud.',
      fr: 'Connexion locale refusée ou injoignable : passage par le cloud Dyson.',
    },
  },
  // A product without local credentials is a cloud-only product: the cloud is
  // its nominal path, nothing to fix.
  noLocalAccess: { degrade: false },
  noCloud: {
    degrade: true,
    message: {
      en: 'No Dyson account session: using the local connection.',
      fr: 'Pas de session de compte Dyson : passage par la connexion locale.',
    },
  },
  cloudFailed: {
    degrade: true,
    failed: true,
    message: {
      en: 'Dyson cloud unreachable: using the local connection.',
      fr: 'Cloud Dyson injoignable : passage par la connexion locale.',
    },
  },
};

export function defaultMqttConnect(url, options) {
  return mqtt.connect(url, options);
}

export class DeviceLink extends EventEmitter {
  /**
   * @param {object} options
   * @param {{serial: string, productType: string, localPassword: string|null}} options.device
   * @param {() => string|null} options.hostOf current address of the device on the LAN
   * @param {{available: () => boolean, credentials: (serial: string) => Promise<object>}} options.cloud
   * @param {boolean} [options.preferLocal]
   * @param {number} [options.refreshIntervalSeconds] how often sensor data is asked
   * @param {Function} [options.mqttConnect] injectable `mqtt.connect` (tests)
   * @param {object} [options.timers] injectable timers (tests)
   */
  constructor({
    device,
    hostOf,
    cloud,
    preferLocal = true,
    refreshIntervalSeconds = 60,
    mqttConnect = defaultMqttConnect,
    timers = globalThis,
  }) {
    super();
    this.device = device;
    this.hostOf = hostOf;
    this.cloud = cloud;
    this.preferLocal = preferLocal;
    this.refreshIntervalSeconds = refreshIntervalSeconds;
    this.mqttConnect = mqttConnect;
    this.timers = timers;
    this.logger = createLogger({ name: `dyson:${device.serial}` });

    this.client = null;
    this.stopped = true;
    this.connecting = null;
    this.retryIndex = 0;
    this.retryTimer = null;
    this.upgradeTimer = null;
    this.refreshTimer = null;
    this.status = { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: false, message: null };
  }

  get connected() {
    return this.client !== null;
  }

  start() {
    this.stopped = false;
    return this.#connect();
  }

  stop() {
    this.stopped = true;
    this.#clearRetry();
    this.#closeClient();
  }

  /** Drop the current session and choose a transport again. */
  async reconnect() {
    this.#clearRetry();
    this.#closeClient();
    if (!this.stopped) {
      this.retryIndex = 0;
      await this.#connect();
    }
  }

  setPreferLocal(preferLocal) {
    this.preferLocal = preferLocal;
  }

  setRefreshInterval(seconds) {
    this.refreshIntervalSeconds = seconds;
    if (this.client) {
      this.#startRefresh();
    }
  }

  /**
   * Send a STATE-SET. The device answers with a STATE-CHANGE: that answer, not
   * this call, is what updates Gladys (`has_feedback`).
   */
  async send(data) {
    if (!this.client) {
      throw new Error(`Dyson ${this.device.serial} is unreachable`);
    }
    await this.#publish(buildCommand(MESSAGES.SET_STATE, data));
  }

  requestState() {
    return this.#request(MESSAGES.REQUEST_STATE);
  }

  requestEnvironment() {
    return this.#request(MESSAGES.REQUEST_ENVIRONMENT);
  }

  // --- connection ----------------------------------------------------------

  #connect() {
    // One attempt at a time: a config update and a retry timer can both ask.
    if (!this.connecting) {
      this.connecting = this.#tryTransports().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async #tryTransports() {
    if (this.stopped || this.client) {
      return;
    }
    const order = this.preferLocal
      ? [DEVICE_TRANSPORTS.LOCAL, DEVICE_TRANSPORTS.CLOUD]
      : [DEVICE_TRANSPORTS.CLOUD, DEVICE_TRANSPORTS.LOCAL];
    let preferredReason = null;

    for (const transport of order) {
      let reason = this.#unavailable(transport);
      if (!reason) {
        try {
          const client = await this.#open(transport);
          if (this.stopped) {
            client.end(true);
            return;
          }
          this.#adopt(client);
          this.retryIndex = 0;
          this.#setStatus(transport, transport === order[0] ? null : preferredReason);
          if (preferredReason?.failed) {
            this.#scheduleUpgrade(order[0]);
          }
          return;
        } catch (err) {
          this.logger.warn(`${transport} connection failed: ${err.message}`);
          reason =
            transport === DEVICE_TRANSPORTS.LOCAL ? REASONS.localFailed : REASONS.cloudFailed;
        }
      }
      if (transport === order[0]) {
        preferredReason = reason;
      }
    }

    this.#setStatus(DEVICE_TRANSPORTS.UNREACHABLE, null);
    this.#scheduleRetry();
  }

  #unavailable(transport) {
    if (transport === DEVICE_TRANSPORTS.LOCAL) {
      if (!this.device.localPassword) {
        return REASONS.noLocalAccess;
      }
      return this.hostOf() ? null : REASONS.noHost(this.device.serial);
    }
    return this.cloud.available() ? null : REASONS.noCloud;
  }

  async #open(transport) {
    const { url, options } =
      transport === DEVICE_TRANSPORTS.LOCAL ? this.#localTarget() : await this.#cloudTarget();
    const client = this.mqttConnect(url, {
      ...options,
      protocolVersion: 4,
      clean: true,
      keepalive: 30,
      // The link owns reconnection: a lost session may have to change
      // transport, which mqtt.js cannot decide.
      reconnectPeriod: 0,
    });
    // An 'error' without listener throws: a late one (after a failed attempt
    // has been dropped) must never crash the integration.
    client.on('error', () => {});

    await new Promise((resolve, reject) => {
      const guard = this.timers.setTimeout(
        () => fail(new Error('connection timeout')),
        options.connectTimeout + 5000,
      );
      const cleanup = () => {
        this.timers.clearTimeout(guard);
        client.off('connect', succeed);
        client.off('error', fail);
        client.off('close', closed);
      };
      const succeed = () => {
        cleanup();
        resolve();
      };
      const fail = (err) => {
        cleanup();
        client.end(true);
        reject(err);
      };
      const closed = () => fail(new Error('connection closed by the broker'));
      client.on('connect', succeed);
      client.on('error', fail);
      client.on('close', closed);
    });
    return client;
  }

  #localTarget() {
    return {
      url: `mqtt://${this.hostOf()}:${LOCAL_PORT}`,
      options: {
        username: this.device.serial,
        password: this.device.localPassword,
        clientId: `gladys-dyson-${randomBytes(4).toString('hex')}`,
        connectTimeout: LOCAL_CONNECT_TIMEOUT_MS,
      },
    };
  }

  async #cloudTarget() {
    const credentials = await this.cloud.credentials(this.device.serial);
    return {
      url: `wss://${credentials.endpoint}/mqtt`,
      options: {
        clientId: credentials.clientId,
        connectTimeout: CLOUD_CONNECT_TIMEOUT_MS,
        // AWS IoT custom authorizer: the credentials travel as headers of the
        // WebSocket upgrade request.
        wsOptions: {
          headers: {
            'X-Amz-CustomAuthorizer-Name': credentials.authorizerName,
            'X-Amz-CustomAuthorizer-Signature': credentials.tokenSignature,
            [credentials.tokenKey]: credentials.tokenValue,
          },
        },
      },
    };
  }

  #adopt(client) {
    this.client = client;
    client.on('message', (_topic, payload) => {
      const decoded = decodeMessage(payload);
      if (decoded) {
        this.emit(decoded.kind, decoded.values);
      }
    });
    client.on('error', (err) => this.logger.debug(`MQTT error: ${err.message}`));
    client.on('close', () => {
      if (this.client !== client) {
        return; // closed on purpose (stop, reconnect, upgrade)
      }
      this.logger.warn('connection lost');
      this.client = null;
      this.#stopRefresh();
      this.#clearUpgrade();
      if (!this.stopped) {
        this.#setStatus(DEVICE_TRANSPORTS.UNREACHABLE, null);
        this.#scheduleRetry();
      }
    });

    client.subscribe(statusTopic(this.device.productType, this.device.serial), { qos: 1 });
    this.requestState();
    this.requestEnvironment();
    this.#startRefresh();
  }

  #closeClient() {
    this.#stopRefresh();
    this.#clearUpgrade();
    const client = this.client;
    this.client = null;
    client?.end(true);
  }

  #scheduleRetry() {
    this.#clearRetry();
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.emit('retry');
      this.#connect();
    }, delay);
  }

  #scheduleUpgrade(transport) {
    this.#clearUpgrade();
    this.upgradeTimer = this.timers.setTimeout(() => {
      this.upgradeTimer = null;
      this.#tryUpgrade(transport);
    }, UPGRADE_DELAY_MS);
  }

  #clearUpgrade() {
    if (this.upgradeTimer) {
      this.timers.clearTimeout(this.upgradeTimer);
      this.upgradeTimer = null;
    }
  }

  /** Still on the fallback: open the preferred transport, swap if it works. */
  async #tryUpgrade(transport) {
    if (this.stopped || !this.client || this.connecting || this.#unavailable(transport)) {
      return;
    }
    const fallback = this.client;
    let client;
    try {
      client = await this.#open(transport);
    } catch (err) {
      this.logger.debug(`${transport} still unavailable: ${err.message}`);
      if (!this.stopped && this.client === fallback) {
        this.#scheduleUpgrade(transport);
      }
      return;
    }
    // The fallback session dropped, was replaced (new settings) or the link
    // stopped meanwhile: the session in place, or the retry path, wins.
    if (this.stopped || this.client !== fallback || this.connecting) {
      client.end(true);
      return;
    }
    this.logger.info(`back on the ${transport} connection`);
    this.#closeClient();
    this.#adopt(client);
    this.#setStatus(transport, null);
  }

  #clearRetry() {
    if (this.retryTimer) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // The sensors are only reported on request: ask at every interval.
  #startRefresh() {
    this.#stopRefresh();
    this.refreshTimer = this.timers.setInterval(
      () => this.requestEnvironment(),
      this.refreshIntervalSeconds * 1000,
    );
  }

  #stopRefresh() {
    if (this.refreshTimer) {
      this.timers.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  #setStatus(transport, reason) {
    const degraded = Boolean(reason?.degrade);
    const status = { transport, degraded, message: degraded ? reason.message : null };
    const changed =
      status.transport !== this.status.transport ||
      status.degraded !== this.status.degraded ||
      status.message !== this.status.message;
    this.status = status;
    if (changed) {
      this.emit('transport', status);
    }
  }

  // --- messages ------------------------------------------------------------

  async #request(msg) {
    if (!this.client) {
      return;
    }
    try {
      await this.#publish(buildCommand(msg));
    } catch (err) {
      this.logger.debug(`${msg} not sent: ${err.message}`);
    }
  }

  #publish(payload) {
    const topic = commandTopic(this.device.productType, this.device.serial);
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
  }
}
