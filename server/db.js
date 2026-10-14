import mysql from "mysql2/promise";
import { MARKETING_DATABASE } from './policy.js';

let pool;

export function isDatabaseConfigured() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD);
}

export function getPool() {
  if (!isDatabaseConfigured()) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: MARKETING_DATABASE,
      waitForConnections: true,
      connectionLimit: 3,
      enableKeepAlive: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 8000,
      timezone: "+08:00"
    });
  }
  return pool;
}

export async function checkDatabase() {
  const db = getPool();
  if (!db) return { configured: false, connected: false };
  try {
    const [[row]] = await db.query("SELECT 1 AS ok");
    return { configured: true, connected: Number(row.ok) === 1, name: MARKETING_DATABASE };
  } catch (error) {
    return { configured: true, connected: false, error: error.code || "CONNECTION_FAILED" };
  }
}
