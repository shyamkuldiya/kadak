import pg from "pg";
import { KadakClient } from "./client.js";

export async function transaction<T>(
  client: KadakClient,
  callback: (txClient: pg.PoolClient) => Promise<T>
): Promise<T> {
  const tx = await client.getClient();
  try {
    await tx.query("BEGIN");
    const result = await callback(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
