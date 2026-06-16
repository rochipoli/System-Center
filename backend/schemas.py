from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ServerBase(BaseModel):
    hostname: str
    ip_address: str | None = None
    domain: str | None = None
    environment: str | None = None
    os: str | None = None
    description: str | None = None
    connection_type: str = "winrm"   # winrm | ssh
    winrm_port: int = 5985
    winrm_transport: str = "ntlm"
    ssh_port: int = 22


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    hostname: str | None = None
    ip_address: str | None = None
    domain: str | None = None
    environment: str | None = None
    os: str | None = None
    description: str | None = None
    connection_type: str | None = None
    winrm_port: int | None = None
    winrm_transport: str | None = None
    ssh_port: int | None = None


class ServerResponse(ServerBase):
    id: int
    created_at: datetime
    last_scanned: datetime | None = None
    scan_status: str | None = None

    model_config = {"from_attributes": True}


class ScanCredentials(BaseModel):
    username: str
    password: str
    ssh_key: str | None = None


class ResourceInfo(BaseModel):
    cpu_percent: float | None = None
    memory_total_gb: float | None = None
    memory_used_gb: float | None = None
    memory_percent: float | None = None
    disks: list[dict] = []
    uptime_days: float | None = None
    error: str | None = None


class LogEntry(BaseModel):
    time_generated: str
    source: str
    event_id: int
    event_type: str
    message: str


class LogsInfo(BaseModel):
    entries: list[LogEntry] = []
    error: str | None = None


class ConfigInfo(BaseModel):
    os_name: str | None = None
    os_version: str | None = None
    os_architecture: str | None = None
    computer_name: str | None = None
    domain: str | None = None
    total_memory_gb: float | None = None
    processors: list[str] = []
    installed_features: list[str] = []
    services: list[dict] = []
    error: str | None = None


class SoftwarePackage(BaseModel):
    name: str
    version: str = ""
    publisher: str = ""


class SoftwareInfo(BaseModel):
    packages: list[SoftwarePackage] = []
    error: str | None = None


class PortEntry(BaseModel):
    port: int
    protocol: str
    state: str = ""
    process_id: int | None = None
    process: str = ""


class PortsInfo(BaseModel):
    ports: list[PortEntry] = []
    error: str | None = None


class ScanAllResult(BaseModel):
    resources: ResourceInfo
    logs: LogsInfo
    configuration: ConfigInfo
    software: SoftwareInfo
    ports: PortsInfo


class StoredScanData(BaseModel):
    resources: Optional[ResourceInfo] = None
    logs: Optional[LogsInfo] = None
    configuration: Optional[ConfigInfo] = None
    software: Optional[SoftwareInfo] = None
    ports: Optional[PortsInfo] = None
    last_scanned: Optional[datetime] = None
