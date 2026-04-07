import pg from "pg";

let pool: pg.Pool | null = null;

export async function runQuery(sql: string, values: unknown[], url?: string, client?: pg.PoolClient) {
  if (client) {
    const res = await client.query(sql, values);
    return res.rows;
  }

  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  const res = await pool.query(sql, values);
  return res.rows;
}

export async function getTransactionClient(url?: string): Promise<pg.PoolClient> {
  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  return await pool.connect();
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
