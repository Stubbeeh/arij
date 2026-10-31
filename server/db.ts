import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const globalForDb = globalThis as unknown as { arijDb?: Database.Database };

function open(): Database.Database {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "arij.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      next_number INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS collaborators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      UNIQUE (project_id, name)
    );
    CREATE TABLE IF NOT EXISTS statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE (project_id, name)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      reporter TEXT NOT NULL,
      assignee TEXT,
      estimation REAL,
      status_id INTEGER NOT NULL REFERENCES statuses(id),
      parent_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      UNIQUE (project_id, number)
    );
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('link', 'file')),
      label TEXT NOT NULL DEFAULT '',
      url TEXT,
      storage_name TEXT UNIQUE,
      original_name TEXT,
      content_type TEXT,
      size INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (kind = 'link' AND url IS NOT NULL AND storage_name IS NULL AND original_name IS NULL AND size IS NULL) OR
        (kind = 'file' AND url IS NULL AND storage_name IS NOT NULL AND original_name IS NOT NULL AND size IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stage_statuses (
      stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      status_id INTEGER NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (stage_id, status_id),
      UNIQUE (board_id, status_id)
    );
  `);
  return db;
}

export const db = (globalForDb.arijDb ??= open());
