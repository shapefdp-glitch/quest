import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(1); }
const schema = fs.readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
try { await pool.query(schema); console.log("QuestPrint PostgreSQL schema initialized."); } finally { await pool.end(); }
