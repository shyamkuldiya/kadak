import { Plan } from "./planner.js";

export type Compiled = {
  text: string;
  values: unknown[];
};

export function compileSQL(plan: Plan, schema: Record<string, Record<string, any>>): Compiled {
  const values: unknown[] = [];
  const selections: string[] = [];

  // Helper to add columns for a table
  const addTableColumns = (tableName: string, alias?: string) => {
    const tableId = alias || tableName;
    const tableSchema = schema[tableName] || {};
    
    // Always include ID
    selections.push(`${tableId}.id AS "${tableId}__id"`);
    
    // Include only fields that are NOT relations
    for (const [field, mapping] of Object.entries(tableSchema)) {
      if (field === "id") continue;
      if (typeof mapping === "string" && mapping.includes(".")) continue;
      if (typeof mapping === "object" && mapping !== null && "table" in mapping && "as" in mapping) continue;
      // Quote both the field and the alias to preserve case
      selections.push(`${tableId}."${field}" AS "${tableId}__${field}"`);
    }
  };

  // Select for root
  addTableColumns(plan.from);

  // Select for joins
  for (const join of plan.joins) {
    addTableColumns(join.table, join.alias);
  }

  let sql = `SELECT ${selections.join(", ")} FROM ${plan.from}\n`;

  for (const join of plan.joins) {
    const aliasStr = join.alias ? ` ${join.alias}` : "";
    const [onLeft, onRight] = join.on.map(part => {
      const [table, field] = part.split(".");
      return `${table}."${field}"`;
    });
    sql += `LEFT JOIN ${join.table}${aliasStr} ON ${onLeft} = ${onRight}\n`;
  }

  if (plan.where && plan.where.length > 0) {
    const whereClauses = plan.where.map(p => {
      values.push(p.value);
      return `${plan.from}."${p.field}" = $${values.length}`;
    }).join(" AND ");
    sql += `WHERE ${whereClauses}\n`;
  }

  if (plan.orderBy) {
    sql += `ORDER BY ${plan.from}."${plan.orderBy.field}" ${plan.orderBy.direction.toUpperCase()}\n`;
  }

  return { text: sql.trim(), values };
}
