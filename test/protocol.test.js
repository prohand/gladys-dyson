import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES,
  buildCommand,
  celsiusToKelvinTenths,
  commandTopic,
  decodeMessage,
  kelvinTenthsToCelsius,
  readNumber,
  statusTopic,
} from '../src/dyson/protocol.js';
import { describeModel } from '../src/dyson/models.js';

test('topics are <product type>/<serial>/...', () => {
  assert.equal(commandTopic('438', 'NK6-EU-MHA0000A'), '438/NK6-EU-MHA0000A/command');
  assert.equal(statusTopic('438', 'NK6-EU-MHA0000A'), '438/NK6-EU-MHA0000A/status/current');
});

test('a request carries the message and the time, a STATE-SET its data too', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');

  assert.deepEqual(JSON.parse(buildCommand(MESSAGES.REQUEST_STATE, undefined, now)), {
    msg: 'REQUEST-CURRENT-STATE',
    time: '2026-10-10T12:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(buildCommand(MESSAGES.SET_STATE, { fpwr: 'ON' }, now)), {
    msg: 'STATE-SET',
    time: '2026-10-10T12:00:00.000Z',
    'mode-reason': 'LAPP',
    data: { fpwr: 'ON' },
  });
});

test('a CURRENT-STATE gives its values, a STATE-CHANGE the new value of each pair', () => {
  assert.deepEqual(
    decodeMessage(
      JSON.stringify({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON', fnsp: '0004' } }),
    ),
    { kind: 'state', values: { fpwr: 'ON', fnsp: '0004' } },
  );
  assert.deepEqual(
    decodeMessage(
      Buffer.from(
        JSON.stringify({
          msg: 'STATE-CHANGE',
          'product-state': { fpwr: ['OFF', 'ON'], fnsp: ['0004', '0007'] },
        }),
      ),
    ),
    { kind: 'state', values: { fpwr: 'ON', fnsp: '0007' } },
  );
});

test('sensor data is decoded, other messages and garbage are ignored', () => {
  assert.deepEqual(
    decodeMessage(
      JSON.stringify({ msg: 'ENVIRONMENTAL-CURRENT-SENSOR-DATA', data: { tact: '2950' } }),
    ),
    { kind: 'environment', values: { tact: '2950' } },
  );
  assert.equal(decodeMessage(JSON.stringify({ msg: 'CURRENT-FAULTS' })), null);
  assert.equal(decodeMessage('not json'), null);
  assert.equal(decodeMessage('null'), null);
});

test('numbers are read, sensor placeholders are "no reading"', () => {
  assert.equal(readNumber('0045'), 45);
  assert.equal(readNumber('0004', 10), 0.4);
  assert.equal(readNumber('OFF'), null);
  assert.equal(readNumber('INIT'), null);
  assert.equal(readNumber(undefined), null);
});

test('temperatures go between tenths of kelvin and °C', () => {
  assert.equal(kelvinTenthsToCelsius('2950'), 21.9);
  assert.equal(kelvinTenthsToCelsius('OFF'), null);
  assert.equal(celsiusToKelvinTenths(21), '2942');
  assert.equal(celsiusToKelvinTenths(1), '2742');
});

test('product types: families, revisions, and what is not a fan', () => {
  assert.deepEqual(describeModel('438K'), {
    productType: '438K',
    name: 'Purifier Cool Formaldehyde',
    protocol: 'pure',
    heater: false,
    humidifier: false,
    airflow: true,
    angles: true,
    formaldehyde: true,
    picture: 'tower',
  });
  assert.equal(describeModel('455').protocol, 'link');
  assert.equal(describeModel('455').heater, true);
  assert.equal(describeModel('527e').heater, true);
  assert.equal(describeModel('358K').humidifier, true);
  // Front / back airflow: the towers and desk fans only.
  assert.equal(describeModel('527E').airflow, true);
  assert.equal(describeModel('358').airflow, false);
  assert.equal(describeModel('664').airflow, false);
  assert.equal(describeModel('475').airflow, false);
  // Oscillation range: the towers only.
  assert.equal(describeModel('438').angles, true);
  assert.equal(describeModel('527E').angles, true);
  assert.equal(describeModel('520').angles, false);
  // The silhouette of the controls widget picture.
  assert.equal(describeModel('455').picture, 'hot-cool');
  assert.equal(describeModel('469').picture, 'desk');
  assert.equal(describeModel('358E').picture, 'humidifier');
  assert.equal(describeModel('664B').picture, 'big-quiet');
  assert.equal(describeModel('358').angles, false);
  assert.equal(describeModel('664').angles, false);
  assert.equal(describeModel('475').angles, false);
  // Unknown revision of a known family.
  assert.equal(describeModel('664B').name, 'Purifier Big+Quiet');
  // Robot vacuum, light, nothing.
  assert.equal(describeModel('276'), null);
  assert.equal(describeModel('552'), null);
  assert.equal(describeModel(''), null);
});
