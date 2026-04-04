import { z } from "zod";

export const ScalarSchema = z.union([
  z.object({ type: z.literal("int"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.number().optional() }),
  z.object({ type: z.literal("varchar"), length: z.number(), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.string().optional() }),
  z.object({ type: z.literal("text"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.string().optional() }),
  z.object({ type: z.literal("jsonb"), nullable: z.boolean().optional(), unique: z.boolean().optional(), default: z.unknown().optional() }),
  z.literal("string"),
  z.literal("int"),
  z.literal("text"),
  z.literal("jsonb")
]);

export const RefSchema = z.object({
  ref: z.string(),
  nullable: z.boolean().optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  onDelete: z.enum(["cascade", "restrict", "set null"]).optional()
});

export const ColumnDefSchema = z.union([ScalarSchema, RefSchema]);

export const TableDefSchema = z.record(z.string(), ColumnDefSchema);

export const SchemaDefSchema = z.record(z.string(), TableDefSchema);

export const QueryInputSchema = z.record(z.string(), z.unknown());

export function validateSchemaDef(input: unknown) {
  return SchemaDefSchema.parse(input);
}

export function validateQueryInput(input: unknown) {
  return QueryInputSchema.parse(input);
}
