import { useEffect, useState } from "react";
import { Server as ServerIcon, Plus, Upload, RefreshCw } from "lucide-react";
import { api, type Server } from "./api/client";
import ServerList from "./components/ServerList";
import AddServerModal from "./components/AddServerModal";
import ExcelImport from "./components/ExcelImport";

type View = "servers" | "import";

export default function App() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("servers");
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setServers(await api.servers.list()); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Topbar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-1.5 rounded-lg">
              <ServerIcon size={18} />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">System Center</h1>
              <p className="text-xs text-gray-400">Windows Server Management</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <nav className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(["servers", "import"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 font-medium transition-colors ${
                    view === v ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {v === "servers" ? "Servers" : "Import"}
                </button>
              ))}
            </nav>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              <Plus size={15} /> Add Server
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Servers" value={servers.length} color="blue" />
          <StatCard label="Scan Success" value={servers.filter((s) => s.scan_status === "success").length} color="green" />
          <StatCard label="Scan Errors" value={servers.filter((s) => s.scan_status === "error").length} color="red" />
          <StatCard label="Never Scanned" value={servers.filter((s) => !s.last_scanned).length} color="gray" />
        </div>

        {view === "servers" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">Server Inventory</h2>
              <span className="text-xs text-gray-400">{servers.length} server{servers.length !== 1 ? "s" : ""}</span>
            </div>
            <ServerList servers={servers} onChanged={load} />
          </div>
        )}

        {view === "import" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Upload size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-800">Import from Spreadsheet</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Upload an Excel (.xlsx/.xls) or CSV file. Required column: <strong>hostname</strong>.
              Optional: <code className="bg-gray-100 px-1 rounded text-xs">ip_address</code>, <code className="bg-gray-100 px-1 rounded text-xs">domain</code>, <code className="bg-gray-100 px-1 rounded text-xs">environment</code>, <code className="bg-gray-100 px-1 rounded text-xs">os</code>, <code className="bg-gray-100 px-1 rounded text-xs">description</code>, <code className="bg-gray-100 px-1 rounded text-xs">winrm_port</code>, <code className="bg-gray-100 px-1 rounded text-xs">winrm_transport</code>.
            </p>
            <ExcelImport onImported={load} />
          </div>
        )}
      </main>

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors = {
    blue: "text-blue-600 bg-blue-50",
    green: "text-green-600 bg-green-50",
    red: "text-red-600 bg-red-50",
    gray: "text-gray-500 bg-gray-50",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold rounded-lg inline-block px-2 py-0.5 ${colors[color as keyof typeof colors]}`}>
        {value}
      </p>
    </div>
  );
}
