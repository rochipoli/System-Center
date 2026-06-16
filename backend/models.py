from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    hostname: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(50), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    environment: Mapped[str | None] = mapped_column(String(50), nullable=True)
    os: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # WinRM
    winrm_port: Mapped[int] = mapped_column(default=5985)
    winrm_transport: Mapped[str] = mapped_column(String(20), default="ntlm")
    # SSH
    connection_type: Mapped[str] = mapped_column(String(10), default="winrm")  # winrm | ssh
    ssh_port: Mapped[int] = mapped_column(default=22)
    # Scan state
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_scanned: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scan_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
