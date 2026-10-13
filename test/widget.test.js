import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import {
  BUTTON_SETS,
  NUDGE_MIN_INTERVAL_MS,
  PICTURE_KEYS,
  SLEEP_TIMER_FIELD,
  WIDGET_ACTIONS,
  buildAirContent,
  buildControlsContent,
  createWidgetNudger,
  handleWidgetAction,
  widgetImage,
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
    [
      { en: 'Poor', fr: 'Mauvaise', de: 'Schlecht', es: 'Mala' },
      '0.02 mg/m³',
      { en: 'Local', fr: 'Locale', de: 'Lokal', es: 'Local' },
      '8 %',
      '50 %',
    ],
    'formaldehyde finds no tile: it goes to the status list; the filters follow the connection',
  );
  assert.deepEqual(
    items.slice(3).map((item) => [item.label.en, item.color]),
    [
      ['HEPA filter', 'warning'],
      ['Carbon filter', 'neutral'],
    ],
    'a filter under 10 % is a warning',
  );
  assert.deepEqual(
    byType(content, 'button').map((b) => b.action.key),
    ['refresh'],
  );
});

test('controls widget of a 2018+ device: the fan tile, settings, four buttons, no air reading', () => {
  const content = buildControlsContent(dysonWith(PURE_INFO), { settings: { device: ID } });

  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.length, 7, 'fan tile, picture, status list, four buttons');
  assert.equal(byType(content, 'gauge')[0].device_feature, feature('speed'));
  assert.deepEqual(byType(content, 'value'), [], 'no air quality nor PM2.5: controls only');
  const items = byType(content, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => [item.label.en, item.value]),
    [
      ['Oscillation', { en: 'On', fr: 'Activé', de: 'Ein', es: 'Activado' }],
      ['Night mode', { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' }],
      ['Airflow', { en: 'Back', fr: 'Arrière', de: 'Hinten', es: 'Atrás' }],
      ['Heating', '21.9 °C'],
      ['Connection', { en: 'Local', fr: 'Locale', de: 'Lokal', es: 'Local' }],
      ['Sleep timer', '30 min'],
    ],
    'the filters are in the air widget',
  );
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

test('controls widget: a drawing of the product, air lines while the fan runs', () => {
  const pictureOf = (info, settings = {}) =>
    byType(
      buildControlsContent(dysonWith(info), { settings: { device: ID, ...settings } }),
      'image',
    );

  assert.deepEqual(pictureOf(PURE_INFO), [
    {
      type: 'image',
      key: 'dyson-hot-cool-on-v1',
      alt: 'Dyson Purifier Hot+Cool Formaldehyde',
      fit: 'contain',
    },
  ]);
  const off = { ...PURE_INFO, productState: { ...PURE_INFO.productState, fpwr: 'OFF' } };
  assert.equal(pictureOf(off)[0].key, 'dyson-hot-cool-off-v1');
  const lost = { ...PURE_INFO, status: { transport: 'unreachable', degraded: false } };
  assert.equal(pictureOf(lost)[0].key, 'dyson-hot-cool-off-v1', 'not known to run');
  const link = { ...PURE_INFO, model: describeModel('475'), productState: { fmod: 'FAN' } };
  assert.equal(pictureOf(link)[0].key, 'dyson-tower-on-v1');
  assert.deepEqual(pictureOf(PURE_INFO, { picture: false }), [], 'the setting hides it');
  assert.equal(pictureOf(PURE_INFO, { picture: true }).length, 1);
});

test('the pictures: every key served, as the core accepts it; nothing else', async () => {
  assert.equal(PICTURE_KEYS.length, 10, 'five silhouettes, fan on and off');
  for (const key of PICTURE_KEYS) {
    assert.match(key, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.deepEqual(validateWidgetImage(await widgetImage(key)), [], key);
  }
  for (const model of ['455', '469', '475', '438', '520', '527', '358', '664']) {
    const picture = describeModel(model).picture;
    assert.ok(PICTURE_KEYS.includes(`dyson-${picture}-on-v1`), model);
  }
  await assert.rejects(widgetImage('dyson-../../etc/passwd-on-v1'), /Unknown widget image/);
  await assert.rejects(widgetImage('cleaning-map'), /Unknown widget image/);
});

test('controls widget: the fan tile says off or auto, where the speed is the last manual one', () => {
  const tilesAt = (productState, level = null) =>
    buildControlsContent(dysonWith({ ...PURE_INFO, productState, level }), {
      settings: { device: ID },
    }).components.filter((c) => c.type === 'value' || c.type === 'gauge');

  const off = tilesAt({ fpwr: 'OFF', auto: 'OFF', fnsp: '0003' });
  assert.deepEqual(off[0], {
    type: 'value',
    label: { en: 'Fan', fr: 'Ventilateur', de: 'Ventilator', es: 'Ventilador' },
    icon: 'power',
    value: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
    color: 'neutral',
  });
  assert.equal(off.length, 1, 'the fan tile only');
  assert.equal(tilesAt({ fpwr: 'ON', auto: 'ON', fnsp: 'AUTO' })[0].value, 'Auto');
  assert.equal(tilesAt({ fpwr: 'ON', auto: 'OFF', fnsp: '0003' }, 'very_poor').length, 1);
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
    de: 'Ein · 45°',
    es: 'Activado · 45°',
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
  const airItems = byType(air, 'status')[0].items;
  assert.deepEqual(airItems[0].value, {
    en: 'Dyson cloud (fallback)',
    fr: 'Cloud Dyson (secours)',
    de: 'Dyson-Cloud (Ersatzweg)',
    es: 'Nube de Dyson (respaldo)',
  });
  assert.equal(airItems[1].value, '300 h', 'the Link filter, in hours');

  const controls = buildControlsContent(dysonWith(info), { settings: { device: ID } });
  assert.deepEqual(validateWidgetContent(controls), []);
  assert.deepEqual(byType(controls, 'value')[0].value, {
    en: 'Off',
    fr: 'Éteint',
    de: 'Aus',
    es: 'Apagado',
  });
  const items = byType(controls, 'status')[0].items;
  assert.deepEqual(
    items.map((item) => item.value),
    [
      {
        en: 'Dyson cloud (fallback)',
        fr: 'Cloud Dyson (secours)',
        de: 'Dyson-Cloud (Ersatzweg)',
        es: 'Nube de Dyson (respaldo)',
      },
    ],
  );
  assert.deepEqual(byType(controls, 'button')[0].label, {
    en: 'Turn on',
    fr: 'Allumer',
    de: 'Einschalten',
    es: 'Encender',
  });
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
  assert.deepEqual(toast, {
    en: 'Readings requested.',
    fr: 'Relevés demandés.',
    de: 'Messwerte angefordert.',
    es: 'Lecturas solicitadas.',
  });
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

// --- The "night" buttons and the sleep timer form (Gladys 5.2+) ------------------

const nightButtonsOf = (productState) =>
  buildControlsContent(dysonWith({ ...PURE_INFO, productState }), {
    settings: { device: ID, buttons: BUTTON_SETS.NIGHT },
  });

test('controls widget, "night" buttons: on/off, night mode, the sleep timer form', () => {
  const content = nightButtonsOf(PURE_INFO.productState);
  assert.deepEqual(validateWidgetContent(content), []);
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.style]),
    [
      ['power', 'secondary'],
      ['night_mode', 'secondary'],
      ['sleep_timer', 'primary'],
    ],
  );
  const [minutes] = buttons[2].action.fields;
  assert.deepEqual(
    {
      key: minutes.key,
      type: minutes.type,
      min: minutes.min,
      max: minutes.max,
      default: minutes.default,
    },
    { key: SLEEP_TIMER_FIELD, type: 'number', min: 0, max: 540, default: 30 },
    'pre-filled with the timer that runs',
  );
  assert.deepEqual(buttons[2].action.params, { device: ID });

  const idle = nightButtonsOf({ ...PURE_INFO.productState, sltm: 'OFF', nmod: 'ON' });
  assert.deepEqual(validateWidgetContent(idle), []);
  const [, night, timer] = idle.components.filter((c) => c.type === 'button');
  assert.deepEqual([night.style, night.action.params.value], ['primary', 0]);
  assert.equal(timer.style, 'secondary');
  assert.equal(timer.action.fields[0].default, 60, 'the scene action default');
});

test('the sleep timer form goes through the set_sleep_timer scene action', async () => {
  const sent = [];
  const dyson = {
    deviceInfo: (id) => (id === ID ? PURE_INFO : null),
    async sendToDevice(device, data) {
      sent.push([device, data]);
      return { sent: device === ID, transport: 'local' };
    },
  };
  const tap = (values, device = ID) =>
    handleWidgetAction(dyson, {
      actionKey: WIDGET_ACTIONS.SLEEP_TIMER,
      params: { device },
      values,
    });

  assert.deepEqual(await tap({ [SLEEP_TIMER_FIELD]: 45 }), {
    en: 'Sleep timer: 45 min.',
    fr: 'Minuterie : 45 min.',
    de: 'Ausschalt-Timer: 45 Min.',
    es: 'Temporizador de apagado: 45 min.',
  });
  assert.deepEqual(await tap({ [SLEEP_TIMER_FIELD]: 0 }), {
    en: 'Sleep timer cancelled.',
    fr: 'Minuterie annulée.',
    de: 'Ausschalt-Timer abgebrochen.',
    es: 'Temporizador de apagado cancelado.',
  });
  assert.deepEqual(sent, [
    [ID, { sltm: '0045' }],
    [ID, { sltm: 'OFF' }],
  ]);
  assert.match((await tap({ [SLEEP_TIMER_FIELD]: 30 }, 'other')).fr, /injoignable/);
});

test('a core that dropped the form gets an explanation, nothing is sent', async () => {
  const sent = [];
  const dyson = {
    deviceInfo: () => PURE_INFO,
    async sendToDevice(device, data) {
      sent.push(data);
      return { sent: true, transport: 'local' };
    },
  };
  for (const values of [undefined, {}, { [SLEEP_TIMER_FIELD]: 'abc' }]) {
    const message = await handleWidgetAction(dyson, {
      actionKey: WIDGET_ACTIONS.SLEEP_TIMER,
      params: { device: ID },
      values,
    });
    assert.match(message.en, /Gladys 5\.2/);
    assert.match(message.fr, /Gladys 5\.2/);
  }
  assert.deepEqual(sent, []);
});

// The core renders a widget in its reader's language, English as fallback:
// every text the integration writes carries the four Gladys languages.
const LANGUAGES = ['en', 'fr', 'de', 'es'];
function multiLanguageTexts(node) {
  if (Array.isArray(node)) {
    return node.flatMap(multiLanguageTexts);
  }
  if (node && typeof node === 'object') {
    return typeof node.en === 'string' ? [node] : Object.values(node).flatMap(multiLanguageTexts);
  }
  return [];
}

test('every widget text is in English, French, German and Spanish', async () => {
  const link = { ...PURE_INFO, model: describeModel('475'), productState: { fmod: 'FAN' } };
  const contents = [
    buildAirContent(dysonWith(PURE_INFO), { settings: { device: ID } }),
    buildAirContent(dysonWith(link), { settings: { device: ID } }),
    buildAirContent(dysonWith(PURE_INFO), { settings: {} }),
    buildAirContent(dysonWith(PURE_INFO), { settings: { device: 'other' } }),
    ...Object.values(BUTTON_SETS).map((buttons) =>
      buildControlsContent(dysonWith(PURE_INFO), { settings: { device: ID, buttons } }),
    ),
    buildControlsContent(
      dysonWith({ ...PURE_INFO, status: { transport: 'cloud', degraded: true } }),
      { settings: { device: ID } },
    ),
  ];
  const toasts = [
    await handleWidgetAction(dysonWith(PURE_INFO), {
      actionKey: WIDGET_ACTIONS.REFRESH,
      params: { device: ID },
    }),
    await handleWidgetAction(dysonWith(PURE_INFO), {
      actionKey: WIDGET_ACTIONS.REFRESH,
      params: { device: 'other' },
    }),
    await handleWidgetAction(dysonWith(PURE_INFO), {
      actionKey: WIDGET_ACTIONS.SLEEP_TIMER,
      params: { device: ID },
    }),
  ];
  const texts = multiLanguageTexts([...contents, ...toasts]);
  assert.ok(texts.length > 40, 'the walk finds the texts');
  for (const text of texts) {
    assert.deepEqual(Object.keys(text), LANGUAGES, JSON.stringify(text));
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, JSON.stringify(text));
    }
  }
  for (const content of contents) {
    assert.deepEqual(validateWidgetContent(content), [], 'every language within the bounds');
  }
});
