import { CanonicalSchemaDef, DBSchema, CanonicalColumn, CanonicalRef } from "./types.js";

export type MigrationOp =
  | { type: "create_table"; table: string }
  | { type: "add_column"; table: string; column: string; def: CanonicalColumn | CanonicalRef | { type: "serial", primaryKey: true } }
  | { type: "add_fk"; table: string; column: string; refTable: string; refColumn: string; onDelete?: string }
  | { type: "add_index"; table: string; column: string; unique: boolean };

export function diffSchemas(desired: CanonicalSchemaDef, current: DBSchema): MigrationOp[] {
  const ops: MigrationOp[] = [];

  for (const [tableName, tableDef] of Object.entries(desired)) {
    const currentTable = current.tables[tableName];

    if (!currentTable) {
      ops.push({ type: "create_table", table: tableName });
      // Implicitly add ID primary key for new tables per standard conventions in v0.0.1
      ops.push({ type: "add_column", table: tableName, column: "id", def: { type: "serial", primaryKey: true } });
    }

    for (const [colName, colDef] of Object.entries(tableDef)) {
      const isNewCol = !currentTable || !currentTable.columns[colName];
      
      if (isNewCol) {
        ops.push({ type: "add_column", table: tableName, column: colName, def: colDef });
      }
      
      if ("refTable" in colDef) {
        const hasFk = currentTable?.fks.some(fk => fk.column === colName && fk.refTable === colDef.refTable);
        if (!hasFk) {
          ops.push({
            type: "add_fk",
            table: tableName,
            column: colName,
            refTable: colDef.refTable,
            refColumn: "id",
            onDelete: colDef.onDelete
          });
        }
        
        if (colDef.index) {
          const hasIdx = currentTable?.indexes.some(idx => idx.columns.includes(colName));
          if (!hasIdx) {
            ops.push({ type: "add_index", table: tableName, column: colName, unique: colDef.unique ?? false });
          }
        }
      }
    }
  }

  // Order of operations is important:
  // 1. Create tables
  // 2. Add columns
  // 3. Add FKs & Indexes
  ops.sort((a, b) => {
    const order = { create_table: 1, add_column: 2, add_index: 3, add_fk: 4 };
    return order[a.type] - order[b.type];
  });

  return ops;
}
