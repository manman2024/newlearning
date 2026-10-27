import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

type D1Object = {
  sql?: string;
  type: 'index' | 'table' | 'trigger' | 'view';
  name: string;
};

type D1QueryResult = {
  results?: D1Object[];
  success?: boolean;
};

type D1DatabaseConfig = {
  binding?: string;
  database_name?: string;
  database_id?: string;
};

type WranglerConfig = {
  d1_databases?: D1DatabaseConfig[];
  env?: Record<string, { d1_databases?: D1DatabaseConfig[] }>;
};

type Options = {
  assumeYes: boolean;
  config?: string;
  database?: string;
  env?: string;
  envFiles: string[];
  help: boolean;
  keepDump: boolean;
  persistTo?: string;
  verbose: boolean;
};

type TargetDatabase = {
  binding?: string;
  id?: string;
  name: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    assumeYes: false,
    envFiles: [],
    help: false,
    keepDump: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--yes' || arg === '-y') {
      options.assumeYes = true;
      continue;
    }

    if (arg === '--keep-dump') {
      options.keepDump = true;
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--database' || arg === '--db' || arg === '--binding') {
      options.database = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--config' || arg === '-c') {
      options.config = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--env' || arg === '-e') {
      options.env = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--env-file') {
      options.envFiles.push(readArgValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--persist-to') {
      options.persistTo = readArgValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readArgValue(argv: string[], index: number, arg: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`${arg} requires a value.`);
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  pnpm db:sync:local -- --yes
  pnpm db:sync:local -- --database <database_name_or_binding>
  pnpm db:sync:local -- --env production --database <database_name_or_binding>

Options:
  --database, --db <value>   D1 database name or binding. Required when multiple D1 bindings exist.
  --binding <value>          Alias for --database.
  --env, -e <name>           Wrangler environment to use.
  --config, -c <path>        Wrangler config path.
  --env-file <path>          Forwarded to Wrangler. Can be passed multiple times.
  --persist-to <path>        Local D1 persistence directory for wrangler d1 execute --local.
  --keep-dump                Keep the downloaded SQL dump in the temp directory.
  --verbose                  Print full Wrangler output, including the temporary export URL.
  --yes, -y                  Skip the destructive local overwrite confirmation.
`);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function getWranglerCommand() {
  return process.env.WRANGLER_BIN || 'wrangler';
}

function runWrangler(args: string[], options: Options) {
  if (options.verbose) {
    const result = spawnSync(getWranglerCommand(), args, {
      shell: false,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    return '';
  }

  const result = spawnSync(getWranglerCommand(), args, {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  printWranglerSummary(result.stdout);
  return result.stdout;
}

function readWrangler(args: string[]) {
  const result = spawnSync(getWranglerCommand(), args, {
    encoding: 'utf8',
    shell: false,
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function printWranglerSummary(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      return (
        line.includes('Downloaded to ') ||
        line.includes('commands executed successfully') ||
        line.includes('Resource location:')
      );
    });

  if (lines.length > 0) {
    console.log(lines.join('\n'));
  }
}

function getWranglerFlags(options: Options) {
  const flags: string[] = [];

  if (options.config) {
    flags.push('--config', options.config);
  }

  if (options.env) {
    flags.push('--env', options.env);
  }

  for (const envFile of options.envFiles) {
    flags.push('--env-file', envFile);
  }

  return flags;
}

function getLocalFlags(options: Options) {
  return options.persistTo ? ['--persist-to', options.persistTo] : [];
}

function findConfigPath(configPath?: string) {
  if (configPath) {
    return path.resolve(configPath);
  }

  for (const candidate of ['wrangler.jsonc', 'wrangler.json']) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function readWranglerConfig(configPath?: string): WranglerConfig | undefined {
  const resolved = findConfigPath(configPath);

  if (!resolved || !fs.existsSync(resolved)) {
    return undefined;
  }

  const extension = path.extname(resolved);

  if (extension !== '.json' && extension !== '.jsonc') {
    return undefined;
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const json = stripTrailingCommas(stripJsonComments(content));
  return JSON.parse(json) as WranglerConfig;
}

function stripJsonComments(content: string) {
  let result = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quote) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < content.length && content[index] !== '\n') {
        index += 1;
      }
      result += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < content.length &&
        !(content[index] === '*' && content[index + 1] === '/')
      ) {
        if (content[index] === '\n') {
          result += '\n';
        }
        index += 1;
      }
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}

function stripTrailingCommas(content: string) {
  let result = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }

    if (char === ',') {
      const nextNonWhitespace = findNextNonWhitespace(content, index + 1);
      if (nextNonWhitespace === '}' || nextNonWhitespace === ']') {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function findNextNonWhitespace(content: string, start: number) {
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return undefined;
}

function getD1Configs(config: WranglerConfig | undefined, env?: string) {
  if (!config) {
    return [];
  }

  const envD1 = env ? config.env?.[env]?.d1_databases : undefined;
  return envD1 && envD1.length > 0 ? envD1 : (config.d1_databases ?? []);
}

function resolveTargetDatabase(options: Options): TargetDatabase {
  const config = readWranglerConfig(options.config);
  const databases = getD1Configs(config, options.env);

  if (options.database) {
    const match = databases.find((database) => {
      return (
        database.database_name === options.database ||
        database.binding === options.database ||
        database.database_id === options.database
      );
    });

    return {
      binding: match?.binding,
      id: match?.database_id,
      name: match?.database_name ?? options.database,
    };
  }

  if (databases.length === 0) {
    throw new Error(
      [
        'No D1 database found in wrangler.jsonc.',
        'Pass --database <database_name> when using wrangler.toml or a custom setup.',
      ].join(' ')
    );
  }

  if (databases.length > 1) {
    const list = databases
      .map((database) => {
        return `- ${database.binding ?? '(no binding)'} -> ${
          database.database_name ?? '(no database_name)'
        }`;
      })
      .join('\n');

    throw new Error(
      `Multiple D1 databases found. Pass --database or --binding:\n${list}`
    );
  }

  const [database] = databases;

  if (!database.database_name) {
    throw new Error('D1 database config is missing database_name.');
  }

  return {
    binding: database.binding,
    id: database.database_id,
    name: database.database_name,
  };
}

async function confirmSync(database: TargetDatabase, options: Options) {
  if (options.assumeYes) {
    return;
  }

  const label = database.binding
    ? `${database.name} (${database.binding})`
    : database.name;

  console.log(
    [
      `This will overwrite the local D1 database "${label}".`,
      'Remote production data may include private customer data.',
      `Type "${database.name}" to continue.`,
    ].join('\n')
  );

  const rl = createInterface({ input, output });
  const answer = await rl.question('Confirm database name: ');
  rl.close();

  if (answer !== database.name) {
    console.log('Aborted.');
    process.exit(0);
  }
}

function parseJsonArrayOutput(outputText: string) {
  const start = outputText.indexOf('[');
  const end = outputText.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not parse Wrangler JSON output.');
  }

  return JSON.parse(outputText.slice(start, end + 1)) as D1QueryResult[];
}

function getLocalObjects(databaseName: string, options: Options) {
  const json = readWrangler([
    'd1',
    'execute',
    databaseName,
    ...getWranglerFlags(options),
    '--local',
    ...getLocalFlags(options),
    '--json',
    '--command',
    [
      'SELECT type, name, sql FROM sqlite_schema',
      "WHERE type IN ('index', 'table', 'trigger', 'view')",
      "AND name NOT LIKE 'sqlite_%'",
      "AND name != '_cf_METADATA'",
      'ORDER BY',
      "CASE type WHEN 'view' THEN 1",
      "WHEN 'trigger' THEN 2",
      "WHEN 'index' THEN 3",
      'ELSE 4 END, name',
    ].join(' '),
  ]);

  return parseJsonArrayOutput(json).flatMap((result) => result.results ?? []);
}

function writeResetSql(filePath: string, objects: D1Object[]) {
  const orderedObjects = orderObjectsForDrop(objects);
  const statements = [
    'PRAGMA foreign_keys = OFF;',
    ...orderedObjects.map((object) => {
      return `DROP ${object.type.toUpperCase()} IF EXISTS ${quoteIdentifier(
        object.name
      )};`;
    }),
    'PRAGMA foreign_keys = ON;',
  ];

  fs.writeFileSync(filePath, `${statements.join('\n')}\n`);
}

function orderObjectsForDrop(objects: D1Object[]) {
  const views = objects
    .filter((object) => object.type === 'view')
    .sort(compareByName);
  const triggers = objects
    .filter((object) => object.type === 'trigger')
    .sort(compareByName);
  const indexes = objects
    .filter((object) => object.type === 'index')
    .sort(compareByName);
  const tables = orderTablesForDrop(
    objects.filter((object) => object.type === 'table')
  );

  return [...views, ...triggers, ...indexes, ...tables];
}

function compareByName(left: D1Object, right: D1Object) {
  return left.name.localeCompare(right.name);
}

function orderTablesForDrop(tables: D1Object[]) {
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const dependentsByTable = new Map<string, Set<string>>();

  for (const table of tables) {
    const references = getReferencedTables(table.sql ?? '');

    for (const referencedTable of references) {
      if (!tableByName.has(referencedTable)) {
        continue;
      }

      const dependents = dependentsByTable.get(referencedTable) ?? new Set();
      dependents.add(table.name);
      dependentsByTable.set(referencedTable, dependents);
    }
  }

  const ordered: D1Object[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(tableName: string) {
    if (visited.has(tableName)) {
      return;
    }

    if (visiting.has(tableName)) {
      return;
    }

    visiting.add(tableName);

    for (const dependent of dependentsByTable.get(tableName) ?? []) {
      visit(dependent);
    }

    visiting.delete(tableName);
    visited.add(tableName);

    const table = tableByName.get(tableName);
    if (table) {
      ordered.push(table);
    }
  }

  for (const table of [...tables].sort(compareByName)) {
    visit(table.name);
  }

  return ordered;
}

function getReferencedTables(sql: string) {
  const references = new Set<string>();
  const referencePattern =
    /REFERENCES\s+(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([^\s(,]+))/gi;

  for (const match of sql.matchAll(referencePattern)) {
    const tableName = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (tableName) {
      references.add(tableName);
    }
  }

  return references;
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | ']' | undefined;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    current += char;

    if (quote) {
      if (quote === ']' && char === ']') {
        quote = undefined;
      } else if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '[') {
      quote = ']';
      continue;
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = '';
    }
  }

  const remaining = current.trim();
  if (remaining) {
    statements.push(remaining.endsWith(';') ? remaining : `${remaining};`);
  }

  return statements;
}

function buildLocalImportSql(dumpSql: string) {
  const pragmas: string[] = [];
  const tableDefinitions: string[] = [];
  const dataStatements: string[] = [];
  const afterDataStatements: string[] = [];
  const otherStatements: string[] = [];

  for (const statement of splitSqlStatements(dumpSql)) {
    const normalized = statement.trimStart().replace(/\s+/g, ' ').toUpperCase();

    if (normalized.startsWith('PRAGMA ')) {
      pragmas.push(statement);
    } else if (normalized.startsWith('CREATE TABLE ')) {
      tableDefinitions.push(statement);
    } else if (normalized.startsWith('INSERT INTO ')) {
      dataStatements.push(statement);
    } else if (normalized.startsWith('CREATE ')) {
      afterDataStatements.push(statement);
    } else {
      otherStatements.push(statement);
    }
  }

  return [
    'PRAGMA foreign_keys = OFF;',
    ...pragmas,
    ...tableDefinitions,
    ...otherStatements,
    ...dataStatements,
    ...afterDataStatements,
    'PRAGMA foreign_keys = ON;',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const database = resolveTargetDatabase(options);
  await confirmSync(database, options);

  const workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `${database.name}-d1-sync-`)
  );
  const dumpPath = path.join(workingDir, 'remote.sql');
  const importPath = path.join(workingDir, 'import-local.sql');
  const resetPath = path.join(workingDir, 'reset-local.sql');

  console.log(`Exporting remote D1 database "${database.name}"...`);
  runWrangler(
    [
      'd1',
      'export',
      database.name,
      ...getWranglerFlags(options),
      '--remote',
      '--skip-confirmation',
      '--output',
      dumpPath,
    ],
    options
  );

  fs.writeFileSync(
    importPath,
    buildLocalImportSql(fs.readFileSync(dumpPath, 'utf8'))
  );

  console.log(`Resetting local D1 database "${database.name}"...`);
  const localObjects = getLocalObjects(database.name, options);
  writeResetSql(resetPath, localObjects);
  runWrangler(
    [
      'd1',
      'execute',
      database.name,
      ...getWranglerFlags(options),
      '--local',
      ...getLocalFlags(options),
      '--yes',
      '--file',
      resetPath,
    ],
    options
  );

  console.log('Importing remote dump into local D1...');
  runWrangler(
    [
      'd1',
      'execute',
      database.name,
      ...getWranglerFlags(options),
      '--local',
      ...getLocalFlags(options),
      '--yes',
      '--file',
      importPath,
    ],
    options
  );

  if (options.keepDump) {
    console.log(`Kept SQL dump at ${dumpPath}`);
  } else {
    fs.rmSync(workingDir, { force: true, recursive: true });
  }

  console.log('Local D1 is now synced from remote.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
