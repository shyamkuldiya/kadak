export function validateInput(input: Record<string, unknown>, schema: Record<string, Record<string, string>>) {
  if (Object.keys(input).length === 0) {
    throw new Error("Input cannot be empty");
  }

  const rootTable = Object.keys(input)[0];
  if (!schema[rootTable] && rootTable !== "where") {
    throw new Error(`Missing schema mapping for table: ${rootTable}`);
  }

  validateNode(rootTable, input[rootTable] as Record<string, unknown>, schema);
}

function validateNode(tableName: string, nodeInput: Record<string, unknown>, schema: Record<string, Record<string, string>>) {
  const tableSchema = schema[tableName] || {};

  for (const [key, value] of Object.entries(nodeInput)) {
    if (key === "where") {
      const whereObj = value as Record<string, unknown>;
      for (const field of Object.keys(whereObj)) {
        // 'id' is a reserved/automatic field that is always valid
        if (field !== "id" && !tableSchema[field]) {
          throw new Error(`Invalid where field: ${field} not found on ${tableName}`);
        }
      }
    } else if (key === "limit" || key === "orderBy") {
       // Support basic query keys
       continue;
    } else {
      // It's a relation
      const target = tableSchema[key];
      if (!target) {
        throw new Error(`Invalid relation: ${key} not found on ${tableName}`);
      }

      if (typeof value === "object" && value !== null) {
        const [targetTable] = target.split(".");
        validateNode(targetTable, value as Record<string, unknown>, schema);
      }
    }
  }
}
