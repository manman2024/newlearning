import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../src/db/migrations/0005_repair_payment_indexes.sql',
    import.meta.url
  ),
  'utf8'
);
const client = createClient({ url: ':memory:' });

describe('payment schema repair migration', () => {
  afterAll(() => client.close());

  test('keeps the paid duplicate and restores payment indexes', async () => {
    await client.executeMultiple(`
      CREATE TABLE payment (
        id TEXT PRIMARY KEY NOT NULL,
        price_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        subscription_id TEXT,
        session_id TEXT,
        invoice_id TEXT,
        type TEXT NOT NULL,
        scene TEXT,
        interval TEXT,
        status TEXT NOT NULL,
        paid INTEGER DEFAULT false NOT NULL,
        period_start INTEGER,
        period_end INTEGER,
        cancel_at_period_end INTEGER,
        trial_start INTEGER,
        trial_end INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO payment (
        id, price_id, user_id, customer_id, subscription_id, session_id,
        invoice_id, type, scene, status, paid, created_at, updated_at
      ) VALUES
        (
          'pending_payment', 'price_monthly', 'user_a', 'cus_a',
          'sub_duplicate', 'cs_duplicate', 'in_duplicate', 'subscription',
          'subscription', 'active', 0, 100, 100
        ),
        (
          'paid_payment', 'price_monthly', 'user_a', 'cus_a',
          'sub_duplicate', 'cs_duplicate', 'in_duplicate', 'subscription',
          'subscription', 'active', 1, 200, 200
        );
    `);

    await client.executeMultiple(migration);

    const rows = await client.execute({
      sql: `SELECT id, paid FROM payment WHERE invoice_id = ?`,
      args: ['in_duplicate'],
    });
    expect(rows.rows).toEqual([{ id: 'paid_payment', paid: 1 }]);

    const indexes = await client.execute('PRAGMA index_list(payment)');
    expect(indexes.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'payment_invoice_id_unique',
        'payment_user_id_idx',
        'payment_customer_id_idx',
        'payment_subscription_id_idx',
        'payment_session_id_idx',
        'payment_invoice_id_idx',
        'payment_paid_idx',
        'payment_user_paid_idx',
      ])
    );

    await expect(
      client.execute({
        sql: `INSERT INTO payment (
          id, price_id, user_id, customer_id, invoice_id, type, status,
          paid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          'duplicate_invoice',
          'price_monthly',
          'user_a',
          'cus_a',
          'in_duplicate',
          'subscription',
          'active',
          1,
          300,
          300,
        ],
      })
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});
