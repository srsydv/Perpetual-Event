/**
 * Run migrations from migrations/*.sql in order.
 * Usage: node src/db/migrate.js
 */
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPool, query, end } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  const migrationsDir = join(__dirname, '../../migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const name = file;
    const existing = await query('SELECT 1 FROM _migrations WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      console.log('Skip (already applied):', name);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await query(sql);
    await query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
    console.log('Applied:', name);
  }
  console.log('Migrations done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => end());
