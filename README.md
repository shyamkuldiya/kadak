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

### Basic Setup

```typescript
import { kadak } from "@shyk/kadak"

const db = kadak({ url: "postgres://..." })

// 1. Define tables explicitly
const users = kadak.table({
  name: "users",
  columns: {
    name: "string",
    email: { type: "string", unique: true }
  }
})

// 2. Register them to get a typed instance
const k = db.define({ users })

// 3. Push schema to database
await k.push()
```

---

### Insert Mutation

```typescript
const alice = await k.insert("users", {
  name: "Alice",
  email: "alice@example.com"
})

console.log(alice) // { id: 1, name: "Alice", email: "alice@example.com" }
```

---

### Update Mutation

```typescript
const updatedUsers = await k.update("users", {
  where: { id: 1 },
  data: { name: "Bob" }
})

console.log(updatedUsers) // [{ id: 1, name: "Bob", email: "alice@example.com" }]
```

---

### Delete Mutation

```typescript
const deletedUsers = await k.delete("users", {
  where: { id: 1 }
})

console.log(deletedUsers) // [{ id: 1, name: "Bob", ... }]
```

---

### Basic Query

```typescript
const tasks = await k.data({
  tasks: {
    where: { id: 1 }
  }
})
```

---

### Nested Query

Query across relations with automatic result normalization and deterministic ordering.

```typescript
const result = await k.data({
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
await k.data({
  users: {
    where: { email: "alice@example.com" }
  }
})
```

#### Nesting
Fetch related data defined in your schema.
```typescript
await k.data({
  posts: {
    author: true,
    comments: true
  }
})
```

#### Ordering
Stable, deterministic ordering using `asc` or `desc`.
```typescript
await k.data({
  tasks: {
    orderBy: { createdAt: "desc" }
  }
})
```

---

### Debugging

Every query object provides introspection tools to verify generated SQL and internal state.

```typescript
const q = k.data({ tasks: { comments: true } })

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
