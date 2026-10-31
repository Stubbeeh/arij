import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { ApiError, notFound } from "../http";
import type { TicketAttachment } from "@/shared/types";

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

type TicketRow = { id: number; key: string };
type AttachmentRow = {
  id: number;
  ticket_id: number;
  kind: "link" | "file";
  label: string;
  url: string | null;
  storage_name: string | null;
  original_name: string | null;
  content_type: string | null;
  size: number | null;
  created_at: string;
};

const storagePath = (name: string) =>
  path.join(process.env.ATTACHMENTS_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "attachments"), name);

function getTicket(key: string): TicketRow {
  const match = /^([A-Z0-9]+)-(\d+)$/.exec(key);
  if (!match) throw new ApiError(400, "Invalid ticket key");
  const ticket = db
    .prepare("SELECT t.id, p.prefix || '-' || t.number AS key FROM tickets t JOIN projects p ON p.id = t.project_id WHERE p.prefix = ? AND t.number = ?")
    .get(match[1], Number(match[2])) as TicketRow | undefined;
  if (!ticket) throw notFound("Ticket");
  return ticket;
}

function toAttachment(row: AttachmentRow, ticketKey: string): TicketAttachment {
  if (row.kind === "link") {
    return { id: row.id, kind: "link", label: row.label, url: row.url!, createdAt: row.created_at };
  }
  return {
    id: row.id,
    kind: "file",
    label: row.label,
    filename: row.original_name!,
    size: row.size!,
    contentType: row.content_type || "application/octet-stream",
    downloadUrl: `/api/tickets/${encodeURIComponent(ticketKey)}/attachments/${row.id}`,
    createdAt: row.created_at,
  };
}

export function listTicketAttachments(key: string): TicketAttachment[] {
  const ticket = getTicket(key);
  const rows = db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY id").all(ticket.id) as AttachmentRow[];
  return rows.map((row) => toAttachment(row, ticket.key));
}

export function addLinkAttachment(key: string, input: { url: string; label?: string }) {
  const ticket = getTicket(key);
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new ApiError(400, "Attachment URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ApiError(400, "Attachment URL must use HTTP or HTTPS");
  if (input.url.length > 2048) throw new ApiError(400, "Attachment URL must be at most 2048 characters");
  const label = input.label?.trim() ?? "";
  if (label.length > 200) throw new ApiError(400, "Attachment label must be at most 200 characters");
  const result = db.prepare("INSERT INTO ticket_attachments (ticket_id, kind, label, url) VALUES (?, 'link', ?, ?)").run(ticket.id, label, url.href);
  return getAttachment(ticket, Number(result.lastInsertRowid));
}

export async function addFileAttachment(
  key: string,
  input: { filename: string; contentType: string; size: number; bytes: Uint8Array; label?: string },
) {
  const ticket = getTicket(key);
  if (input.size > MAX_ATTACHMENT_SIZE || input.bytes.byteLength > MAX_ATTACHMENT_SIZE) {
    throw new ApiError(413, "Attachments must be 25 MB or smaller");
  }
  if (!input.filename.trim() || input.filename.length > 255) throw new ApiError(400, "Filename must be between 1 and 255 characters");
  if (input.size !== input.bytes.byteLength) throw new ApiError(400, "Attachment size does not match its contents");
  const label = input.label?.trim() || input.filename;
  if (label.length > 200) throw new ApiError(400, "Attachment label must be at most 200 characters");
  const storageName = randomUUID();
  const target = storagePath(storageName);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, input.bytes, { flag: "wx" });
  try {
    const result = db.prepare(
      "INSERT INTO ticket_attachments (ticket_id, kind, label, storage_name, original_name, content_type, size) VALUES (?, 'file', ?, ?, ?, ?, ?)",
    ).run(ticket.id, label, storageName, input.filename, input.contentType || "application/octet-stream", input.size);
    return getAttachment(ticket, Number(result.lastInsertRowid));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

function getAttachment(ticket: TicketRow, id: number): TicketAttachment {
  const row = db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id = ? AND id = ?").get(ticket.id, id) as AttachmentRow | undefined;
  if (!row) throw notFound("Attachment");
  return toAttachment(row, ticket.key);
}

function getFileRow(key: string, attachmentId: number): AttachmentRow {
  const ticket = getTicket(key);
  const row = db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id = ? AND id = ?").get(ticket.id, attachmentId) as AttachmentRow | undefined;
  if (!row) throw notFound("Attachment");
  if (row.kind !== "file" || !row.storage_name) throw new ApiError(400, "Link attachments cannot be downloaded");
  return row;
}

export async function readAttachmentFile(key: string, attachmentId: number) {
  const row = getFileRow(key, attachmentId);
  return { bytes: await readFile(/*turbopackIgnore: true*/ storagePath(row.storage_name!)), filename: row.original_name! };
}

export async function deleteAttachment(key: string, attachmentId: number) {
  const ticket = getTicket(key);
  const row = db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id = ? AND id = ?").get(ticket.id, attachmentId) as AttachmentRow | undefined;
  if (!row) throw notFound("Attachment");
  if (row.storage_name) await rm(storagePath(row.storage_name), { force: true });
  db.prepare("DELETE FROM ticket_attachments WHERE id = ?").run(row.id);
}

export async function deleteStoredFilesForTickets(ticketIds: number[]) {
  if (!ticketIds.length) return;
  const placeholders = ticketIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT storage_name FROM ticket_attachments WHERE ticket_id IN (${placeholders}) AND storage_name IS NOT NULL`).all(...ticketIds) as { storage_name: string }[];
  await Promise.all(rows.map(({ storage_name }) => rm(storagePath(storage_name), { force: true })));
}