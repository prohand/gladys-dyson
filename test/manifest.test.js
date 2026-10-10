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

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const allFields = [
  ...manifest.config_schema,
  ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
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

test('every text is in English and French', () => {
  for (const field of [...allFields, ...(manifest.actions ?? [])]) {
    for (const text of ['label', 'description', 'placeholder']) {
      if (field[text] !== undefined) {
        assert.ok(field[text].en && field[text].fr, `"${field.key}".${text} needs en and fr`);
      }
    }
  }
});

test('the catalog name and description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.ok(manifest.description.en && manifest.description.fr);
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

test('the Gladys floor covers every field the manifest declares', () => {
  // Older cores reject a manifest field they do not know: `categories` needs
  // 4.86; this integration is built and tested against Gladys 5.1.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), `got ${manifest.gladys_version}`);
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
