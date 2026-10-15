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
  hasFormaldehydeReading,
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

test('feature names in the language of the account country, English by default', () => {
  const gladys = createFakeGladys();
  const names = (language) =>
    Object.fromEntries(
      buildDevice(gladys, { serial: 'S', name: 'x' }, PURE, language).features.map((f) => [
        featureKeyOf(gladys, 'S', f.external_id),
        f.name,
      ]),
    );

  const fr = names('fr');
  assert.equal(fr['night-mode'], 'Mode nuit');
  assert.equal(fr['oscillation-angle'], "Angle d'oscillation");
  assert.equal(fr['hepa-filter'], 'Durée de vie filtre HEPA');
  assert.equal(names()['night-mode'], 'Night mode');
  assert.equal(names('de')['night-mode'], 'Nachtmodus');
  assert.equal(names('es')['night-mode'], 'Modo nocturno');
  assert.equal(names('it')['night-mode'], 'Night mode', 'any other language: English');
  const all = ['en', 'fr', 'de', 'es'].flatMap((language) => Object.entries(names(language)));
  for (const [key, name] of all) {
    assert.equal(typeof name, 'string', key);
    assert.ok(name.length > 0, key);
  }
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
      [FEATURES.VOC]: 1,
      [FEATURES.NO2]: 0,
      [FEATURES.FORMALDEHYDE]: 0.002,
    },
  );
});

test('particles and formaldehyde: the fields the Dyson app shows win', () => {
  // A 438 sends both pairs: p25r / p10r are what the app (and Matter) show,
  // pm25 / pm10 read differently (here PM2.5 above PM10).
  assert.deepEqual(
    byKey(
      statesFromEnvironment(FORMALDEHYDE, {
        pm25: '0025',
        pm10: '0020',
        p25r: '0024',
        p10r: '0029',
        hcho: '0002',
        hchr: '0005',
      }),
    ),
    {
      [FEATURES.PM25]: 24,
      [FEATURES.PM10]: 29,
      [FEATURES.FORMALDEHYDE]: 0.005,
    },
  );
  // A new field still warming up is no reading, not a reason to fall back.
  assert.deepEqual(statesFromEnvironment(PURE, { p25r: 'INIT', pm25: '0025' }), []);
});

test('VOC and NO2: the index of the Dyson app, truncated', () => {
  assert.deepEqual(byKey(statesFromEnvironment(PURE, { va10: '0004', noxl: '0019' })), {
    [FEATURES.VOC]: 0,
    [FEATURES.NO2]: 1,
  });
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

test('fan lists use the Gladys FAN types, oscillation and night mode are switches', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, { serial: 'S', name: 'x' }, PURE);
  const typeOf = (key) => {
    const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
    return `${feature.category}/${feature.type}/${feature.min}-${feature.max}`;
  };

  assert.equal(typeOf(FEATURES.FAN_MODE), 'fan/mode/0-4');
  assert.equal(typeOf(FEATURES.OSCILLATION), 'switch/binary/0-1');
  assert.equal(typeOf(FEATURES.NIGHT_MODE), 'switch/binary/0-1');
  assert.equal(typeOf(FEATURES.AIRFLOW_DIRECTION), 'fan/airflow-direction/0-1');
  assert.equal(typeOf(FEATURES.OSCILLATION_ANGLE), 'text/select/0-350');
});

// The category / type pairs Gladys 5.1 has a label and an icon for: any other
// shows as an empty chip in the Discover tab.
const KNOWN_TYPES = new Set([
  'switch/binary',
  'fan/mode',
  'fan/speed',
  'fan/airflow-direction',
  'text/select',
  'thermostat/target-temperature',
  'temperature-sensor/decimal',
  'humidity-sensor/decimal',
  'pm25-sensor/decimal',
  'pm10-sensor/decimal',
  'voc-index-sensor/integer',
  'no2-sensor/decimal',
  'formaldehyd-sensor/decimal',
  'maintenance/life-remaining',
]);

test('every feature has a category / type Gladys labels', () => {
  const gladys = createFakeGladys();
  for (const model of [PURE, FORMALDEHYDE, HOT_COOL, HUMIDIFY, LINK_HEATER]) {
    for (const feature of buildDevice(gladys, { serial: 'S', name: 'x' }, model).features) {
      const type = `${feature.category}/${feature.type}`;
      assert.ok(KNOWN_TYPES.has(type), `${feature.name}: ${type}`);
    }
  }
});

test('oscillation angle: the towers only, four options of the Dyson app', () => {
  const gladys = createFakeGladys();
  const angle = buildDevice(gladys, { serial: 'S', name: 'x' }, PURE).features.find((f) =>
    f.external_id.endsWith(':oscillation-angle'),
  );
  assert.deepEqual(angle.supported_options, [
    { value: '45', label: '45°' },
    { value: '90', label: '90°' },
    { value: '180', label: '180°' },
    { value: '350', label: '350°' },
  ]);
  assert.equal(angle.keep_history, false);
  assert.ok(!featureKeys(HUMIDIFY).includes(FEATURES.OSCILLATION_ANGLE));
  assert.ok(!featureKeys(LINK_HEATER).includes(FEATURES.OSCILLATION_ANGLE));
  assert.ok(featureKeys(HOT_COOL).includes(FEATURES.OSCILLATION_ANGLE));
});

test('oscillation angle command: a range of that width around the current centre', () => {
  // The app's 45° on a 438 centred on 220: 0198-0243.
  assert.deepEqual(
    commandFor(PURE, FEATURES.OSCILLATION_ANGLE, '90', { oson: 'ON', osal: '0198', osau: '0243' }),
    { oson: 'ON', ancp: 'CUST', osal: '0176', osau: '0266' },
  );
  // Nothing known: around the front (180).
  assert.deepEqual(commandFor(PURE, FEATURES.OSCILLATION_ANGLE, '45'), {
    oson: 'ON',
    ancp: 'CUST',
    osal: '0158',
    osau: '0203',
  });
  // Clamped to 5..355, 350 is the whole range; the OION dialect is kept.
  assert.deepEqual(
    commandFor(PURE, FEATURES.OSCILLATION_ANGLE, '180', {
      oson: 'OIOF',
      osal: '0005',
      osau: '0050',
    }),
    { oson: 'OION', ancp: 'CUST', osal: '0005', osau: '0185' },
  );
  assert.deepEqual(commandFor(PURE, FEATURES.OSCILLATION_ANGLE, '350', {}), {
    oson: 'ON',
    ancp: 'CUST',
    osal: '0005',
    osau: '0355',
  });
  assert.throws(() => commandFor(PURE, FEATURES.OSCILLATION_ANGLE, '60'), /cannot be controlled/);
  assert.throws(
    () => commandFor(HUMIDIFY, FEATURES.OSCILLATION_ANGLE, '45'),
    /cannot be controlled/,
  );
});

test('oscillation angle read back: the ancp preset wins, else the width', () => {
  const angleOf = (values) =>
    statesFromProductState(PURE, values).find((s) => s.key === FEATURES.OSCILLATION_ANGLE);

  // The remote leaves an old range next to its preset.
  assert.deepEqual(angleOf({ ancp: '0350', osal: '0190', osau: '0235' }), {
    key: FEATURES.OSCILLATION_ANGLE,
    text: '350',
  });
  assert.equal(angleOf({ ancp: 'CUST', osal: '0198', osau: '0243' }).text, '45');
  assert.equal(angleOf({ ancp: 'CUST', osal: '0005', osau: '0355' }).text, '350');
  // Another width: no option to show.
  assert.equal(angleOf({ ancp: 'CUST', osal: '0100', osau: '0200' }), undefined);
  // A change that does not touch the range publishes no angle.
  assert.equal(angleOf({ nmod: 'ON' }), undefined);
  // The Link models have no range.
  assert.equal(
    statesFromProductState(LINK_HEATER, { osal: '0100', osau: '0145' }).some(
      (s) => s.key === FEATURES.OSCILLATION_ANGLE,
    ),
    false,
  );
});

test('a sensor, or a control the model lacks, cannot be commanded', () => {
  assert.throws(() => commandFor(PURE, FEATURES.HEATING, 1), /cannot be controlled/);
  assert.throws(() => commandFor(PURE, FEATURES.TEMPERATURE, 1), /cannot be controlled/);
  assert.throws(() => commandFor(PURE, null, 1), /cannot be controlled/);
});

test('a formaldehyde reading is a number in hchr or hcho, not INIT or NONE', () => {
  assert.equal(hasFormaldehydeReading({ hchr: '0005' }), true);
  assert.equal(hasFormaldehydeReading({ hcho: '0002' }), true);
  assert.equal(hasFormaldehydeReading({ hchr: 'INIT' }), false);
  assert.equal(hasFormaldehydeReading({ hchr: 'NONE', hcho: 'NONE' }), false);
  assert.equal(hasFormaldehydeReading({ p25r: '0004' }), false);
});
