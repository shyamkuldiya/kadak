import { kadak } from "../src/index.js";

async function runVerification() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  const schemaMapping = {
    users: { id: "users.id", tasks: "tasks.userid" },
    tasks: { id: "tasks.id", userid: "users.id", comments: "comments.taskid" },
    comments: { id: "comments.id", taskid: "tasks.id", author: "users.id" }
  };

  const db = kadak({ url: DB_URL, schema: schemaMapping });

  console.log("\n🚀 KADAK MANUAL VERIFICATION VIEW\n" + "=".repeat(40));

  try {
    const result = await db.data({
      tasks: {
        comments: {
          author: true
        }
      }
    });

    console.log(`\n📦 ROOT: tasks (Found ${result.length} unique tasks)`);
    
    // Check for root-level duplicates
    const ids = new Set();
    const duplicates = result.filter((t: any) => ids.has(t.id) || !ids.add(t.id));
    if (duplicates.length > 0) {
      console.log(`🚨 DUPLICATES DETECTED: ${duplicates.length} duplicate IDs found!`);
    } else {
      console.log("✅ DEDUPLICATION: No duplicate tasks in result set.");
    }

    // Custom Tree Printer
    const printNode = (obj: any, level: number = 0) => {
      const pad = "  ".repeat(level);
      const pipe = level > 0 ? "└─ " : "";
      
      if (Array.isArray(obj)) {
        if (obj.length === 0) {
          console.log(`${pad}${pipe}[EMPTY ARRAY] ⚪️`);
          return;
        }
        obj.forEach((item, i) => {
          console.log(`${pad}${pipe}Item #${i + 1}:`);
          printNode(item, level + 1);
        });
      } else if (typeof obj === "object" && obj !== null) {
        for (const [key, value] of Object.entries(obj)) {
          if (value === null) {
            console.log(`${pad}${pipe}${key}: [NULL] ⚠️`);
          } else if (typeof value === "object") {
            console.log(`${pad}${pipe}${key} (Nest Level ${level + 1}):`);
            printNode(value, level + 1);
          } else {
            console.log(`${pad}${pipe}${key}: ${value}`);
          }
        }
      }
    };

    // Print first 2 tasks for manual verification
    result.slice(0, 2).forEach((task: any, index: number) => {
      console.log(`\n--- [ Task #${index + 1} Visual Tree ] ---`);
      printNode(task);
    });

    if (result.length > 2) {
      console.log(`\n... and ${result.length - 2} more tasks.`);
    }

  } catch (e: any) {
    console.error("\n❌ Verification Failed:", e.message);
  } finally {
    await db.close();
  }
}

runVerification();
