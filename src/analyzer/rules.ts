import { Plan } from "../query/planner.js";

export type AnalyzerWarning = {
  type: "warning";
  message: string;
  suggestion: string;
};

export function analyzePlan(plan: Plan): AnalyzerWarning[] {
  const warnings: AnalyzerWarning[] = [];

  // 1. Detect High Fan-out (multiple 1:N joins)
  // For v0.0.1 we use a simple heuristic: if there are > 1 LEFT JOINs, warn about potential fan-out.
  if (plan.joins.length > 1) {
    warnings.push({
      type: "warning",
      message: `High fan-out detected on query starting at '${plan.from.table}'. Multiple joins may cause row explosion.`,
      suggestion: "Consider paginating relations or splitting queries.",
    });
  }

  // 2. Missing Index (heuristic: FK used in join condition)
  for (const join of plan.joins) {
    for (const cond of join.on) {
      warnings.push({
         type: "warning",
         message: `Foreign key used in JOIN on ${join.table}: ${cond.right}`,
         suggestion: `Ensure there is an index on ${cond.right} to avoid full table scans.`,
      });
    }
  }

  return warnings;
}
