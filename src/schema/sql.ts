import { MigrationOp } from "./diff.js";

export function generateSQL(ops: MigrationOp[]): string[] {
  const statements: string[] = [];

  for (const op of ops) {
    switch (op.type) {
      case "create_table":
        statements.push(`CREATE TABLE IF NOT EXISTS ${op.table} ();`);
        break;
      
      case "add_column": {
        let typeStr = "";
        
        if (op.def.type === "serial") {
          typeStr = "SERIAL PRIMARY KEY";
        } else if ("refTable" in op.def) {
          typeStr = "INTEGER"; // Assume ID references are integer for now
        } else {
          typeStr = op.def.type.toUpperCase();
          if (op.def.length) typeStr += `(${op.def.length})`;
        }

        let constraints = "";
        if (!op.def.nullable && op.def.type !== "serial") constraints += " NOT NULL";
        if (op.def.unique) constraints += " UNIQUE";
        if (op.def.default !== undefined) {
          const val = typeof op.def.default === 'string' ? `'${op.def.default}'` : op.def.default;
          constraints += ` DEFAULT ${val}`;
        }

        statements.push(`ALTER TABLE ${op.table} ADD COLUMN ${op.column} ${typeStr}${constraints};`);
        break;
      }
      
      case "add_fk": {
        let sql = `ALTER TABLE ${op.table} ADD CONSTRAINT fk_${op.table}_${op.column} FOREIGN KEY (${op.column}) REFERENCES ${op.refTable}(${op.refColumn})`;
        if (op.onDelete) {
          sql += ` ON DELETE ${op.onDelete.toUpperCase()}`;
        }
        statements.push(sql + ";");
        break;
      }

      case "add_index": {
        const uniqueStr = op.unique ? "UNIQUE " : "";
        statements.push(`CREATE ${uniqueStr}INDEX idx_${op.table}_${op.column} ON ${op.table}(${op.column});`);
        break;
      }
    }
  }

  return statements;
}
