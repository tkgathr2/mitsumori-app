import "server-only";
import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _pool;
}

let _schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS price_cache (
           id         text PRIMARY KEY,
           payload    jsonb NOT NULL,
           updated_at timestamptz DEFAULT NOW()
         )`
      )
      .then(() => undefined)
      .catch((e) => {
        _schemaReady = null;
        throw e;
      });
  }
  return _schemaReady;
}

const CACHE_KEY = "main";
// GASは毎時pushするので2時間以上古いデータは使わない（GAS停止の早期検知）
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface PriceCacheRow {
  payload: unknown;
  updated_at: Date;
}

export async function loadPriceCache(): Promise<PriceCacheRow | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    await ensureSchema();
    const res = await getPool().query<{ payload: unknown; updated_at: Date }>(
      `SELECT payload, updated_at FROM price_cache WHERE id = $1`,
      [CACHE_KEY]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > MAX_AGE_MS) return null;
    return row;
  } catch (e) {
    console.error("[price-cache] load failed:", e);
    return null;
  }
}

export async function savePriceCache(payload: unknown): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO price_cache (id, payload, updated_at)
         VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload = $2::jsonb, updated_at = NOW()`,
      [CACHE_KEY, JSON.stringify(payload)]
    );
  } catch (e) {
    console.error("[price-cache] save failed:", e);
    throw e;
  }
}
