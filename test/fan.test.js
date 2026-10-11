import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRFLOW,
  FAN_MODES,
  FEATURES,
  buildDevice,
  commandFor,
  featureKeyOf,
  featureKeys,
  statesFromEnvironment,
  statesFromProductState,
} from '../src/devices/fan.js';
import { describeModel } from '../src/dyson/models.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const PURE = describeModel('438');
const FORMALDEHYDE = describeModel('438K');
const HOT_COOL = describeModel('527');
const HUMIDIFY = describeModel('358');
const LINK_HEATER = describeModel('455');

const byKey = (states) => Object.fromEntries(states.map(({ key, value }) => [key, value]));

test('the device is keyed on the serial and carries the model', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(
    gladys,
    { serial: 'NK6-EU-MHA0000A', name: 'Bedroom', productType: '438' },
    PURE,
  );

  assert.equal(device.name, 'Bedroom');
  assert.equal(device.external_id, 'ext:dyson:fan:NK6-EU-MHA0000A');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'DYSON_SERIAL', value: 'NK6-EU-MHA0000A' },
    { name: 'DYSON_PRODUCT_TYPE', value: '438' },
    { name: 'DYSON_MODEL', value: 'Pure Cool' },
  ]);
  assert.ok(
    device.features.every((f) => f.external_id.startsWith('ext:dyson:fan:NK6-EU-MHA0000A:')),
  );
});

test('a device without a name in the account is named after its model', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, { serial: 'X', name: null }, LINK_HEATER);

  assert.equal(device.name, 'Dyson Pure Hot+Cool Link');
});

test('every feature declares min and max, controls have feedback', () => {
  const gladys = createFakeGladys();
  for (const model of [PURE, FORMALDEHYDE, HOT_COOL, HUMIDIFY, LINK_HEATER]) {
    const device = buildDevice(gladys, { serial: 'S', name: 'x' }, model);
    for (const feature of device.features) {
      assert.equal(typeof feature.min, 'number', `${feature.name}: min`);
      assert.equal(typeof feature.max, 'number', `${feature.name}: max`);
      assert.ok(feature.min < feature.max, `${feature.name}: min < max`);
      assert.ok(feature.category && feature.type, `${feature.name}: category and type`);
      assert.equal(feature.has_feedback, !feature.read_only, `${feature.name}: feedback`);
    }
    const ids = device.features.map((f) => f.external_id);
    assert.equal(new Set(ids).size, ids.length, 'unique feature ids');
  }
});

test('the features follow the model', () => {
  assert.ok(!featureKeys(PURE).includes(FEATURES.HEATING));
  assert.ok(!featureKeys(PURE).includes(FEATURES.FORMALDEHYDE));
  assert.ok(featureKeys(PURE).includes(FEATURES.PM25));
  assert.ok(featureKeys(FORMALDEHYDE).includes(FEATURES.FORMALDEHYDE));
  assert.ok(featureKeys(HOT_COOL).includes(FEATURES.TARGET_TEMPERATURE));
  assert.ok(featureKeys(HUMIDIFY).includes(FEATURES.HUMIDIFICATION));
  assert.ok(featureKeys(LINK_HEATER).includes(FEATURES.FILTER));
  assert.ok(!featureKeys(LINK_HEATER).includes(FEATURES.PM25));
});

test('a feature external id gives its key back', () => {
  const gladys = createFakeGladys();
  const id = gladys.externalIds('fan', 'S1').feature(FEATURES.NIGHT_MODE);

  assert.equal(featureKeyOf(gladys, 'S1', id), FEATURES.NIGHT_MODE);
  assert.equal(featureKeyOf(gladys, 'S2', id), null);
});

test('product state of a 2018+ model', () => {
  const states = byKey(
    statesFromProductState(HOT_COOL, {
      fpwr: 'ON',
      auto: 'OFF',
      fnsp: '0007',
      oson: 'OION',
      nmod: 'OFF',
      hmod: 'HEAT',
      hmax: '2950',
      hflr: '0087',
      cflr: 'INV',
    }),
  );

  assert.deepEqual(states, {
    [FEATURES.POWER]: 1,
    [FEATURES.AUTO]: 0,
    [FEATURES.SPEED]: 7,
    [FEATURES.OSCILLATION]: 1,
    [FEATURES.NIGHT_MODE]: 0,
    [FEATURES.FAN_MODE]: 3,
    [FEATURES.HEATING]: 1,
    [FEATURES.TARGET_TEMPERATURE]: 21.9,
    [FEATURES.HEPA_FILTER]: 87,
  });
});

test('an automatic speed publishes no speed, a partial change only what changed', () => {
  assert.deepEqual(byKey(statesFromProductState(PURE, { fnsp: 'AUTO', auto: 'ON' })), {
    [FEATURES.AUTO]: 1,
    [FEATURES.FAN_MODE]: 4,
  });
  assert.deepEqual(byKey(statesFromProductState(PURE, { nmod: 'ON' })), {
    [FEATURES.NIGHT_MODE]: 1,
  });
});

test('product state of a Link model: one key for power and auto', () => {
  assert.deepEqual(
    byKey(statesFromProductState(LINK_HEATER, { fmod: 'AUTO', filf: '2150', hmod: 'OFF' })),
    {
      [FEATURES.POWER]: 1,
      [FEATURES.AUTO]: 1,
      [FEATURES.FILTER]: 2150,
      [FEATURES.FAN_MODE]: 4,
      [FEATURES.HEATING]: 0,
    },
  );
  assert.deepEqual(byKey(statesFromProductState(LINK_HEATER, { fmod: 'OFF' })), {
    [FEATURES.POWER]: 0,
    [FEATURES.AUTO]: 0,
    [FEATURES.FAN_MODE]: 0,
  });
});

test('sensor data of a formaldehyde model', () => {
  assert.deepEqual(
    byKey(
      statesFromEnvironment(FORMALDEHYDE, {
        tact: '2950',
        hact: '0045',
        pm25: '0004',
        pm10: '0006',
        va10: '0012',
        noxl: '0003',
        hcho: '0002',
      }),
    ),
    {
      [FEATURES.TEMPERATURE]: 21.9,
      [FEATURES.HUMIDITY]: 45,
      [FEATURES.PM25]: 4,
      [FEATURES.PM10]: 6,
      [FEATURES.VOC]: 1.2,
      [FEATURES.NO2]: 0.3,
      [FEATURES.FORMALDEHYDE]: 0.002,
    },
  );
});

test('sensors warming up publish nothing; Link models read vact', () => {
  assert.deepEqual(statesFromEnvironment(PURE, { tact: 'OFF', hact: 'OFF', pm25: 'INIT' }), []);
  assert.deepEqual(byKey(statesFromEnvironment(LINK_HEATER, { vact: '0003', pact: '0002' })), {
    [FEATURES.VOC]: 3,
  });
});

test('commands of a 2018+ model', () => {
  assert.deepEqual(commandFor(PURE, FEATURES.POWER, 1), { fpwr: 'ON' });
  assert.deepEqual(commandFor(PURE, FEATURES.POWER, 0), { fpwr: 'OFF' });
  assert.deepEqual(commandFor(PURE, FEATURES.AUTO, 1), { auto: 'ON' });
  assert.deepEqual(commandFor(PURE, FEATURES.SPEED, 4), { fpwr: 'ON', auto: 'OFF', fnsp: '0004' });
  assert.deepEqual(commandFor(PURE, FEATURES.SPEED, 42), {
    fpwr: 'ON',
    auto: 'OFF',
    fnsp: '0010',
  });
  assert.deepEqual(commandFor(PURE, FEATURES.NIGHT_MODE, 1), { nmod: 'ON' });
  assert.deepEqual(commandFor(HOT_COOL, FEATURES.HEATING, 1), { hmod: 'HEAT' });
  assert.deepEqual(commandFor(HOT_COOL, FEATURES.TARGET_TEMPERATURE, 21), { hmax: '2942' });
  assert.deepEqual(commandFor(HOT_COOL, FEATURES.TARGET_TEMPERATURE, 80), { hmax: '3102' });
  assert.deepEqual(commandFor(HUMIDIFY, FEATURES.HUMIDIFICATION, 1), { hume: 'HUMD' });
});

test('oscillation speaks the dialect the device uses', () => {
  assert.deepEqual(commandFor(PURE, FEATURES.OSCILLATION, 1), { oson: 'ON' });
  assert.deepEqual(commandFor(PURE, FEATURES.OSCILLATION, 1, { oson: 'OIOF' }), { oson: 'OION' });
  assert.deepEqual(commandFor(PURE, FEATURES.OSCILLATION, 0, { oson: 'OION' }), { oson: 'OIOF' });
});

test('commands of a Link model', () => {
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.POWER, 1), { fmod: 'FAN' });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.POWER, 0), { fmod: 'OFF' });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.AUTO, 1), { fmod: 'AUTO' });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.AUTO, 0), { fmod: 'FAN' });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.SPEED, 3), { fmod: 'FAN', fnsp: '0003' });
});

test('the fan mode list follows the speed, so the list and the slider agree', () => {
  const modeOf = (model, values) => byKey(statesFromProductState(model, values))[FEATURES.FAN_MODE];

  assert.equal(modeOf(PURE, { fpwr: 'OFF', auto: 'ON', fnsp: '0004' }), FAN_MODES.OFF);
  assert.equal(modeOf(PURE, { fpwr: 'ON', auto: 'ON', fnsp: 'AUTO' }), FAN_MODES.AUTO);
  for (const [speed, mode] of [
    ['0001', FAN_MODES.LOW],
    ['0003', FAN_MODES.LOW],
    ['0004', FAN_MODES.MEDIUM],
    ['0006', FAN_MODES.MEDIUM],
    // 7 already blows hard: "high" from there (forum feedback).
    ['0007', FAN_MODES.HIGH],
    ['0010', FAN_MODES.HIGH],
  ]) {
    assert.equal(modeOf(PURE, { fpwr: 'ON', auto: 'OFF', fnsp: speed }), mode, speed);
  }
  assert.equal(modeOf(LINK_HEATER, { fmod: 'FAN', fnsp: '0009' }), FAN_MODES.HIGH);
  // A speed change alone: the rest of the state comes from what is known.
  const known = { fpwr: 'ON', auto: 'OFF', fnsp: '0002' };
  assert.equal(
    byKey(statesFromProductState(PURE, { fnsp: '0002' }, known))[FEATURES.FAN_MODE],
    FAN_MODES.LOW,
  );
  // Not enough to tell: nothing published.
  assert.equal(modeOf(PURE, { nmod: 'ON' }), undefined);
});

test('a mode of the list is a power, auto or speed order', () => {
  assert.deepEqual(commandFor(PURE, FEATURES.FAN_MODE, FAN_MODES.OFF), { fpwr: 'OFF' });
  assert.deepEqual(commandFor(PURE, FEATURES.FAN_MODE, FAN_MODES.LOW), {
    fpwr: 'ON',
    auto: 'OFF',
    fnsp: '0001',
  });
  assert.deepEqual(commandFor(PURE, FEATURES.FAN_MODE, FAN_MODES.MEDIUM).fnsp, '0005');
  assert.deepEqual(commandFor(PURE, FEATURES.FAN_MODE, FAN_MODES.HIGH).fnsp, '0010');
  assert.deepEqual(commandFor(PURE, FEATURES.FAN_MODE, FAN_MODES.AUTO), {
    fpwr: 'ON',
    auto: 'ON',
  });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.FAN_MODE, FAN_MODES.AUTO), { fmod: 'AUTO' });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.FAN_MODE, FAN_MODES.MEDIUM), {
    fmod: 'FAN',
    fnsp: '0005',
  });
  assert.deepEqual(commandFor(LINK_HEATER, FEATURES.FAN_MODE, FAN_MODES.OFF), { fmod: 'OFF' });
  assert.throws(() => commandFor(PURE, FEATURES.FAN_MODE, 9), /cannot be controlled/);
});

test('airflow direction: the towers only, front is forward', () => {
  assert.ok(featureKeys(PURE).includes(FEATURES.AIRFLOW_DIRECTION));
  assert.ok(!featureKeys(HUMIDIFY).includes(FEATURES.AIRFLOW_DIRECTION));
  assert.ok(!featureKeys(LINK_HEATER).includes(FEATURES.AIRFLOW_DIRECTION));

  const direction = (model, fdir) =>
    byKey(statesFromProductState(model, { fdir }))[FEATURES.AIRFLOW_DIRECTION];
  assert.equal(direction(PURE, 'ON'), AIRFLOW.FORWARD);
  assert.equal(direction(PURE, 'OFF'), AIRFLOW.REVERSE);
  assert.equal(direction(HUMIDIFY, 'ON'), undefined);

  assert.deepEqual(commandFor(PURE, FEATURES.AIRFLOW_DIRECTION, AIRFLOW.FORWARD), { fdir: 'ON' });
  assert.deepEqual(commandFor(PURE, FEATURES.AIRFLOW_DIRECTION, AIRFLOW.REVERSE), { fdir: 'OFF' });
  assert.throws(() => commandFor(HUMIDIFY, FEATURES.AIRFLOW_DIRECTION, 1), /cannot be controlled/);
});

test('fan controls use the Gladys FAN types, drawn with their own icons', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, { serial: 'S', name: 'x' }, PURE);
  const typeOf = (key) => {
    const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
    return `${feature.category}/${feature.type}/${feature.min}-${feature.max}`;
  };

  assert.equal(typeOf(FEATURES.FAN_MODE), 'fan/mode/0-4');
  assert.equal(typeOf(FEATURES.OSCILLATION), 'fan/rock-setting/0-1');
  assert.equal(typeOf(FEATURES.NIGHT_MODE), 'fan/wind-setting/0-1');
  assert.equal(typeOf(FEATURES.AIRFLOW_DIRECTION), 'fan/airflow-direction/0-1');
});

test('a sensor, or a control the model lacks, cannot be commanded', () => {
  assert.throws(() => commandFor(PURE, FEATURES.HEATING, 1), /cannot be controlled/);
  assert.throws(() => commandFor(PURE, FEATURES.TEMPERATURE, 1), /cannot be controlled/);
  assert.throws(() => commandFor(PURE, null, 1), /cannot be controlled/);
});
