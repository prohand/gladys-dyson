import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_ACTIONS, settingsCommand, sleepTimerCommand } from '../src/capabilities/scenes.js';
import { describeModel } from '../src/dyson/models.js';

const PURE = describeModel('438');
const LINK = describeModel('475');

test('settings are merged into one order, empty fields left as they are', () => {
  assert.deepEqual(settingsCommand(PURE, { power: 'on', speed: 4, night_mode: 'on' }), {
    fpwr: 'ON',
    auto: 'OFF',
    fnsp: '0004',
    nmod: 'ON',
  });
  assert.deepEqual(settingsCommand(PURE, { mode: 'auto', speed: 4, oscillation: 'off' }), {
    auto: 'ON',
    oson: 'OFF',
  });
  assert.deepEqual(settingsCommand(PURE, { mode: 'manual', speed: '' }), { auto: 'OFF' });
  assert.equal(settingsCommand(PURE, { power: '', speed: null }), null);
});

test('off is off, whatever else is asked', () => {
  assert.deepEqual(settingsCommand(PURE, { power: 'off', speed: 8, mode: 'auto' }), {
    fpwr: 'OFF',
  });
  assert.deepEqual(settingsCommand(LINK, { power: 'off', night_mode: 'on' }), { fmod: 'OFF' });
});

test('the Link dialect: power then auto on the same key', () => {
  assert.deepEqual(settingsCommand(LINK, { power: 'on', mode: 'auto' }), { fmod: 'AUTO' });
  assert.deepEqual(settingsCommand(LINK, { power: 'on', speed: 2 }), {
    fmod: 'FAN',
    fnsp: '0002',
  });
});

test('oscillation keeps the dialect of the device', () => {
  assert.deepEqual(settingsCommand(PURE, { oscillation: 'on' }, { oson: 'OIOF' }), {
    oson: 'OION',
  });
});

test('sleep timer: minutes on four digits, 0 cancels, capped at 9 hours', () => {
  assert.deepEqual(sleepTimerCommand(60), { sltm: '0060' });
  assert.deepEqual(sleepTimerCommand(0), { sltm: 'OFF' });
  assert.deepEqual(sleepTimerCommand('abc'), { sltm: 'OFF' });
  assert.deepEqual(sleepTimerCommand(9999), { sltm: '0540' });
});

function fakeDyson(info) {
  const sent = [];
  return {
    sent,
    deviceInfo: (id) => (id === 'ext:dyson:fan:S1' ? info : null),
    async sendToDevice(id, data) {
      sent.push({ id, data });
      return { sent: true, transport: 'local' };
    },
  };
}

const INFO = { model: PURE, productState: {}, status: { transport: 'local' } };

test('apply_settings sends the order and returns the outputs', async () => {
  const dyson = fakeDyson(INFO);

  const outputs = await SCENE_ACTIONS.apply_settings(dyson, {
    device: 'ext:dyson:fan:S1',
    power: 'on',
  });

  assert.deepEqual(outputs, { sent: true, transport: 'local' });
  assert.deepEqual(dyson.sent, [{ id: 'ext:dyson:fan:S1', data: { fpwr: 'ON' } }]);
});

test('nothing to do, or an unknown device, is an output, not an error', async () => {
  const dyson = fakeDyson(INFO);

  assert.deepEqual(await SCENE_ACTIONS.apply_settings(dyson, { device: 'ext:dyson:fan:S1' }), {
    sent: false,
    transport: 'local',
  });
  assert.deepEqual(await SCENE_ACTIONS.apply_settings(dyson, { device: 'nope', power: 'on' }), {
    sent: false,
    transport: 'unknown',
  });
  assert.deepEqual(await SCENE_ACTIONS.set_sleep_timer(dyson, { device: 'nope', minutes: 5 }), {
    sent: false,
    transport: 'unknown',
  });
  assert.equal(dyson.sent.length, 0);
});

test('set_sleep_timer sends the timer', async () => {
  const dyson = fakeDyson(INFO);

  await SCENE_ACTIONS.set_sleep_timer(dyson, { device: 'ext:dyson:fan:S1', minutes: 30 });

  assert.deepEqual(dyson.sent[0].data, { sltm: '0030' });
});
