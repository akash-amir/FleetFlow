import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Only key NAMES that look like credentials are checked for accidental
// identity — plain config (DEFAULT_CURRENCY, INVOICE_DUE_DAYS, an email
// used only as an identifier, ...) is expected to be identical between
// .env and .env.example and is not a leak.
// ponytail: name-based heuristic, not value-based — a future *_URL env var
// that ISN'T credential-bearing would be over-flagged; revisit if that happens.
const SENSITIVE_KEY_PATTERN = /PASSWORD|SECRET|_KEY(_|$)|TOKEN|_URL$/i;

// A value that's clearly a template/dummy, not a working credential —
// identical placeholders across both files are fine (and expected: that's
// the whole point of shipping a usable default like a dev-only JWT secret).
const PLACEHOLDER_VALUE_PATTERN = /<[^>]+>|placeholder|change-?me|\.\.\.\s*$/i;

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, 'utf8');
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

describe('env guard', () => {
  it('.env.example never holds the same real credential as .env', () => {
    let real: Record<string, string>;
    try {
      real = parseEnvFile(resolve(REPO_ROOT, '.env'));
    } catch {
      return; // no local .env (e.g. a fresh CI checkout) — nothing to guard against
    }
    const example = parseEnvFile(resolve(REPO_ROOT, '.env.example'));

    const leaked: string[] = [];
    for (const [key, exampleValue] of Object.entries(example)) {
      const realValue = real[key];
      if (realValue === undefined) continue;
      if (!SENSITIVE_KEY_PATTERN.test(key)) continue;
      if (exampleValue === '' || PLACEHOLDER_VALUE_PATTERN.test(exampleValue)) continue;
      if (exampleValue === realValue) leaked.push(key);
    }

    // Never print the values themselves — only which keys leaked.
    expect(leaked, `.env.example appears to hold the real value for: ${leaked.join(', ')}`).toEqual([]);
  });
});
