// Manual check: requires `npm run dev` running. Usage: npx tsx mcp/smoke.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const client = new Client({ name: "smoke", version: "0.0.0" });

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = res.content[0].text;
  console.log(`${res.isError ? "ERROR" : "ok   "} ${name}: ${text.slice(0, 300)}`);
  return res.isError ? null : JSON.parse(text);
}

async function main() {
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "arij-mcp-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "arij-mcp-outside-"));
  const attachmentPath = path.join(attachmentRoot, "smoke-attachment.txt");
  const outsidePath = path.join(outsideRoot, "outside.txt");
  await writeFile(attachmentPath, "MCP attachment smoke test\n");
  await writeFile(outsidePath, "must not be attached\n");
  try {
    await client.connect(
      new StdioClientTransport({
        command: "npx",
        args: ["tsx", "mcp/server.ts"],
        env: { ...(process.env as Record<string, string>), MCP_ATTACHMENT_ROOT: attachmentRoot },
      }),
    );
    console.log((await client.listTools()).tools.map((t) => t.name).join(", "));
    await call("whoami");
    const projects = await call("list_projects");
    if (!projects?.length) throw new Error("No projects: create one in the UI first.");
    const project = await call("get_project", { project: projects[0].prefix });
    const reporter = project.collaborators[0];
    if (!reporter) throw new Error("No collaborators: add one in the UI first.");
    const created = await call("create_ticket", {
      project: project.prefix,
      type: "epic",
      title: "MCP smoke test",
      reporter,
      attachments: [
        { kind: "link", url: "https://example.com/mcp-smoke", label: "MCP link" },
        { kind: "file", path: attachmentPath, label: "MCP file" },
      ],
    });
    if (!created) throw new Error("Ticket creation failed.");
    if (created.attachmentErrors?.length) throw new Error(JSON.stringify(created.attachmentErrors));
    const outside = await call("add_ticket_attachment", {
      key: created.key,
      attachment: { kind: "file", path: outsidePath },
    });
    if (outside) throw new Error("MCP accepted a file outside MCP_ATTACHMENT_ROOT.");
    await call("update_ticket", { key: created.key, status: project.statuses.at(-1).name, description: "updated" });
    const withAttachment = await call("get_ticket", { key: created.key });
    const link = withAttachment.attachments.find((attachment: { kind: string; label: string }) => attachment.kind === "link" && attachment.label === "MCP link");
    if (!link) throw new Error("Create-time link attachment was not returned.");
    await call("add_ticket_attachment", {
      key: created.key,
      attachment: { kind: "link", url: "https://example.com/mcp-added", label: "Added later" },
    });
    const updated = await call("get_ticket", { key: created.key });
    for (const attachment of updated.attachments) {
      await call("remove_ticket_attachment", { key: created.key, attachmentId: attachment.id });
    }
    await call("list_tickets", { project: project.prefix, text: "smoke" });
    await call("create_ticket", { project: project.prefix, type: "epic", title: "x", reporter: "nobody" }); // expected ERROR
  } finally {
    await client.close().catch(() => undefined);
    await rm(attachmentRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
