import { runQuery } from "../exec/client.js";

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

export function buildSchemaSQL(definition: SchemaDefinition): string[] {
  const statements: string[] = [];
  const indexStatements: string[] = [];

  for (const [tableName, columns] of Object.entries(definition)) {
    const colDefs: string[] = ["id SERIAL PRIMARY KEY"];
    const fkDefs: string[] = [];

    for (const [colName, rawDef] of Object.entries(columns)) {
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

      // 3. Assemble
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
