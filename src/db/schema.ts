import { boolean, integer, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  age: integer().notNull(),
  email: varchar({ length: 255 }).notNull().unique(),

  // nullable, to exercise null handling alongside coercion
  nickname: varchar({ length: 255 }),
  bio: varchar({ length: 2000 }),

  // numeric coercion: arrives as a string from query params and JSON alike.
  // mode: "number" is what makes drizzle-zod emit a number schema; the default
  // string mode emits a plain z.string(), which accepts "abc" for a numeric column.
  creditBalance: numeric({ precision: 10, scale: 2, mode: "number" }),
  loginCount: integer().notNull().default(0),

  // date coercion: arrives as an ISO string
  birthDate: timestamp({ mode: "date" }),
  lastSeenAt: timestamp({ mode: "date" }),

  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ mode: "date" }).notNull().defaultNow(),
});
