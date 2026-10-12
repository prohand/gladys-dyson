// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so tests can assert on them: external ids, states, transports, discovered
// devices, connection status, scene events and widget refresh nudges. Its
// publishChangedStates is a small copy of the SDK's dedupe, so the manager's
// "only changes are sent" is tested against the same rules.
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'dyson' } = {}) {
  /** feature external id -> last value accepted (publishChangedStates) */
  const remembered = new Map();
  let queue = Promise.resolve();
  const gladys = {
    devices: [],
    published: [],
    /** forgetPublishedStates calls: an external id, or null for everything */
    forgotten: [],
    publishStatesError: null,
    transports: [],
    discovered: [],
    connectionStatuses: [],
    sceneEvents: [],
    widgetRefreshes: [],
    sceneEventError: null,

    externalIds(type, platformId) {
      const device = `ext:${selector}:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async publishStates(states) {
      if (gladys.publishStatesError) {
        throw gladys.publishStatesError;
      }
      for (const s of states) {
        gladys.published.push({
          featureExternalId: s.device_feature_external_id,
          ...(s.text === undefined ? { state: s.state } : { text: s.text }),
        });
      }
    },

    // The SDK's dedupe (0.15): skip an entry equal to the last value Gladys
    // ACCEPTED for its feature, calls one after the other, a failed batch
    // forgotten and its error thrown. No heartbeat: the integration uses none.
    async publishChangedStates(states) {
      const run = queue.then(async () => {
        const previous = new Map();
        const changed = states.filter((state) => {
          const id = state.device_feature_external_id;
          const last = previous.has(id) ? previous.get(id) : remembered.get(id);
          previous.set(id, { state: state.state, text: state.text });
          return last === undefined || last.state !== state.state || last.text !== state.text;
        });
        if (changed.length === 0) {
          return { success: true, count: 0 };
        }
        for (const { device_feature_external_id: id, state, text } of changed) {
          remembered.set(id, { state, text });
        }
        try {
          await gladys.publishStates(changed);
        } catch (err) {
          for (const { device_feature_external_id: id } of changed) {
            remembered.delete(id);
          }
          throw err;
        }
        return { success: true, count: changed.length };
      });
      queue = run.catch(() => {});
      return run;
    },

    forgetPublishedStates(externalId) {
      gladys.forgotten.push(externalId ?? null);
      if (externalId === undefined) {
        remembered.clear();
        return;
      }
      for (const id of [...remembered.keys()]) {
        if (id === externalId || id.startsWith(`${externalId}:`)) {
          remembered.delete(id);
        }
      }
    },

    async publishTransports(entries) {
      gladys.transports.push(...entries);
    },

    async publishDiscoveredDevices(devices) {
      gladys.discovered = devices;
    },

    async getDevices() {
      return gladys.devices;
    },

    async setConnectionStatus(connected, message) {
      gladys.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      if (gladys.sceneEventError) {
        throw gladys.sceneEventError;
      }
      gladys.sceneEvents.push({ key, data });
      return { success: true };
    },

    // Fire-and-forget in the SDK too: synchronous, resolves nothing.
    requestWidgetRefresh(key) {
      gladys.widgetRefreshes.push(key);
    },

    /** Simulate "the user added these discovered devices in Gladys". */
    createDiscovered() {
      gladys.devices = gladys.discovered.map((device) => ({ ...device }));
      // The SDK forgets the remembered values of a created device by itself.
      for (const device of gladys.devices) {
        gladys.forgetPublishedStates(device.external_id);
      }
    },

    lastStatus() {
      return gladys.connectionStatuses.at(-1);
    },
  };
  return gladys;
}
