// -----------------------------------------------------------------------------
// Fake Dyson account API and in-memory store, for the manager tests.
// -----------------------------------------------------------------------------

import { DysonCloudError } from '../../src/dyson/cloud.js';

export const PURE_COOL = {
  serial: 'NK6-EU-MHA0000A',
  name: 'Bedroom',
  productType: '438',
  version: '21.04.03',
  localPassword: 'local-secret-1',
};

export const HOT_COOL_LINK = {
  serial: 'AB1-EU-XYZ1234B',
  name: null,
  productType: '455',
  version: '21.03.08',
  localPassword: 'local-secret-2',
};

export const ROBOT = {
  serial: 'JH1-EU-ROB0001C',
  name: 'Robot',
  productType: '276',
  version: '1.0',
  localPassword: 'local-secret-3',
};

export function createFakeCloud({ devices = [PURE_COOL] } = {}) {
  const calls = [];
  const cloud = {
    calls,
    devices,
    validCode: '123456',
    tokenValid: true,
    unreachable: false,
    countries: [],

    factory({ country }) {
      cloud.countries.push(country);
      return cloud.api;
    },

    api: {
      async requestCode(email, culture) {
        calls.push({ method: 'requestCode', email, culture });
        return 'challenge-1';
      },
      async verifyCode(params) {
        calls.push({ method: 'verifyCode', ...params });
        if (params.otpCode !== cloud.validCode || params.challengeId !== 'challenge-1') {
          throw new DysonCloudError('HTTP 400', { status: 400, code: 'rejected' });
        }
        return 'token-1';
      },
      async listDevices(token) {
        calls.push({ method: 'listDevices', token });
        if (cloud.unreachable) {
          throw new DysonCloudError('down', { code: 'unreachable' });
        }
        if (!cloud.tokenValid) {
          throw new DysonCloudError('HTTP 401', { status: 401, code: 'unauthorized' });
        }
        return cloud.devices;
      },
      async iotCredentials(token, serial) {
        calls.push({ method: 'iotCredentials', token, serial });
        return {
          endpoint: 'iot.example.com',
          clientId: `client-${serial}`,
          authorizerName: 'authorizer',
          tokenKey: 'token',
          tokenValue: 'token-value',
          tokenSignature: 'signature',
        };
      },
    },
  };
  return cloud;
}

export function createMemoryStore(initial = {}) {
  const store = {
    data: structuredClone(initial),
    saves: 0,
    cleared: false,
    async load() {
      return structuredClone(store.data);
    },
    async save(data) {
      store.saves += 1;
      store.data = structuredClone(data);
    },
    async clear() {
      store.cleared = true;
      store.data = {};
    },
  };
  return store;
}
