import type {
  Board,
  BoardDetail,
  Category,
  Collaborator,
  Project,
  Status,
  TicketAttachment,
  Ticket,
  TicketSummary,
  TicketType,
} from "@/shared/types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: body === undefined || isFormData ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export type TicketPayload = {
  type?: TicketType;
  title?: string;
  description?: string;
  reporter?: string;
  assignee?: string | null;
  estimation?: number | null;
  statusId?: number;
  parentId?: number | null;
};

export type StagePayload = { name: string; category: Category; statusIds: number[] };

export const api = {
  projects: {
    list: () => call<Project[]>("GET", "/api/projects"),
    get: (id: number) => call<Project>("GET", `/api/projects/${id}`),
    create: (b: { name: string; prefix: string }) => call<Project>("POST", "/api/projects", b),
    update: (id: number, b: { name: string }) => call<Project>("PATCH", `/api/projects/${id}`, b),
    remove: (id: number) => call<void>("DELETE", `/api/projects/${id}`),
  },
  collaborators: {
    list: (pid: number, q = "") => call<Collaborator[]>("GET", `/api/projects/${pid}/collaborators?q=${encodeURIComponent(q)}`),
    add: (pid: number, name: string) => call<Collaborator>("POST", `/api/projects/${pid}/collaborators`, { name }),
    remove: (pid: number, id: number) => call<void>("DELETE", `/api/projects/${pid}/collaborators/${id}`),
  },
  statuses: {
    list: (pid: number) => call<Status[]>("GET", `/api/projects/${pid}/statuses`),
    create: (pid: number, b: { name: string; category: Category }) => call<Status>("POST", `/api/projects/${pid}/statuses`, b),
    update: (pid: number, id: number, b: { name?: string; category?: Category }) =>
      call<Status>("PATCH", `/api/projects/${pid}/statuses/${id}`, b),
    remove: (pid: number, id: number, replaceWith?: number) =>
      call<void>("DELETE", `/api/projects/${pid}/statuses/${id}${replaceWith ? `?replaceWith=${replaceWith}` : ""}`),
  },
  tickets: {
    list: (pid: number) => call<TicketSummary[]>("GET", `/api/projects/${pid}/tickets`),
    get: (key: string) => call<Ticket>("GET", `/api/tickets/${key}`),
    create: (pid: number, b: TicketPayload) => call<Ticket>("POST", `/api/projects/${pid}/tickets`, b),
    update: (key: string, b: TicketPayload) => call<Ticket>("PATCH", `/api/tickets/${key}`, b),
    remove: (key: string) => call<void>("DELETE", `/api/tickets/${key}`),
    attachments: (key: string) => call<TicketAttachment[]>("GET", `/api/tickets/${encodeURIComponent(key)}/attachments`),
    addLinkAttachment: (key: string, b: { url: string; label?: string }) =>
      call<TicketAttachment>("POST", `/api/tickets/${encodeURIComponent(key)}/attachments`, b),
    addFileAttachment: (key: string, file: File, label?: string) => {
      const body = new FormData();
      body.append("file", file, file.name);
      if (label) body.append("label", label);
      return call<TicketAttachment>("POST", `/api/tickets/${encodeURIComponent(key)}/attachments`, body);
    },
    removeAttachment: (key: string, attachmentId: number) =>
      call<void>("DELETE", `/api/tickets/${encodeURIComponent(key)}/attachments/${attachmentId}`),
  },
  boards: {
    list: (pid: number) => call<Board[]>("GET", `/api/projects/${pid}/boards`),
    get: (id: number) => call<BoardDetail>("GET", `/api/boards/${id}`),
    create: (pid: number, name: string) => call<Board>("POST", `/api/projects/${pid}/boards`, { name }),
    rename: (id: number, name: string) => call<Board>("PATCH", `/api/boards/${id}`, { name }),
    remove: (id: number) => call<void>("DELETE", `/api/boards/${id}`),
    setStages: (id: number, stages: StagePayload[]) => call<BoardDetail>("PUT", `/api/boards/${id}/stages`, { stages }),
  },
};
