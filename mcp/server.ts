import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ALLOWED_PARENTS, TICKET_TYPES, type Status, type Ticket, type TicketSummary } from "../shared/types";
import * as api from "./client";
import { ToolError } from "./client";

const USER = process.env.ARIJ_USER?.trim() || null;

const HIERARCHY = `Hierarchy: ${TICKET_TYPES.map((t) => `${t} -> ${ALLOWED_PARENTS[t].join("|") || "no parent"}`).join("; ")}.`;

const server = new McpServer(
  { name: "arij", version: "0.1.0" },
  {
    instructions: `Tools for the local Arij Jira-like app. Ticket keys look like ABC-12. ${HIERARCHY} ${
      USER
        ? `The current user is "${USER}"; use it as reporter when creating tickets.`
        : "The current user is unknown: ask the user who they are (see get_project collaborators) before creating tickets."
    }`,
  },
);

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function run<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Result> => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn(args)) }] };
    } catch (e) {
      const msg = e instanceof ToolError || e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  };
}

const statusName = (statuses: Status[], id: number) => statuses.find((s) => s.id === id)?.name ?? String(id);

const brief = (t: TicketSummary, statuses: Status[]) => ({
  key: t.key,
  type: t.type,
  title: t.title,
  status: statusName(statuses, t.statusId),
  estimation: t.estimation,
  parent: t.parent?.key ?? null,
});

async function detail(t: Ticket) {
  const statuses = await api.listStatuses(t.projectId);
  return {
    ...brief(t, statuses),
    description: t.description,
    reporter: t.reporter,
    assignee: t.assignee,
    attachments: t.attachments,
    children: t.children.map((c) => brief(c, statuses)),
  };
}

const attachmentInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: z.string().url(), label: z.string().max(200).optional() }),
  z.object({ kind: z.literal("file"), path: z.string().min(1), label: z.string().max(200).optional() }),
]);

async function addAttachment(key: string, attachment: z.infer<typeof attachmentInput>) {
  if (attachment.kind === "link") return api.addLinkAttachment(key, { url: attachment.url, label: attachment.label });
  const allowedRoot = process.env.MCP_ATTACHMENT_ROOT;
  if (!allowedRoot) throw new ToolError("Local file attachments require MCP_ATTACHMENT_ROOT to be configured");
  let root: string;
  let filePath: string;
  try {
    [root, filePath] = await Promise.all([realpath(allowedRoot), realpath(attachment.path)]);
  } catch {
    throw new ToolError("The attachment path or MCP_ATTACHMENT_ROOT does not exist");
  }
  const relativePath = path.relative(root, filePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new ToolError("The attachment file must be inside MCP_ATTACHMENT_ROOT");
  }
  const file = await stat(filePath);
  if (!file.isFile()) throw new ToolError("The attachment path must point to a regular file");
  if (file.size > 25 * 1024 * 1024) throw new ToolError("Attachments must be 25 MB or smaller");
  return api.addFileAttachment(key, path.basename(filePath), await readFile(filePath), attachment.label);
}

async function parentId(key: string | null | undefined) {
  if (key === undefined || key === null) return key;
  return api.resolveTicketId(key);
}

const projectRef = z.string().describe("Project id or prefix, e.g. ABC");
const ticketKey = z.string().describe("Ticket key, e.g. ABC-12");
const type = z.enum(TICKET_TYPES);
const parent = z.string().nullable().describe(`Parent ticket key, or null for none. ${HIERARCHY}`);

server.registerTool(
  "whoami",
  { description: "Return the current user name to use as reporter." },
  run(async () => ({
    user: USER,
    note: USER ? undefined : "ARIJ_USER is not set: ask the user which collaborator they are.",
  })),
);

server.registerTool(
  "list_projects",
  { description: "List all projects (id, name, prefix)." },
  run(async () => api.listProjects()),
);

server.registerTool(
  "get_project",
  { description: "Get a project with its statuses and collaborators.", inputSchema: { project: projectRef } },
  run(async ({ project }: { project: string }) => {
    const p = await api.resolveProject(project);
    const [statuses, collaborators] = await Promise.all([api.listStatuses(p.id), api.listCollaborators(p.id)]);
    return {
      ...p,
      statuses: statuses.map((s) => ({ name: s.name, category: s.category })),
      collaborators: collaborators.map((c) => c.name),
    };
  }),
);

server.registerTool(
  "list_tickets",
  {
    description:
      "List tickets of a project, optionally filtered. Assignee, reporter and text filters are slower (one request per ticket). Text matches title and description.",
    inputSchema: {
      project: projectRef,
      status: z.string().optional(),
      type: type.optional(),
      assignee: z.string().optional(),
      reporter: z.string().optional(),
      text: z.string().optional(),
    },
  },
  run(
    async (a: { project: string; status?: string; type?: (typeof TICKET_TYPES)[number]; assignee?: string; reporter?: string; text?: string }) => {
      const p = await api.resolveProject(a.project);
      const statuses = await api.listStatuses(p.id);
      let tickets = await api.listTickets(p.id);
      if (a.status) {
        const id = await api.resolveStatusId(p.id, a.status);
        tickets = tickets.filter((t) => t.statusId === id);
      }
      if (a.type) tickets = tickets.filter((t) => t.type === a.type);
      if (a.assignee || a.reporter || a.text) {
        const full = await Promise.all(tickets.map((t) => api.getTicket(t.key)));
        const text = a.text?.toLowerCase();
        tickets = full.filter(
          (t) =>
            (!a.assignee || t.assignee === a.assignee) &&
            (!a.reporter || t.reporter === a.reporter) &&
            (!text || t.title.toLowerCase().includes(text) || t.description.toLowerCase().includes(text)),
        );
      }
      return tickets.map((t) => brief(t, statuses));
    },
  ),
);

server.registerTool(
  "get_ticket",
  { description: "Read a ticket in full: description, reporter, assignee, parent and children.", inputSchema: { key: ticketKey } },
  run(async ({ key }: { key: string }) => detail(await api.getTicket(key))),
);

server.registerTool(
  "create_ticket",
  {
    description: `Create a ticket. Reporter is required and must be a project collaborator (use the current user). ${HIERARCHY}`,
    inputSchema: {
      project: projectRef,
      type,
      title: z.string(),
      description: z.string().optional(),
      reporter: z.string().describe("Collaborator name of the current user"),
      assignee: z.string().nullable().optional(),
      estimation: z.number().min(0).nullable().optional(),
      status: z.string().optional().describe("Status name; defaults to the project's first status"),
      parent: parent.optional(),
      attachments: z.array(attachmentInput).optional(),
    },
  },
  run(
    async (a: {
      project: string;
      type: (typeof TICKET_TYPES)[number];
      title: string;
      description?: string;
      reporter: string;
      assignee?: string | null;
      estimation?: number | null;
      status?: string;
      parent?: string | null;
      attachments?: z.infer<typeof attachmentInput>[];
    }) => {
      const p = await api.resolveProject(a.project);
      await api.checkPeople(p.id, { Reporter: a.reporter, Assignee: a.assignee });
      const created = await api.createTicket(p.id, {
        type: a.type,
        title: a.title,
        description: a.description,
        reporter: a.reporter,
        assignee: a.assignee,
        estimation: a.estimation,
        statusId: a.status ? await api.resolveStatusId(p.id, a.status) : undefined,
        parentId: await parentId(a.parent),
      });
      const attachmentErrors: { item: string; error: string }[] = [];
      for (const attachment of a.attachments ?? []) {
        try {
          await addAttachment(created.key, attachment);
        } catch (error) {
          attachmentErrors.push({
            item: attachment.kind === "link" ? attachment.url : path.basename(attachment.path),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const fullTicket = await api.getTicket(created.key);
      return { ...(await detail(fullTicket)), attachmentErrors };
    },
  ),
);

server.registerTool(
  "add_ticket_attachment",
  {
    description: "Add an HTTP(S) link or a local file from MCP_ATTACHMENT_ROOT to a ticket.",
    inputSchema: { key: ticketKey, attachment: attachmentInput },
  },
  run(async ({ key, attachment }: { key: string; attachment: z.infer<typeof attachmentInput> }) => {
    await addAttachment(key, attachment);
    return detail(await api.getTicket(key));
  }),
);

server.registerTool(
  "remove_ticket_attachment",
  {
    description: "Remove a ticket attachment by its id.",
    inputSchema: { key: ticketKey, attachmentId: z.number().int().positive() },
  },
  run(async ({ key, attachmentId }: { key: string; attachmentId: number }) => {
    await api.removeAttachment(key, attachmentId);
    return detail(await api.getTicket(key));
  }),
);

server.registerTool(
  "update_ticket",
  {
    description: `Update any subset of a ticket's fields. Use null to clear assignee, estimation or parent. ${HIERARCHY}`,
    inputSchema: {
      key: ticketKey,
      title: z.string().optional(),
      description: z.string().optional(),
      type: type.optional(),
      assignee: z.string().nullable().optional(),
      estimation: z.number().min(0).nullable().optional(),
      status: z.string().optional().describe("Status name, case-insensitive"),
      parent: parent.optional(),
    },
  },
  run(
    async (a: {
      key: string;
      title?: string;
      description?: string;
      type?: (typeof TICKET_TYPES)[number];
      assignee?: string | null;
      estimation?: number | null;
      status?: string;
      parent?: string | null;
    }) => {
      const current = await api.getTicket(a.key);
      await api.checkPeople(current.projectId, { Assignee: a.assignee });
      const updated = await api.updateTicket(a.key, {
        title: a.title,
        description: a.description,
        type: a.type,
        assignee: a.assignee,
        estimation: a.estimation,
        statusId: a.status ? await api.resolveStatusId(current.projectId, a.status) : undefined,
        parentId: await parentId(a.parent),
      });
      return detail(updated);
    },
  ),
);

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
