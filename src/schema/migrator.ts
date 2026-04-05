import { runQuery } from "../exec/client.js";

export type ColumnObject = {
  type?: "string" | "varchar" | "int" | "text" | "jsonb" | string;
  ref?: string;
  unique?: boolean;
  nullable?: boolean;
  default?: any;
  length?: number;
  onDelete?: "cascade" | "restrict" | "set null" | "no action";
  index?: boolean;
};

export type ColumnDef = string | ColumnObject;

export interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
  name: N;
  columns: C;
}

export interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
  config: TableConfig<N, C>;
}

export type SchemaDefinition = Record<string, Record<string, ColumnDef>>;

export function buildSchemaSQL(definition: SchemaDefinition): string[] {
  const statements: string[] = [];
  const indexStatements: string[] = [];

  for (const [tableName, columns] of Object.entries(definition)) {
    const colDefs: string[] = ["id SERIAL PRIMARY KEY"];
    const fkDefs: string[] = [];

    for (const [colName, def] of Object.entries(columns)) {
      let typeStr = "";
      let constraints = "";
      let refTable = "";
      let onDelete = "";

      const isObject = typeof def === "object" && def !== null;
      const shorthand = typeof def === "string" ? def : "";

      if (shorthand === "string" || (isObject && def.type === "string")) {
        typeStr = "VARCHAR(255)";
      } else if (isObject && def.type === "varchar") {
        typeStr = `VARCHAR(${def.length || 255})`;
      } else if (shorthand === "int" || (isObject && def.type === "int")) {
        typeStr = "INTEGER";
      } else if (shorthand === "text" || (isObject && def.type === "text")) {
        typeStr = "TEXT";
      } else if (shorthand === "jsonb" || (isObject && def.type === "jsonb")) {
        typeStr = "JSONB";
      } else if (shorthand.startsWith("ref:")) {
        refTable = shorthand.split(":")[1];
        typeStr = "INTEGER";
      } else if (isObject && def.ref) {
        refTable = def.ref;
        typeStr = "INTEGER";
        onDelete = def.onDelete ? ` ON DELETE ${def.onDelete.toUpperCase()}` : "";
      }

      if (isObject) {
        if (def.unique) constraints += " UNIQUE";
        if (def.nullable === false) constraints += " NOT NULL";
        if (def.default !== undefined) {
          const val = typeof def.default === "string" ? `'${def.default}'` : def.default;
          constraints += ` DEFAULT ${val}`;
        }
        if (def.index) {
          indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_${colName} ON ${tableName}("${colName}");`);
        }
      }

      if (typeStr) {
        colDefs.push(`"${colName}" ${typeStr}${constraints}`);
      }

      if (refTable) {
        fkDefs.push(`FOREIGN KEY ("${colName}") REFERENCES ${refTable}(id)${onDelete}`);
      }
    }

    const allDefs = [...colDefs, ...fkDefs];
    statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${allDefs.join(",\n  ")}\n);`);
  }

  return [...statements, ...indexStatements];
}

export async function pushSchema(definition: SchemaDefinition, url: string) {
  const statements = buildSchemaSQL(definition);
  for (const sql of statements) {
    await runQuery(sql, [], url);
  }
}
