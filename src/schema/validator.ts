export function validateInput(input: Record<string, unknown>, schema: Record<string, Record<string, any>>) {
  if (Object.keys(input).length === 0) {
    throw new Error("❌ Kadak Error: Input cannot be empty. Please provide a table to query.");
  }

  const rootTable = Object.keys(input)[0];
  if (!schema[rootTable] && rootTable !== "where") {
    const suggestions = getSuggestions(rootTable, Object.keys(schema));
    throw new Error(`❌ Kadak Error: Table '${rootTable}' not found. ${suggestions}`);
  }

  validateNode(rootTable, input[rootTable] as Record<string, unknown>, schema);
}

function validateNode(tableName: string, nodeInput: Record<string, unknown>, schema: Record<string, Record<string, any>>) {
  const tableSchema = schema[tableName] || {};
  const validFields = Object.keys(tableSchema);

  for (const [key, value] of Object.entries(nodeInput)) {
    if (key === "where") {
      const whereObj = value as Record<string, unknown>;
      for (const field of Object.keys(whereObj)) {
        if (field !== "id" && !tableSchema[field]) {
          const suggestions = getSuggestions(field, validFields);
          throw new Error(`❌ Kadak Error: Invalid filter field '${field}' on table '${tableName}'. ${suggestions}`);
        }
      }
    } else if (key === "limit" || key === "orderBy") {
       continue;
    } else {
      // It's a relation
      const target = tableSchema[key];
      if (!target) {
        const suggestions = getSuggestions(key, validFields);
        throw new Error(`❌ Kadak Error: Relation '${key}' not found on table '${tableName}'. ${suggestions}`);
      }

      if (typeof value === "object" && value !== null) {
        if (typeof target === "object" && target !== null && "table" in target) {
          validateNode((target as any).table, value as Record<string, unknown>, schema);
        }
      }
    }
  }
}

function getSuggestions(input: string, validOptions: string[]): string {
  if (validOptions.length === 0) return "";
  
  // Very simple "did you mean" based on partial matching
  const matches = validOptions.filter(opt => opt.includes(input) || input.includes(opt));
  if (matches.length > 0) {
    return `Did you mean: ${matches.join(", ")}?`;
  }
  return `Available: ${validOptions.join(", ")}`;
}
