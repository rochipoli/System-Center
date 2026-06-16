import { useState } from "react";
import {
  Server as ServerIcon, Search, Trash2, ScanLine, CheckCircle2,
  XCircle, Clock, ChevronUp, ChevronDown
} from "lucide-react";
import { api, type Server } from "../api/client";
import ScanModal from "./ScanModal";

interface Props {
  servers: Server[];
  onChanged: () => void;
}

type SortKey = "hostname" | "environment" | "last_scanned" | "scan_status";

const ENV_COLORS: Record<string, string> = {
  production: "bg-red-100 text-red-700",
  staging: "bg-yellow-100 text-yellow-700",
  development: "bg-green-100 text-green-700",
  test: "bg-blue-100 text-blue-700",
};

export default function ServerList({ servers, onChanged }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("hostname");
  const [sortAsc, setSortAsc] = useState(true);
  const [scanning, setScanning] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this server from the list?")) return;
    setDeleting(id);
    try { await api.servers.delete(id); onChanged(); }
    finally { setDeleting(null); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const filtered = servers
    .filter((s) =>
      !search ||
      s.hostname.toLowerCase().includes(search.toLowerCase()) ||
      (s.ip_address ?? "").includes(search) ||
      (s.environment ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const va = (a[sortKey] ?? "") as string;
      const vb = (b[sortKey] ?? "") as string;
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
    ) : null;

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hostname, IP, or environment…"
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ServerIcon size={40} className="mx-auto mb-3 opacity-30" />
          <p>{servers.length === 0 ? "No servers yet — add one or import from Excel." : "No results match your search."}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <Th label="Hostname" col="hostname" sortKey={sortKey} onClick={toggleSort}><SortIcon col="hostname" /></Th>
                <Th label="IP Address" />
                <Th label="Environment" col="environment" sortKey={sortKey} onClick={toggleSort}><SortIcon col="environment" /></Th>
                <Th label="OS" />
                <Th label="Last Scanned" col="last_scanned" sortKey={sortKey} onClick={toggleSort}><SortIcon col="last_scanned" /></Th>
                <Th label="Status" col="scan_status" sortKey={sortKey} onClick={toggleSort}><SortIcon col="scan_status" /></Th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.hostname}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.ip_address ?? "—"}</td>
                  <td className="px-4 py-3">
                    {s.environment ? (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ENV_COLORS[s.environment.toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>
                        {s.environment}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.os ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.last_scanned ? new Date(s.last_scanned).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.scan_status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setScanning(s)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Scan"
                      >
                        <ScanLine size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deleting === s.id}
                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scanning && (
        <ScanModal
          server={scanning}
          onClose={() => setScanning(null)}
          onScanned={onChanged}
        />
      )}
    </div>
  );
}

function Th({
  label, col, sortKey, onClick, children
}: {
  label: string; col?: SortKey; sortKey?: SortKey;
  onClick?: (c: SortKey) => void; children?: React.ReactNode;
}) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${col ? "cursor-pointer select-none hover:text-gray-700" : ""}`}
      onClick={() => col && onClick?.(col)}
    >
      <span className="flex items-center gap-1">{label}{children}</span>
    </th>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400 text-xs">—</span>;
  const map = {
    success: { icon: <CheckCircle2 size={13} />, cls: "text-green-600" },
    error: { icon: <XCircle size={13} />, cls: "text-red-500" },
    scanning: { icon: <Clock size={13} />, cls: "text-blue-500" },
  };
  const entry = map[status as keyof typeof map];
  if (!entry) return <span className="text-xs text-gray-500">{status}</span>;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${entry.cls}`}>
      {entry.icon}{status}
    </span>
  );
}
