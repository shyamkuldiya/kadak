import { QueryAST, RelationAST } from "../query/ast.js";

/**
 * Normalizes flat SQL rows into a nested object graph based on the AST structure.
 * Groups by 'id' and avoids duplicates.
 * All columns are expected to be aliased as 'tableId__columnName'.
 */
export function normalize(rows: any[], ast: QueryAST, schema: Record<string, Record<string, any>>): any[] {
  const rootMap = new Map<unknown, any>();
  const results: any[] = [];

  const rootPrefix = `${ast.root}__`;

  for (const row of rows) {
    const id = row[`${rootPrefix}id`];
    if (id === null || id === undefined) continue;

    let rootObj = rootMap.get(id);
    if (!rootObj) {
      rootObj = { id };
      // Map root fields
      for (const [key, val] of Object.entries(row)) {
        if (key.startsWith(rootPrefix) && key !== `${rootPrefix}id`) {
          rootObj[key.replace(rootPrefix, "")] = val;
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
  schema: Record<string, Record<string, string>>
) {
  for (const rel of relations) {
    const target = schema[parentTable]?.[rel.name];
    if (!target) continue;

    const [targetTable, targetField] = target.split(".");
    const isOneToMany = targetField !== "id";

    // Use relation name as alias/prefix (consistent with Planner/Compiler)
    const prefix = `${rel.name}__`;
    const relId = row[`${prefix}id`];
    
    if (relId === null || relId === undefined) {
      if (!parentObj.hasOwnProperty(rel.name)) {
        parentObj[rel.name] = isOneToMany ? [] : null;
      }
      continue;
    }

    // Identify/Create object
    let relObj: any;
    if (isOneToMany) {
      if (!parentObj[rel.name]) parentObj[rel.name] = [];
      relObj = parentObj[rel.name].find((item: any) => item.id === relId);
    } else {
      relObj = parentObj[rel.name];
    }

    if (!relObj) {
      relObj = { id: relId };
      // Map fields for this relation
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
