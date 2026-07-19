import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

function shouldUseSsl() {
  const url = process.env.DATABASE_URL ?? '';
  const explicit = (process.env.DATABASE_SSL ?? '').toLowerCase();
  return explicit === 'true' || url.includes('sslmode=require') || url.includes('supabase.co');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 8),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000),
  application_name: process.env.STONEPINERP_SERVER_ID
    ?? process.env.YELLOWSTONERP_SERVER_ID
    ?? 'stonepinerp-backend',
  ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined
});

export async function query(sql, params = []) {
  return pool.query(sql, params);
}

export async function one(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] ?? null;
}

export async function many(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function dbHealth() {
  if (!process.env.DATABASE_URL) {
    return { ok: false, error: 'DATABASE_URL is not set' };
  }
  try {
    const result = await pool.query('select now() as now');
    return { ok: true, now: result.rows[0]?.now ?? null };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}
