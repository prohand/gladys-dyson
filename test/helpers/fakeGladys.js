// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so tests can assert on them: external ids, states, transports, discovered
// devices and connection status.
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'dyson' } = {}) {
  const gladys = {
    devices: [],
    published: [],
    transports: [],
    discovered: [],
    connectionStatuses: [],

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
