import { runQuery } from "../exec/client.js";
import { createHash } from "crypto";

export type ColumnObject = {
  type?: "string" | "varchar" | "int" | "text" | "jsonb" | "timestamp" | string;
  min?: number;
  max?: number;
  lowercase?: boolean;
  array?: {
    type: "string" | "int";
  };
  ref?: {
    table: string;
    as: string;
    to?: string;
    source?: string;
  };
  unique?: boolean;
  nullable?: boolean;
  default?: unknown;
  length?: number;
  onDelete?: "cascade" | "restrict" | "set null" | "no action";
  index?: boolean;
  autoUpdate?: boolean; // For updatedAt
};

export type ColumnDef = string | ColumnObject | ColumnBuilder;

export interface TableConfig<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
  name: N;
  columns: C;
}

export interface Table<N extends string = string, C extends Record<string, ColumnDef> = Record<string, ColumnDef>> {
  config: TableConfig<N, C>;
}

export type SchemaDefinition = Record<string, Record<string, ColumnDef>>;

// --- Fluent Column Builder ---
export class ColumnBuilder<T extends ColumnObject = ColumnObject> {
  obj: ColumnObject = {};

  constructor(type?: ColumnObject["type"]) {
    if (type) this.obj.type = type;
  }

  default(val: unknown) {
    this.obj.default = val;
    return this;
  }

  min(val: number) {
    this.obj.min = val;
    return this;
  }

  max(val: number) {
    this.obj.max = val;
    return this;
  }

  lowercase() {
    this.obj.lowercase = true;
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
  build(): T {
    return this.obj as T;
  }
}

export const types = {
  string: () => new ColumnBuilder<{ type: "string" }>("string"),
  varchar: (len?: number) => new ColumnBuilder<{ type: "varchar"; length?: number }>("varchar").length(len || 255),
  int: () => new ColumnBuilder<{ type: "int" }>("int"),
  text: () => new ColumnBuilder<{ type: "text" }>("text"),
  jsonb: () => new ColumnBuilder<{ type: "jsonb" }>("jsonb"),
  timestamp: () => new ColumnBuilder<{ type: "timestamp" }>("timestamp"),
  array: <T extends "string" | "int">(innerType: ColumnBuilder<{ type: T }>) => {
    const built = typeof innerType?.build === "function" ? innerType.build() : innerType;
    const inner = built as ColumnObject;
    if (!inner || (inner.type !== "string" && inner.type !== "int")) {
      throw new Error("Kadak Error: array() only supports string or int");
    }
    const b = new ColumnBuilder<{ type: "array"; array: { type: T } }>("array");
    b.obj.array = { type: inner.type as T };
    return b;
  },
  ref: <const TableName extends string, const RelationName extends string, const To extends string = "id">(
    table: TableName,
    opts: { as: RelationName; to?: To }
  ) => {
    if (!opts?.as) {
      throw new Error("Kadak Error: 'as' is required in ref()");
    }
    const b = new ColumnBuilder<{ type: "int"; ref: { table: TableName; as: RelationName; to: To } }>();
    b.obj.ref = { table, as: opts.as, to: (opts.to || "id") as To };
    b.obj.type = "int"; // Refs are integers
    return b;
  },
  timestamps: () => ({
    createdAt: new ColumnBuilder("timestamp").defaultNow().build(),
    updatedAt: { type: "timestamp", default: "NOW()", autoUpdate: true } as ColumnObject
  })
};
// -----------------------------

function generateColumnSQL(colName: string, rawDef: any, tableName: string, indexStatements: string[]): { columnSQL: string | null, fkSQL?: string } {
  // Ignore virtual relations (string mapping like "other.id") for migration
  if (typeof rawDef === "string" && rawDef.includes(".")) {
    return { columnSQL: null };
  }

  // Safe extraction: check for .build() method to support fluent API even if instanceof fails
  const def: ColumnObject = typeof rawDef?.build === "function" 
    ? rawDef.build() 
    : (typeof rawDef === "string" ? { type: rawDef } : rawDef);
  
  let typeStr = "";
  let constraints = "";
  let refTable = "";
  let refTarget = "id";
  let onDelete = "";

  // 1. Resolve Type
  if (def.array) {
    if (def.array.type === "string") {
      typeStr = "TEXT[]";
    } else if (def.array.type === "int") {
      typeStr = "INTEGER[]";
    }
  } else if (def.type === "string") {
    typeStr = "VARCHAR(255)";
  } else if (def.type === "varchar") {
    typeStr = `VARCHAR(${def.length || 255})`;
  } else if (def.type === "int") {
    typeStr = "INTEGER";
  } else if (def.type === "text") {
    typeStr = "TEXT";
  } else if (def.type === "jsonb") {
    typeStr = "JSONB";
  } else if (def.type === "timestamp") {
    typeStr = "TIMESTAMP";
  } else if (typeof rawDef === "string" && rawDef.startsWith("ref:")) {
    refTable = rawDef.split(":")[1];
    typeStr = "INTEGER";
  } else if (def.ref) {
    refTable = def.ref.table;
    refTarget = def.ref.to || "id";
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

  if (def.min !== undefined || def.max !== undefined || def.lowercase) {
    // Metadata only for future tooling.
  }

  let fkSQL: string | undefined;
  if (refTable) {
    fkSQL = `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY ("${colName}") REFERENCES ${refTable}(${refTarget})${onDelete}`;
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
      if (fkSQL) {
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
      hash TEXT NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    );
  `, [], url);
  
  // Ensure unique index separately to avoid syntax error issues in some environments
  await runQuery(`CREATE UNIQUE INDEX IF NOT EXISTS _kadak_migrations_hash_idx ON _kadak_migrations (hash)`, [], url);

  // 2. Check if hash exists
  const existing = await runQuery(`SELECT id FROM _kadak_migrations WHERE hash = $1`, [currentHash], url);
  if (existing.length > 0) {
    console.log("ℹ️ [Kadak] No changes detected. Schema is up to date.");
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
      console.log(`✨ [Kadak] New table detected: ${tableName}`);
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
          const { columnSQL, fkSQL } = generateColumnSQL(colName, rawDef, tableName, indexStatements);
          if (columnSQL) {
            console.log(`➕ [Kadak] New column detected: ${tableName}.${colName}`);
            statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${columnSQL};`);
          }
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
    console.log("✅ [Kadak] Schema migration applied successfully.");
  } else {
    // If no SQL was generated but hash was different (shouldn't happen with our logic but for safety)
    await runQuery(`INSERT INTO _kadak_migrations (hash) VALUES ($1)`, [currentHash], url);
    console.log("ℹ️ [Kadak] Migration metadata updated.");
  }
}
