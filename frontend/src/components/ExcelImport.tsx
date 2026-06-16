import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from "lucide-react";
import { api } from "../api/client";

interface Props {
  onImported: () => void;
}

export default function ExcelImport({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState("");

  const handle = async (file: File) => {
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const res = await api.servers.importExcel(file);
      setResult(res);
      if (res.added > 0) onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handle(e.target.files[0]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.[0]) handle(e.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-3">
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium">Importing…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <FileSpreadsheet size={32} className="text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-700">Drop spreadsheet here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv — requires a <strong>hostname</strong> column</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
              <Upload size={12} />
              Optional columns: ip_address, domain, environment, os, description, winrm_port, winrm_transport
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 text-green-700 font-medium">
            <CheckCircle size={16} />
            Import complete — {result.added} added, {result.skipped} skipped
          </div>
          {result.errors.length > 0 && (
            <ul className="text-red-600 text-xs space-y-0.5 mt-1">
              {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm flex items-center gap-2 text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
    </div>
  );
}
