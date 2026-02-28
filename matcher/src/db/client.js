/**
 * PostgreSQL client for matcher. Uses pg with a connection pool.
 * Set DATABASE_URL or individual PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE.
 */
import pg from 'pg';

const { Pool } = pg;

function getConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'event_perp_matcher',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool(getConfig());
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

export async function end() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
