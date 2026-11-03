import { createRequire } from 'node:module'
import type { Database as DatabaseType } from 'better-sqlite3'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => DatabaseType

export type TicketRow = {
  ticket_id: string
  sub: string
  name: string
  device_id: string
  device_uuid: string
  status: 'waiting' | 'active' | 'closed'
  created_at: string
  closed_at: string | null
  supporter_sub: string | null
}

export function openDb(path: string) {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      sub TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket (
      ticket_id TEXT PRIMARY KEY,
      sub TEXT NOT NULL,
      name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_uuid TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT,
      supporter_sub TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ticket_open_device
      ON ticket(device_id) WHERE status IN ('waiting', 'active');
    CREATE TABLE IF NOT EXISTS used_jti (
      jti TEXT PRIMARY KEY,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS acl_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL DEFAULT '',
      api_key_enc TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'off'
    );
    CREATE TABLE IF NOT EXISTS acl_push_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      sub TEXT NOT NULL,
      result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS acl_shadow_diff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      sub TEXT NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device (
      device_id TEXT PRIMARY KEY,
      device_uuid TEXT NOT NULL,
      sub TEXT NOT NULL,
      name TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      presence_exp INTEGER NOT NULL DEFAULT 0
    );
  `)
  const columns = db.prepare(`PRAGMA table_info(device)`).all() as { name: string }[]
  if (!columns.some((column) => column.name === 'presence_exp')) {
    db.exec(`ALTER TABLE device ADD COLUMN presence_exp INTEGER NOT NULL DEFAULT 0`)
  }
  return db
}

export function rememberDevice(db: Db, deviceId: string, deviceUuid: string, sub: string, name: string, exp: number) {
  db.prepare(
    `INSERT INTO device (device_id, device_uuid, sub, name, last_seen, presence_exp)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       device_uuid = excluded.device_uuid,
       sub = excluded.sub,
       name = excluded.name,
       last_seen = excluded.last_seen,
       presence_exp = excluded.presence_exp`,
  ).run(deviceId, deviceUuid, sub, name, new Date().toISOString(), exp)
}

export function closeExpiredTickets(db: Db, nowSec = Math.floor(Date.now() / 1000)) {
  db.prepare(
    `UPDATE ticket SET status = 'closed', closed_at = ?
     WHERE status IN ('waiting', 'active')
       AND device_uuid IN (
         SELECT device_uuid FROM device WHERE presence_exp > 0 AND presence_exp <= ?
       )`,
  ).run(new Date().toISOString(), nowSec)
}

export type Db = ReturnType<typeof openDb>
