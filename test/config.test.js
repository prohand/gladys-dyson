import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  languageOfCountry,
  normalizeConfig,
  parseBareHosts,
  parseDeviceHosts,
} from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  const config = normalizeConfig();

  assert.equal(config.email, '');
  assert.equal(config.password, '');
  assert.equal(config.country, DEFAULT_CONFIG.country);
  assert.equal(config.culture, 'fr-FR');
  assert.equal(config.refresh_interval, DEFAULT_CONFIG.refresh_interval);
  assert.equal(config.preferLocal, true);
  assert.equal(config.hosts.size, 0);
});

test('the e-mail is trimmed and lower-cased, the password kept as typed', () => {
  const config = normalizeConfig({ email: '  Me@Example.COM ', password: ' Pa ss ' });

  assert.equal(config.email, 'me@example.com');
  assert.equal(config.password, ' Pa ss ');
});

test('the country is a two-letter code, upper-cased, FR when unreadable', () => {
  assert.equal(normalizeConfig({ country: 'gb' }).country, 'GB');
  assert.equal(normalizeConfig({ country: 'gb' }).culture, 'en-GB');
  assert.equal(normalizeConfig({ country: 'be' }).culture, 'fr-BE');
  assert.equal(normalizeConfig({ country: 'be' }).language, 'fr');
  assert.equal(normalizeConfig({ country: 'gb' }).language, 'en');
  assert.equal(normalizeConfig({ country: 'de' }).culture, 'de-DE');
  assert.equal(normalizeConfig({ country: 'es' }).culture, 'es-ES');
  assert.equal(normalizeConfig({ country: 'France' }).country, 'FR');
  assert.equal(normalizeConfig({ country: '' }).country, 'FR');
});

test('the refresh interval is clamped to 15..3600 seconds', () => {
  assert.equal(normalizeConfig({ refresh_interval: 5 }).refresh_interval, 15);
  assert.equal(normalizeConfig({ refresh_interval: 99999 }).refresh_interval, 3600);
  assert.equal(normalizeConfig({ refresh_interval: '120' }).refresh_interval, 120);
  assert.equal(normalizeConfig({ refresh_interval: 'abc' }).refresh_interval, 60);
  assert.equal(normalizeConfig({ refresh_interval: '' }).refresh_interval, 60);
});

test('only an explicit false turns the local preference off', () => {
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).preferLocal, false);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: true }).preferLocal, true);
  assert.equal(normalizeConfig({}).preferLocal, true);
});

test('device addresses are read as serial=host pairs', () => {
  const hosts = parseDeviceHosts(
    'nk6-eu-mha0000a=192.168.1.20, AB1-EU-XYZ1234B=dyson.lan;\nbroken entry =1.2.3.4 x=$(rm)',
  );

  assert.deepEqual(
    [...hosts],
    [
      ['NK6-EU-MHA0000A', '192.168.1.20'],
      ['AB1-EU-XYZ1234B', 'dyson.lan'],
    ],
  );
  assert.equal(parseDeviceHosts('').size, 0);
  assert.equal(parseDeviceHosts(undefined).size, 0);
});

test('addresses typed without a serial are kept apart', () => {
  assert.deepEqual(parseBareHosts(' 192.168.1.20 '), ['192.168.1.20']);
  assert.deepEqual(parseBareHosts('dyson.lan, NK6-EU-MHA0000A=192.168.1.20'), ['dyson.lan']);
  assert.deepEqual(parseBareHosts('NK6-EU-MHA0000A'), [], 'a serial alone is not an address');
  assert.deepEqual(parseBareHosts('$(rm) 1.2.3.4;x'), ['1.2.3.4']);
  assert.deepEqual(normalizeConfig({ device_hosts: '10.0.0.5' }).bareHosts, ['10.0.0.5']);
  assert.equal(normalizeConfig({ device_hosts: '10.0.0.5' }).hosts.size, 0);
});

test('the language of the account country: French, German, Spanish, else English', () => {
  for (const country of ['FR', 'BE', 'CH', 'LU', 'MC']) {
    assert.equal(languageOfCountry(country), 'fr', country);
  }
  for (const country of ['DE', 'AT', 'LI']) {
    assert.equal(languageOfCountry(country), 'de', country);
  }
  for (const country of ['ES', 'MX', 'AR', 'CO']) {
    assert.equal(languageOfCountry(country), 'es', country);
  }
  for (const country of ['GB', 'US', 'IT', 'NL', 'JP']) {
    assert.equal(languageOfCountry(country), 'en', country);
  }
  assert.equal(normalizeConfig({ country: 'at' }).language, 'de');
  assert.equal(normalizeConfig({ country: 'mx' }).language, 'es');
});
