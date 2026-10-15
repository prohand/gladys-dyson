// -----------------------------------------------------------------------------
// The Dyson side of the integration, in one place: the account (sign-in with
// the e-mailed code, device list), one MQTT link per device created in Gladys, and the states and transport
// badges published back to Gladys.
//
// index.js only wires the SDK handlers to the methods below.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from '../config.js';
import { createDysonCloud, DysonCloudError } from './cloud.js';
import { DeviceLink, defaultMqttConnect } from './link.js';
import { describeModel } from './models.js';
import { createTriggerTracker } from '../capabilities/triggers.js';
import {
  FEATURES,
  buildDevice,
  commandFor,
  deviceIds,
  featureKeyOf,
  hasFormaldehydeReading,
  statesFromEnvironment,
  statesFromProductState,
} from '../devices/fan.js';

const logger = createLogger({ name: 'dyson' });

// A code e-mailed by Dyson is valid for a short while only.
const CHALLENGE_TTL_MS = 30 * 60 * 1000;
// How long a widget button waits for the device's answer: the core refetches
// the widget when the action returns, and it should show the new state.
export const ANSWER_TIMEOUT_MS = 4000;

const STATUS_MESSAGES = {
  noAccount: {
    en: 'Enter the e-mail and password of your Dyson account, save, then use "Receive a code".',
    fr: "Renseignez l'e-mail et le mot de passe de votre compte Dyson, enregistrez, puis utilisez « Recevoir un code ».",
    de: 'Gib die E-Mail-Adresse und das Passwort deines Dyson-Kontos ein, speichere und verwende dann „Code erhalten“.',
    es: 'Introduzca el correo electrónico y la contraseña de su cuenta Dyson, guarde y luego use «Recibir un código».',
  },
  noToken: {
    en: 'Not signed in yet: use "Receive a code", then "Validate the code".',
    fr: 'Pas encore connecté : utilisez « Recevoir un code », puis « Valider le code ».',
    de: 'Noch nicht angemeldet: Verwende „Code erhalten“ und dann „Code bestätigen“.',
    es: 'Aún no ha iniciado sesión: use «Recibir un código» y luego «Validar el código».',
  },
  tokenRejected: {
    en: 'The Dyson session has expired: sign in again with a new code.',
    fr: 'La session Dyson a expiré : reconnectez-vous avec un nouveau code.',
    de: 'Die Dyson-Sitzung ist abgelaufen: Melde dich mit einem neuen Code erneut an.',
    es: 'La sesión de Dyson ha caducado: vuelva a iniciar sesión con un código nuevo.',
  },
};

/**
 * @param {object} options
 * @param {object} options.gladys SDK instance
 * @param {ReturnType<import('./store.js').createAccountStore>} options.store
 * @param {Function} [options.cloudFactory] injectable createDysonCloud (tests)
 * @param {Function} [options.mqttConnect] injectable mqtt.connect (tests)
 * @param {object} [options.timers] injectable timers (tests)
 * @param {() => number} [options.now]
 * @param {() => void} [options.onDeviceChange] something a widget shows changed
 */
export function createDysonManager({
  gladys,
  store,
  cloudFactory = createDysonCloud,
  mqttConnect = defaultMqttConnect,
  timers = globalThis,
  now = Date.now,
  onDeviceChange = () => {},
}) {
  let config = normalizeConfig();
  let cloud = cloudFactory({ country: config.country });
  // { email, token, tokenRejected, challengeId, challengeAt, devices }
  let account = { devices: [] };
  let loaded = false;

  /** serial -> { link, model, dysonDevice } */
  const links = new Map();
  /** serial -> last product state (flat), to speak the device's dialect */
  const productStates = new Map();
  // Scene triggers: air quality, filters, connection (one event per change).
  const triggers = createTriggerTracker(gladys, { onLevelChange: () => onDeviceChange() });

  // --- account -------------------------------------------------------------

  async function load() {
    if (!loaded) {
      const saved = await store.load();
      account = { devices: [], ...saved };
      loaded = true;
    }
  }

  async function save() {
    await store.save(account);
  }

  function supportedDevices() {
    return (account.devices ?? [])
      .map((dysonDevice) => ({ dysonDevice, model: modelOf(dysonDevice) }))
      .filter(({ model }) => model !== null);
  }

  // The product type misses some formaldehyde sensors (models.js): a device
  // whose data carried a reading keeps the sensor, saved with the account.
  function modelOf(dysonDevice) {
    const model = describeModel(dysonDevice.productType);
    if (model?.protocol === 'pure' && (account.formaldehyde ?? []).includes(dysonDevice.serial)) {
      model.formaldehyde = true;
    }
    return model;
  }

  /** First formaldehyde reading of a device whose product type did not tell. */
  async function learnFormaldehyde(serial, model) {
    model.formaldehyde = true;
    account.formaldehyde = [...new Set([...(account.formaldehyde ?? []), serial])];
    logger.info(`${serial} has a formaldehyde sensor: use "Update" in the Discover tab`);
    await save();
    // The Discover tab shows the new feature, with an "Update" button.
    await publishDiscovered();
  }

  /** Refresh the device list from the account; keep the cached one when the cloud is down. */
  async function refreshDevices() {
    if (!account.token) {
      return;
    }
    try {
      account.devices = await cloud.listDevices(account.token);
      account.tokenRejected = false;
      await save();
      const ignored = account.devices.filter((d) => describeModel(d.productType) === null);
      for (const device of ignored) {
        logger.info(`Product ${device.productType} (${device.serial}) is not a supported fan`);
      }
    } catch (err) {
      if (err instanceof DysonCloudError && err.code === 'unauthorized') {
        logger.warn('The Dyson account token was refused');
        account.token = null;
        account.tokenRejected = true;
        await save();
        return;
      }
      logger.warn(`Device list not refreshed, keeping the cached one: ${err.message}`);
    }
  }

  // The core keeps the discovered list in memory only, from the last publish:
  // a new version must publish its list at every connection, or the Discover
  // tab keeps showing the previous version's features with no "Update" button.
  async function publishDiscovered() {
    if (!account.token && (account.devices ?? []).length === 0) {
      return;
    }
    try {
      await gladys.publishDiscoveredDevices(discoveredDevices());
    } catch (err) {
      logger.warn(`Discovered devices not published: ${err.message}`);
    }
  }

  function discoveredDevices() {
    return supportedDevices().map(({ dysonDevice, model }) =>
      buildDevice(gladys, dysonDevice, model, config.language),
    );
  }

  async function reportStatus() {
    let connected = true;
    let message;
    if (!account.token) {
      connected = false;
      if (account.tokenRejected) {
        message = STATUS_MESSAGES.tokenRejected;
      } else if (!config.email || !config.password) {
        message = STATUS_MESSAGES.noAccount;
      } else {
        message = STATUS_MESSAGES.noToken;
      }
    }
    await gladys.setConnectionStatus(connected, message);
  }

  // --- network addresses ---------------------------------------------------

  // Typed by the user. Dyson products announce themselves over mDNS
  // (`_dyson_mqtt._tcp`), but the store refuses that service name in the
  // manifest `network_discovery` (no "_" allowed inside it), so the mediated
  // scan cannot be declared: without an address, the cloud is the path.
  // A bare address (no "serial=") is what people type with one device: it is
  // used when the account has a single fan, where it cannot be the wrong one.
  function hostOf(serial, from = config) {
    const typed = from.hosts.get(serial);
    if (typed) {
      return typed;
    }
    if (from.bareHosts.length === 1 && supportedDevices().length === 1) {
      return from.bareHosts[0];
    }
    return null;
  }

  // --- links ---------------------------------------------------------------

  function isCreated(serial) {
    const externalId = deviceIds(gladys, serial).device;
    return (gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  // Only changes are sent: the SDK remembers the last value Gladys accepted
  // per feature (publishChangedStates). A new link starts from scratch, so
  // its first reading is sent whole even when the values did not move.
  function forgetPublished(serial) {
    gladys.forgetPublishedStates(deviceIds(gladys, serial).device);
  }

  async function publish(serial, states) {
    const ids = deviceIds(gladys, serial);
    const created = (gladys.devices ?? []).find((device) => device.external_id === ids.device);
    const known = new Set((created?.features ?? []).map((feature) => feature.external_id));
    const batch = states
      // A text feature (the oscillation angle) takes `text`, the others `state`.
      .map(({ key, value, text }) => ({
        device_feature_external_id: ids.feature(key),
        ...(text === undefined ? { state: value } : { text }),
      }))
      // A feature the user's device does not have (created before a model
      // update) would be refused: send only what Gladys knows.
      .filter((state) => known.has(state.device_feature_external_id));
    if (batch.length === 0) {
      return;
    }
    try {
      // Skips the values Gladys already holds; a refused batch is forgotten
      // by the SDK, so the next reading publishes it again rather than never.
      await gladys.publishChangedStates(batch);
    } catch (err) {
      logger.warn(`States of ${serial} not published: ${err.message}`);
    }
  }

  async function publishTransport(serial, status) {
    try {
      await gladys.publishTransports([transportEntry(serial, status)]);
    } catch (err) {
      logger.debug(`Transport of ${serial} not published: ${err.message}`);
    }
  }

  function transportEntry(serial, status) {
    const entry = { external_id: deviceIds(gladys, serial).device, transport: status.transport };
    if (status.degraded) {
      entry.degraded = true;
      entry.message = status.message;
    }
    return entry;
  }

  function createLink(dysonDevice, model) {
    const link = new DeviceLink({
      device: dysonDevice,
      hostOf: () => hostOf(dysonDevice.serial),
      cloud: {
        available: () => Boolean(account.token),
        credentials: (serial) => cloud.iotCredentials(account.token, serial),
      },
      preferLocal: config.preferLocal,
      refreshIntervalSeconds: config.refresh_interval,
      mqttConnect,
      timers,
    });
    const { serial } = dysonDevice;
    const device = { serial, externalId: deviceIds(gladys, serial).device };

    link.on('state', async (values) => {
      const state = { ...productStates.get(serial), ...values };
      productStates.set(serial, state);
      onDeviceChange();
      await publish(serial, statesFromProductState(model, values, state));
      await triggers.onProductState(device, values);
    });
    link.on('environment', async (values) => {
      if (model.protocol === 'pure' && !model.formaldehyde && hasFormaldehydeReading(values)) {
        await learnFormaldehyde(serial, model);
      }
      await publish(serial, statesFromEnvironment(model, values));
      await triggers.onEnvironment(device, model, values);
    });
    link.on('transport', async (status) => {
      onDeviceChange();
      await publishTransport(serial, status);
      await triggers.onTransport(device, status);
    });
    return link;
  }

  /**
   * One link per device both in the account and created in Gladys: start the
   * missing ones, stop the ones whose device is gone.
   */
  async function syncLinks() {
    const wanted = new Map(
      supportedDevices()
        .filter(({ dysonDevice }) => isCreated(dysonDevice.serial))
        .map((entry) => [entry.dysonDevice.serial, entry]),
    );

    for (const [serial, entry] of links) {
      const next = wanted.get(serial);
      // A device that left the account, was deleted in Gladys, or whose
      // local password changed (device reset) gets a fresh link.
      if (!next || next.dysonDevice.localPassword !== entry.dysonDevice.localPassword) {
        entry.link.stop();
        links.delete(serial);
        productStates.delete(serial);
        triggers.forget(serial);
      }
    }

    const starting = [];
    for (const [serial, { dysonDevice, model }] of wanted) {
      if (!links.has(serial)) {
        forgetPublished(serial);
        const link = createLink(dysonDevice, model);
        links.set(serial, { link, model, dysonDevice });
        starting.push(link.start());
      }
    }
    await Promise.all(starting);
  }

  function stopLinks() {
    for (const { link } of links.values()) {
      link.stop();
    }
    for (const serial of links.keys()) {
      triggers.forget(serial);
    }
    links.clear();
    productStates.clear();
  }

  /** The next product state the link reports, or nothing after a while. */
  function waitForState(link) {
    let cancel;
    const promise = new Promise((resolve) => {
      const finish = () => {
        timers.clearTimeout(timer);
        link.off('state', finish);
        resolve();
      };
      const timer = timers.setTimeout(finish, ANSWER_TIMEOUT_MS);
      // Registered after the manager's own listener: the known state is
      // already updated when this one runs.
      link.on('state', finish);
      cancel = finish;
    });
    return { promise, cancel };
  }

  function findLinkByDevice(device) {
    return findLink(device.external_id);
  }

  function findLink(externalId) {
    for (const [serial, entry] of links) {
      if (deviceIds(gladys, serial).device === externalId) {
        return { serial, ...entry };
      }
    }
    return null;
  }

  // --- public API ------------------------------------------------------------

  return {
    /** (Re)initialize after every connection to Gladys. */
    async start(rawConfig) {
      await load();
      await this.updateConfig(rawConfig, { initial: true });
      await refreshDevices();
      await publishDiscovered();
      // Gladys may have restarted while the socket was down: send everything
      // once more (the SDK only forgets by itself on device events).
      gladys.forgetPublishedStates();
      await syncLinks();
      await gladys.publishTransports(this.transportEntries()).catch(() => {});
      await reportStatus();
    },

    async updateConfig(rawConfig, { initial = false } = {}) {
      await load();
      const previous = config;
      config = normalizeConfig(rawConfig);

      if (config.country !== previous.country) {
        cloud = cloudFactory({ country: config.country });
      }
      // The token belongs to one account: a new e-mail signs out.
      if (account.email && config.email && account.email !== config.email) {
        logger.info('Dyson account changed: signing out');
        stopLinks();
        account = { devices: [] };
        await save();
      }
      if (initial) {
        return;
      }

      for (const { link, dysonDevice } of links.values()) {
        link.setRefreshInterval(config.refresh_interval);
        const routeChanged =
          link.preferLocal !== config.preferLocal ||
          hostOf(dysonDevice.serial, previous) !== hostOf(dysonDevice.serial);
        link.setPreferLocal(config.preferLocal);
        if (routeChanged) {
          await link.reconnect();
        }
      }
      await reportStatus();
    },

    /** Action "Receive a code": Dyson e-mails a one-time code. */
    async requestCode() {
      await load();
      if (!config.email) {
        return STATUS_MESSAGES.noAccount;
      }
      const challengeId = await cloud.requestCode(config.email, config.culture);
      account.email = config.email;
      account.challengeId = challengeId;
      account.challengeAt = now();
      await save();
      return {
        en: `A code was sent to ${config.email}. Type it in "Validate the code" within a few minutes.`,
        fr: `Un code a été envoyé à ${config.email}. Saisissez-le dans « Valider le code » dans les minutes qui suivent.`,
        de: `Ein Code wurde an ${config.email} gesendet. Gib ihn innerhalb weniger Minuten unter „Code bestätigen“ ein.`,
        es: `Se ha enviado un código a ${config.email}. Introdúzcalo en «Validar el código» en los próximos minutos.`,
      };
    },

    /** Action "Validate the code": code + password -> account token. */
    async verifyCode(code) {
      await load();
      const otpCode = String(code ?? '').trim();
      if (
        !account.challengeId ||
        account.email !== config.email ||
        now() - (account.challengeAt ?? 0) > CHALLENGE_TTL_MS
      ) {
        return {
          en: 'No code pending for this e-mail: use "Receive a code" first.',
          fr: "Aucun code en attente pour cet e-mail : utilisez d'abord « Recevoir un code ».",
          de: 'Für diese E-Mail-Adresse steht kein Code aus: Verwende zuerst „Code erhalten“.',
          es: 'No hay ningún código pendiente para este correo electrónico: use primero «Recibir un código».',
        };
      }
      if (!config.password) {
        return STATUS_MESSAGES.noAccount;
      }

      let token;
      try {
        token = await cloud.verifyCode({
          email: config.email,
          password: config.password,
          challengeId: account.challengeId,
          otpCode,
        });
      } catch (err) {
        if (err instanceof DysonCloudError && err.code !== 'unreachable') {
          return {
            en: 'Dyson refused the code or the password. Check them, or ask for a new code.',
            fr: 'Dyson a refusé le code ou le mot de passe. Vérifiez-les, ou demandez un nouveau code.',
            de: 'Dyson hat den Code oder das Passwort abgelehnt. Prüfe beides oder fordere einen neuen Code an.',
            es: 'Dyson ha rechazado el código o la contraseña. Compruébelos o solicite un código nuevo.',
          };
        }
        throw err;
      }

      account.token = token;
      account.tokenRejected = false;
      account.challengeId = null;
      account.challengeAt = null;
      await save();
      await refreshDevices();
      await gladys.publishDiscoveredDevices(this.discoveredDevices());
      await syncLinks();
      await reportStatus();

      const count = supportedDevices().length;
      return {
        en: `Signed in: ${count} Dyson device(s) found. Add them from the Discover tab.`,
        fr: `Connecté : ${count} appareil(s) Dyson trouvé(s). Ajoutez-les depuis l'onglet Découverte.`,
        de: `Angemeldet: ${count} Dyson-Gerät(e) gefunden. Füge sie im Tab „Entdecken“ hinzu.`,
        es: `Sesión iniciada: ${count} dispositivo(s) Dyson encontrado(s). Añádalos desde la pestaña «Descubrir».`,
      };
    },

    /** Action "Sign out": forget the token and the device list. */
    async forgetAccount() {
      await load();
      stopLinks();
      account = { devices: [] };
      await store.clear();
      await reportStatus();
      return {
        en: 'Signed out: the Dyson token and device list were deleted.',
        fr: 'Déconnecté : le jeton et la liste des appareils Dyson ont été supprimés.',
        de: 'Abgemeldet: Das Dyson-Token und die Geräteliste wurden gelöscht.',
        es: 'Sesión cerrada: se han eliminado el token de Dyson y la lista de dispositivos.',
      };
    },

    /** Action "Test the connection": one line per device. */
    async testConnection() {
      await load();
      if (!account.token) {
        return account.tokenRejected ? STATUS_MESSAGES.tokenRejected : STATUS_MESSAGES.noToken;
      }
      await refreshDevices();
      await reportStatus();
      if (!account.token) {
        return STATUS_MESSAGES.tokenRejected;
      }
      await syncLinks();

      const devices = supportedDevices();
      if (devices.length === 0) {
        return {
          en: 'Signed in, but the account has no supported Dyson fan or purifier.',
          fr: 'Connecté, mais le compte ne contient aucun ventilateur ou purificateur Dyson pris en charge.',
          de: 'Angemeldet, aber das Konto enthält keinen unterstützten Dyson-Ventilator oder -Luftreiniger.',
          es: 'Sesión iniciada, pero la cuenta no contiene ningún ventilador o purificador Dyson compatible.',
        };
      }
      const lines = { en: [], fr: [], de: [], es: [] };
      for (const { dysonDevice, model } of devices) {
        const name = dysonDevice.name ?? model.name;
        const entry = links.get(dysonDevice.serial);
        if (!entry) {
          lines.en.push(`${name}: not added in Gladys`);
          lines.fr.push(`${name} : pas ajouté dans Gladys`);
          lines.de.push(`${name}: nicht in Gladys hinzugefügt`);
          lines.es.push(`${name}: no añadido en Gladys`);
          continue;
        }
        const { transport, degraded } = entry.link.status;
        const label = {
          local: { en: 'local', fr: 'local', de: 'lokal', es: 'local' },
          cloud: { en: 'Dyson cloud', fr: 'cloud Dyson', de: 'Dyson-Cloud', es: 'nube de Dyson' },
          unreachable: {
            en: 'unreachable',
            fr: 'injoignable',
            de: 'nicht erreichbar',
            es: 'inaccesible',
          },
        }[transport];
        // The reason says what to fix (the address to type, a refused session).
        const { message } = entry.link.status;
        lines.en.push(`${name}: ${label.en}${degraded ? ` (fallback). ${message.en}` : ''}`);
        lines.fr.push(`${name} : ${label.fr}${degraded ? ` (secours). ${message.fr}` : ''}`);
        lines.de.push(`${name}: ${label.de}${degraded ? ` (Ersatzweg). ${message.de}` : ''}`);
        lines.es.push(`${name}: ${label.es}${degraded ? ` (respaldo). ${message.es}` : ''}`);
      }
      return Object.fromEntries(
        Object.entries(lines).map(([language, entries]) => [language, entries.join(' · ')]),
      );
    },

    /** Gladys asks for the device list (Discover tab). */
    async scan() {
      await load();
      await refreshDevices();
      await gladys.publishDiscoveredDevices(this.discoveredDevices());
      await reportStatus();
    },

    discoveredDevices,

    async setValue(device, feature, value) {
      const entry = findLinkByDevice(device);
      if (!entry) {
        throw new Error(`Unknown Dyson device ${device.external_id}`);
      }
      const key = featureKeyOf(gladys, entry.serial, feature.external_id);
      const data = commandFor(entry.model, key, value, productStates.get(entry.serial));
      logger.info(`${entry.serial} <- ${JSON.stringify(data)}`);
      await entry.link.send(data);
    },

    /** Devices created or deleted in Gladys. */
    syncLinks,

    /**
     * What the scene actions and the widget need to know about a device
     * created in Gladys, by its external id. Null for an unknown one.
     */
    deviceInfo(externalId) {
      const entry = findLink(externalId);
      if (!entry) {
        return null;
      }
      const ids = deviceIds(gladys, entry.serial);
      const created = (gladys.devices ?? []).find((device) => device.external_id === ids.device);
      const existing = new Set((created?.features ?? []).map((feature) => feature.external_id));
      // Only the features the Gladys device has: a tile bound to a missing one
      // would stay empty.
      const features = Object.fromEntries(
        Object.values(FEATURES)
          .filter((key) => existing.has(ids.feature(key)))
          .map((key) => [key, ids.feature(key)]),
      );
      return {
        serial: entry.serial,
        model: entry.model,
        dysonDevice: entry.dysonDevice,
        status: entry.link.status,
        productState: productStates.get(entry.serial) ?? {},
        level: triggers.levelOf(entry.serial),
        ...triggers.airOf(entry.serial),
        features,
      };
    },

    /**
     * Send a STATE-SET for a scene action. Never throws on an unreachable
     * device: the outputs say it.
     * @returns {Promise<{sent: boolean, transport: string}>}
     */
    async sendToDevice(externalId, data) {
      const entry = findLink(externalId);
      if (!entry) {
        return { sent: false, transport: 'unknown' };
      }
      try {
        logger.info(`${entry.serial} <- ${JSON.stringify(data)}`);
        await entry.link.send(data);
        return { sent: true, transport: entry.link.status.transport };
      } catch (err) {
        logger.warn(`${entry.serial}: order not sent: ${err.message}`);
        return { sent: false, transport: entry.link.status.transport };
      }
    },

    /**
     * A widget button: change one feature, then wait (a few seconds at most)
     * for the device to answer, so the content refetched after the action
     * shows the new state. The value comes from the state known at the tap,
     * never from the content shown, which may be older.
     * @param {string} externalId device external id
     * @param {string} key a FEATURES value
     * @param {(state: object) => number|null} valueOf null: nothing to change
     * @returns {Promise<boolean>} false when the device is unreachable
     */
    async command(externalId, key, valueOf) {
      const entry = findLink(externalId);
      if (!entry?.link.connected) {
        return false;
      }
      const state = productStates.get(entry.serial) ?? {};
      const value = valueOf(state);
      if (value === null || value === undefined) {
        return true;
      }
      const data = commandFor(entry.model, key, value, state);
      const answer = waitForState(entry.link);
      logger.info(`${entry.serial} <- ${JSON.stringify(data)}`);
      try {
        await entry.link.send(data);
      } catch (err) {
        answer.cancel();
        logger.warn(`${entry.serial}: order not sent: ${err.message}`);
        return false;
      }
      await answer.promise;
      return true;
    },

    /** Ask the device for its state and sensor data now. */
    async refreshDevice(externalId) {
      const entry = findLink(externalId);
      if (!entry?.link.connected) {
        return false;
      }
      await entry.link.requestState();
      await entry.link.requestEnvironment();
      return true;
    },

    transportEntries() {
      return [...links.entries()].map(([serial, { link }]) => transportEntry(serial, link.status));
    },

    stop() {
      stopLinks();
    },
  };
}
