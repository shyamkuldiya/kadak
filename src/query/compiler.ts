import { Plan } from "./planner.js";
import { QueryAST, RelationAST } from "./ast.js";

export type Compiled = {
  text: string;
  values: unknown[];
};

export function compileSQL(plan: Plan, ast: QueryAST, schema: Record<string, Record<string, any>>): Compiled {
  const values: unknown[] = [];
  const selections: string[] = [];

  const addTableColumns = (tableName: string, alias?: string, select?: Record<string, true>) => {
    const tableId = alias || tableName;
    const tableSchema = schema[tableName] || {};
    const fields = select ? Object.keys(select) : Object.keys(tableSchema).filter(field => {
      const mapping = tableSchema[field];
      if (field === "id") return false;
      if (typeof mapping === "string" && mapping.includes(".")) return false;
      if (typeof mapping === "object" && mapping !== null && "table" in mapping && "as" in mapping) return false;
      return true;
    });

    const hasId = !select || select.id;
    if (hasId) {
      selections.push(`${tableId}.id AS "${tableId}__id"`);
    }

    for (const field of fields) {
      if (field === "id") continue;
      selections.push(`${tableId}."${field}" AS "${tableId}__${field}"`);
    }
  };

  const walkRelations = (tableName: string, relations: RelationAST[]) => {
    for (const rel of relations) {
      const mapping = schema[tableName]?.[rel.name];
      if (!mapping || typeof mapping !== "object" || !("table" in mapping)) continue;
      const alias = mapping.as !== mapping.table ? mapping.as : undefined;
      addTableColumns(mapping.table, alias, rel.select);
      walkRelations(mapping.table, rel.relations);
    }
  };

  // Select for root
  addTableColumns(plan.from, undefined, ast.select);
  walkRelations(plan.from, ast.relations);

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
