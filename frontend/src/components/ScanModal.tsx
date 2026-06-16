import { useState } from "react";
import { X, Cpu, ScrollText, Settings2, Package, AlertCircle, Loader2, Key, PlayCircle } from "lucide-react";
import {
  api, type Server, type ResourceInfo, type LogsInfo,
  type ConfigInfo, type SoftwareInfo,
} from "../api/client";

type Tab = "resources" | "logs" | "configuration" | "software";
const TABS: Tab[] = ["resources", "logs", "configuration", "software"];

interface Props {
  server: Server;
  onClose: () => void;
  onScanned: () => void;
}

export default function ScanModal({ server, onClose, onScanned }: Props) {
  const isSSH = server.connection_type === "ssh";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [useKey, setUseKey] = useState(false);
  const [credError, setCredError] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>("resources");
  const [scanningAll, setScanningAll] = useState(false);
  const [loadingTab, setLoadingTab] = useState<Tab | null>(null);

  const [resources, setResources]       = useState<ResourceInfo | null>(null);
  const [logs, setLogs]                 = useState<LogsInfo | null>(null);
  const [config, setConfig]             = useState<ConfigInfo | null>(null);
  const [software, setSoftware]         = useState<SoftwareInfo | null>(null);

  const validate = (): boolean => {
    if (!username) { setCredError("Username is required"); return false; }
    if (!useKey && !password) { setCredError("Password is required"); return false; }
    if (useKey && !sshKey.trim()) { setCredError("Paste your private key or switch to password auth"); return false; }
    setCredError("");
    return true;
  };

  const creds = () => ({ username, password, ssh_key: useKey ? sshKey : undefined });

  const scanAll = async () => {
    if (!validate()) return;
    setScanningAll(true);
    try {
      const result = await api.scan.all(server.id, creds());
      setResources(result.resources);
      setLogs(result.logs);
      setConfig(result.configuration);
      setSoftware(result.software);
      onScanned();
    } finally {
      setScanningAll(false);
    }
  };

  const scanOne = async (tab: Tab) => {
    if (!validate()) return;
    setLoadingTab(tab);
    setActiveTab(tab);
    try {
      if (tab === "resources")     setResources(await api.scan.resources(server.id, creds()));
      if (tab === "logs")          setLogs(await api.scan.logs(server.id, creds()));
      if (tab === "configuration") setConfig(await api.scan.configuration(server.id, creds()));
      if (tab === "software")      setSoftware(await api.scan.software(server.id, creds()));
      onScanned();
    } finally {
      setLoadingTab(null);
    }
  };

  const tabHasData = (tab: Tab) => {
    if (tab === "resources")     return !!resources;
    if (tab === "logs")          return !!logs;
    if (tab === "configuration") return !!config;
    if (tab === "software")      return !!software;
  };

  const tabHasError = (tab: Tab) => {
    if (tab === "resources")     return !!resources?.error;
    if (tab === "logs")          return !!logs?.error;
    if (tab === "configuration") return !!config?.error;
    if (tab === "software")      return !!software?.error;
  };

  const tabLoading = (tab: Tab) => scanningAll || loadingTab === tab;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{server.hostname}</h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isSSH ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
              }`}>
                {isSSH ? `SSH :${server.ssh_port}` : `WinRM :${server.winrm_port}`}
              </span>
            </div>
            {server.ip_address && <p className="text-xs text-gray-500">{server.ip_address}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Credentials + Scan All */}
        <div className="px-6 py-3 bg-gray-50 border-b shrink-0 space-y-2">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                placeholder={isSSH ? "ubuntu / root" : "DOMAIN\\user"}
              />
            </div>

            {isSSH && (
              <div className="flex items-center gap-1.5 self-end pb-1.5">
                <button type="button" onClick={() => setUseKey(false)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${!useKey ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}>
                  Password
                </button>
                <button type="button" onClick={() => setUseKey(true)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors ${useKey ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-100"}`}>
                  <Key size={11} /> Private Key
                </button>
              </div>
            )}

            {(!isSSH || !useKey) && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
              </div>
            )}

            <div className="self-end pb-px ml-auto">
              <button onClick={scanAll} disabled={scanningAll}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                {scanningAll
                  ? <><Loader2 size={14} className="animate-spin" /> Scanning all…</>
                  : <><PlayCircle size={14} /> Scan All</>}
              </button>
            </div>

            {credError && <p className="w-full text-xs text-red-600">{credError}</p>}
          </div>

          {isSSH && useKey && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Private Key (PEM) — contents of <code className="bg-gray-200 px-1 rounded">id_rsa</code> or <code className="bg-gray-200 px-1 rounded">id_ed25519</code>
              </label>
              <textarea value={sshKey} onChange={(e) => setSshKey(e.target.value)} rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..." />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0 px-6">
          {TABS.map((tab) => {
            const Icon = { resources: Cpu, logs: ScrollText, configuration: Settings2, software: Package }[tab];
            const hasData = tabHasData(tab);
            const hasError = tabHasError(tab);
            const isLoading = tabLoading(tab);
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                <Icon size={14} />
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {isLoading && <Loader2 size={11} className="animate-spin ml-0.5" />}
                {!isLoading && hasData && !hasError && <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" />}
                {!isLoading && hasError && <span className="w-1.5 h-1.5 rounded-full bg-red-500 ml-0.5" />}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "resources" && (
            <ResourcesTab data={resources} loading={tabLoading("resources")} onScan={() => scanOne("resources")} />
          )}
          {activeTab === "logs" && (
            <LogsTab data={logs} loading={tabLoading("logs")} onScan={() => scanOne("logs")} isSSH={isSSH} />
          )}
          {activeTab === "configuration" && (
            <ConfigTab data={config} loading={tabLoading("configuration")} onScan={() => scanOne("configuration")} />
          )}
          {activeTab === "software" && (
            <SoftwareTab data={software} loading={tabLoading("software")} onScan={() => scanOne("software")} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ScanButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
      {loading && <Loader2 size={12} className="animate-spin" />}
      {loading ? "Scanning…" : "Rescan"}
    </button>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-red-700 text-sm">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <pre className="whitespace-pre-wrap break-all font-sans">{msg}</pre>
    </div>
  );
}

function GaugeBar({ percent }: { percent: number }) {
  const color = percent > 80 ? "bg-red-500" : percent > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function TabHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center mb-4">
      <h3 className="font-medium text-gray-800">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function ResourcesTab({ data, loading, onScan }: { data: ResourceInfo | null; loading: boolean; onScan: () => void }) {
  return (
    <div className="space-y-4">
      <TabHeader title="System Resources">
        {data && <ScanButton onClick={onScan} loading={loading} />}
      </TabHeader>
      {data?.error && <ErrorBox msg={data.error} />}
      {data && !data.error && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="CPU Usage" value={`${data.cpu_percent ?? 0}%`} sub={<GaugeBar percent={data.cpu_percent ?? 0} />} />
            <StatCard label="Memory" value={`${data.memory_used_gb ?? 0} / ${data.memory_total_gb ?? 0} GB`} sub={<GaugeBar percent={data.memory_percent ?? 0} />} />
            <StatCard label="Uptime" value={`${data.uptime_days ?? 0} days`} />
          </div>
          {data.disks.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Disk Usage</h4>
              <div className="space-y-2">
                {data.disks.map((d, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium font-mono">{d.drive}</span>
                      <span className="text-gray-500">{d.used_gb} / {d.total_gb} GB</span>
                    </div>
                    <GaugeBar percent={Math.round((d.used_gb / d.total_gb) * 100)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!data && !loading && (
        <EmptyState msg="Run Scan All or click Rescan to collect resource data." onScan={onScan} loading={loading} />
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-800">{value}</p>
      {sub}
    </div>
  );
}

function LogsTab({ data, loading, onScan, isSSH }: { data: LogsInfo | null; loading: boolean; onScan: () => void; isSSH: boolean }) {
  const title = isSSH ? "System Logs (last 50 errors/warnings)" : "System Event Logs (last 50 Errors/Warnings)";
  return (
    <div className="space-y-4">
      <TabHeader title={title}>
        {data && <ScanButton onClick={onScan} loading={loading} />}
      </TabHeader>
      {data?.error && <ErrorBox msg={data.error} />}
      {data && !data.error && (
        data.entries.length === 0
          ? <p className="text-sm text-gray-500">No errors or warnings found.</p>
          : (
            <div className="space-y-2">
              {data.entries.map((e, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      e.event_type === "Error" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                    }`}>{e.event_type}</span>
                    <span className="text-gray-500 text-xs">{e.time_generated}</span>
                    {e.source && <span className="text-gray-700 font-medium">{e.source}</span>}
                    {e.event_id > 0 && <span className="text-gray-400 text-xs">ID: {e.event_id}</span>}
                  </div>
                  <p className="text-gray-600 text-xs line-clamp-2">{e.message}</p>
                </div>
              ))}
            </div>
          )
      )}
      {!data && !loading && <EmptyState msg="Run Scan All or click Rescan to fetch logs." onScan={onScan} loading={loading} />}
    </div>
  );
}

function ConfigTab({ data, loading, onScan }: { data: ConfigInfo | null; loading: boolean; onScan: () => void }) {
  const [svcFilter, setSvcFilter] = useState("");
  return (
    <div className="space-y-4">
      <TabHeader title="System Configuration">
        {data && <ScanButton onClick={onScan} loading={loading} />}
      </TabHeader>
      {data?.error && <ErrorBox msg={data.error} />}
      {data && !data.error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {([
              ["OS", data.os_name],
              ["Version", data.os_version],
              ["Architecture", data.os_architecture],
              ["Computer Name", data.computer_name],
              ["Domain", data.domain],
              ["Memory", data.total_memory_gb ? `${data.total_memory_gb} GB` : null],
            ] as [string, string | null][]).map(([label, val]) => val ? (
              <div key={label} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-sm font-medium text-gray-800">{val}</p>
              </div>
            ) : null)}
          </div>
          {data.processors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Processors</p>
              <ul className="space-y-1">
                {data.processors.map((p, i) => <li key={i} className="bg-gray-50 rounded px-3 py-1.5 text-sm text-gray-700">{p}</li>)}
              </ul>
            </div>
          )}
          {data.services.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-600">Services ({data.services.length})</p>
                <input value={svcFilter} onChange={(e) => setSvcFilter(e.target.value)} placeholder="Filter…"
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-36" />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {data.services
                  .filter((s) => !svcFilter || (s.display_name + s.name).toLowerCase().includes(svcFilter.toLowerCase()))
                  .map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-xs">
                      <span className="text-gray-700 truncate max-w-xs">{s.display_name || s.name}</span>
                      <span className={`font-medium ml-2 shrink-0 ${s.status === "Running" ? "text-green-600" : "text-gray-400"}`}>{s.status}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!data && !loading && <EmptyState msg="Run Scan All or click Rescan to collect configuration." onScan={onScan} loading={loading} />}
    </div>
  );
}

function SoftwareTab({ data, loading, onScan }: { data: SoftwareInfo | null; loading: boolean; onScan: () => void }) {
  const [filter, setFilter] = useState("");
  const filtered = data?.packages.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.publisher.toLowerCase().includes(filter.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-4">
      <TabHeader title="Installed Software">
        {data && <ScanButton onClick={onScan} loading={loading} />}
      </TabHeader>
      {data?.error && <ErrorBox msg={data.error} />}
      {data && !data.error && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{data.packages.length} packages</p>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or publisher…"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-56" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide w-32">Version</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Publisher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono">{p.version || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{p.publisher || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center py-6 text-gray-400 text-xs">No packages match your filter.</p>
            )}
          </div>
        </div>
      )}
      {!data && !loading && <EmptyState msg="Run Scan All or click Rescan to list installed software." onScan={onScan} loading={loading} />}
    </div>
  );
}

function EmptyState({ msg, onScan, loading }: { msg: string; onScan: () => void; loading: boolean }) {
  return (
    <div className="text-center py-10 space-y-3">
      <p className="text-sm text-gray-400">{msg}</p>
      <button onClick={onScan} disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
        {loading ? <Loader2 size={14} className="animate-spin" /> : null}
        {loading ? "Scanning…" : "Scan Now"}
      </button>
    </div>
  );
}
