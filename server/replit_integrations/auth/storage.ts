import { users, normalizeEmail, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalized = normalizeEmail(email);
    if (!normalized) return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`);
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const payload: UpsertUser = { ...userData };
    if (payload.email !== undefined) {
      payload.email = normalizeEmail(payload.email);
    }
    const [user] = await db
      .insert(users)
      .values(payload)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...payload,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }
}

export const authStorage = new AuthStorage();
