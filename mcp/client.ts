import type { Collaborator, Project, Status, Ticket, TicketAttachment, TicketSummary } from "../shared/types";

const BASE = (process.env.ARIJ_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class ToolError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init?.headers);
    if (!(typeof FormData !== "undefined" && init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new ToolError(`Arij app not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ToolError(body?.error ?? `Request failed with status ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listProjects = () => api<Project[]>("/projects");
export const listStatuses = (projectId: number) => api<Status[]>(`/projects/${projectId}/statuses`);
export const listCollaborators = (projectId: number) => api<Collaborator[]>(`/projects/${projectId}/collaborators`);
export const listTickets = (projectId: number) => api<TicketSummary[]>(`/projects/${projectId}/tickets`);
export const getTicket = (key: string) => api<Ticket>(`/tickets/${encodeURIComponent(key)}`);
export const createTicket = (projectId: number, body: unknown) =>
  api<Ticket>(`/projects/${projectId}/tickets`, send("POST", body));
export const updateTicket = (key: string, body: unknown) =>
  api<Ticket>(`/tickets/${encodeURIComponent(key)}`, send("PATCH", body));
export const addLinkAttachment = (key: string, body: { url: string; label?: string }) =>
  api<TicketAttachment>(`/tickets/${encodeURIComponent(key)}/attachments`, send("POST", body));
export function addFileAttachment(key: string, filename: string, bytes: Uint8Array, label?: string) {
  const form = new FormData();
  const content = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(content).set(bytes);
  form.append("file", new Blob([content], { type: "application/octet-stream" }), filename);
  if (label) form.append("label", label);
  return api<TicketAttachment>(`/tickets/${encodeURIComponent(key)}/attachments`, { method: "POST", body: form });
}
export const removeAttachment = (key: string, attachmentId: number) =>
  api<void>(`/tickets/${encodeURIComponent(key)}/attachments/${attachmentId}`, { method: "DELETE" });

// Accepts a numeric id or a prefix such as "ABC".
export async function resolveProject(ref: string): Promise<Project> {
  const projects = await listProjects();
  const p = projects.find((x) => String(x.id) === ref || x.prefix.toLowerCase() === ref.toLowerCase());
  if (!p) throw new ToolError(`Project "${ref}" not found. Available: ${projects.map((x) => x.prefix).join(", ") || "none"}`);
  return p;
}

export async function resolveStatusId(projectId: number, name: string): Promise<number> {
  const statuses = await listStatuses(projectId);
  const s = statuses.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new ToolError(`Unknown status "${name}". Valid statuses: ${statuses.map((x) => x.name).join(", ")}`);
  return s.id;
}

export async function resolveTicketId(key: string): Promise<number> {
  return (await getTicket(key)).id;
}

export async function checkPeople(projectId: number, people: Record<string, string | null | undefined>) {
  const names = Object.entries(people).filter(([, v]) => v);
  if (!names.length) return;
  const collabs = (await listCollaborators(projectId)).map((c) => c.name);
  for (const [label, name] of names) {
    if (!collabs.includes(name!)) {
      throw new ToolError(`${label} "${name}" is not a collaborator. Collaborators: ${collabs.join(", ") || "none"}`);
    }
  }
}
