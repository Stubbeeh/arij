"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Modal } from "./Modal";
import { TicketAttachments } from "./TicketAttachments";
import { TicketForm } from "./TicketForm";
import type { Status, Ticket, TicketSummary } from "@/shared/types";

export function TicketDrawer({
  ticketKey,
  projectId,
  statuses,
  tickets,
  onClose,
  onChanged,
}: {
  ticketKey: string;
  projectId: number;
  statuses: Status[];
  tickets: TicketSummary[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [key, setKey] = useState(ticketKey);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api.tickets.get(key).then(setTicket).catch((e) => setError(e.message)), [key]);
  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    if (!ticket || !window.confirm(`Delete ${ticket.key}? Its children will be kept without parent.`)) return;
    await api.tickets.remove(ticket.key);
    onChanged();
    onClose();
  }

  return (
    <Modal drawer onClose={onClose}>
      {error && <div className="error">{error}</div>}
      {ticket && (
        <div className="stack">
          <div className="row">
            <span className={`badge ${ticket.type}`}>{ticket.type}</span>
            <span className="key">{ticket.key}</span>
            <span className="spacer" />
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={remove}>
              Delete
            </button>
            <button onClick={onClose}>Close</button>
          </div>
          <h2>{ticket.title}</h2>
          <p className="desc">{ticket.description || <span className="muted">No description</span>}</p>
          <table>
            <tbody>
              <tr>
                <th>Status</th>
                <td>{statuses.find((s) => s.id === ticket.statusId)?.name}</td>
              </tr>
              <tr>
                <th>Reporter</th>
                <td>{ticket.reporter}</td>
              </tr>
              <tr>
                <th>Assignee</th>
                <td>{ticket.assignee ?? "Unassigned"}</td>
              </tr>
              <tr>
                <th>Estimation</th>
                <td>{ticket.estimation ?? "-"}</td>
              </tr>
              <tr>
                <th>Parent</th>
                <td>
                  {ticket.parent ? (
                    <a href="#" onClick={(e) => (e.preventDefault(), setKey(ticket.parent!.key))}>
                      {ticket.parent.key} {ticket.parent.title}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <TicketAttachments
            ticketKey={ticket.key}
            attachments={ticket.attachments}
            onChanged={() => {
              load();
              onChanged();
            }}
          />
          {ticket.children.length > 0 && (
            <>
              <h3>Children ({ticket.children.length})</h3>
              <table>
                <tbody>
                  {ticket.children.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setKey(c.key)}>
                      <td>
                        <span className={`badge ${c.type}`}>{c.type}</span>
                      </td>
                      <td className="key">{c.key}</td>
                      <td>{c.title}</td>
                      <td>{statuses.find((s) => s.id === c.statusId)?.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {editing && ticket && (
        <TicketForm
          projectId={projectId}
          statuses={statuses}
          tickets={tickets}
          ticket={ticket}
          onClose={() => setEditing(false)}
          onSaved={(t) => {
            setTicket(t);
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}
