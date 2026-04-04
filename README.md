# Kadak — PostgreSQL Data Runtime

Kadak is a PostgreSQL-first declarative data runtime that unifies schema definition, query construction, and result normalization into a single object-based language.

### Why Kadak?
Traditional ORMs obscure SQL performance with complex abstractions. Kadak provides a lossless mapping where every object corresponds 1:1 to a PostgreSQL capability, ensuring deterministic execution.

---

### Install

```bash
npm install @shyk/kadak
```

---

### Basic Query

```typescript
import { kadak } from "@shyk/kadak"

const db = kadak({ 
  url: "postgres://..."
})

await db.schema({
  tasks: {
    title: "string"
  }
}).push()

const tasks = await db.data({
  tasks: {
    where: { id: 1 }
  }
})
```

---

### Nested Query

Query across relations with automatic result normalization and deterministic ordering.

```typescript
const result = await db.data({
  tasks: {
    orderBy: { id: "desc" },
    comments: {
      author: true
    }
  }
})

// Result is a nested object graph
// tasks -> comments[] -> author {}
```

---

### Common Patterns

#### Filtering (where)
Equality-based filtering at the root level.
```typescript
await db.data({
  users: {
    where: { email: "alice@example.com" }
  }
})
```

#### Nesting
Fetch related data defined in your schema.
```typescript
await db.data({
  posts: {
    author: true,
    comments: true
  }
})
```

#### Ordering
Stable, deterministic ordering using `asc` or `desc`.
```typescript
await db.data({
  tasks: {
    orderBy: { createdAt: "desc" }
  }
})
```

---

### Debugging

Every query object provides introspection tools to verify generated SQL and internal state.

```typescript
const q = db.data({ tasks: { comments: true } })

// 1. Get compiled SQL and parameterized values
const { sql, values } = q.toSQL()

// 2. Run EXPLAIN ANALYZE on the live database
const plan = await q.explain()

// 3. View full internal lifecycle (AST -> Plan -> SQL)
const trace = q.trace()
```

---

### Status
**v0.0.1 (Experimental)**  
Kadak is in early development. The API focuses on core relational mechanics and deterministic execution.
