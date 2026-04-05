import { runQuery } from "../exec/client.js";
import { createHash } from "crypto";

export type ColumnObject = {
  type?: "string" | "varchar" | "int" | "text" | "jsonb" | "timestamp" | string;
  ref?: string;
  unique?: boolean;
  nullable?: boolean;
  default?: any;
  length?: number;
  onDelete?: "cascade" | "restrict" | "set null" | "no action";
  index?: boolean;
  autoUpdate?: boolean; // For updatedAt
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

// --- Fluent Column Builder ---
export class ColumnBuilder {
  private obj: ColumnObject = {};

  constructor(type?: ColumnObject["type"]) {
    if (type) this.obj.type = type;
  }

  default(val: any) {
    this.obj.default = val;
    return this;
  }

  defaultNow() {
    this.obj.default = "NOW()";
    return this;
  }

  unique() {
    this.obj.unique = true;
    return this;
  }

  nullable(val: boolean = true) {
    this.obj.nullable = val;
    return this;
  }

  notNull() {
    this.obj.nullable = false;
    return this;
  }

  length(val: number) {
    this.obj.length = val;
    return this;
  }

  onDelete(val: ColumnObject["onDelete"]) {
    this.obj.onDelete = val;
    return this;
  }

  index() {
    this.obj.index = true;
    return this;
  }

  // Internal helper to get the raw object
  build(): ColumnObject {
    return this.obj;
  }
}

export const t = {
  string: () => new ColumnBuilder("string"),
  varchar: (len?: number) => new ColumnBuilder("varchar").length(len || 255),
  int: () => new ColumnBuilder("int"),
  text: () => new ColumnBuilder("text"),
  jsonb: () => new ColumnBuilder("jsonb"),
  timestamp: () => new ColumnBuilder("timestamp"),
  ref: (table: string) => {
    const b = new ColumnBuilder();
    (b as any).obj.ref = table;
    (b as any).obj.type = "int"; // Refs are integers
    return b;
  },
  timestamps: () => ({
    createdAt: new ColumnBuilder("timestamp").defaultNow().build(),
    updatedAt: { type: "timestamp", default: "NOW()", autoUpdate: true } as ColumnObject
  })
};
// -----------------------------

function generateColumnSQL(colName: string, rawDef: ColumnDef, tableName: string, indexStatements: string[]): { columnSQL: string, fkSQL?: string } {
  const def: ColumnObject = (rawDef instanceof ColumnBuilder) ? rawDef.build() : (typeof rawDef === "string" ? { type: rawDef } : rawDef);
  
  let typeStr = "";
  let constraints = "";
  let refTable = "";
  let onDelete = "";

  const shorthand = typeof rawDef === "string" ? rawDef : "";

  // 1. Resolve Type
  if (shorthand === "string" || def.type === "string") {
    typeStr = "VARCHAR(255)";
  } else if (def.type === "varchar") {
    typeStr = `VARCHAR(${def.length || 255})`;
  } else if (shorthand === "int" || def.type === "int") {
    typeStr = "INTEGER";
  } else if (shorthand === "text" || def.type === "text") {
    typeStr = "TEXT";
  } else if (shorthand === "jsonb" || def.type === "jsonb") {
    typeStr = "JSONB";
  } else if (shorthand === "timestamp" || def.type === "timestamp") {
    typeStr = "TIMESTAMP";
  } else if (shorthand.startsWith("ref:")) {
    refTable = shorthand.split(":")[1];
    typeStr = "INTEGER";
  } else if (def.ref) {
    refTable = def.ref;
    typeStr = "INTEGER";
    onDelete = def.onDelete ? ` ON DELETE ${def.onDelete.toUpperCase()}` : "";
  }

  // 2. Resolve Constraints
  if (def.unique) constraints += " UNIQUE";
  if (def.nullable === false) constraints += " NOT NULL";
  if (def.default !== undefined) {
    const val = def.default === "NOW()" ? "NOW()" : (typeof def.default === "string" ? `'${def.default}'` : def.default);
    constraints += ` DEFAULT ${val}`;
  }
  if (def.index) {
    indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_${colName} ON ${tableName}("${colName}");`);
  }

  let fkSQL: string | undefined;
  if (refTable) {
    fkSQL = `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY ("${colName}") REFERENCES ${refTable}(id)${onDelete}`;
  }

  return { columnSQL: `"${colName}" ${typeStr}${constraints}`, fkSQL };
}

export function buildSchemaSQL(definition: SchemaDefinition): string[] {
  const statements: string[] = [];
  const indexStatements: string[] = [];

  for (const [tableName, columns] of Object.entries(definition)) {
    const colDefs: string[] = ["id SERIAL PRIMARY KEY"];
    const fks: string[] = [];

    for (const [colName, rawDef] of Object.entries(columns)) {
      const { columnSQL, fkSQL } = generateColumnSQL(colName, rawDef, tableName, indexStatements);
      if (columnSQL) colDefs.push(columnSQL);
      // For CREATE TABLE, we usually put FKs inline, but for incremental we use ALTER TABLE.
      // To keep buildSchemaSQL consistent for FIRST push, we can put them inline.
      if (fkSQL) {
        // extract parts from fkSQL: ALTER TABLE x ADD CONSTRAINT y FOREIGN KEY (z) REFERENCES w(p) ON DELETE v
        const match = fkSQL.match(/FOREIGN KEY .*/);
        if (match) fks.push(match[0]);
      }
    }

    const allDefs = [...colDefs, ...fks];
    statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${allDefs.join(",\n  ")}\n);`);
  }

  return [...statements, ...indexStatements];
}

function calculateHash(definition: SchemaDefinition): string {
  const str = JSON.stringify(definition, (key, value) => {
    if (value instanceof ColumnBuilder) return value.build();
    return value;
  });
  return createHash("sha256").update(str).digest("hex");
}

export async function pushSchema(definition: SchemaDefinition, url: string) {
  const currentHash = calculateHash(definition);

  // 1. Ensure migrations table exists
  await runQuery(`
    CREATE TABLE IF NOT EXISTS _kadak_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `, [], url);

  // 2. Check if hash exists
  const existing = await runQuery(`SELECT id FROM _kadak_migrations WHERE hash = $1`, [currentHash], url);
  if (existing.length > 0) {
    console.log("ℹ️ [Kadak] Schema up to date. Skipping push.");
    return;
  }

  // 3. Incremental Update: Introspect existing tables/columns
  const existingTablesRes = await runQuery(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `, [], url);
  const existingTables = new Set(existingTablesRes.map((r: any) => r.table_name));

  const statements: string[] = [];
  const indexStatements: string[] = [];

  for (const [tableName, columns] of Object.entries(definition)) {
    if (!existingTables.has(tableName)) {
      console.log(`✨ [Kadak] Creating table: ${tableName}`);
      // Use existing buildSchemaSQL logic for new tables
      const subDef: SchemaDefinition = { [tableName]: columns };
      statements.push(...buildSchemaSQL(subDef));
    } else {
      // Table exists, check for new columns
      const existingColsRes = await runQuery(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName], url);
      const existingCols = new Set(existingColsRes.map((r: any) => r.column_name));

      for (const [colName, rawDef] of Object.entries(columns)) {
        if (!existingCols.has(colName)) {
          console.log(`➕ [Kadak] Adding column: ${colName} to ${tableName}`);
          const { columnSQL, fkSQL } = generateColumnSQL(colName, rawDef, tableName, indexStatements);
          statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${columnSQL};`);
          if (fkSQL) statements.push(fkSQL + ";");
        }
      }
    }
  }

  // Combine and execute
  const allSql = [...statements, ...indexStatements];
  if (allSql.length > 0) {
    for (const sql of allSql) {
      await runQuery(sql, [], url);
    }
    // 4. Record new hash
    await runQuery(`INSERT INTO _kadak_migrations (hash) VALUES ($1)`, [currentHash], url);
    console.log("✅ [Kadak] Schema push complete.");
  } else {
    // If no SQL was generated but hash was different (shouldn't happen with our logic but for safety)
    await runQuery(`INSERT INTO _kadak_migrations (hash) VALUES ($1)`, [currentHash], url);
    console.log("ℹ️ [Kadak] No changes detected. Migration recorded.");
  }
}
