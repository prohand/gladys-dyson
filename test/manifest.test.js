// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync,
// and catch the store rules that are easiest to miss before a release.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  SCENE_ACTIONS,
  SLEEP_TIMER_DEFAULT_MINUTES,
  SLEEP_TIMER_MAX_MINUTES,
} from '../src/capabilities/scenes.js';
import { SCENE_TRIGGERS, createTriggerTracker } from '../src/capabilities/triggers.js';
import {
  BUTTON_SETS,
  CONTROLS_WIDGET,
  SLEEP_TIMER_FIELD,
  WIDGETS,
  WIDGET_ACTIONS,
  WIDGET_CONTENT,
} from '../src/capabilities/widget.js';
import { describeModel } from '../src/dyson/models.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const allFields = [
  ...manifest.config_schema,
  ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
  ...(manifest.scene_triggers ?? []).flatMap((trigger) => trigger.fields ?? []),
  ...(manifest.scene_actions ?? []).flatMap((action) => action.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The store schema is the admission authority: a field type outside this
// list gets the integration rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

// The catalog shelves the store indexes (integration-store src/constants.js).
const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('every manifest action is registered in index.js, and only those', () => {
  const declared = (manifest.actions ?? []).map((action) => action.key).sort();
  const registered = [...indexSource.matchAll(/onAction\('([a-z0-9_]+)'/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(registered, declared);
});

test('every field uses a type the store accepts', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.type === 'secret') {
      assert.equal(field.default, undefined, `secret "${field.key}" cannot have a default`);
    }
  }
});

test('field placeholders are multi-language objects, on text and number fields only', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs English`);
    assert.ok(
      ['string', 'number', 'secret'].includes(field.type),
      `field "${field.key}": a ${field.type} field cannot have a placeholder`,
    );
  }
});

// Every language of the Gladys interface: the core shows `value[userLanguage]`,
// else English, so a missing language falls back without failing.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Every multi-language object of the manifest, with its path. */
function multiLanguageTexts(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => multiLanguageTexts(item, `${path}[${index}]`));
  }
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      return [{ path, text: node }];
    }
    return Object.entries(node).flatMap(([key, value]) =>
      multiLanguageTexts(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

test('every text is in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, 'the walk finds the texts');
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text), LANGUAGES, `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
  // The fields the store reads as texts are all multi-language objects.
  const declarations = [
    ...allFields,
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((trigger) => trigger.variables ?? []),
    ...(manifest.scene_actions ?? []),
    ...(manifest.scene_actions ?? []).flatMap((action) => action.outputs ?? []),
    ...(manifest.widgets ?? []),
  ];
  for (const field of declarations) {
    for (const text of ['label', 'description', 'placeholder']) {
      if (field[text] !== undefined) {
        assert.equal(typeof field[text].en, 'string', `"${field.key}".${text} is multi-language`);
      }
    }
  }
});

test('every language fits the store length limits', () => {
  const within = (text, min, max, path) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${path}.${language}: ${length} characters`);
    }
  };
  for (const field of manifest.config_schema.filter((f) => f.type === 'section')) {
    within(field.description, 1, 1000, `section ${field.key}`);
  }
  for (const widget of manifest.widgets ?? []) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
});

test('the catalog name and description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.deepEqual(Object.keys(manifest.description), LANGUAGES);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('every stored config key is known by the code, and the other way round', () => {
  const stored = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(stored.sort(), Object.keys(DEFAULT_CONFIG).sort());
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}": no placeholder`);
    for (const text of Object.values(section.description ?? {})) {
      assert.ok(text.length <= 1000, `section "${section.key}": 1000 characters at most`);
    }
  }
});

test('the categories stay inside the vocabulary the store indexes', () => {
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3, '1 to 3 categories');
  assert.equal(new Set(categories).size, categories.length, 'categories must be unique');
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    const { length } = keyword.trim();
    assert.ok(length >= 2 && length <= 30, `keyword "${keyword}": ${length} characters`);
  }
});

test('Dyson sells worldwide: no country restriction', () => {
  assert.equal(manifest.countries, undefined);
});

test('the Gladys floor covers every field the manifest declares', () => {
  // Older cores reject a manifest field they do not know: `categories` needs
  // 4.86, the widgets and scenes 5.1; the sleep timer FORM of the controls
  // widget needs 5.2 (an older core drops it and runs the action without
  // `values`); `keywords`, `countries` and `music` need 5.3.
  assert.ok(WIDGET_ACTIONS.SLEEP_TIMER);
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 2), `got ${manifest.gladys_version}`);
  if (manifest.keywords || manifest.countries || manifest.music) {
    assert.ok(major > 5 || (major === 5 && minor >= 3), `got ${manifest.gladys_version}`);
  }
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.match(indexSource, /\{ actionKey, params, values \}/, 'index.js relays the form');
});

test('the sleep timer form and the scene action take the same minutes', () => {
  const minutes = manifest.scene_actions
    .find((action) => action.key === 'set_sleep_timer')
    .fields.find((field) => field.key === SLEEP_TIMER_FIELD);
  assert.equal(minutes.min, 0);
  assert.equal(minutes.max, SLEEP_TIMER_MAX_MINUTES);
  assert.equal(minutes.default, SLEEP_TIMER_DEFAULT_MINUTES);
});

test('both transports are declared: local first, Dyson cloud as the fallback', () => {
  // Both declared -> Gladys shows the "Prefer the local connection" toggle,
  // read by the code as GLADYS_PREFER_LOCAL.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-dyson:${manifest.version}`);
});

test('every scene action has a handler, and every handler a declaration', () => {
  assert.deepEqual(
    (manifest.scene_actions ?? []).map((action) => action.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
  assert.match(indexSource, /onSceneAction\(actionKey/);
  for (const action of manifest.scene_actions) {
    assert.deepEqual(
      action.outputs.map((output) => output.key).sort(),
      ['sent', 'transport'],
      `"${action.key}" outputs are what the handlers return`,
    );
  }
});

test('the scene triggers the code fires are the declared ones, with declared data', async () => {
  const declared = Object.fromEntries(
    (manifest.scene_triggers ?? []).map((trigger) => [
      trigger.key,
      new Set([
        ...(trigger.fields ?? []).map((field) => field.key),
        ...(trigger.variables ?? []).map((variable) => variable.key),
      ]),
    ]),
  );
  assert.deepEqual(Object.keys(declared).sort(), Object.values(SCENE_TRIGGERS).sort());

  // Fire each trigger once and check every data key is declared: an
  // undeclared key is silently dropped by the core.
  const gladys = createFakeGladys();
  const tracker = createTriggerTracker(gladys);
  const device = { serial: 'S', externalId: 'ext:dyson:fan:S' };
  const model = describeModel('438K');
  await tracker.onEnvironment(device, model, { pm25: '0001' });
  await tracker.onEnvironment(device, model, { pm25: '0099' });
  await tracker.onProductState(device, { hflr: '0050' });
  await tracker.onProductState(device, { hflr: '0005' });
  await tracker.onTransport(device, { transport: 'local', degraded: false });
  await tracker.onTransport(device, { transport: 'cloud', degraded: true });

  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  for (const { key, data } of gladys.sceneEvents) {
    for (const dataKey of Object.keys(data)) {
      assert.ok(declared[key].has(dataKey), `${key}: "${dataKey}" is not declared`);
    }
  }
});

test('the widgets are declared with the keys the code serves', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    WIDGETS,
  );
  assert.deepEqual(Object.keys(WIDGET_CONTENT), WIDGETS);
  assert.match(indexSource, /for \(const key of WIDGETS\)/);
  assert.match(indexSource, /onWidgetGet\(key/);
  assert.match(indexSource, /onWidgetAction\(key/);
  assert.match(indexSource, /onWidgetGetImage\(widgetImage\)/);
});

test('the controls widget picture: on by default, and its files in the image', async () => {
  const setting = manifest.widgets
    .find((widget) => widget.key === CONTROLS_WIDGET)
    .settings.find((field) => field.key === 'picture');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, true);
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^COPY assets \.\/assets$/m, 'widgetImage reads them at run time');
});

test('the button sets of the controls widget are the ones the code draws', () => {
  const setting = manifest.widgets
    .find((widget) => widget.key === CONTROLS_WIDGET)
    .settings.find((field) => field.key === 'buttons');
  assert.deepEqual(
    setting.options.map((option) => option.value),
    Object.values(BUTTON_SETS),
  );
  assert.equal(setting.default, BUTTON_SETS.SPEED);
});
