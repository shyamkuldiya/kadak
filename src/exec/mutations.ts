export function buildInsertSQL(table: string, data: Record<string, any>): { sql: string; values: any[] } {
  const fields = Object.keys(data);
  const values = Object.values(data);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
  
  const sql = `INSERT INTO ${table} (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`;
  
  return { sql, values };
}
