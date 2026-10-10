// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data (the only writable
// path of the container):
//   - the Dyson account token, obtained once with the e-mailed code;
//   - the pending challenge id, between "Receive a code" and "Validate";
//   - the last device list of the account, with the local MQTT passwords, so
//     the devices keep working locally while the Dyson cloud is down.
//
// The file holds secrets: it is written with owner-only permissions, and
// replaced atomically so a crash never leaves half a file behind.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE_NAME = 'dyson-account.json';

/**
 * @param {object} [options]
 * @param {string} [options.dir] defaults to $DYSON_DATA_DIR, then /data
 */
export function createAccountStore({ dir = process.env.DYSON_DATA_DIR || '/data' } = {}) {
  const file = join(dir, FILE_NAME);

  return {
    file,

    /** @returns {Promise<object>} the saved state, `{}` when there is none */
    async load() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && typeof data === 'object' ? data : {};
      } catch {
        return {};
      }
    },

    async save(data) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(tmp, file);
    },

    async clear() {
      await rm(file, { force: true });
    },
  };
}
