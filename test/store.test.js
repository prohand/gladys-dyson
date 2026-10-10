import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountStore } from '../src/dyson/store.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-dyson-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('nothing saved yet reads as an empty object', () =>
  withDir(async (dir) => {
    assert.deepEqual(await createAccountStore({ dir }).load(), {});
  }));

test('saved data reads back, in an owner-only file, no temporary left', () =>
  withDir(async (dir) => {
    const store = createAccountStore({ dir: join(dir, 'nested') });
    await store.save({ token: 'tok', devices: [{ serial: 'S' }] });

    assert.deepEqual(await store.load(), { token: 'tok', devices: [{ serial: 'S' }] });
    assert.equal((await stat(store.file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, 'nested')), ['dyson-account.json']);
  }));

test('clear deletes the file, and clearing twice is fine', () =>
  withDir(async (dir) => {
    const store = createAccountStore({ dir });
    await store.save({ token: 'tok' });
    await store.clear();
    await store.clear();

    assert.deepEqual(await store.load(), {});
  }));
