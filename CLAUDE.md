# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
# Start both backend and frontend together
./start.sh

# Backend only (from backend/)
source .venv/bin/activate
uvicorn main:app --reload --port 8000

# Frontend only (from frontend/)
npm run dev
```

- Frontend: http://localhost:5173
- Backend API + Swagger UI: http://localhost:8000/docs

The venv must be created with **Python 3.13** (`python3.13 -m venv .venv`) — pydantic-core does not build on Python 3.14.

## Installing dependencies

```bash
# Backend (from backend/)
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend (from frontend/)
npm install --legacy-peer-deps   # legacy flag required due to @vitejs/plugin-react peer constraint
```

## Architecture

**Backend** — FastAPI app in `backend/`, auto-creates a SQLite DB (`system_center.db`) on startup.

| File | Purpose |
|------|---------|
| `main.py` | App factory: creates tables, mounts CORS, registers routers |
| `models.py` | Single `Server` SQLAlchemy model (hostname, IP, domain, environment, WinRM settings, scan state) |
| `schemas.py` | All Pydantic request/response types: `ServerCreate`, `ServerUpdate`, `ResourceInfo`, `LogsInfo`, `ConfigInfo`, `ScanCredentials` |
| `database.py` | SQLAlchemy engine + `get_db` dependency |
| `routers/servers.py` | CRUD endpoints + `POST /api/servers/import/excel` (pandas-based bulk import) |
| `routers/scans.py` | Three scan endpoints under `/api/servers/{id}/scan/{resources,logs,configuration}` — each runs inline PowerShell over WinRM |

**Frontend** — React + Vite + Tailwind CSS v4 (imported via `@import "tailwindcss"` in `index.css`). All API calls proxy through Vite to `http://localhost:8000`.

| File | Purpose |
|------|---------|
| `src/api/client.ts` | Typed fetch wrapper + all interface types mirroring backend schemas |
| `src/App.tsx` | Top-level layout: stats strip, Servers / Import tab toggle, Add Server button |
| `src/components/ServerList.tsx` | Sortable/searchable table; opens `ScanModal` per row |
| `src/components/ScanModal.tsx` | Credential form + three scan tabs (Resources, Logs, Configuration) |
| `src/components/AddServerModal.tsx` | Manual server creation form |
| `src/components/ExcelImport.tsx` | Drag-and-drop file import UI |

## Scan flow

Scan endpoints receive `ScanCredentials` (username + password) in the POST body, open a `winrm.Session` using the server's stored `winrm_transport` and `winrm_port`, run the embedded PowerShell script, parse the JSON output, and update `scan_status` + `last_scanned` on the server record. Errors are returned in the response body (not as HTTP error codes) so the UI can display them inline.

## Excel import format

Required column: `hostname`. Optional columns (exact names after lowercasing + underscore-normalizing): `ip_address`, `domain`, `environment`, `os`, `description`, `winrm_port`, `winrm_transport`. Duplicate hostnames are skipped silently.
