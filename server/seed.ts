import { db } from "./db";
import { users, departments } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Seeding database...");

  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@ahavamedical.com"));

  const hashedPassword = await bcrypt.hash("admin123", 10);

  if (!existingAdmin) {
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
    await db.update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.email, "admin@ahavamedical.com"));
    console.log("Updated admin user password: admin@ahavamedical.com / admin123");
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
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
