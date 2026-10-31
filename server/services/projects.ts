import { db } from "../db";
import { ApiError, notFound } from "../http";
import { deleteStoredFilesForTickets } from "./attachments";
import type { Category, Collaborator, Project, Status } from "@/shared/types";

type ProjectRow = { id: number; name: string; prefix: string };
const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, prefix: r.prefix });

const DEFAULT_STATUSES: [string, Category][] = [
  ["To Do", "todo"],
  ["In Progress", "in_progress"],
  ["Done", "finished"],
];

export function listProjects(): Project[] {
  return (db.prepare("SELECT id, name, prefix FROM projects ORDER BY name").all() as ProjectRow[]).map(toProject);
}

export function getProject(id: number): Project {
  const r = db.prepare("SELECT id, name, prefix FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!r) throw notFound("Project");
  return toProject(r);
}

export function createProject(input: { name: string; prefix: string }): Project {
  if (db.prepare("SELECT 1 FROM projects WHERE prefix = ?").get(input.prefix)) {
    throw new ApiError(409, `Prefix ${input.prefix} is already used`);
  }
  const tx = db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO projects (name, prefix) VALUES (?, ?)").run(input.name, input.prefix).lastInsertRowid);
    const ins = db.prepare("INSERT INTO statuses (project_id, name, category, position) VALUES (?, ?, ?, ?)");
    DEFAULT_STATUSES.forEach(([n, c], i) => ins.run(id, n, c, i));
    return id;
  });
  return getProject(tx());
}

export function updateProject(id: number, input: { name: string }): Project {
  getProject(id);
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(input.name, id);
  return getProject(id);
}

export async function deleteProject(id: number) {
  getProject(id);
  const ticketIds = (db.prepare("SELECT id FROM tickets WHERE project_id = ?").all(id) as { id: number }[]).map((t) => t.id);
  await deleteStoredFilesForTickets(ticketIds);
  // Tickets reference statuses without cascade, so remove them first.
  db.transaction(() => {
    db.prepare("DELETE FROM tickets WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  })();
}

export function listCollaborators(projectId: number, q?: string): Collaborator[] {
  getProject(projectId);
  const rows = db
    .prepare("SELECT id, name FROM collaborators WHERE project_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name")
    .all(projectId, `%${(q ?? "").replace(/[\\%_]/g, "\\$&")}%`);
  return rows as Collaborator[];
}

export function addCollaborator(projectId: number, input: { name: string }): Collaborator {
  getProject(projectId);
  const existing = db
    .prepare("SELECT id, name FROM collaborators WHERE project_id = ? AND name = ?")
    .get(projectId, input.name) as Collaborator | undefined;
  if (existing) return existing;
  const id = Number(db.prepare("INSERT INTO collaborators (project_id, name) VALUES (?, ?)").run(projectId, input.name).lastInsertRowid);
  return { id, name: input.name };
}

export function deleteCollaborator(projectId: number, id: number) {
  db.prepare("DELETE FROM collaborators WHERE project_id = ? AND id = ?").run(projectId, id);
}

type StatusRow = { id: number; name: string; category: Category };

export function listStatuses(projectId: number): Status[] {
  getProject(projectId);
  return db
    .prepare("SELECT id, name, category FROM statuses WHERE project_id = ? ORDER BY position, id")
    .all(projectId) as StatusRow[];
}

function getStatus(projectId: number, id: number): Status {
  const r = db.prepare("SELECT id, name, category FROM statuses WHERE project_id = ? AND id = ?").get(projectId, id) as StatusRow | undefined;
  if (!r) throw notFound("Status");
  return r;
}

export function createStatus(projectId: number, input: { name: string; category: Category }): Status {
  getProject(projectId);
  try {
    const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM statuses WHERE project_id = ?").get(projectId) as { p: number }).p;
    const id = Number(
      db.prepare("INSERT INTO statuses (project_id, name, category, position) VALUES (?, ?, ?, ?)").run(projectId, input.name, input.category, pos).lastInsertRowid,
    );
    return getStatus(projectId, id);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new ApiError(409, "A status with this name already exists");
    throw e;
  }
}

export function updateStatus(projectId: number, id: number, input: { name?: string; category?: Category }): Status {
  const cur = getStatus(projectId, id);
  try {
    db.prepare("UPDATE statuses SET name = ?, category = ? WHERE id = ?").run(input.name ?? cur.name, input.category ?? cur.category, id);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new ApiError(409, "A status with this name already exists");
    throw e;
  }
  return getStatus(projectId, id);
}

export function deleteStatus(projectId: number, id: number, replacementId?: number) {
  getStatus(projectId, id);
  const used = (db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status_id = ?").get(id) as { c: number }).c;
  const total = (db.prepare("SELECT COUNT(*) AS c FROM statuses WHERE project_id = ?").get(projectId) as { c: number }).c;
  if (total <= 1) throw new ApiError(409, "A project needs at least one status");
  if (used > 0) {
    if (!replacementId || replacementId === id) throw new ApiError(409, "Choose a replacement status for existing tickets");
    getStatus(projectId, replacementId);
  }
  db.transaction(() => {
    if (used > 0) db.prepare("UPDATE tickets SET status_id = ? WHERE status_id = ?").run(replacementId, id);
    db.prepare("DELETE FROM statuses WHERE id = ?").run(id);
    // Stages must keep at least one status; drop the empty ones.
    db.prepare("DELETE FROM stages WHERE id NOT IN (SELECT stage_id FROM stage_statuses)").run();
  })();
}
