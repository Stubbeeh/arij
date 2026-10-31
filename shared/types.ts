import { z } from "zod";

export const CATEGORIES = ["todo", "in_progress", "finished"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  todo: "To do",
  in_progress: "In progress",
  finished: "Finished",
};

export const TICKET_TYPES = ["epic", "story", "task", "bug"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

// Allowed parent types per child type; epics never have a parent.
export const ALLOWED_PARENTS: Record<TicketType, TicketType[]> = {
  epic: [],
  story: ["epic"],
  task: ["story"],
  bug: ["story", "epic"],
};

const name = z.string().trim().min(1).max(100);

export const projectInput = z.object({
  name,
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,5}$/, "Prefix: 2-5 uppercase letters or digits"),
});
export const projectUpdate = z.object({ name });

export const collaboratorInput = z.object({ name });

export const statusInput = z.object({ name, category: z.enum(CATEGORIES) });
export const statusUpdate = statusInput.partial();

export const ticketInput = z.object({
  type: z.enum(TICKET_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(""),
  reporter: name,
  assignee: z.string().trim().max(100).nullable().optional(),
  estimation: z.number().min(0).nullable().optional(),
  statusId: z.number().int().optional(),
  parentId: z.number().int().nullable().optional(),
});
export const ticketUpdate = ticketInput.partial();
export const attachmentLinkInput = z.object({
  url: z.string().trim().url().max(2048),
  label: z.string().trim().max(200).optional(),
});

export const boardInput = z.object({ name });
export const stagesInput = z.object({
  stages: z
    .array(
      z.object({
        name,
        category: z.enum(CATEGORIES),
        statusIds: z.array(z.number().int()).min(1, "A stage needs at least one status"),
      }),
    )
    .min(1),
});

export type Project = { id: number; name: string; prefix: string };
export type Collaborator = { id: number; name: string };
export type Status = { id: number; name: string; category: Category };
export type TicketSummary = {
  id: number;
  key: string;
  type: TicketType;
  title: string;
  estimation: number | null;
  statusId: number;
  parent: { id: number; key: string; title: string; type: TicketType } | null;
};
export type TicketAttachment = {
  id: number;
  kind: "link" | "file";
  label: string;
  createdAt: string;
} & (
  | { kind: "link"; url: string }
  | { kind: "file"; filename: string; size: number; contentType: string; downloadUrl: string }
);
export type Ticket = TicketSummary & {
  projectId: number;
  description: string;
  reporter: string;
  assignee: string | null;
  children: TicketSummary[];
  attachments: TicketAttachment[];
};
export type Stage = {
  id: number;
  name: string;
  category: Category;
  statusIds: number[];
};
export type Board = { id: number; projectId: number; name: string };
export type BoardDetail = Board & {
  stages: Stage[];
  statuses: Status[];
  tickets: TicketSummary[];
};
