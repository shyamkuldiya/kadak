import { QueryAST, RelationAST, Predicate, OrderBy } from "./ast.js";

export type Plan = {
  from: string;
  joins: Array<{
    table: string;
    alias?: string;
    on: [string, string];
  }>;
  where?: Predicate[];
  orderBy?: OrderBy;
};

export function buildPlan(ast: QueryAST, schema: Record<string, Record<string, string>>): Plan {
  const plan: Plan = {
    from: ast.root,
    joins: [],
    where: ast.where,
    orderBy: ast.orderBy
  };

  traverse(ast.root, ast.relations, plan, schema);
  return plan;
}

function traverse(
  parentTableOrAlias: string, 
  relations: RelationAST[], 
  plan: Plan, 
  schema: Record<string, Record<string, string>>
) {
  for (const rel of relations) {
    const parentTable = findTable(parentTableOrAlias, plan);
    const target = schema[parentTable]?.[rel.name];
    
    if (!target) {
      throw new Error(`Invalid relation: ${rel.name} not found on ${parentTable}`);
    }

    const [targetTable, targetField] = target.split(".");
    
    const alias = rel.name !== targetTable ? rel.name : undefined;
    const targetIdentifier = alias || targetTable;

    let onCondition: [string, string];
    if (targetField === "id") {
      onCondition = [`${parentTableOrAlias}.${rel.name}id`, `${targetIdentifier}.${targetField}`];
    } else {
      onCondition = [`${targetIdentifier}.${targetField}`, `${parentTableOrAlias}.id`];
    }

    plan.joins.push({
      table: targetTable,
      alias: alias,
      on: onCondition
    });

    traverse(targetIdentifier, rel.relations, plan, schema);
  }
}

function findTable(id: string, plan: Plan): string {
  if (id === plan.from) return id;
  const join = plan.joins.find(j => (j.alias || j.table) === id);
  return join ? join.table : id;
}
