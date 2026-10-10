import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildWidgetContent, handleWidgetAction } from '../src/capabilities/widget.js';
import { describeModel } from '../src/dyson/models.js';

const ID = 'ext:dyson:fan:S1';
const feature = (key) => `${ID}:${key}`;

const PURE_INFO = {
  model: describeModel('527K'),
  status: { transport: 'local', degraded: false, message: null },
  productState: { fpwr: 'ON', auto: 'OFF', fnsp: '0006', hflr: '0008', cflr: '0050', sltm: '0030' },
  level: 'fair',
  features: Object.fromEntries(
    ['power', 'auto', 'temperature', 'humidity', 'pm25', 'pm10', 'voc', 'no2'].map((key) => [
      key,
      feature(key),
    ]),
  ),
};

const dysonWith = (info) => ({
  deviceInfo: (id) => (id === ID ? info : null),
  refreshed: [],
  async refreshDevice(id) {
    this.refreshed.push(id);
    return id === ID;
  },
});

const byType = (content, type) => content.components.filter((c) => c.type === type);

test('a 2018+ device: live tiles, computed status, buttons — all rendered as sent', () => {
  const content = buildWidgetContent(dysonWith(PURE_INFO), { settings: { device: ID } });

  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    byType(content, 'value').map((c) => c.device_feature),
    ['pm25', 'voc', 'temperature', 'humidity'].map(feature),
  );
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => item.value),
    [
      { en: 'Fair', fr: 'Moyenne' },
      { en: 'Local', fr: 'Locale' },
      { en: 'Speed 6', fr: 'Vitesse 6' },
      '8 %',
      '50 %',
      '30 min',
    ],
  );
  assert.equal(items[3].color, 'warning', 'a filter under 10 % is a warning');
  const buttons = byType(content, 'button');
  assert.deepEqual(
    buttons.map((b) => [b.device_feature ?? b.action.key, b.value]),
    [
      [feature('power'), 0],
      [feature('auto'), 1],
      ['refresh', undefined],
    ],
  );
});

test('a Link device that is off, through the cloud fallback', () => {
  const content = buildWidgetContent(
    dysonWith({
      model: describeModel('475'),
      status: { transport: 'cloud', degraded: true, message: null },
      productState: { fmod: 'OFF', filf: '0300' },
      level: null,
      features: { power: feature('power'), voc: feature('voc') },
    }),
    { settings: { device: ID } },
  );

  assert.deepEqual(validateWidgetContent(content), []);
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(items[0].value, { en: 'Dyson cloud (fallback)', fr: 'Cloud Dyson (secours)' });
  assert.deepEqual(items[1].value, { en: 'Off', fr: 'Éteint' });
  assert.equal(items[2].value, '300 h');
  assert.deepEqual(byType(content, 'button')[0].label, { en: 'Turn on', fr: 'Allumer' });
});

test('an unreachable device shows no mode', () => {
  const content = buildWidgetContent(
    dysonWith({
      ...PURE_INFO,
      status: { transport: 'unreachable', degraded: false },
      productState: {},
      level: null,
    }),
    { settings: { device: ID } },
  );

  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    byType(content, 'status')[0].items.map((item) => item.label.en),
    ['Connection'],
  );
});

test('no device chosen, or an unknown one: a message', () => {
  for (const settings of [{}, { device: 'ext:dyson:fan:GONE' }, undefined]) {
    const content = buildWidgetContent(dysonWith(PURE_INFO), { settings });
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].type, 'text');
  }
});

test('the refresh button asks the device for its readings', async () => {
  const dyson = dysonWith(PURE_INFO);

  const toast = await handleWidgetAction(dyson, { actionKey: 'refresh', params: { device: ID } });
  assert.deepEqual(toast, { en: 'Readings requested.', fr: 'Relevés demandés.' });
  assert.deepEqual(dyson.refreshed, [ID]);

  const unreachable = await handleWidgetAction(dyson, {
    actionKey: 'refresh',
    params: { device: 'other' },
  });
  assert.match(unreachable.en, /unreachable/);
  await assert.rejects(handleWidgetAction(dyson, { actionKey: 'nope', params: {} }), /Unknown/);
});
