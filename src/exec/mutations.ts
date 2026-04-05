export function buildInsertSQL(table: string, data: Record<string, any>): { sql: string; values: any[] } {
  const fields = Object.keys(data);
  const values = Object.values(data);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
  
  const sql = `INSERT INTO ${table} (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`;
  
  return { sql, values };
}

export function buildUpdateSQL(table: string, where: Record<string, any>, data: Record<string, any>): { sql: string; values: any[] } {
  const setFields = Object.keys(data);
  const setValues = Object.values(data);
  const whereFields = Object.keys(where);
  const whereValues = Object.values(where);

  const setClauses = setFields.map((f, i) => `"${f}" = $${i + 1}`).join(", ");
  const whereClauses = whereFields.map((f, i) => `"${f}" = $${setFields.length + i + 1}`).join(" AND ");

  const sql = `UPDATE ${table} SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
  const values = [...setValues, ...whereValues];

  return { sql, values };
}
