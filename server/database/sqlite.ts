import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { paths } from "../config.js";

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  const db = new DatabaseSync(path.join(paths.data, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

export const now = () => new Date().toISOString();
