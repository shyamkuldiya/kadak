import { QueryAST, RelationAST } from "../query/ast.js";

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * Supports both aliased (table__col) and raw rows (for mutations).
 */
export function normalize(rows: any[], ast: QueryAST, schema: Record<string, Record<string, any>>): any[] {
  const rootMap = new Map<unknown, any>();
  const results: any[] = [];

  const rootPrefix = `${ast.root}__`;

  for (const row of rows) {
    // Check for aliased ID first, then fallback to raw 'id' (for mutations)
    const id = row[`${rootPrefix}id`] ?? row.id;
    if (id === null || id === undefined) continue;

    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = { id };
      // Map root fields: handle both aliased and raw
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix)) {
          if (key !== `${rootPrefix}id`) rootObj[key.replace(rootPrefix, "")] = val;
        } else if (!key.includes("__")) {
          // If it's a raw column (no __ in name) and not 'id'
          if (key !== "id") rootObj[key] = val;
        }
      }
      rootMap.set(id, rootObj);
      results.push(rootObj);
    }

    processRelations(ast.root, rootObj, row, ast.relations, schema);
  }

  return results;
}

function processRelations(
  parentTable: string,
  parentObj: any,
  row: any,
  relations: RelationAST[],
  schema: Record<string, Record<string, any>>
) {
  for (const rel of relations) {
    const target = schema[parentTable]?.[rel.name] as unknown as RelationDefinition | string | undefined;
    if (!target) continue;

    const relation = typeof target === "string"
      ? { table: target.split(".")[0], as: rel.name, to: target.split(".")[1] || "id", source: rel.name }
      : target;
    const targetTable = relation.table;
    const targetField = relation.to;
    const isOneToMany = targetField !== "id";

    const prefix = `${rel.name}__`;
    const relId = row[`${prefix}id`];
    
    if (relId === null || relId === undefined) {
      if (!parentObj.hasOwnProperty(rel.name)) {
        parentObj[rel.name] = isOneToMany ? [] : null;
      }
      continue;
    }

    let relObj: any;
    if (isOneToMany) {
      if (!parentObj[rel.name]) parentObj[rel.name] = [];
      relObj = parentObj[rel.name].find((item: any) => item.id === relId);
    } else {
      relObj = parentObj[rel.name];
    }

    if (!relObj) {
      relObj = { id: relId };
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(prefix) && key !== `${prefix}id`) {
          relObj[key.replace(prefix, "")] = val;
        }
      }

      if (isOneToMany) {
        parentObj[rel.name].push(relObj);
      } else {
        parentObj[rel.name] = relObj;
      }
    }

    if (rel.relations.length > 0) {
      processRelations(targetTable, relObj, row, rel.relations, schema);
    }
  }
}
