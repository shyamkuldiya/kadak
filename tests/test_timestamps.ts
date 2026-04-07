import { kadak } from "../src/index.js";

async function runTimestampTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
  const { types } = kadak;

  console.log("--- Kadak Defaults & Timestamps Tests ---");

  const db = kadak({ url: DB_URL });

  const users = kadak.table({
    name: "users_meta",
    columns: {
      name: types.string().default("guest"),
      age: types.int().default(0),
      ...types.timestamps()
    }
  });

  const dbClient = db.define({ users });

  try {
    // 1. Schema Push
    console.log("\n1. Pushing Schema...");
    await dbClient.push();
    console.log("✅ Schema pushed.");

    // 2. Default Values Test
    console.log("\n2. Default Values Test:");
    const guest = await dbClient.insert("users_meta", {});
    console.log("Guest User (should have defaults):", guest);
    
    if (guest.name === "guest" && guest.age === 0 && guest.createdAt) {
      console.log("✅ Success: Default values and createdAt applied.");
    } else {
      console.log("❌ Failure: Defaults missing.");
    }

    // 3. Override Default Test
    console.log("\n3. Override Default Test:");
    const admin = await dbClient.insert("users_meta", { name: "admin", age: 99 });
    console.log("Admin User (should override defaults):", admin);
    
    if (admin.name === "admin" && admin.age === 99) {
      console.log("✅ Success: Defaults overridden.");
    } else {
      console.log("❌ Failure: Defaults not overridden.");
    }

    // 4. updatedAt Auto-update Test
    console.log("\n4. updatedAt Auto-update Test:");
    const initialUpdatedAt = guest.updatedAt;
    
    // Wait a moment to ensure timestamp changes
    await new Promise(r => setTimeout(r, 1000));
    
    const [updatedGuest] = await dbClient.update("users_meta", {
      where: { id: guest.id },
      data: { age: 1 }
    });
    
    console.log("Initial updatedAt:", initialUpdatedAt);
    console.log("New updatedAt:", updatedGuest.updatedAt);

    if (new Date(updatedGuest.updatedAt).getTime() > new Date(initialUpdatedAt).getTime()) {
      console.log("✅ Success: updatedAt auto-updated.");
    } else {
      console.log("❌ Failure: updatedAt did not change.");
    }

  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  } finally {
    await db.close().catch(() => {});
  }
}

await runTimestampTests();
