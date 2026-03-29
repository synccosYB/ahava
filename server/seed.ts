import { db } from "./db";
import { users, departments } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function seed() {
  console.log("Seeding database...");

  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@ahavamedical.com"));

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await db.insert(users).values({
      id: "admin-dev-001",
      email: "admin@ahavamedical.com",
      password: hashedPassword,
      firstName: "Admin",
      lastName: "User",
      role: "admin",
    });
    console.log("Created admin user: admin@ahavamedical.com / admin123");
  } else {
    console.log("Admin user already exists, skipping.");
  }

  const [existingDept] = await db
    .select()
    .from(departments)
    .where(eq(departments.name, "General"));

  if (!existingDept) {
    await db.insert(departments).values({
      name: "General",
      description: "General department",
    });
    console.log("Created General department.");
  } else {
    console.log("General department already exists, skipping.");
  }

  console.log("Seed complete.");
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
