import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { getD1Database } from './parse-wrangler';

type DatabaseTarget = 'local' | 'remote';

interface D1StatementResult {
  results?: unknown[];
  success?: boolean;
  error?: string;
}

interface UserRow {
  id: string;
  email: string;
  role: string | null;
}

export type QueryD1 = (sql: string) => Record<string, unknown>[];

export type SetAdminResult =
  | { status: 'updated'; user: UserRow }
  | { status: 'already-admin'; user: UserRow }
  | { status: 'not-found' };

const EMAIL_SCHEMA = z.email();

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const readUser = (row: Record<string, unknown>): UserRow => {
  if (
    typeof row.id !== 'string' ||
    typeof row.email !== 'string' ||
    (typeof row.role !== 'string' && row.role !== null)
  ) {
    throw new Error('D1 returned an invalid user row');
  }

  return {
    id: row.id,
    email: row.email,
    role: row.role,
  };
};

export function setAdminRole(email: string, queryD1: QueryD1): SetAdminResult {
  const matches = queryD1(
    [
      'SELECT id, email, role FROM "user"',
      `WHERE email = ${sqlString(email)} COLLATE NOCASE`,
      'LIMIT 2',
    ].join(' ')
  );

  if (matches.length === 0) return { status: 'not-found' };
  if (matches.length > 1) {
    throw new Error(`Multiple users found with email "${email}"`);
  }

  const user = readUser(matches[0]);
  if (user.role === 'admin') return { status: 'already-admin', user };

  queryD1(
    [
      'UPDATE "user" SET role = \'admin\',',
      "updated_at = cast(unixepoch('subsecond') * 1000 as integer)",
      `WHERE id = ${sqlString(user.id)}`,
    ].join(' ')
  );

  const updatedRows = queryD1(
    [
      'SELECT id, email, role FROM "user"',
      `WHERE id = ${sqlString(user.id)}`,
      'LIMIT 1',
    ].join(' ')
  );
  const updatedUser = updatedRows[0] ? readUser(updatedRows[0]) : null;

  if (updatedUser?.role !== 'admin') {
    throw new Error(`Failed to verify the admin role for "${email}"`);
  }

  return { status: 'updated', user: updatedUser };
}

function parseD1Output(stdout: string): Record<string, unknown>[] {
  let payload: unknown;

  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('Wrangler returned invalid JSON output');
  }

  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error('Wrangler returned an unexpected D1 response');
  }

  const statement = payload[0] as D1StatementResult;
  if (statement.success !== true) {
    throw new Error(statement.error ?? 'D1 query failed');
  }

  if (!statement.results) return [];
  if (!Array.isArray(statement.results)) {
    throw new Error('Wrangler returned invalid D1 results');
  }

  return statement.results.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Wrangler returned an invalid D1 result row');
    }
    return row as Record<string, unknown>;
  });
}

function createD1Query(databaseName: string, target: DatabaseTarget): QueryD1 {
  return (sql) => {
    const result = spawnSync(
      'wrangler',
      [
        'd1',
        'execute',
        databaseName,
        `--${target}`,
        '--command',
        sql,
        '--json',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || 'Wrangler failed'
      );
    }

    return parseD1Output(result.stdout);
  };
}

function printUsage(): void {
  console.error('Usage:');
  console.error('  pnpm db:admin:local <email>');
  console.error('  pnpm db:admin:remote <email>');
}

function main(): void {
  const [targetFlag, rawEmail, ...extraArgs] = process.argv.slice(2);
  const target = targetFlag?.replace(/^--/, '');
  const emailResult = EMAIL_SCHEMA.safeParse(rawEmail?.trim().toLowerCase());

  if (
    (target !== 'local' && target !== 'remote') ||
    !emailResult.success ||
    extraArgs.length > 0
  ) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const database = getD1Database();
  if (!database) {
    throw new Error('D1 database not found in wrangler.jsonc');
  }

  const result = setAdminRole(
    emailResult.data,
    createD1Query(database.name, target)
  );

  if (result.status === 'not-found') {
    console.error(`No user found with email "${emailResult.data}"`);
    process.exitCode = 1;
    return;
  }

  if (result.status === 'already-admin') {
    console.log(`${result.user.email} is already an admin.`);
    return;
  }

  console.log(`${result.user.email} is now an admin.`);
  console.log('Sign out and sign in again to refresh the cached session.');
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
