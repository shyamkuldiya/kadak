import { kadak } from "../src/index.js";

async function runOrderTest() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Deterministic Ordering Test ---");

  const db = kadak({ 
    url: DB_URL,
    schema: {
      tasks: { id: "tasks.id", title: "tasks.title" }
    }
  });

  try {
    // 1. Order by ID ASC
    console.log("\n1. Order by ID ASC:");
    const q1 = await db.data({
      tasks: {
        orderBy: { id: "asc" }
      }
    }, { debug: true });
    console.log("SQL:", q1.sql);
    console.log("First 3 IDs:", q1.data.slice(0, 3).map((t: any) => t.id));

    // 2. Order by ID DESC
    console.log("\n2. Order by ID DESC:");
    const q2 = await db.data({
      tasks: {
        orderBy: { id: "desc" }
      }
    }, { debug: true });
    console.log("SQL:", q2.sql);
    console.log("First 3 IDs:", q2.data.slice(0, 3).map((t: any) => t.id));

    // Verification
    const ascIds = q1.data.map((t: any) => t.id);
    const descIds = [...ascIds].reverse();
    const actualDescIds = q2.data.map((t: any) => t.id);

    if (JSON.stringify(descIds) === JSON.stringify(actualDescIds)) {
      console.log("\n✅ Success: Ordering is deterministic and stable.");
    } else {
      console.log("\n❌ Failure: Ordering mismatch.");
    }

  } catch (e: any) {
    console.error("\n❌ Order Test Failed:", e.message);
  } finally {
    await db.close();
  }
}

runOrderTest();
