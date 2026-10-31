# Arij

Arij is a lightweight project tracker for organizing work in projects, tracking tickets, and managing workflow boards. It runs as a self-hosted web app and stores its data in SQLite.

## Features

- Create and manage projects with unique project prefixes.
- Track epics, stories, tasks, and bugs using project-scoped ticket keys (for example, `ARJ-1`).
- Organize tickets with statuses, descriptions, estimates, reporters, assignees, and parent-child relationships.
- Attach HTTP(S) links and upload files to tickets. Files are limited to 25 MB and are always downloaded rather than opened in the app.
- Manage project collaborators and custom statuses.
- Create boards with configurable workflow stages and move tickets through them.
- Persist data locally in SQLite.

## Tech stack

- [Next.js](https://nextjs.org/) 16 with the App Router
- [React](https://react.dev/) 19 and [TypeScript](https://www.typescriptlang.org/)
- [SQLite](https://sqlite.org/) via `better-sqlite3`
- [Zod](https://zod.dev/) for input validation
- [dnd-kit](https://dndkit.com/) for drag-and-drop interactions

## Requirements

- Node.js 22 or later
- npm

For Docker deployment, Docker Engine and the Docker Compose plugin are required.

## Getting started

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The SQLite database is created automatically at `data/arij.db` by default; the containing directory is created if needed.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_PATH` | Path to the SQLite database file | `data/arij.db` under the application working directory |
| `ATTACHMENTS_PATH` | Directory for uploaded ticket files | `data/attachments` under the application working directory |
| `PORT` | Port used by the production server | `3000` |
| `HOSTNAME` | Host interface used by the production server | Next.js default; Docker sets it to `0.0.0.0` |

Set `DATABASE_PATH` and `ATTACHMENTS_PATH` to keep ticket data outside the project directory or to use mounted persistent storage. Back up the database and attachments directory together if they contain data you need to retain.

## Docker

Build and start the application with Docker Compose:

```sh
docker compose up --build
```

The app is available at [http://localhost:3000](http://localhost:3000). Compose mounts a named volume at `/data`, and the container stores the database at `/data/arij.db`, so data persists across container restarts.

To stop the app:

```sh
docker compose down
```

The named volume stores both the database and uploaded files and is retained when the containers are removed. To also delete them, remove the volume explicitly:

```sh
docker compose down --volumes
```

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server (run `npm run build` first) |
| `npm run typecheck` | Run the TypeScript compiler without emitting files |
| `npm run mcp` | Start the MCP server over stdio (needs the app running) |

## MCP server

`mcp/server.ts` lets agents work with Arij through the REST API, so the app must be running (`npm run dev`).

| Variable | Description | Default |
| --- | --- | --- |
| `ARIJ_URL` | Base URL of the running app | `http://localhost:3000` |
| `ARIJ_USER` | Collaborator name of the current user, used as ticket reporter | unset (agent asks) |
| `MCP_ATTACHMENT_ROOT` | Directory whose files MCP may attach to tickets | unset (local-file attachment disabled) |

Tools: `whoami`, `list_projects`, `get_project`, `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `add_ticket_attachment`, and `remove_ticket_attachment`. `create_ticket` and `add_ticket_attachment` accept HTTP(S) links or local paths beneath `MCP_ATTACHMENT_ROOT`. Files are limited to 25 MB. Statuses are given by name and parents by ticket key. There are no ticket delete tools.

For Copilot CLI / Agent Host, [.mcp.json](.mcp.json) registers it and reads `ARIJ_USER` from the environment, so export it before starting the agent. Set `MCP_ATTACHMENT_ROOT` to a directory the MCP process may read from; paths outside it are rejected. For other clients, run `npm run --silent mcp` from this directory with the variables above, for example with `npx @modelcontextprotocol/inspector npm run --silent mcp`. `npx tsx mcp/smoke.ts` exercises ticket attachment creation, addition, and removal against a running app that has a project and a collaborator.

## Data and deployment notes

The application uses SQLite for project, ticket, collaborator, status, board, workflow-stage, and attachment metadata. Uploaded files are stored separately under `ATTACHMENTS_PATH`. When deploying with Docker, keep the `/data` volume mounted to preserve both; back up the database and files together. The provided Compose configuration publishes the app on port `3000`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
