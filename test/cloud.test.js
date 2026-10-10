import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { DysonCloudError, createDysonCloud, decryptLocalCredentials } from '../src/dyson/cloud.js';

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));

function encrypt(object) {
  const cipher = createCipheriv('aes-256-cbc', KEY, Buffer.alloc(16));
  return Buffer.concat([cipher.update(JSON.stringify(object)), cipher.final()]).toString('base64');
}

// Fake fetch: answers by "METHOD path", records every request.
function createFakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const request = {
      method: init.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      host: url.origin,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    requests.push(request);
    const route = routes[`${init.method} ${url.pathname}`];
    if (route instanceof Error) {
      throw route;
    }
    const { status = 200, body = '' } =
      typeof route === 'function' ? route(request) : (route ?? { status: 404 });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fetchImpl, requests };
}

const PROVISION = 'GET /v1/provisioningservice/application/Android/version';

test('requesting a code: user status, then the e-mail challenge', async () => {
  const { fetchImpl, requests } = createFakeFetch({
    [PROVISION]: { body: '"5.0.21061"' },
    'POST /v3/userregistration/email/userstatus': {
      body: { accountStatus: 'ACTIVE', authenticationMethod: 'EMAIL_PWD_2FA' },
    },
    'POST /v3/userregistration/email/auth': { body: { challengeId: 'abc' } },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  assert.equal(await cloud.requestCode('me@example.com', 'fr-FR'), 'abc');
  const auth = requests.find((r) => r.path === '/v3/userregistration/email/auth');
  assert.deepEqual(auth.query, { country: 'FR', culture: 'fr-FR' });
  assert.deepEqual(auth.body, { email: 'me@example.com' });
  assert.equal(auth.host, 'https://appapi.cp.dyson.com');
  assert.equal(auth.headers['User-Agent'], 'android client');
});

test('an account that is not active cannot get a code', async () => {
  const { fetchImpl } = createFakeFetch({
    'POST /v3/userregistration/email/userstatus': { body: { accountStatus: 'UNREGISTERED' } },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  await assert.rejects(cloud.requestCode('me@example.com', 'fr-FR'), {
    name: 'DysonCloudError',
    code: 'rejected',
  });
});

test('validating the code sends code, password and challenge, and returns the token', async () => {
  const { fetchImpl, requests } = createFakeFetch({
    'POST /v3/userregistration/email/verify': { body: { token: 'tok', tokenType: 'Bearer' } },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  const token = await cloud.verifyCode({
    email: 'me@example.com',
    password: 'pw',
    challengeId: 'abc',
    otpCode: '123456',
  });

  assert.equal(token, 'tok');
  assert.deepEqual(requests.at(-1).body, {
    email: 'me@example.com',
    password: 'pw',
    challengeId: 'abc',
    otpCode: '123456',
  });
});

test('a refused code is a "rejected" error, a server error "unreachable"', async () => {
  const refused = createDysonCloud({
    country: 'FR',
    fetchImpl: createFakeFetch({ 'POST /v3/userregistration/email/verify': { status: 400 } })
      .fetchImpl,
  });
  await assert.rejects(refused.verifyCode({}), { code: 'rejected', status: 400 });

  const down = createDysonCloud({
    country: 'FR',
    fetchImpl: createFakeFetch({ 'POST /v3/userregistration/email/verify': { status: 503 } })
      .fetchImpl,
  });
  await assert.rejects(down.verifyCode({}), { code: 'unreachable', status: 503 });

  const offline = createDysonCloud({
    country: 'FR',
    fetchImpl: createFakeFetch({ 'POST /v3/userregistration/email/verify': new Error('ENOTFOUND') })
      .fetchImpl,
  });
  await assert.rejects(offline.verifyCode({}), (err) => {
    assert.ok(err instanceof DysonCloudError);
    assert.equal(err.code, 'unreachable');
    return true;
  });
});

test('the device list is normalized and the local passwords decrypted', async () => {
  const { fetchImpl, requests } = createFakeFetch({
    'GET /v2/provisioningservice/manifest': {
      body: [
        {
          Serial: 'nk6-eu-mha0000a',
          Name: ' Bedroom ',
          ProductType: '438k',
          Version: '21.04.03',
          LocalCredentials: encrypt({ serial: 'NK6-EU-MHA0000A', apPasswordHash: 'secret' }),
        },
        { Serial: 'XX1', Name: '', ProductType: '527', LocalCredentials: 'garbage' },
        { Name: 'no serial' },
      ],
    },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  assert.deepEqual(await cloud.listDevices('tok'), [
    {
      serial: 'NK6-EU-MHA0000A',
      name: 'Bedroom',
      productType: '438K',
      version: '21.04.03',
      localPassword: 'secret',
    },
    { serial: 'XX1', name: null, productType: '527', version: null, localPassword: null },
  ]);
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer tok');
});

test('a refused token is an "unauthorized" error', async () => {
  const { fetchImpl } = createFakeFetch({
    'GET /v2/provisioningservice/manifest': { status: 401 },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  await assert.rejects(cloud.listDevices('old'), { code: 'unauthorized', status: 401 });
});

test('the app version is asked once, and its failure does not block', async () => {
  const { fetchImpl, requests } = createFakeFetch({
    [PROVISION]: { status: 500 },
    'GET /v2/provisioningservice/manifest': { body: [] },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  assert.deepEqual(await cloud.listDevices('tok'), []);
  assert.equal(requests.filter((r) => r.path.includes('application')).length, 1);
});

test('the IoT credentials of a device', async () => {
  const { fetchImpl, requests } = createFakeFetch({
    'POST /v2/authorize/iot-credentials': {
      body: {
        Endpoint: 'abc-ats.iot.eu-west-1.amazonaws.com',
        IoTCredentials: {
          ClientId: 'client',
          CustomAuthorizerName: 'authorizer',
          TokenKey: 'token',
          TokenSignature: 'sig',
          TokenValue: 'value',
        },
      },
    },
  });
  const cloud = createDysonCloud({ country: 'FR', fetchImpl });

  assert.deepEqual(await cloud.iotCredentials('tok', 'NK6-EU-MHA0000A'), {
    endpoint: 'abc-ats.iot.eu-west-1.amazonaws.com',
    clientId: 'client',
    authorizerName: 'authorizer',
    tokenKey: 'token',
    tokenValue: 'value',
    tokenSignature: 'sig',
  });
  assert.deepEqual(requests.at(-1).body, { Serial: 'NK6-EU-MHA0000A' });
});

test('Chinese accounts use the Chinese platform', () => {
  assert.equal(createDysonCloud({ country: 'CN' }).host, 'https://appapi.cp.dyson.cn');
  assert.equal(createDysonCloud({ country: 'FR' }).host, 'https://appapi.cp.dyson.com');
});

test('local credentials: missing or unreadable means no local access', () => {
  assert.equal(decryptLocalCredentials(encrypt({ apPasswordHash: 'p' })), 'p');
  assert.equal(decryptLocalCredentials(encrypt({ other: 1 })), null);
  assert.equal(decryptLocalCredentials(''), null);
  assert.equal(decryptLocalCredentials(undefined), null);
  assert.equal(decryptLocalCredentials('bm90IGEgYmxvY2s='), null);
});
