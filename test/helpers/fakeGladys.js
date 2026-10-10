// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so tests can assert on them: external ids, states, transports, discovered
// devices, connection status, scene events and widget refresh nudges.
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'dyson' } = {}) {
  const gladys = {
    devices: [],
    published: [],
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
      for (const s of states) {
        gladys.published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
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
    },

    lastStatus() {
      return gladys.connectionStatuses.at(-1);
    },
  };
  return gladys;
}
