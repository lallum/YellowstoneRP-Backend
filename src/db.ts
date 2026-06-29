import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const sslEnabled = (process.env.DATABASE_SSL ?? '').toLowerCase() === 'true' || (process.env.DATABASE_URL ?? '').includes('sslmode=require');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: process.env.YELLOWSTONERP_SERVER_ID ?? 'yellowstonerp-backend',
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
});

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const res = await pool.query(sql, params);
  return res.rows[0] ?? null;
}

export async function many<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows;
}
