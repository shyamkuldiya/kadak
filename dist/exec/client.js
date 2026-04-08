// src/exec/client.ts
import pg from "pg";
var pool = null;
async function runQuery(sql, values, url, client) {
  if (client) {
    const res2 = await client.query(sql, values);
    return res2.rows;
  }
  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  const res = await pool.query(sql, values);
  return res.rows;
}
async function getTransactionClient(url) {
  if (!pool && url) {
    pool = new pg.Pool({ connectionString: url });
  }
  if (!pool) throw new Error("Database pool not initialized");
  return await pool.connect();
}
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
export {
  closePool,
  getTransactionClient,
  runQuery
};
