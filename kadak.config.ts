import { kadak } from "./src/index.js";
import { users } from "./tables/users.js";

const db = kadak({
  url: process.env.DATABASE_URL || "postgres://localhost:5432/mock"
});

export const dbClient = db.define({ users });

export default dbClient;
