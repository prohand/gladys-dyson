import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  NUDGE_MIN_INTERVAL_MS,
  buildAirContent,
  buildControlsContent,
  createWidgetNudger,
  handleWidgetAction,
} from '../src/capabilities/widget.js';
import { describeModel } from '../src/dyson/models.js';
import { createFakeTimers } from './helpers/fakeMqtt.js';

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

test('controls widget of a 2018+ device: fan, air and PM2.5 tiles, settings, four buttons', () => {
  const content = buildControlsContent(dysonWith(PURE_INFO), { settings: { device: ID } });

  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.length, 8, 'the whole budget');
  assert.equal(byType(content, 'gauge')[0].device_feature, feature('speed'));
  assert.deepEqual(
    byType(content, 'value').map((tile) => [tile.label.en, tile.value, tile.color]),
    [
      ['Air quality', { en: 'Poor', fr: 'Mauvaise' }, 'warning'],
      ['PM2.5', undefined, 'info'],
    ],
  );
  assert.equal(byType(content, 'value')[1].device_feature, feature('pm25'));
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => [item.label.en, item.value]),
    [
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
  assert.equal(items[5].color, 'warning', 'a filter under 10 % is a warning');
  assert.deepEqual(
    byType(content, 'button').map((b) => [b.action.key, b.action.params]),
    [
      ['power', { device: ID, value: 0 }],
      ['auto', { device: ID, value: 1 }],
      ['speed_down', { device: ID }],
      ['speed_up', { device: ID }],
    ],
    'actions: the core refetches the widget once the device answered',
  );
});

test('controls widget: the fan tile says off or auto, where the speed is the last manual one', () => {
  const tilesAt = (productState, level = null) =>
    buildControlsContent(dysonWith({ ...PURE_INFO, productState, level }), {
      settings: { device: ID },
    }).components.filter((c) => c.type === 'value' || c.type === 'gauge');

  const off = tilesAt({ fpwr: 'OFF', auto: 'OFF', fnsp: '0003' });
  assert.deepEqual(off[0], {
    type: 'value',
    label: { en: 'Fan', fr: 'Ventilateur' },
    icon: 'power',
    value: { en: 'Off', fr: 'Éteint' },
    color: 'neutral',
  });
  assert.equal(off.length, 2, 'no level yet: fan and PM2.5');
  assert.equal(tilesAt({ fpwr: 'ON', auto: 'ON', fnsp: 'AUTO' })[0].value, 'Auto');
  assert.deepEqual(tilesAt({ fpwr: 'ON', auto: 'OFF', fnsp: '0003' }, 'very_poor')[1].value, {
    en: 'Very poor',
    fr: 'Très mauv.',
  });
  for (const level of ['good', 'fair', 'poor', 'very_poor']) {
    const content = buildControlsContent(dysonWith({ ...PURE_INFO, level }), {
      settings: { device: ID },
    });
    assert.deepEqual(validateWidgetContent(content), [], level);
  }
});

test('controls widget: the oscillation row gives the angle', () => {
  const content = buildControlsContent(
    dysonWith({
      ...PURE_INFO,
      model: describeModel('438'),
      productState: { fpwr: 'ON', oson: 'ON', ancp: 'CUST', osal: '0198', osau: '0243' },
    }),
    { settings: { device: ID } },
  );
  assert.deepEqual(byType(content, 'status')[0].items[0].value, {
    en: 'On · 45°',
    fr: 'Activé · 45°',
  });
});

test('controls widget, "settings" buttons: on/off, oscillation, night mode, airflow', () => {
  const buttonsOf = (info) =>
    byType(
      buildControlsContent(dysonWith(info), { settings: { device: ID, buttons: 'settings' } }),
      'button',
    );

  const buttons = buttonsOf(PURE_INFO);
  assert.deepEqual(validateWidgetContent({ components: buttons }), []);
  const content = buildControlsContent(dysonWith(PURE_INFO), {
    settings: { device: ID, buttons: 'settings' },
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    byType(content, 'status')[0]
      .items.map((item) => item.label.en)
      .slice(0, 2),
    ['Airflow', 'Heating'],
    'the buttons show the oscillation and night mode: no row for them',
  );
  assert.deepEqual(
    buttons.map((b) => [b.label.fr, b.style, b.action.key, b.action.params.value]),
    [
      ['Éteindre', 'secondary', 'power', 0],
      ['Oscillation', 'primary', 'oscillation', 0],
      ['Mode nuit', 'secondary', 'night_mode', 1],
      ["Flux vers l'avant", 'secondary', 'airflow', 0],
    ],
    'a setting that is on is filled, a tap switches it',
  );

  const humidifier = buttonsOf({
    ...PURE_INFO,
    model: describeModel('358'),
    productState: { fpwr: 'ON', auto: 'ON', oson: 'OFF', nmod: 'ON' },
  });
  assert.deepEqual(
    humidifier.map((b) => [b.label.en, b.style, b.action.params.value]),
    [
      ['Turn off', 'secondary', 0],
      ['Oscillation', 'secondary', 1],
      ['Night mode', 'primary', 0],
      ['Auto mode', 'primary', 0],
    ],
    'one-way airflow: the auto mode takes the fourth button',
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
  assert.deepEqual(buttonsAt({ fpwr: 'ON', auto: 'ON', fnsp: 'AUTO' }), [
    'Turn off',
    'Manual mode',
  ]);
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
  assert.deepEqual(byType(controls, 'value')[0].value, { en: 'Off', fr: 'Éteint' });
  const items = byType(controls, 'status')[0].items;
  assert.deepEqual(items[0].value, { en: 'Dyson cloud (fallback)', fr: 'Cloud Dyson (secours)' });
  assert.equal(items[1].value, '300 h');
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

test('the control buttons change the device, from the state at the tap', async () => {
  const commands = [];
  const dyson = {
    async command(device, key, valueOf) {
      if (device !== ID) {
        return false;
      }
      commands.push([key, valueOf({ fpwr: 'ON', auto: 'OFF', fnsp: '0004' })]);
      return true;
    },
  };
  const tap = (actionKey, value) =>
    handleWidgetAction(dyson, {
      actionKey,
      params: value === undefined ? { device: ID } : { device: ID, value },
    });

  assert.equal(await tap('power', 0), undefined, 'no toast: the refetched widget shows it');
  await tap('auto', 1);
  await tap('speed_up');
  await tap('speed_down');
  await tap('oscillation', 1);
  await tap('night_mode', '1');
  await tap('airflow', 1);
  assert.deepEqual(commands, [
    ['power', 0],
    ['auto', 1],
    ['speed', 5],
    ['speed', 3],
    ['oscillation', 1],
    ['night-mode', 1],
    ['airflow-direction', 1],
  ]);

  const unreachable = await handleWidgetAction(dyson, {
    actionKey: 'power',
    params: { device: 'other', value: 1 },
  });
  assert.match(unreachable.fr, /injoignable/);
});

test('a speed step past the ends, or in auto, changes nothing', async () => {
  const valueAt = async (actionKey, fnsp) => {
    let value;
    await handleWidgetAction(
      {
        async command(_device, _key, valueOf) {
          value = valueOf({ fpwr: 'ON', fnsp });
          return true;
        },
      },
      { actionKey, params: { device: ID } },
    );
    return value;
  };
  assert.equal(await valueAt('speed_up', '0010'), null);
  assert.equal(await valueAt('speed_down', '0001'), null);
  assert.equal(await valueAt('speed_up', 'AUTO'), null);
});

test('widget nudges: paced under the core limit, the ones in between held, never lost', () => {
  const timers = createFakeTimers();
  let clock = 1000;
  const sent = [];
  const nudger = createWidgetNudger((key) => sent.push([key, clock]), {
    timers,
    now: () => clock,
  });

  nudger.nudge('dyson_controls');
  assert.deepEqual(sent, [['dyson_controls', 1000]], 'the first nudge goes at once');

  clock += 3000; // a command answered 3 s after a sensor nudge
  nudger.nudge('dyson_controls');
  nudger.nudge('dyson_controls');
  assert.equal(sent.length, 1, 'held: the core would drop it');
  assert.equal(timers.timeouts.size, 1, 'one held nudge for any number of changes');
  assert.equal([...timers.timeouts.values()][0].ms, NUDGE_MIN_INTERVAL_MS - 3000);

  nudger.nudge('dyson_air');
  assert.deepEqual(sent.at(-1), ['dyson_air', 4000], 'each widget key has its own pace');

  clock = 1000 + NUDGE_MIN_INTERVAL_MS;
  timers.runTimeouts(NUDGE_MIN_INTERVAL_MS - 3000);
  assert.deepEqual(sent.at(-1), ['dyson_controls', clock], 'the held nudge is sent at the end');

  clock += NUDGE_MIN_INTERVAL_MS;
  nudger.nudge('dyson_controls');
  assert.deepEqual(sent.at(-1), ['dyson_controls', clock], 'after a quiet period: at once again');

  clock += 1000;
  nudger.nudge('dyson_controls');
  nudger.stop();
  assert.equal(timers.timeouts.size, 0, 'stop drops the held nudges');
});

test('widget nudges: a refused nudge (socket down) never throws', () => {
  const nudger = createWidgetNudger(() => {
    throw new Error('not connected');
  });
  assert.doesNotThrow(() => nudger.nudge('dyson_air'));
});
