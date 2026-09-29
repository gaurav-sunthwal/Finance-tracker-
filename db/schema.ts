import { pgTable, serial, text, timestamp, real, varchar, customType, primaryKey, integer } from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  emailId: varchar("email_id", { length: 255 }).unique().notNull(), // Gmail Message ID to prevent duplicates
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  subject: text("subject"),
  sender: text("sender"),
  date: timestamp("date").notNull(),
  amount: real("amount").notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'debit' or 'credit'
  merchant: varchar("merchant", { length: 255 }),
  category: varchar("category", { length: 255 }),
  accountSnippet: varchar("account_snippet", { length: 50 }),
  rawSnippet: text("raw_snippet"),
  
  // Future proofing for AI semantic search
  embedding: vector("embedding"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
