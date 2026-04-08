# Kadak Product Rules

These rules define how Kadak should evolve in this repo.

## Purpose
- Make PostgreSQL access simple to start.
- Keep the mental model explicit and predictable.
- Deliver strong TypeScript inference and reliable runtime behavior.
- Stay small enough to understand quickly, but strong enough for production use.

## Core Principles
- One source of truth for schema and relations.
- No duplicate config or hidden schema discovery.
- No guessing relation names, column names, or query intent.
- No silent fallback when something is invalid.
- No feature bloat that hides SQL shape.
- No unnecessary abstraction layers.

## DX Rules
- Favor readable object queries.
- Keep autocomplete useful for tables, fields, relations, and results.
- Keep error messages direct and specific.
- Keep the happy path simple for beginners.
- Keep advanced use cases explicit for experts.

## Runtime Rules
- Preserve correct SQL behavior.
- Preserve normalization correctness.
- Avoid join explosion when graphs become deep or reverse-heavy.
- Prefer explicit internal strategy changes over magical behavior.
- Do not change public API shape unless strictly required for correctness.

## Execution Rewrite Rules
- Use a staged execution plan, not branch-by-branch recursion.
- Batch relation loading by layer.
- Cache repeated table/path/value-set fetches within one query execution.
- Keep internal identity fields available until the final projection step.
- Separate hydration identity from user-visible projection.
- Parallelize independent sibling relation loads when safe.
- Stop refetching the same subgraph through cycles.
- Keep single-query execution only for simple shallow graphs.
- Use multi-query execution for deep graphs and reverse-heavy graphs.
- Keep result shaping deterministic and stable across repeated runs.

## Scope Rules
- Stay PostgreSQL-first.
- Do not expand into a full application framework.
- Do not add app-layer features like auth, routing, jobs, or UI scaffolding.
- Do not add runtime validation frameworks.
- Do not add broad multi-database support until the core is proven.

## Release Rule
- `v0.0.1` is the final scope for our direct work on Kadak.
- Only correctness, stability, DX, packaging, and essential production readiness belong before release.
- No new feature work beyond what is needed to make the tool complete and trustworthy.

## Maintenance Rule
- Treat this file as binding product guidance.
- If a change conflicts with these rules, it must be justified as necessary for correctness, stability, or essential DX.

## Rewrite Acceptance Rule
- Do not consider the engine rewrite complete until live benchmark runs show materially lower latency on deep and reverse-heavy queries and correctness remains stable.
