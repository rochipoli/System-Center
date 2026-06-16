import { useState } from "react";
import { X, Monitor, Terminal } from "lucide-react";
import { api, type ServerCreate } from "../api/client";

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

const EMPTY: ServerCreate = {
  hostname: "",
  ip_address: "",
  domain: "",
  environment: "",
  os: "",
  description: "",
  connection_type: "winrm",
  winrm_port: 5985,
  winrm_transport: "ntlm",
  ssh_port: 22,
};

export default function AddServerModal({ onClose, onAdded }: Props) {
  const [form, setForm] = useState<ServerCreate>(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof ServerCreate, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isSSH = form.connection_type === "ssh";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.hostname.trim()) return setError("Hostname is required");
    setSaving(true);
    setError("");
    try {
      const payload: ServerCreate = { ...form };
      if (!payload.ip_address) delete payload.ip_address;
      if (!payload.domain) delete payload.domain;
      if (!payload.environment) delete payload.environment;
      if (!payload.os) delete payload.os;
      if (!payload.description) delete payload.description;
      await api.servers.create(payload);
      onAdded();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Add Server</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {/* Connection type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Connection Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["winrm", "ssh"] as const).map((ct) => {
                const Icon = ct === "winrm" ? Monitor : Terminal;
                const label = ct === "winrm" ? "WinRM (Windows)" : "SSH (Linux / macOS)";
                return (
                  <button
                    key={ct}
                    type="button"
                    onClick={() => set("connection_type", ct)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      form.connection_type === ct
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hostname <span className="text-red-500">*</span>
              </label>
              <input
                value={form.hostname}
                onChange={(e) => set("hostname", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="server01.domain.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IP Address</label>
              <input
                value={form.ip_address ?? ""}
                onChange={(e) => set("ip_address", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="192.168.1.10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
              <input
                value={form.domain ?? ""}
                onChange={(e) => set("domain", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="corp.local"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
              <select
                value={form.environment ?? ""}
                onChange={(e) => set("environment", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select —</option>
                <option>Production</option>
                <option>Staging</option>
                <option>Development</option>
                <option>Test</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OS</label>
              <input
                value={form.os ?? ""}
                onChange={(e) => set("os", e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={isSSH ? "Ubuntu 22.04 / macOS 14" : "Windows Server 2022"}
              />
            </div>

            {/* Connection-specific fields */}
            {isSSH ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SSH Port</label>
                <input
                  type="number"
                  value={form.ssh_port}
                  onChange={(e) => set("ssh_port", parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">WinRM Port</label>
                  <input
                    type="number"
                    value={form.winrm_port}
                    onChange={(e) => set("winrm_port", parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transport</label>
                  <select
                    value={form.winrm_transport}
                    onChange={(e) => set("winrm_transport", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ntlm">NTLM</option>
                    <option value="kerberos">Kerberos</option>
                    <option value="basic">Basic</option>
                    <option value="credssp">CredSSP</option>
                  </select>
                </div>
              </>
            )}

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Optional notes…"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add Server"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
