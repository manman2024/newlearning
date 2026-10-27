import { createClient } from '@libsql/client';
import { readdirSync, readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { user } from '@/db/auth.schema';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      middleware: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock('@/middlewares/admin-middleware', () => ({ adminApiMiddleware: {} }));
vi.mock('@/db', () => ({ getDb: mocks.getDb }));

import { listUsers } from '@/api/users';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const literalEmail = 'literal_100%@example.test';
const decoyEmail = 'literalx100extra@example.test';

beforeAll(async () => {
  const migrations = new URL('../../../src/db/migrations/', import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await client.executeMultiple(
      readFileSync(new URL(file, migrations), 'utf8')
    );
  }
  await db.insert(user).values([
    {
      id: 'literal',
      name: 'Literal_100%\\Account',
      email: literalEmail,
      updatedAt: new Date(0),
    },
    {
      id: 'decoy',
      name: 'LiteralX100extraAccount',
      email: decoyEmail,
      updatedAt: new Date(0),
    },
  ]);
});

beforeEach(() => mocks.getDb.mockReturnValue(db));
afterAll(() => client.close());

test.each([
  ['_', [literalEmail]],
  ['%', [literalEmail]],
  ['\\', [literalEmail]],
  [literalEmail, [literalEmail]],
  ['LITERAL', [literalEmail, decoyEmail]],
  ['missing', []],
  ['', [literalEmail, decoyEmail]],
])('user search matches %j literally in SQLite', async (search, emails) => {
  const result = await listUsers({
    data: {
      pageIndex: 0,
      pageSize: 10,
      search,
      sortId: 'email',
      sortDesc: false,
    },
  });

  expect(result.items.map((item) => item.email).sort()).toEqual(
    [...emails].sort()
  );
  expect(result.total).toBe(emails.length);
});
