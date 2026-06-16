import io
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from database import get_db
from models import Server
from schemas import ServerCreate, ServerUpdate, ServerResponse

router = APIRouter(prefix="/api/servers", tags=["servers"])


@router.get("", response_model=list[ServerResponse])
def list_servers(db: Session = Depends(get_db)):
    return db.query(Server).order_by(Server.hostname).all()


@router.post("", response_model=ServerResponse, status_code=201)
def create_server(payload: ServerCreate, db: Session = Depends(get_db)):
    existing = db.query(Server).filter(Server.hostname == payload.hostname).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Server '{payload.hostname}' already exists")
    server = Server(**payload.model_dump())
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@router.get("/{server_id}", response_model=ServerResponse)
def get_server(server_id: int, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.patch("/{server_id}", response_model=ServerResponse)
def update_server(server_id: int, payload: ServerUpdate, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, field, value)
    db.commit()
    db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=204)
def delete_server(server_id: int, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    db.delete(server)
    db.commit()


@router.post("/import/excel", response_model=dict)
async def import_from_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="File must be .xlsx, .xls, or .csv")

    contents = await file.read()
    try:
        if file.filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")

    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    required = {"hostname"}
    if not required.issubset(set(df.columns)):
        raise HTTPException(status_code=400, detail="File must contain a 'hostname' column")

    added, skipped, errors = 0, 0, []
    allowed = {"hostname", "ip_address", "domain", "environment", "os", "description", "winrm_port", "winrm_transport"}

    for _, row in df.iterrows():
        row_data = {k: (None if pd.isna(v) else v) for k, v in row.items() if k in allowed}
        hostname = row_data.get("hostname")
        if not hostname:
            errors.append("Row skipped: missing hostname")
            continue
        hostname = str(hostname).strip()
        if not hostname:
            errors.append("Row skipped: empty hostname")
            continue
        row_data["hostname"] = hostname

        existing = db.query(Server).filter(Server.hostname == hostname).first()
        if existing:
            skipped += 1
            continue
        try:
            server = Server(**row_data)
            db.add(server)
            db.commit()
            added += 1
        except Exception as e:
            db.rollback()
            errors.append(f"{hostname}: {e}")

    return {"added": added, "skipped": skipped, "errors": errors}
