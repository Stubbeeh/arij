"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { TicketAttachment } from "@/shared/types";

export function TicketAttachments({
  ticketKey,
  attachments,
  onChanged,
}: {
  ticketKey: string;
  attachments: TicketAttachment[];
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.tickets.addLinkAttachment(ticketKey, { url, label });
      setUrl("");
      setLabel("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setBusy(true);
    const failures: string[] = [];
    let added = false;
    for (const file of Array.from(files)) {
      try {
        await api.tickets.addFileAttachment(ticketKey, file);
        added = true;
      } catch (err) {
        failures.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    if (added) onChanged();
    if (failures.length) setError(failures.join("; "));
    setBusy(false);
  }

  async function remove(id: number) {
    setError("");
    setBusy(true);
    try {
      await api.tickets.removeAttachment(ticketKey, id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="attachment-section stack">
      <div className="row">
        <h3>Attachments</h3>
        <span className="muted">{attachments.length}</span>
        <span className="spacer" />
        <label className="attachment-file-button">
          Add files
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              void addFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {attachments.length > 0 ? (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li className="attachment-item" key={attachment.id}>
              <div className="stack attachment-details">
                {attachment.kind === "link" ? (
                  <a href={attachment.url} target="_blank" rel="noreferrer">
                    {attachment.label || attachment.url}
                  </a>
                ) : (
                  <a href={attachment.downloadUrl}>{attachment.label || attachment.filename}</a>
                )}
                {attachment.kind === "link" ? (
                  attachment.label && <span className="muted attachment-subtitle">{attachment.url}</span>
                ) : (
                  <span className="muted attachment-subtitle">
                    {attachment.filename} | {formatSize(attachment.size)}
                  </span>
                )}
              </div>
              <button type="button" disabled={busy} onClick={() => void remove(attachment.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No attachments</p>
      )}
      <form className="attachment-link-form" onSubmit={addLink}>
        <label className="field">
          Link URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required maxLength={2048} />
        </label>
        <label className="field">
          Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
        </label>
        <button type="submit" disabled={busy || !url.trim()}>
          Add link
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      <p className="muted attachment-hint">Files up to 25 MB. Downloads are never opened in the app.</p>
    </section>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}