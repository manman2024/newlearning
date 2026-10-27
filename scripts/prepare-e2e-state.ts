import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const e2eStatePath = process.env.E2E_PERSIST_PATH ?? './.wrangler/e2e-state';
const wranglerRoot = resolve('.wrangler');
const resolvedStatePath = resolve(e2eStatePath);

if (!resolvedStatePath.startsWith(`${wranglerRoot}${sep}`)) {
  throw new Error('E2E state path must stay inside .wrangler');
}

rmSync(resolvedStatePath, { recursive: true, force: true });
