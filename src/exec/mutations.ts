export function buildInsertSQL(table: string, data: Record<string, any>): { sql: string; values: any[] } {
  const fields: string[] = [];
  const values: any[] = [];
  const valuePlaceholders: string[] = [];

  const entries = Object.entries(data);
  
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${table} DEFAULT VALUES RETURNING *`, values: [] };
  }

  entries.forEach(([field, val]) => {
    fields.push(field);
    if (val === "NOW()") {
      valuePlaceholders.push("NOW()");
    } else {
      values.push(val);
      valuePlaceholders.push(`$${values.length}`);
    }
  });
  
  const sql = `INSERT INTO ${table} (${fields.map(f => `"${f}"`).join(", ")}) VALUES (${valuePlaceholders.join(", ")}) RETURNING *`;
  
  return { sql, values };
}

export function buildUpdateSQL(table: string, where: Record<string, any>, data: Record<string, any>): { sql: string; values: any[] } {
  const values: any[] = [];
  
  const setClauses: string[] = [];
  Object.entries(data).forEach(([field, val]) => {
    if (val === "NOW()") {
      setClauses.push(`"${field}" = NOW()`);
    } else {
      values.push(val);
      setClauses.push(`"${field}" = $${values.length}`);
    }
  });

  const whereClauses: string[] = [];
  Object.entries(where).forEach(([field, val]) => {
    values.push(val);
    whereClauses.push(`"${field}" = $${values.length}`);
  });

  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;

  return { sql, values };
}

export function buildDeleteSQL(table: string, where: Record<string, any>): { sql: string; values: any[] } {
  const whereFields = Object.keys(where);
  const whereValues = Object.values(where);

  const whereClauses = whereFields.map((f, i) => `"${f}" = $${i + 1}`).join(" AND ");

  const sql = `DELETE FROM ${table} WHERE ${whereClauses} RETURNING *`;
  
  return { sql, values: whereValues };
}
