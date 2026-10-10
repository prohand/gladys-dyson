import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-dyson';

test('the first release moves Unreleased under the version and links its tag', () => {
  const before = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Dyson fans.',
    '',
    `[Unreleased]: ${REPO}/commits/main`,
    '',
  ].join('\n');

  assert.equal(
    rollChangelog(before, '1.0.0', '2026-10-10'),
    [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [1.0.0] - 2026-10-10',
      '',
      '### Added',
      '',
      '- Dyson fans.',
      '',
      `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD`,
      `[1.0.0]: ${REPO}/releases/tag/v1.0.0`,
      '',
    ].join('\n'),
  );
});

test('an empty Unreleased section still names the version', () => {
  const result = rollChangelog('## [Unreleased]\n', '1.0.1', '2026-10-11');

  assert.match(result, /## \[1\.0\.1\] - 2026-10-11\n\n- Maintenance release/);
});

test('a version already rolled is left untouched', () => {
  const text = '## [Unreleased]\n\n## [1.0.0] - 2026-10-10\n';

  assert.equal(rollChangelog(text, '1.0.0', '2026-10-12'), text);
});

test('a mention of the Unreleased heading in the introduction is not the heading', () => {
  const before = [
    '# Changelog',
    '',
    'Describe each change under `## [Unreleased]` as you make it.',
    '',
    '## [Unreleased]',
    '',
    '- Widget.',
    '',
    `[Unreleased]: ${REPO}/compare/v0.0.1...HEAD`,
    '',
  ].join('\n');

  const result = rollChangelog(before, '0.0.2', '2026-10-11');

  assert.match(
    result,
    /under `## \[Unreleased\]` as you make it\.\n\n## \[Unreleased\]\n\n## \[0\.0\.2\]/,
  );
  assert.match(result, /## \[0\.0\.2\] - 2026-10-11\n\n- Widget\./);
  assert.match(result, /\[0\.0\.2\]: .*compare\/v0\.0\.1\.\.\.v0\.0\.2/);
});
