import { kadak } from "../src/index.js";
import { runQuery } from "../src/exec/client.js";

async function testTransactions() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
  const db = kadak({ url: DB_URL });

  const tx_users = kadak.table({
    name: "tx_users",
    columns: {
      name: "string",
      balance: "int"
    }
  });

  const dbClient = db.define({ tx_users });

  try {
    console.log("--- Kadak Transaction Test ---");
    
    console.log("1. Pushing Schema...");
    await dbClient.push();

    console.log("2. Cleaning table...");
    await runQuery("DELETE FROM tx_users", [], DB_URL);

    // --- TEST 1: SUCCESSFUL TRANSACTION ---
    console.log("3. Testing Successful Transaction...");
    await dbClient.transaction(async (tx) => {
      const user = await tx.insert("tx_users", { name: "Alice", balance: 100 });
      await tx.update("tx_users", {
        where: { id: user.id },
        data: { balance: 150 }
      });
    });

    const alice = await dbClient.data({ tx_users: { where: { name: "Alice" } } });
    if (alice[0].balance === 150) {
      console.log("✅ Success: Transaction committed (Alice balance is 150).");
    } else {
      throw new Error(`❌ Failure: Transaction failed to commit correct balance. Got ${alice[0].balance}`);
    }

    // --- TEST 2: ROLLBACK ON ERROR ---
    console.log("4. Testing Rollback on Error...");
    try {
      await dbClient.transaction(async (tx) => {
        await tx.insert("tx_users", { name: "Bob", balance: 200 });
        throw new Error("Simulated Error");
      });
    } catch (e: any) {
      if (e.message === "Simulated Error") {
        console.log("Caught simulated error.");
      } else {
        throw e;
      }
    }

    const bob = await dbClient.data({ tx_users: { where: { name: "Bob" } } });
    if (bob.length === 0) {
      console.log("✅ Success: Transaction rolled back (Bob not found).");
    } else {
      throw new Error("❌ Failure: Transaction failed to rollback (Bob was found).");
    }

    console.log("\n✨ All transaction tests passed.");

  } catch (e: any) {
    console.error("\n❌ Test Failed:", e.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

await testTransactions();
