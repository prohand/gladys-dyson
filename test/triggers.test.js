import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_TRIGGERS,
  airQualityLevel,
  createTriggerTracker,
} from '../src/capabilities/triggers.js';
import { describeModel } from '../src/dyson/models.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const PURE = describeModel('438');
const DEVICE = { serial: 'S1', externalId: 'ext:dyson:fan:S1' };

test('the worst pollutant decides the air quality level', () => {
  assert.equal(airQualityLevel({}), null);
  assert.equal(airQualityLevel({ pm25: 10, voc: 1 }), 'good');
  assert.equal(airQualityLevel({ pm25: 35 }), 'good');
  assert.equal(airQualityLevel({ pm25: 36 }), 'fair');
  assert.equal(airQualityLevel({ pm25: 10, pm10: 90 }), 'poor');
  assert.equal(airQualityLevel({ pm25: 10, no2: 9.5 }), 'very_poor');
  assert.equal(airQualityLevel({ voc: 4 }), 'fair');
});

test('air quality: the first level is a reference, a change fires once', async () => {
  const gladys = createFakeGladys();
  const changes = [];
  const tracker = createTriggerTracker(gladys, { onLevelChange: (s) => changes.push(s) });

  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0005', va10: '0010' });
  assert.deepEqual(gladys.sceneEvents, []);
  assert.equal(tracker.levelOf('S1'), 'good');

  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0060' });
  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0065' });

  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.AIR_QUALITY_CHANGED,
      data: {
        device: 'ext:dyson:fan:S1',
        level: 'poor',
        previous_level: 'good',
        pm25: 60,
        pm10: null,
        voc: 1,
        no2: null,
      },
    },
  ]);
  assert.deepEqual(changes, ['S1', 'S1']);
});

test('filters: an event when a filter crosses its threshold, not on the first reading', async () => {
  const gladys = createFakeGladys();
  const tracker = createTriggerTracker(gladys);

  await tracker.onProductState(DEVICE, { hflr: '0008' });
  assert.deepEqual(gladys.sceneEvents, [], 'already low at start: no event');

  await tracker.onProductState(DEVICE, { cflr: '0011' });
  await tracker.onProductState(DEVICE, { cflr: '0010' });
  await tracker.onProductState(DEVICE, { cflr: '0009' });
  await tracker.onProductState(DEVICE, { filf: 'INV' });

  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.FILTER_LOW,
      data: { device: 'ext:dyson:fan:S1', filter: 'carbon', remaining: 10 },
    },
  ]);
});

test('connection: the first connection is a reference, then every change fires', async () => {
  const gladys = createFakeGladys();
  const tracker = createTriggerTracker(gladys);
  const status = (transport, degraded = false) => ({ transport, degraded, message: null });

  await tracker.onTransport(DEVICE, status('unreachable'));
  await tracker.onTransport(DEVICE, status('local'));
  assert.deepEqual(gladys.sceneEvents, []);

  await tracker.onTransport(DEVICE, status('unreachable'));
  await tracker.onTransport(DEVICE, status('cloud', true));
  await tracker.onTransport(DEVICE, status('cloud', true));

  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.data),
    [
      {
        device: 'ext:dyson:fan:S1',
        transport: 'unreachable',
        previous_transport: 'local',
        degraded: false,
      },
      {
        device: 'ext:dyson:fan:S1',
        transport: 'cloud',
        previous_transport: 'unreachable',
        degraded: true,
      },
    ],
  );
});

test('a refused scene event never breaks the device', async () => {
  const gladys = createFakeGladys();
  gladys.sceneEventError = new Error('429 Too Many Requests');
  const tracker = createTriggerTracker(gladys);

  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0005' });
  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0099' });

  assert.equal(tracker.levelOf('S1'), 'very_poor');
});

test('forgetting a device resets its references', async () => {
  const gladys = createFakeGladys();
  const tracker = createTriggerTracker(gladys);
  await tracker.onEnvironment(DEVICE, PURE, { pm25: '0005' });

  tracker.forget('S1');

  assert.equal(tracker.levelOf('S1'), null);
});
