import { kadak } from "../src/index.js";

async function runVerification() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  const db = kadak({ url: DB_URL });

  const users = kadak.table({ name: "users", columns: { id: "users.id", tasks: "tasks.userid" } });
  const tasks = kadak.table({ name: "tasks", columns: { id: "tasks.id", userid: "ref:users", comments: "comments.taskid" } });
  const comments = kadak.table({ name: "comments", columns: { id: "comments.id", taskid: "ref:tasks", author: "users.id" } });

  const dbClient = db.define({ users, tasks, comments });

  console.log("\n🚀 KADAK MANUAL VERIFICATION VIEW\n" + "=".repeat(40));

  try {
    const result = await dbClient.data({
      tasks: {
        comments: {
          author: true
        }
      }
    });

    console.log(`\n📦 ROOT: tasks (Found ${result.length} unique tasks)`);
    
    // Check for root-level duplicates
    const ids = new Set();
    const duplicates = result.filter((row: any) => ids.has(row.id) || !ids.add(row.id));
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

await runVerification();
