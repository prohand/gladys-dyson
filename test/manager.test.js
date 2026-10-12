import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_TIMEOUT_MS, createDysonManager } from '../src/dyson/manager.js';
import { FEATURES } from '../src/devices/fan.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeMqtt, createFakeTimers, flush } from './helpers/fakeMqtt.js';
import {
  HOT_COOL_LINK,
  PURE_COOL,
  ROBOT,
  createFakeCloud,
  createMemoryStore,
} from './helpers/fakeDyson.js';

const ACCOUNT_CONFIG = { email: 'Me@Example.com', password: 'pw', country: 'FR' };
const LOCAL_CONFIG = { ...ACCOUNT_CONFIG, device_hosts: 'NK6-EU-MHA0000A=192.168.1.42' };

function setup({ store = createMemoryStore(), devices, decide, now = () => 1000 } = {}) {
  const gladys = createFakeGladys();
  const cloud = createFakeCloud({ devices });
  const mqtt = createFakeMqtt(decide);
  const timers = createFakeTimers();
  const manager = createDysonManager({
    gladys,
    store,
    cloudFactory: cloud.factory,
    mqttConnect: mqtt.connect,
    timers,
    now,
    onDeviceChange: () => gladys.requestWidgetRefresh('dyson_air'),
  });
  return { gladys, cloud, mqtt, timers, store, manager };
}

// Sign in with the e-mailed code, like the user does from the Configuration
// screen, then add every discovered device.
async function signIn(context, config = ACCOUNT_CONFIG) {
  await context.manager.start(config);
  await context.manager.requestCode();
  const message = await context.manager.verifyCode('123456');
  context.gladys.createDiscovered();
  await context.manager.syncLinks();
  return message;
}

test('fresh install: the status asks for the account', async () => {
  const { gladys, manager } = setup();
  await manager.start({});

  assert.equal(gladys.lastStatus().connected, false);
  assert.match(gladys.lastStatus().message.en, /e-mail and password/);
});

test('account filled but not signed in: the status asks for the code', async () => {
  const { gladys, manager } = setup();
  await manager.start(ACCOUNT_CONFIG);

  assert.equal(gladys.lastStatus().connected, false);
  assert.match(gladys.lastStatus().message.fr, /Recevoir un code/);
});

test('sign-in: code requested, validated, token saved, devices discovered', async () => {
  const context = setup({ devices: [PURE_COOL, HOT_COOL_LINK, ROBOT] });
  const { gladys, cloud, store, manager } = context;
  await manager.start(ACCOUNT_CONFIG);

  const sent = await manager.requestCode();
  assert.match(sent.en, /me@example\.com/);
  assert.deepEqual(cloud.calls[0], {
    method: 'requestCode',
    email: 'me@example.com',
    culture: 'fr-FR',
  });

  const signedIn = await manager.verifyCode(' 123456 ');
  assert.match(signedIn.en, /2 Dyson device\(s\)/);
  assert.equal(store.data.token, 'token-1');
  assert.equal(store.data.challengeId, null);
  assert.deepEqual(
    gladys.discovered.map((d) => d.external_id),
    ['ext:dyson:fan:NK6-EU-MHA0000A', 'ext:dyson:fan:AB1-EU-XYZ1234B'],
    'the robot vacuum is not a fan',
  );
  assert.equal(gladys.lastStatus().connected, true);
});

test('a wrong code is said in both languages, nothing saved', async () => {
  const { store, manager } = setup();
  await manager.start(ACCOUNT_CONFIG);
  await manager.requestCode();

  const message = await manager.verifyCode('000000');

  assert.match(message.en, /refused the code or the password/);
  assert.match(message.fr, /refusé le code ou le mot de passe/);
  assert.equal(store.data.token, undefined);
});

test('validating without a pending code asks for one first', async () => {
  const { manager } = setup();
  await manager.start(ACCOUNT_CONFIG);

  assert.match((await manager.verifyCode('123456')).en, /Receive a code/);
});

test('an expired code is not sent', async () => {
  let clock = 0;
  const { cloud, manager } = setup({ now: () => clock });
  await manager.start(ACCOUNT_CONFIG);
  await manager.requestCode();
  clock = 31 * 60 * 1000;

  assert.match((await manager.verifyCode('123456')).en, /Receive a code/);
  assert.equal(cloud.calls.filter((c) => c.method === 'verifyCode').length, 0);
});

test('only the devices created in Gladys get a link', async () => {
  const context = setup({ devices: [PURE_COOL, HOT_COOL_LINK] });
  await context.manager.start(ACCOUNT_CONFIG);
  await context.manager.requestCode();
  await context.manager.verifyCode('123456');
  assert.equal(context.mqtt.clients.length, 0, 'nothing created yet');

  context.gladys.devices = [context.gladys.discovered[0]];
  await context.manager.syncLinks();
  assert.equal(context.mqtt.clients.length, 1);

  context.gladys.devices = [];
  await context.manager.syncLinks();
  assert.equal(context.mqtt.clients[0].ended, true, 'deleted device: link closed');
});

test('a typed address is used for the local link', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);

  assert.equal(context.mqtt.clients[0].url, 'mqtt://192.168.1.42:1883');
  assert.deepEqual(context.gladys.transports.at(-1), {
    external_id: 'ext:dyson:fan:NK6-EU-MHA0000A',
    transport: 'local',
  });
});

test('no address: the device goes through the cloud, flagged degraded', async () => {
  const context = setup();
  await signIn(context);

  assert.equal(context.mqtt.clients[0].url, 'wss://iot.example.com/mqtt');
  const entry = context.gladys.transports.at(-1);
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true);
  assert.match(entry.message.fr, /Adresses des appareils/);
});

test('a bare address is used when the account has a single fan', async () => {
  const context = setup({ devices: [PURE_COOL, ROBOT] });
  await signIn(context, { ...ACCOUNT_CONFIG, device_hosts: ' 192.168.1.42 ' });

  assert.equal(context.mqtt.clients[0].url, 'mqtt://192.168.1.42:1883');
  assert.equal(context.gladys.transports.at(-1).transport, 'local');
});

test('a bare address with several fans: cloud, the message names the serial to type', async () => {
  const context = setup({ devices: [PURE_COOL, HOT_COOL_LINK] });
  await signIn(context, { ...ACCOUNT_CONFIG, device_hosts: '192.168.1.42' });

  assert.ok(context.mqtt.clients.every((c) => !c.url.startsWith('mqtt://')));
  const entry = context.gladys.transports.find(
    (t) => t.external_id === 'ext:dyson:fan:NK6-EU-MHA0000A',
  );
  assert.equal(entry.degraded, true);
  assert.match(entry.message.en, /add NK6-EU-MHA0000A=<IP> to the Device addresses setting/);
  assert.match(entry.message.fr, /ajoutez NK6-EU-MHA0000A=<IP> au réglage Adresses des appareils/);
});

test('a bare address typed later moves the single fan to local', async () => {
  const context = setup();
  await signIn(context);

  await context.manager.updateConfig({ ...ACCOUNT_CONFIG, device_hosts: '192.168.1.42' });

  assert.equal(context.gladys.transports.at(-1).transport, 'local');
});

test('an address typed later moves the device to local', async () => {
  const context = setup();
  await signIn(context);
  assert.equal(context.gladys.transports.at(-1).transport, 'cloud');

  await context.manager.updateConfig(LOCAL_CONFIG);

  assert.deepEqual(context.gladys.transports.at(-1), {
    external_id: 'ext:dyson:fan:NK6-EU-MHA0000A',
    transport: 'local',
  });
});

test('device states are published once, and only for known features', async () => {
  const context = setup();
  await signIn(context);
  const client = context.mqtt.clients[0];
  const id = (key) => `ext:dyson:fan:NK6-EU-MHA0000A:${key}`;

  client.receive({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON', fnsp: '0004' } });
  await flush();
  client.receive({ msg: 'STATE-CHANGE', 'product-state': { fnsp: ['0004', '0004'] } });
  client.receive({ msg: 'ENVIRONMENTAL-CURRENT-SENSOR-DATA', data: { pm25: '0007', hcho: '1' } });
  await flush();

  assert.deepEqual(context.gladys.published, [
    { featureExternalId: id(FEATURES.POWER), state: 1 },
    { featureExternalId: id(FEATURES.SPEED), state: 4 },
    { featureExternalId: id(FEATURES.FAN_MODE), state: 2 },
    { featureExternalId: id(FEATURES.PM25), state: 7 },
  ]);
});

test('a refused batch is published again at the next reading, even unchanged', async () => {
  const context = setup();
  await signIn(context);
  const client = context.mqtt.clients[0];
  const power = `ext:dyson:fan:NK6-EU-MHA0000A:${FEATURES.POWER}`;
  const powerStates = () => context.gladys.published.filter((s) => s.featureExternalId === power);

  context.gladys.publishStatesError = new Error('429 Too Many Requests');
  client.receive({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON' } });
  await flush();
  assert.deepEqual(powerStates(), []);

  context.gladys.publishStatesError = null;
  client.receive({ msg: 'STATE-CHANGE', 'product-state': { fpwr: ['ON', 'ON'] } });
  await flush();
  assert.deepEqual(powerStates(), [{ featureExternalId: power, state: 1 }]);
});

test('a reconnection to Gladys sends the unchanged values once more', async () => {
  const context = setup();
  await signIn(context);
  const client = context.mqtt.clients[0];
  const power = `ext:dyson:fan:NK6-EU-MHA0000A:${FEATURES.POWER}`;
  const powerStates = () => context.gladys.published.filter((s) => s.featureExternalId === power);

  client.receive({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON' } });
  await flush();
  await context.manager.start(ACCOUNT_CONFIG);
  assert.equal(context.gladys.forgotten.at(-1), null, 'everything forgotten');
  client.receive({ msg: 'STATE-CHANGE', 'product-state': { fpwr: ['ON', 'ON'] } });
  await flush();
  assert.equal(powerStates().length, 2);
});

test('the oscillation angle goes as a text state, and a chosen angle as a range', async () => {
  const context = setup();
  await signIn(context);
  const client = context.mqtt.clients[0];
  const id = `ext:dyson:fan:NK6-EU-MHA0000A:${FEATURES.OSCILLATION_ANGLE}`;

  client.receive({
    msg: 'CURRENT-STATE',
    'product-state': { oson: 'ON', ancp: 'CUST', osal: '0198', osau: '0243' },
  });
  await flush();
  client.receive({ msg: 'STATE-CHANGE', 'product-state': { osau: ['0243', '0243'] } });
  await flush();
  assert.deepEqual(
    context.gladys.published.filter((s) => s.featureExternalId === id),
    [{ featureExternalId: id, text: '45' }],
    'once',
  );

  const [device] = context.gladys.devices;
  const feature = device.features.find((f) => f.external_id === id);
  await context.manager.setValue(device, feature, '90');
  assert.deepEqual(client.published.at(-1).payload.data, {
    oson: 'ON',
    ancp: 'CUST',
    osal: '0176',
    osau: '0266',
  });
});

test('a Gladys command is sent to the device, in its dialect', async () => {
  const context = setup({ devices: [HOT_COOL_LINK] });
  await signIn(context);
  const [device] = context.gladys.devices;
  const feature = device.features.find((f) => f.external_id.endsWith(':auto'));

  await context.manager.setValue(device, feature, 1);

  const last = context.mqtt.clients[0].published.at(-1);
  assert.equal(last.topic, '455/AB1-EU-XYZ1234B/command');
  assert.deepEqual(last.payload.data, { fmod: 'AUTO' });
});

test('a command for an unknown device fails', async () => {
  const { manager } = setup();
  await manager.start(ACCOUNT_CONFIG);

  await assert.rejects(
    manager.setValue({ external_id: 'ext:dyson:fan:NOPE' }, { external_id: 'x' }, 1),
    /Unknown Dyson device/,
  );
});

test('a refused token signs out and says the session expired', async () => {
  const store = createMemoryStore({ email: 'me@example.com', token: 'old', devices: [PURE_COOL] });
  const context = setup({ store });
  context.cloud.tokenValid = false;

  await context.manager.start(ACCOUNT_CONFIG);

  assert.equal(store.data.token, null);
  assert.equal(context.gladys.lastStatus().connected, false);
  assert.match(context.gladys.lastStatus().message.en, /expired/);
});

test('the cloud down at startup: the cached device list is kept', async () => {
  const store = createMemoryStore({
    email: 'me@example.com',
    token: 'tok',
    devices: [PURE_COOL],
  });
  const context = setup({ store });
  context.cloud.unreachable = true;
  context.gladys.devices = [{ external_id: 'ext:dyson:fan:NK6-EU-MHA0000A', features: [] }];

  await context.manager.start(LOCAL_CONFIG);

  assert.equal(context.mqtt.clients[0].url, 'mqtt://192.168.1.42:1883');
  assert.equal(context.gladys.lastStatus().connected, true);
});

test('another e-mail signs out of the previous account', async () => {
  const context = setup();
  await signIn(context);
  assert.equal(context.store.data.token, 'token-1');

  await context.manager.updateConfig({ ...ACCOUNT_CONFIG, email: 'other@example.com' });

  assert.equal(context.store.data.token, undefined);
  assert.equal(context.mqtt.clients[0].ended, true);
});

test('turning the local preference off moves the links to the cloud', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);
  assert.equal(context.gladys.transports.at(-1).transport, 'local');

  await context.manager.updateConfig({ ...LOCAL_CONFIG, GLADYS_PREFER_LOCAL: false });

  assert.equal(context.gladys.transports.at(-1).transport, 'cloud');
  assert.deepEqual(context.manager.transportEntries(), [
    { external_id: 'ext:dyson:fan:NK6-EU-MHA0000A', transport: 'cloud' },
  ]);
});

test('a new country uses a new API client', async () => {
  const context = setup();
  await context.manager.start(ACCOUNT_CONFIG);
  await context.manager.updateConfig({ ...ACCOUNT_CONFIG, country: 'cn' });

  assert.deepEqual(context.cloud.countries, ['FR', 'CN']);
});

test('test the connection: one line per device', async () => {
  const context = setup({ devices: [PURE_COOL, HOT_COOL_LINK] });
  await context.manager.start(LOCAL_CONFIG);
  await context.manager.requestCode();
  await context.manager.verifyCode('123456');
  context.gladys.devices = [context.gladys.discovered[0]];
  await context.manager.syncLinks();

  const message = await context.manager.testConnection();

  assert.equal(message.en, 'Bedroom: local · Pure Hot+Cool Link: not added in Gladys');
  assert.equal(message.fr, 'Bedroom : local · Pure Hot+Cool Link : pas ajouté dans Gladys');
});

test('sign out: links closed, saved data deleted', async () => {
  const context = setup();
  await signIn(context);

  const message = await context.manager.forgetAccount();

  assert.match(message.fr, /Déconnecté/);
  assert.equal(context.store.cleared, true);
  assert.equal(
    context.mqtt.clients.every((c) => c.ended),
    true,
  );
  assert.equal(context.gladys.lastStatus().connected, false);
});

test('every start publishes the device list: the Discover tab sees a new version', async () => {
  const store = createMemoryStore({ email: 'me@example.com', token: 'tok', devices: [] });
  const context = setup({ store, devices: [PURE_COOL] });

  await context.manager.start(ACCOUNT_CONFIG);

  assert.deepEqual(
    context.gladys.discovered.map((d) => d.external_id),
    ['ext:dyson:fan:NK6-EU-MHA0000A'],
  );
  assert.ok(
    context.gladys.discovered[0].features.some((f) => f.external_id.endsWith(':fan-mode')),
    'with the features of this version',
  );
});

test('a fresh install publishes no empty device list at start', async () => {
  const { gladys, manager } = setup();
  gladys.discovered = null;
  await manager.start({});

  assert.equal(gladys.discovered, null, 'nothing published');
});

test('scan publishes the devices of the account', async () => {
  const store = createMemoryStore({ email: 'me@example.com', token: 'tok', devices: [] });
  const context = setup({ store, devices: [PURE_COOL] });

  await context.manager.scan();

  assert.equal(context.gladys.discovered.length, 1);
  assert.equal(context.gladys.discovered[0].name, 'Bedroom');
});

test('scene actions and the widget see the created device, its state and level', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);
  const client = context.mqtt.clients[0];
  const id = 'ext:dyson:fan:NK6-EU-MHA0000A';

  client.receive({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON', oson: 'OIOF' } });
  client.receive({ msg: 'ENVIRONMENTAL-CURRENT-SENSOR-DATA', data: { pm25: '0040' } });
  await flush();

  const info = context.manager.deviceInfo(id);
  assert.equal(info.serial, 'NK6-EU-MHA0000A');
  assert.equal(info.status.transport, 'local');
  assert.equal(info.level, 'fair');
  assert.deepEqual(info.productState, { fpwr: 'ON', oson: 'OIOF' });
  assert.equal(info.features[FEATURES.PM25], `${id}:${FEATURES.PM25}`);
  assert.equal(info.features[FEATURES.FORMALDEHYDE], undefined);
  assert.equal(context.manager.deviceInfo('ext:dyson:fan:OTHER'), null);
  assert.ok(context.gladys.widgetRefreshes.length > 0, 'the widget was nudged');
});

test('a scene order reaches the device; an unreachable one says so', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);
  const id = 'ext:dyson:fan:NK6-EU-MHA0000A';

  assert.deepEqual(await context.manager.sendToDevice(id, { sltm: '0030' }), {
    sent: true,
    transport: 'local',
  });
  assert.deepEqual(context.mqtt.clients[0].published.at(-1).payload.data, { sltm: '0030' });
  assert.equal(await context.manager.refreshDevice(id), true);

  context.mqtt.clients[0].drop();
  assert.deepEqual(await context.manager.sendToDevice(id, { sltm: '0030' }), {
    sent: false,
    transport: 'unreachable',
  });
  assert.equal(await context.manager.refreshDevice(id), false);
  assert.deepEqual(await context.manager.sendToDevice('nope', {}), {
    sent: false,
    transport: 'unknown',
  });
});

test('a lost connection fires the connection_changed trigger', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);

  context.mqtt.clients[0].drop();
  await flush();

  assert.deepEqual(context.gladys.sceneEvents, [
    {
      key: 'connection_changed',
      data: {
        device: 'ext:dyson:fan:NK6-EU-MHA0000A',
        transport: 'unreachable',
        previous_transport: 'local',
        degraded: false,
      },
    },
  ]);
});

test('a widget command waits for the device answer, from the state known at the tap', async () => {
  const context = setup();
  await signIn(context, LOCAL_CONFIG);
  const id = 'ext:dyson:fan:NK6-EU-MHA0000A';
  const [client] = context.mqtt.clients;
  client.receive({
    msg: 'CURRENT-STATE',
    'product-state': { fpwr: 'ON', auto: 'OFF', fnsp: '0004', oson: 'OION' },
  });
  await flush();

  let done = false;
  const pending = context.manager
    .command(id, FEATURES.SPEED, (state) => Number(state.fnsp) + 1)
    .then((result) => {
      done = result;
    });
  await flush();
  assert.deepEqual(client.published.at(-1).payload.data, {
    fpwr: 'ON',
    auto: 'OFF',
    fnsp: '0005',
  });
  assert.equal(done, false, 'still waiting for the device');

  client.receive({ msg: 'STATE-CHANGE', 'product-state': { fnsp: ['0004', '0005'] } });
  await pending;
  assert.equal(done, true);

  // A device that does not answer: the wait ends after a few seconds.
  const silent = context.manager.command(id, FEATURES.OSCILLATION, () => 0);
  await flush();
  assert.deepEqual(client.published.at(-1).payload.data, { oson: 'OIOF' }, 'its dialect');
  context.timers.runTimeouts(ANSWER_TIMEOUT_MS);
  assert.equal(await silent, true);

  const before = client.published.length;
  assert.equal(await context.manager.command(id, FEATURES.SPEED, () => null), true);
  assert.equal(client.published.length, before, 'nothing to change: nothing sent');

  client.drop();
  assert.equal(await context.manager.command(id, FEATURES.POWER, () => 1), false);
  assert.equal(await context.manager.command('nope', FEATURES.POWER, () => 1), false);
});
