import pg from "pg";
import { DBSchema } from "./types.js";

export async function introspect(client: pg.ClientBase): Promise<DBSchema> {
  const schema: DBSchema = { tables: {} };

  const colsRes = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  for (const row of colsRes.rows) {
    if (!schema.tables[row.table_name]) {
      schema.tables[row.table_name] = { columns: {}, fks: [], indexes: [] };
    }
    schema.tables[row.table_name].columns[row.column_name] = {
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      default: row.column_default ?? undefined,
    };
  }

  const fksRes = await client.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  for (const row of fksRes.rows) {
    if (schema.tables[row.table_name]) {
      schema.tables[row.table_name].fks.push({
        column: row.column_name,
        refTable: row.foreign_table_name,
        refColumn: row.foreign_column_name,
        onDelete: row.delete_rule.toLowerCase(),
      });
    }
  }

  const idxRes = await client.query(`
    SELECT
      t.relname as table_name,
      i.relname as index_name,
      a.attname as column_name,
      ix.indisunique as is_unique
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relkind = 'r' AND n.nspname = 'public'
      AND i.relname NOT LIKE '%_pkey'
  `);

  const idxMap: Record<string, Record<string, { columns: string[]; unique: boolean }>> = {};
  for (const row of idxRes.rows) {
    if (!idxMap[row.table_name]) idxMap[row.table_name] = {};
    if (!idxMap[row.table_name][row.index_name]) {
      idxMap[row.table_name][row.index_name] = { columns: [], unique: row.is_unique };
    }
    idxMap[row.table_name][row.index_name].columns.push(row.column_name);
  }

  for (const [tableName, idxs] of Object.entries(idxMap)) {
    if (schema.tables[tableName]) {
      for (const [idxName, idx] of Object.entries(idxs)) {
        schema.tables[tableName].indexes.push({
          name: idxName,
          columns: idx.columns,
          unique: idx.unique,
        });
      }
    }
  }

  return schema;
}
