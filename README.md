# Kadak — PostgreSQL Data Runtime

Kadak is a PostgreSQL-first declarative data runtime that unifies schema definition, query construction, and result normalization into a single object-based language.

### Why Kadak?
Traditional ORMs obscure SQL performance. Kadak provides a lossless mapping where every object corresponds 1:1 to a PostgreSQL capability, ensuring deterministic execution and predictable performance.

---

### Install

```bash
npm install @shyk/kadak
```

---

### Quick Example

```typescript
import { kadak } from "@shyk/kadak"
const { t } = kadak

const db = kadak({ url: process.env.DATABASE_URL })

// 1. Define tables
const users = kadak.table({
  name: "users",
  columns: {
    name: t.string().notNull(),
    email: t.string().unique().notNull(),
    ...t.timestamps()
  }
})

const k = db.define({ users })

// 2. Query with nested relations
const data = await k.data({
  users: {
    where: { id: 1 },
    posts: {
      comments: true
    }
  }
})
```

---

### CLI Usage

Kadak includes a CLI for syncing your schema with the database.

1. Create `kadak.config.ts` in your root:

```typescript
import { kadak } from "@shyk/kadak"
const { t } = kadak

const users = kadak.table({
  name: "users",
  columns: { name: t.string() }
})

export default {
  url: process.env.DATABASE_URL,
  schema: { users }
}
```

2. Run the push command:

```bash
npx kadak push
```

---

### Mutations

```typescript
// Insert
const user = await k.insert("users", { name: "Alice" })

// Update
await k.update("users", {
  where: { id: 1 },
  data: { name: "Bob" }
})

// Delete
await k.delete("users", { where: { id: 1 } })
```

---

### Debugging

```typescript
const q = k.data({ users: true })

console.log(q.toSQL())  // { sql, values }
await q.explain()       // EXPLAIN ANALYZE result
console.log(q.trace())  // Full internal state (AST, Plan, SQL)
```

---

### Status
**v0.0.1 (Experimental)**  
Kadak is in early development. The API focuses on core relational mechanics and deterministic execution.

### License
Apache-2.0
