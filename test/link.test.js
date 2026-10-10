import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceLink, RETRY_DELAYS_MS } from '../src/dyson/link.js';
import { createFakeMqtt, createFakeTimers, flush } from './helpers/fakeMqtt.js';

const DEVICE = { serial: 'NK6-EU-MHA0000A', productType: '438', localPassword: 'local-secret' };

const CREDENTIALS = {
  endpoint: 'iot.example.com',
  clientId: 'client-1',
  authorizerName: 'authorizer',
  tokenKey: 'token',
  tokenValue: 'token-value',
  tokenSignature: 'signature',
};

function setup({
  decide,
  host = '192.168.1.20',
  cloudAvailable = true,
  preferLocal = true,
  device = DEVICE,
} = {}) {
  const mqtt = createFakeMqtt(decide);
  const timers = createFakeTimers();
  const statuses = [];
  const link = new DeviceLink({
    device,
    hostOf: () => host,
    cloud: {
      available: () => cloudAvailable,
      credentials: async () => CREDENTIALS,
    },
    preferLocal,
    refreshIntervalSeconds: 60,
    mqttConnect: mqtt.connect,
    timers,
  });
  link.on('transport', (status) => statuses.push(status));
  return { link, mqtt, timers, statuses };
}

const isLocal = (url) => url.startsWith('mqtt://');

test('local preferred and reachable: local, nominal', async () => {
  const { link, mqtt, statuses } = setup();
  await link.start();

  assert.equal(mqtt.clients.length, 1);
  const [client] = mqtt.clients;
  assert.equal(client.url, 'mqtt://192.168.1.20:1883');
  assert.equal(client.options.username, 'NK6-EU-MHA0000A');
  assert.equal(client.options.password, 'local-secret');
  assert.equal(client.options.reconnectPeriod, 0);
  assert.deepEqual(statuses, [{ transport: 'local', degraded: false, message: null }]);
  assert.deepEqual(client.subscriptions, [
    { topic: '438/NK6-EU-MHA0000A/status/current', options: { qos: 1 } },
  ]);
  assert.deepEqual(
    client.published.map((p) => [p.topic, p.payload.msg]),
    [
      ['438/NK6-EU-MHA0000A/command', 'REQUEST-CURRENT-STATE'],
      ['438/NK6-EU-MHA0000A/command', 'REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA'],
    ],
  );
  link.stop();
});

test('local refused: Dyson cloud, flagged degraded with the reason', async () => {
  const { link, mqtt, statuses } = setup({ decide: (url) => (isLocal(url) ? 'error' : 'connect') });
  await link.start();

  assert.equal(mqtt.clients.length, 2);
  const cloud = mqtt.clients[1];
  assert.equal(cloud.url, 'wss://iot.example.com/mqtt');
  assert.equal(cloud.options.clientId, 'client-1');
  assert.deepEqual(cloud.options.wsOptions.headers, {
    'X-Amz-CustomAuthorizer-Name': 'authorizer',
    'X-Amz-CustomAuthorizer-Signature': 'signature',
    token: 'token-value',
  });
  assert.equal(statuses.at(-1).transport, 'cloud');
  assert.equal(statuses.at(-1).degraded, true);
  assert.match(statuses.at(-1).message.en, /refused or unreachable/);
  assert.match(statuses.at(-1).message.fr, /refusée ou injoignable/);
  link.stop();
});

test('address unknown: cloud, degraded, no local attempt', async () => {
  const { link, mqtt, statuses } = setup({ host: null });
  await link.start();

  assert.equal(mqtt.clients.length, 1);
  assert.equal(statuses.at(-1).transport, 'cloud');
  assert.match(statuses.at(-1).message.en, /Local address unknown/);
  link.stop();
});

test('a cloud-only product is nominal on the cloud', async () => {
  const { link, statuses } = setup({ device: { ...DEVICE, localPassword: null } });
  await link.start();

  assert.deepEqual(statuses.at(-1), { transport: 'cloud', degraded: false, message: null });
  link.stop();
});

test('cloud preferred: cloud first, local as the degraded fallback', async () => {
  const preferred = setup({ preferLocal: false });
  await preferred.link.start();
  assert.equal(preferred.mqtt.clients[0].url, 'wss://iot.example.com/mqtt');
  assert.deepEqual(preferred.statuses.at(-1), {
    transport: 'cloud',
    degraded: false,
    message: null,
  });
  preferred.link.stop();

  const fallback = setup({
    preferLocal: false,
    decide: (url) => (isLocal(url) ? 'connect' : 'error'),
  });
  await fallback.link.start();
  assert.equal(fallback.statuses.at(-1).transport, 'local');
  assert.match(fallback.statuses.at(-1).message.en, /Dyson cloud unreachable/);
  fallback.link.stop();
});

test('nothing works: unreachable, then retried later', async () => {
  const { link, mqtt, timers, statuses } = setup({ decide: () => 'error' });
  await link.start();

  // Unreachable from the start: no change, so no event, but the status says it.
  assert.deepEqual(statuses, []);
  assert.deepEqual(link.status, { transport: 'unreachable', degraded: false, message: null });
  assert.ok([...timers.timeouts.values()].some((t) => t.ms === RETRY_DELAYS_MS[0]));

  timers.runTimeouts(RETRY_DELAYS_MS[0]);
  await flush();
  await flush();
  assert.equal(mqtt.clients.length, 4, 'local and cloud tried again');
  assert.ok([...timers.timeouts.values()].some((t) => t.ms === RETRY_DELAYS_MS[1]));
  link.stop();
  assert.equal(timers.timeouts.size, 0, 'stop cancels the retry');
});

test('a broker that never answers is given up by the link timeout', async () => {
  const { link, mqtt, timers, statuses } = setup({
    decide: (url) => (isLocal(url) ? 'hang' : 'connect'),
  });
  const started = link.start();
  await flush();
  timers.runTimeouts(15000);
  await started;

  assert.equal(mqtt.clients[0].ended, true);
  assert.equal(statuses.at(-1).transport, 'cloud');
  link.stop();
});

test('device messages become events', async () => {
  const { link, mqtt } = setup();
  const states = [];
  const environments = [];
  link.on('state', (values) => states.push(values));
  link.on('environment', (values) => environments.push(values));
  await link.start();

  const [client] = mqtt.clients;
  client.receive({ msg: 'STATE-CHANGE', 'product-state': { fpwr: ['OFF', 'ON'] } });
  client.receive({ msg: 'ENVIRONMENTAL-CURRENT-SENSOR-DATA', data: { pm25: '0003' } });
  client.receive({ msg: 'HELLO' });

  assert.deepEqual(states, [{ fpwr: 'ON' }]);
  assert.deepEqual(environments, [{ pm25: '0003' }]);
  link.stop();
});

test('a command is a STATE-SET on the command topic', async () => {
  const { link, mqtt } = setup();
  await link.start();

  await link.send({ fpwr: 'ON' });

  const last = mqtt.clients[0].published.at(-1);
  assert.equal(last.topic, '438/NK6-EU-MHA0000A/command');
  assert.equal(last.payload.msg, 'STATE-SET');
  assert.deepEqual(last.payload.data, { fpwr: 'ON' });
  link.stop();
});

test('a command to an unreachable device fails', async () => {
  const { link } = setup({ decide: () => 'error' });
  await link.start();

  await assert.rejects(link.send({ fpwr: 'ON' }), /unreachable/);
  link.stop();
});

test('the sensors are asked at every interval', async () => {
  const { link, mqtt, timers } = setup();
  await link.start();

  const [interval] = [...timers.intervals.values()];
  assert.equal(interval.ms, 60000);
  interval.fn();
  await flush();
  assert.equal(
    mqtt.clients[0].published.at(-1).payload.msg,
    'REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA',
  );

  link.setRefreshInterval(120);
  assert.deepEqual(
    [...timers.intervals.values()].map((t) => t.ms),
    [120000],
  );
  link.stop();
  assert.equal(timers.intervals.size, 0);
});

test('a lost session: unreachable, then reconnected', async () => {
  const { link, mqtt, timers, statuses } = setup();
  await link.start();

  mqtt.clients[0].drop();
  assert.equal(statuses.at(-1).transport, 'unreachable');
  assert.equal(link.connected, false);

  timers.runTimeouts(RETRY_DELAYS_MS[0]);
  await flush();
  await flush();
  assert.equal(statuses.at(-1).transport, 'local');
  assert.equal(mqtt.clients.length, 2);
  link.stop();
});

test('changing the preference and reconnecting switches transport', async () => {
  const { link, mqtt, statuses } = setup();
  await link.start();
  assert.equal(statuses.at(-1).transport, 'local');

  link.setPreferLocal(false);
  await link.reconnect();

  assert.equal(mqtt.clients[0].ended, true);
  assert.equal(statuses.at(-1).transport, 'cloud');
  link.stop();
});
