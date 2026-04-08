import { QueryAST, RelationAST } from "../query/ast.js";

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

type Row = Record<string, unknown>;
type Schema = Record<string, Record<string, unknown>>;

/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * Supports both aliased (table__col for roots, relation_col for relations) and raw rows (for mutations).
 */
export function normalize(rows: Row[], ast: QueryAST, schema: Schema): Row[] {
  const rootMap = new Map<unknown, Row>();
  const results: Row[] = [];

  const rootPrefix = `${ast.root}__`;
  const directRelationPrefixes = new Set(ast.relations.map((rel) => `${rel.name}_`));

  for (const row of rows) {
    const id = row[`${rootPrefix}id`] ?? row.id;
    if (id === null || id === undefined) continue;

    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = { id };
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix)) {
          if (key !== `${rootPrefix}id`) rootObj[key.replace(rootPrefix, "")] = val;
        } else if (!key.includes("__") && !Array.from(directRelationPrefixes).some((prefix) => key.startsWith(prefix))) {
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
  parentObj: Row,
  row: Row,
  relations: RelationAST[],
  schema: Schema
) {
  for (const rel of relations) {
    const target = schema[parentTable]?.[rel.name] as RelationDefinition | string | undefined;
    if (!target) continue;

    const relation = typeof target === "string"
      ? { table: target.split(".")[0], as: rel.name, to: target.split(".")[1] || "id", source: rel.name }
      : target;
    const targetTable = relation.table;
    const targetField = relation.to;
    const isOneToMany = targetField !== "id";

    const prefix = `${rel.name}_`;
    const relId = row[`${prefix}id`];

    if (relId === null || relId === undefined) {
      if (!Object.prototype.hasOwnProperty.call(parentObj, rel.name)) {
        parentObj[rel.name] = isOneToMany ? [] : null;
      }
      continue;
    }

    let relObj: Row | undefined;
    if (isOneToMany) {
      if (!parentObj[rel.name]) parentObj[rel.name] = [];
      relObj = (parentObj[rel.name] as Row[]).find((item) => item.id === relId);
    } else {
      relObj = parentObj[rel.name] as Row | undefined;
    }

    if (!relObj) {
      relObj = { id: relId };
      for (const [key] of Object.entries(row)) {
        if (key.startsWith(prefix) && key !== `${prefix}id`) {
          relObj[key.replace(prefix, "")] = row[key];
        }
      }

      if (!rel.select?.id) {
        delete relObj.id;
      }

      if (isOneToMany) {
        (parentObj[rel.name] as Row[]).push(relObj);
      } else {
        parentObj[rel.name] = relObj;
      }
    }

    if (rel.relations.length > 0) {
      processRelations(targetTable, relObj, row, rel.relations, schema);
    }
  }
}
