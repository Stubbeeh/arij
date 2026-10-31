import { db } from "../db";
import { ApiError, notFound } from "../http";
import { deleteStoredFilesForTickets, listTicketAttachments } from "./attachments";
import { getProject } from "./projects";
import { ALLOWED_PARENTS, type Ticket, type TicketSummary, type TicketType } from "@/shared/types";

type Row = {
  id: number;
  project_id: number;
  number: number;
  type: TicketType;
  title: string;
  description: string;
  reporter: string;
  assignee: string | null;
  estimation: number | null;
  status_id: number;
  parent_id: number | null;
  prefix: string;
};

const SELECT = "SELECT t.*, p.prefix FROM tickets t JOIN projects p ON p.id = t.project_id";

function summary(r: Row): TicketSummary {
  const parent = r.parent_id
    ? (db.prepare(`${SELECT} WHERE t.id = ?`).get(r.parent_id) as Row | undefined)
    : undefined;
  return {
    id: r.id,
    key: `${r.prefix}-${r.number}`,
    type: r.type,
    title: r.title,
    estimation: r.estimation,
    statusId: r.status_id,
    parent: parent ? { id: parent.id, key: `${parent.prefix}-${parent.number}`, title: parent.title, type: parent.type } : null,
  };
}

export function listTickets(projectId: number): TicketSummary[] {
  getProject(projectId);
  return (db.prepare(`${SELECT} WHERE t.project_id = ? ORDER BY t.number`).all(projectId) as Row[]).map(summary);
}

function full(r: Row): Ticket {
  const children = (db.prepare(`${SELECT} WHERE t.parent_id = ? ORDER BY t.number`).all(r.id) as Row[]).map(summary);
  return {
    ...summary(r),
    projectId: r.project_id,
    description: r.description,
    reporter: r.reporter,
    assignee: r.assignee,
    children,
    attachments: listTicketAttachments(`${r.prefix}-${r.number}`),
  };
}

export function getTicket(key: string): Ticket {
  const m = /^([A-Z0-9]+)-(\d+)$/.exec(key);
  if (!m) throw new ApiError(400, "Invalid ticket key");
  const r = db.prepare(`${SELECT} WHERE p.prefix = ? AND t.number = ?`).get(m[1], Number(m[2])) as Row | undefined;
  if (!r) throw notFound("Ticket");
  return full(r);
}

function checkPerson(projectId: number, label: string, name: string | null | undefined) {
  if (!name) return;
  if (!db.prepare("SELECT 1 FROM collaborators WHERE project_id = ? AND name = ?").get(projectId, name)) {
    throw new ApiError(400, `${label} "${name}" is not a collaborator of this project`);
  }
}

function checkParent(projectId: number, type: TicketType, parentId: number | null | undefined, selfId?: number) {
  if (parentId == null) return;
  if (parentId === selfId) throw new ApiError(400, "A ticket cannot be its own parent");
  const parent = db.prepare("SELECT type FROM tickets WHERE id = ? AND project_id = ?").get(parentId, projectId) as { type: TicketType } | undefined;
  if (!parent) throw new ApiError(400, "Parent ticket not found in this project");
  if (!ALLOWED_PARENTS[type].includes(parent.type)) {
    throw new ApiError(400, `A ${type} cannot have a ${parent.type} as parent`);
  }
}

function checkStatus(projectId: number, statusId: number) {
  if (!db.prepare("SELECT 1 FROM statuses WHERE id = ? AND project_id = ?").get(statusId, projectId)) {
    throw new ApiError(400, "Status not found in this project");
  }
}

type Input = {
  type: TicketType;
  title: string;
  description: string;
  reporter: string;
  assignee?: string | null;
  estimation?: number | null;
  statusId?: number;
  parentId?: number | null;
};

export function createTicket(projectId: number, input: Input): Ticket {
  getProject(projectId);
  checkPerson(projectId, "Reporter", input.reporter);
  checkPerson(projectId, "Assignee", input.assignee);
  checkParent(projectId, input.type, input.parentId);
  const statusId =
    input.statusId ??
    (db.prepare("SELECT id FROM statuses WHERE project_id = ? ORDER BY position, id LIMIT 1").get(projectId) as { id: number }).id;
  checkStatus(projectId, statusId);
  const id = db.transaction(() => {
    const { next_number } = db.prepare("SELECT next_number FROM projects WHERE id = ?").get(projectId) as { next_number: number };
    db.prepare("UPDATE projects SET next_number = next_number + 1 WHERE id = ?").run(projectId);
    return Number(
      db
        .prepare(
          "INSERT INTO tickets (project_id, number, type, title, description, reporter, assignee, estimation, status_id, parent_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(projectId, next_number, input.type, input.title, input.description, input.reporter, input.assignee ?? null, input.estimation ?? null, statusId, input.parentId ?? null).lastInsertRowid,
    );
  })();
  return full(db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as Row);
}

export function updateTicket(key: string, input: Partial<Input>): Ticket {
  const cur = getTicket(key);
  const full0 = db.prepare("SELECT reporter, assignee FROM tickets WHERE id = ?").get(cur.id) as { reporter: string; assignee: string | null };
  const type = input.type ?? cur.type;
  const parentId = input.parentId !== undefined ? input.parentId : cur.parent?.id ?? null;

  if (input.type && input.type !== cur.type) {
    const bad = cur.children.find((c) => !ALLOWED_PARENTS[c.type].includes(type));
    if (bad) throw new ApiError(400, `Cannot become a ${type}: child ${bad.key} (${bad.type}) would be invalid`);
  }
  if (input.type !== undefined || input.parentId !== undefined) checkParent(cur.projectId, type, parentId, cur.id);
  if (input.reporter !== undefined && input.reporter !== full0.reporter) checkPerson(cur.projectId, "Reporter", input.reporter);
  if (input.assignee !== undefined && input.assignee !== full0.assignee) checkPerson(cur.projectId, "Assignee", input.assignee);
  if (input.statusId !== undefined) checkStatus(cur.projectId, input.statusId);

  db.prepare(
    "UPDATE tickets SET type=?, title=?, description=?, reporter=?, assignee=?, estimation=?, status_id=?, parent_id=? WHERE id=?",
  ).run(
    type,
    input.title ?? cur.title,
    input.description ?? cur.description,
    input.reporter ?? full0.reporter,
    input.assignee !== undefined ? input.assignee || null : full0.assignee,
    input.estimation !== undefined ? input.estimation : cur.estimation,
    input.statusId ?? cur.statusId,
    parentId,
    cur.id,
  );
  return getTicket(key);
}

export async function deleteTicket(key: string) {
  const t = getTicket(key);
  await deleteStoredFilesForTickets([t.id]);
  db.prepare("DELETE FROM tickets WHERE id = ?").run(t.id);
}
