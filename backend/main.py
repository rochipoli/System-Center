from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from database import engine
import models
from routers import servers, scans

models.Base.metadata.create_all(bind=engine)

# Add columns introduced after initial schema without full migration tooling
def _migrate():
    cols = {c["name"] for c in inspect(engine).get_columns("servers")}
    with engine.begin() as conn:
        if "connection_type" not in cols:
            conn.execute(text("ALTER TABLE servers ADD COLUMN connection_type VARCHAR(10) DEFAULT 'winrm'"))
        if "ssh_port" not in cols:
            conn.execute(text("ALTER TABLE servers ADD COLUMN ssh_port INTEGER DEFAULT 22"))

_migrate()

app = FastAPI(title="System Center API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(servers.router)
app.include_router(scans.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
