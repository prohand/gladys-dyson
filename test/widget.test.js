import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildAirContent,
  buildControlsContent,
  handleWidgetAction,
} from '../src/capabilities/widget.js';
import { describeModel } from '../src/dyson/models.js';

const ID = 'ext:dyson:fan:S1';
const feature = (key) => `${ID}:${key}`;

const PURE_INFO = {
  model: describeModel('527K'),
  status: { transport: 'local', degraded: false, message: null },
  productState: {
    fpwr: 'ON',
    auto: 'OFF',
    fnsp: '0006',
    oson: 'OION',
    nmod: 'OFF',
    fdir: 'OFF',
    hmod: 'HEAT',
    hmax: '2950',
    hflr: '0008',
    cflr: '0050',
    sltm: '0030',
  },
  level: 'poor',
  readings: { pm25: 40, pm10: 20, voc: 1, no2: 7, formaldehyde: 0.02 },
  levels: { pm25: 'fair', pm10: 'good', voc: 'good', no2: 'poor' },
  features: Object.fromEntries(
    [
      'power',
      'auto',
      'speed',
      'temperature',
      'humidity',
      'pm25',
      'pm10',
      'voc',
      'no2',
      'formaldehyde',
    ].map((key) => [key, feature(key)]),
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

test('air widget of a 2018+ device: six live tiles coloured by level — rendered as sent', () => {
  const content = buildAirContent(dysonWith(PURE_INFO), { settings: { device: ID } });

  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = byType(content, 'value');
  assert.deepEqual(
    tiles.map((c) => c.device_feature),
    ['pm25', 'pm10', 'voc', 'no2', 'temperature', 'humidity'].map(feature),
  );
  assert.deepEqual(
    tiles.map((c) => c.color),
    ['info', 'success', 'success', 'warning', undefined, undefined],
    'each pollutant tile has the colour of its own level',
  );
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => item.value),
    [{ en: 'Poor', fr: 'Mauvaise' }, '0.02 mg/m³', { en: 'Local', fr: 'Locale' }],
    'formaldehyde finds no tile: it goes to the status list',
  );
  assert.deepEqual(
    byType(content, 'button').map((b) => b.action.key),
    ['refresh'],
  );
});

test('controls widget of a 2018+ device: speed gauge, settings, four buttons', () => {
  const content = buildControlsContent(dysonWith(PURE_INFO), { settings: { device: ID } });

  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(byType(content, 'gauge')[0].device_feature, feature('speed'));
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => [item.label.en, item.value]),
    [
      ['Mode', { en: 'Speed 6', fr: 'Vitesse 6' }],
      ['Oscillation', { en: 'On', fr: 'Activé' }],
      ['Night mode', { en: 'Off', fr: 'Désactivé' }],
      ['Airflow', { en: 'Back', fr: 'Arrière' }],
      ['Heating', '21.9 °C'],
      ['Connection', { en: 'Local', fr: 'Locale' }],
      ['HEPA filter', '8 %'],
      ['Carbon filter', '50 %'],
      ['Sleep timer', '30 min'],
    ],
  );
  assert.equal(items[6].color, 'warning', 'a filter under 10 % is a warning');
  assert.deepEqual(
    byType(content, 'button').map((b) => [b.device_feature, b.value]),
    [
      [feature('power'), 0],
      [feature('auto'), 1],
      [feature('speed'), 5],
      [feature('speed'), 7],
    ],
  );
});

test('controls widget: no speed step past the ends, nor while in auto', () => {
  const buttonsAt = (productState) =>
    byType(
      buildControlsContent(dysonWith({ ...PURE_INFO, productState }), {
        settings: { device: ID },
      }),
      'button',
    ).map((b) => b.label.en);

  assert.deepEqual(buttonsAt({ fpwr: 'ON', auto: 'OFF', fnsp: '0010' }), [
    'Turn off',
    'Auto mode',
    'Speed -',
  ]);
  assert.deepEqual(buttonsAt({ fpwr: 'ON', auto: 'OFF', fnsp: '0001' }), [
    'Turn off',
    'Auto mode',
    'Speed +',
  ]);
  assert.deepEqual(buttonsAt({ fpwr: 'ON', auto: 'ON', fnsp: 'AUTO' }), ['Turn off', 'Auto mode']);
  assert.deepEqual(buttonsAt({ fpwr: 'OFF', fnsp: '0004' }), ['Turn on', 'Auto mode']);
});

test('a Link device that is off, through the cloud fallback', () => {
  const info = {
    model: describeModel('475'),
    status: { transport: 'cloud', degraded: true, message: null },
    productState: { fmod: 'OFF', filf: '0300' },
    level: null,
    features: { power: feature('power'), voc: feature('voc') },
  };

  const air = buildAirContent(dysonWith(info), { settings: { device: ID } });
  assert.deepEqual(validateWidgetContent(air), []);
  assert.equal(byType(air, 'value')[0].color, undefined, 'no reading yet: no colour');
  assert.deepEqual(byType(air, 'status')[0].items[0].value, {
    en: 'Dyson cloud (fallback)',
    fr: 'Cloud Dyson (secours)',
  });

  const controls = buildControlsContent(dysonWith(info), { settings: { device: ID } });
  assert.deepEqual(validateWidgetContent(controls), []);
  const items = byType(controls, 'status')[0].items;
  assert.deepEqual(items[0].value, { en: 'Off', fr: 'Éteint' });
  assert.deepEqual(items[1].value, { en: 'Dyson cloud (fallback)', fr: 'Cloud Dyson (secours)' });
  assert.equal(items[2].value, '300 h');
  assert.deepEqual(byType(controls, 'button')[0].label, { en: 'Turn on', fr: 'Allumer' });
});

test('an unreachable device shows its connection only', () => {
  const info = {
    ...PURE_INFO,
    status: { transport: 'unreachable', degraded: false },
    level: null,
    levels: {},
    readings: {},
  };
  for (const build of [buildAirContent, buildControlsContent]) {
    const content = build(dysonWith(info), { settings: { device: ID } });
    assert.deepEqual(validateWidgetContent(content), []);
    assert.deepEqual(
      byType(content, 'status')[0].items.map((item) => item.label.en),
      ['Connection'],
    );
  }
});

test('no device chosen, or an unknown one: a message', () => {
  for (const build of [buildAirContent, buildControlsContent]) {
    for (const settings of [{}, { device: 'ext:dyson:fan:GONE' }, undefined]) {
      const content = build(dysonWith(PURE_INFO), { settings });
      assert.deepEqual(validateWidgetContent(content), []);
      assert.equal(content.components[0].type, 'text');
    }
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
