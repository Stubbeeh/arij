"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Modal } from "./Modal";
import { PersonField } from "./PersonField";
import { ALLOWED_PARENTS, TICKET_TYPES, type Status, type Ticket, type TicketSummary, type TicketType } from "@/shared/types";

const REPORTER_KEY = "arij.lastReporter";
type PendingAttachment =
  | { id: string; kind: "link"; url: string; label: string }
  | { id: string; kind: "file"; file: File };

export function TicketForm({
  projectId,
  statuses,
  tickets,
  ticket,
  initialStatusId,
  onClose,
  onSaved,
}: {
  projectId: number;
  statuses: Status[];
  tickets: TicketSummary[];
  ticket?: Ticket;
  initialStatusId?: number;
  onClose: () => void;
  onSaved: (t: Ticket) => void;
}) {
  const [type, setType] = useState<TicketType>(ticket?.type ?? "task");
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [reporter, setReporter] = useState(ticket?.reporter ?? (typeof window !== "undefined" ? localStorage.getItem(REPORTER_KEY) ?? "" : ""));
  const [assignee, setAssignee] = useState(ticket?.assignee ?? "");
  const [estimation, setEstimation] = useState(ticket?.estimation?.toString() ?? "");
  const [statusId, setStatusId] = useState(ticket?.statusId ?? initialStatusId ?? statuses[0]?.id);
  const [parentId, setParentId] = useState<number | null>(ticket?.parent?.id ?? null);
  const [error, setError] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);

  const parentTypes = ALLOWED_PARENTS[type];
  const parents = tickets.filter((t) => parentTypes.includes(t.type) && t.id !== ticket?.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const body = {
      type,
      title,
      description,
      reporter,
      assignee: assignee || null,
      estimation: estimation === "" ? null : Number(estimation),
      statusId,
      parentId: parentTypes.length ? parentId : null,
    };
    try {
      let saved = ticket
        ? await api.tickets.update(ticket.key, body)
        : createdTicket
          ? await api.tickets.update(createdTicket.key, body)
          : await api.tickets.create(projectId, body);
      if (reporter) localStorage.setItem(REPORTER_KEY, reporter);
      if (!ticket) {
        setCreatedTicket(saved);
        const failed: PendingAttachment[] = [];
        for (const attachment of pendingAttachments) {
          try {
            if (attachment.kind === "link") {
              await api.tickets.addLinkAttachment(saved.key, { url: attachment.url, label: attachment.label });
            } else {
              await api.tickets.addFileAttachment(saved.key, attachment.file);
            }
          } catch {
            failed.push(attachment);
          }
        }
        setPendingAttachments(failed);
        if (failed.length) {
          setError(`Ticket ${saved.key} was created, but ${failed.length} attachment${failed.length === 1 ? "" : "s"} failed. Retry or add them from the ticket details.`);
          return;
        }
        if (pendingAttachments.length) saved = await api.tickets.get(saved.key);
      }
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function stageLink() {
    setError("");
    try {
      const parsed = new URL(linkUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Use an HTTP or HTTPS link");
      setPendingAttachments((items) => [...items, { id: crypto.randomUUID(), kind: "link", url: parsed.href, label: linkLabel.trim() }]);
      setLinkUrl("");
      setLinkLabel("");
    } catch (err) {
      setError((err as Error).message || "Enter a valid HTTP or HTTPS link");
    }
  }

  function stageFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    const tooLarge = selected.filter((file) => file.size > 25 * 1024 * 1024);
    setPendingAttachments((items) => [
      ...items,
      ...selected.filter((file) => file.size <= 25 * 1024 * 1024).map((file) => ({ id: crypto.randomUUID(), kind: "file" as const, file })),
    ]);
    setError(tooLarge.length ? `${tooLarge.map((file) => file.name).join(", ")} exceed the 25 MB file limit.` : "");
  }

  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <h2>{ticket ? `Edit ${ticket.key}` : "New ticket"}</h2>
        <div className="row">
          <label className="field">
            Type
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as TicketType);
                setParentId(null);
              }}
            >
              {TICKET_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Status
            <select value={statusId} onChange={(e) => setStatusId(Number(e.target.value))}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Estimation
            <input type="number" min={0} step="any" value={estimation} onChange={(e) => setEstimation(e.target.value)} style={{ width: 90 }} />
          </label>
        </div>
        <label className="field">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus />
        </label>
        <label className="field">
          Description
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {!ticket && (
          <section className="attachment-section stack">
            <h3>Attachments</h3>
            <div className="row wrap">
              <label className="field attachment-grow">
                Link URL
                <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" maxLength={2048} />
              </label>
              <label className="field attachment-grow">
                Label (optional)
                <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} maxLength={200} />
              </label>
              <button type="button" disabled={!linkUrl.trim()} onClick={stageLink}>
                Add link
              </button>
            </div>
            <label className="field">
              Add files (up to 25 MB each)
              <input type="file" multiple onChange={(e) => {
                stageFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }} />
            </label>
            {pendingAttachments.length > 0 && (
              <ul className="attachment-list">
                {pendingAttachments.map((attachment) => (
                  <li className="attachment-item" key={attachment.id}>
                    <span>
                      {attachment.kind === "link" ? attachment.label || attachment.url : attachment.file.name}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setPendingAttachments((items) => items.filter((item) => item.id !== attachment.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {parentTypes.length > 0 && (
          <label className="field">
            Parent ({parentTypes.join(" or ")})
            <select value={parentId ?? ""} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">None</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <div style={{ flex: 1 }}>
            <PersonField projectId={projectId} label="Reporter" value={reporter} onChange={setReporter} />
          </div>
          <div style={{ flex: 1 }}>
            <PersonField projectId={projectId} label="Assignee (optional)" value={assignee} onChange={setAssignee} />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="spacer" />
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={saving || (!createdTicket && (!reporter || !title.trim()))}>
            {saving ? "Saving..." : createdTicket ? "Retry attachments" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
