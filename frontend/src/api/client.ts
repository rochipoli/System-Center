export interface Server {
  id: number;
  hostname: string;
  ip_address: string | null;
  domain: string | null;
  environment: string | null;
  os: string | null;
  description: string | null;
  connection_type: "winrm" | "ssh";
  winrm_port: number;
  winrm_transport: string;
  ssh_port: number;
  created_at: string;
  last_scanned: string | null;
  scan_status: string | null;
}

export interface ServerCreate {
  hostname: string;
  ip_address?: string;
  domain?: string;
  environment?: string;
  os?: string;
  description?: string;
  connection_type?: "winrm" | "ssh";
  winrm_port?: number;
  winrm_transport?: string;
  ssh_port?: number;
}

export interface ScanCredentials {
  username: string;
  password: string;
  ssh_key?: string;
}

export interface DiskInfo {
  drive: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
}

export interface ResourceInfo {
  cpu_percent: number | null;
  memory_total_gb: number | null;
  memory_used_gb: number | null;
  memory_percent: number | null;
  disks: DiskInfo[];
  uptime_days: number | null;
  error: string | null;
}

export interface LogEntry {
  time_generated: string;
  source: string;
  event_id: number;
  event_type: string;
  message: string;
}

export interface LogsInfo {
  entries: LogEntry[];
  error: string | null;
}

export interface ServiceInfo {
  name: string;
  display_name: string;
  status: string;
}

export interface ConfigInfo {
  os_name: string | null;
  os_version: string | null;
  os_architecture: string | null;
  computer_name: string | null;
  domain: string | null;
  total_memory_gb: number | null;
  processors: string[];
  installed_features: string[];
  services: ServiceInfo[];
  error: string | null;
}

export interface SoftwarePackage {
  name: string;
  version: string;
  publisher: string;
}

export interface SoftwareInfo {
  packages: SoftwarePackage[];
  error: string | null;
}

export interface PortEntry {
  port: number;
  protocol: string;
  state: string;
  process_id: number | null;
  process: string;
}

export interface PortsInfo {
  ports: PortEntry[];
  error: string | null;
}

export interface ScanAllResult {
  resources: ResourceInfo;
  logs: LogsInfo;
  configuration: ConfigInfo;
  software: SoftwareInfo;
  ports: PortsInfo;
}

export interface StoredScanData {
  resources: ResourceInfo | null;
  logs: LogsInfo | null;
  configuration: ConfigInfo | null;
  software: SoftwareInfo | null;
  ports: PortsInfo | null;
  last_scanned: string | null;
}

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  servers: {
    list: () => request<Server[]>("/servers"),
    create: (data: ServerCreate) =>
      request<Server>("/servers", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<ServerCreate>) =>
      request<Server>(`/servers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/servers/${id}`, { method: "DELETE" }),
    importExcel: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/servers/import/excel`, { method: "POST", body: form }).then(
        async (r) => {
          if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
          return r.json() as Promise<{ added: number; skipped: number; errors: string[] }>;
        }
      );
    },
  },
  scan: {
    all: (id: number, creds: ScanCredentials) =>
      request<ScanAllResult>(`/servers/${id}/scan/all`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    resources: (id: number, creds: ScanCredentials) =>
      request<ResourceInfo>(`/servers/${id}/scan/resources`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    logs: (id: number, creds: ScanCredentials) =>
      request<LogsInfo>(`/servers/${id}/scan/logs`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    configuration: (id: number, creds: ScanCredentials) =>
      request<ConfigInfo>(`/servers/${id}/scan/configuration`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    software: (id: number, creds: ScanCredentials) =>
      request<SoftwareInfo>(`/servers/${id}/scan/software`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    ports: (id: number, creds: ScanCredentials) =>
      request<PortsInfo>(`/servers/${id}/scan/ports`, {
        method: "POST",
        body: JSON.stringify(creds),
      }),
    results: (id: number) =>
      request<StoredScanData | null>(`/servers/${id}/scan/results`),
  },
};
