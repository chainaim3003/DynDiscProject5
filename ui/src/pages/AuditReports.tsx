import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FileText,
  RefreshCw,
  CalendarDays,
  CalendarRange,
  FileDown,
  AlertCircle,
  CheckCircle2,
  Eye,
  X,
} from "lucide-react";

/**
 * AuditReports page  —  Audit Framework v6 / Iteration 7.
 *
 * Surfaces the AuditReportingAgent (port 7074) to the user:
 *   - List of existing daily/weekly/on-demand reports (auto-refresh 10s)
 *   - "Generate now" buttons for daily and weekly (fresh, no cache)
 *   - View report content inline (markdown rendered as <pre>)
 *   - Forensic: pick a deal from the existing buyer-side list, generate a
 *     regulator-grade PDF that the browser downloads.
 *
 * The forensic PDF is rendered by shared/audit-pdf.ts (all 14 v6 audit
 * blocks). The agent streams it directly back from POST /api/reports/forensic.
 */

const REPORTING_URL =
  (import.meta.env.VITE_AUDIT_REPORTING_URL as string | undefined) ??
  "http://localhost:7074";

// ─── Types matching the agent's responses ────────────────────────────────

interface ReportFile {
  name:      string;
  sizeBytes: number;
  mtime:     string;
}

interface ReportListResponse {
  daily:    ReportFile[];
  weekly:   ReportFile[];
  onDemand: ReportFile[];
}

interface GenerateResponse {
  ok:            boolean;
  outputPath?:   string;
  selfAuditPath?:string;
  dealCount?:    number;
  dateUtc?:      string;
  weekKey?:      string;
  error?:        string;
}

// ─── API calls ───────────────────────────────────────────────────────────

/**
 * One entry from /api/reports/forensic/available-deals — deals that actually
 * have a v6 forensic audit JSON on disk. The forensic PDF endpoint is
 * guaranteed to succeed for every deal in this list (no 404s, no missing
 * audit blocks).
 */
interface AvailableDeal {
  negotiationId:          string;
  outcome:                "success" | "escalation";
  generatedAt:            string;
  totalDealValue:         number | null;
  currency:               string;
  counterpartyEntityName: string | null;
}

async function fetchAvailableDeals(): Promise<AvailableDeal[]> {
  const res = await fetch(`${REPORTING_URL}/api/reports/forensic/available-deals`);
  if (!res.ok) throw new Error(`available-deals ${res.status}`);
  const data = await res.json();
  return (data?.deals ?? []) as AvailableDeal[];
}

async function fetchReports(): Promise<ReportListResponse> {
  const res = await fetch(`${REPORTING_URL}/api/reports/list`);
  if (!res.ok) throw new Error(`reports/list ${res.status}`);
  return res.json();
}

async function fetchReportContent(
  kind: "daily" | "weekly" | "on-demand",
  name: string,
): Promise<string> {
  const url = `${REPORTING_URL}/api/reports/content?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reports/content ${res.status}`);
  return res.text();
}

async function generateDaily(): Promise<GenerateResponse> {
  const res = await fetch(`${REPORTING_URL}/api/reports/daily`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({}),
  });
  return res.json();
}

async function generateWeekly(): Promise<GenerateResponse> {
  const res = await fetch(`${REPORTING_URL}/api/reports/weekly`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({}),
  });
  return res.json();
}

async function downloadForensicPdf(negotiationId: string): Promise<void> {
  const res = await fetch(`${REPORTING_URL}/api/reports/forensic`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ negotiationId }),
  });
  if (!res.ok) {
    let msg = `forensic ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error ?? msg;
    } catch { /* swallow */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${negotiationId}.audit.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ReportRow({
  kind,
  file,
  onView,
}: {
  kind: "daily" | "weekly" | "on-demand";
  file: ReportFile;
  onView: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <FileText size={16} className="text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="font-mono text-sm truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground">
            {(file.sizeBytes / 1024).toFixed(1)} KB · {new Date(file.mtime).toLocaleString()}
          </div>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onView} className="gap-1.5">
        <Eye size={14} />
        View
      </Button>
    </div>
  );
}

function ReportViewerModal({
  kind,
  name,
  onClose,
}: {
  kind: "daily" | "weekly" | "on-demand";
  name: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["report-content", kind, name],
    queryFn:  () => fetchReportContent(kind, name),
  });
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} />
            <span className="font-mono text-sm truncate">{kind} / {name}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="overflow-auto p-5">
          {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {q.isError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle size={14} /> Failed to load: {String(q.error)}
            </div>
          )}
          {q.data && (
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
              {q.data}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────

export function AuditReports() {
  const queryClient = useQueryClient();

  const reportsQuery = useQuery({
    queryKey:        ["audit-reports-list"],
    queryFn:         fetchReports,
    refetchInterval: 10_000,
  });

  // Only list deals that have a v6 forensic audit available on disk.
  // The new endpoint reads index.jsonl + verifies the audit file exists, so
  // every option in the dropdown is guaranteed to produce a real PDF —
  // no more 404s for legacy deals that lack v6 audit blocks.
  const dealsQuery = useQuery({
    queryKey: ["forensic-available-deals"],
    queryFn:  fetchAvailableDeals,
  });

  const [viewerOpen, setViewerOpen] = useState<{ kind: "daily" | "weekly" | "on-demand"; name: string } | null>(null);
  const [forensicId, setForensicId] = useState<string>("");
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const dailyMut = useMutation({
    mutationFn: generateDaily,
    onSuccess: (r) => {
      if (r.ok) {
        setLastResult({ ok: true, msg: `Daily report written: ${r.dateUtc} (${r.dealCount} deals)` });
        queryClient.invalidateQueries({ queryKey: ["audit-reports-list"] });
      } else {
        setLastResult({ ok: false, msg: r.error ?? "Unknown error" });
      }
    },
    onError: (e: any) => setLastResult({ ok: false, msg: e?.message ?? String(e) }),
  });

  const weeklyMut = useMutation({
    mutationFn: generateWeekly,
    onSuccess: (r) => {
      if (r.ok) {
        setLastResult({ ok: true, msg: `Weekly report written: ${r.weekKey} (${r.dealCount} deals)` });
        queryClient.invalidateQueries({ queryKey: ["audit-reports-list"] });
      } else {
        setLastResult({ ok: false, msg: r.error ?? "Unknown error" });
      }
    },
    onError: (e: any) => setLastResult({ ok: false, msg: e?.message ?? String(e) }),
  });

  const forensicMut = useMutation({
    mutationFn: (negId: string) => downloadForensicPdf(negId),
    onSuccess: () => setLastResult({ ok: true, msg: `Forensic PDF downloaded for ${forensicId}` }),
    onError:   (e: any) => setLastResult({ ok: false, msg: e?.message ?? String(e) }),
  });

  const onGenerateForensic = () => {
    const id = forensicId.trim();
    if (!/^NEG-[A-Za-z0-9_-]+$/.test(id)) {
      setLastResult({ ok: false, msg: "Pick or enter a valid NEG-... ID" });
      return;
    }
    forensicMut.mutate(id);
  };

  return (
    <div className="space-y-6">
      {/* Header + action buttons */}
      <div className="glass-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lg">Audit Reports</h2>
            <p className="text-sm text-muted-foreground">
              Daily &amp; weekly summaries auto-generated at 21:00 UTC. Forensic PDFs render all 14 audit blocks on demand.
              Source: AuditReportingAgent on <code className="text-xs">{REPORTING_URL}</code>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dailyMut.mutate()}
              disabled={dailyMut.isPending}
              className="gap-1.5"
            >
              <CalendarDays size={14} />
              {dailyMut.isPending ? "Generating…" : "Generate daily now"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => weeklyMut.mutate()}
              disabled={weeklyMut.isPending}
              className="gap-1.5"
            >
              <CalendarRange size={14} />
              {weeklyMut.isPending ? "Generating…" : "Generate weekly now"}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => reportsQuery.refetch()}
              disabled={reportsQuery.isFetching}
              title="Refresh"
            >
              <RefreshCw size={14} className={cn(reportsQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {lastResult && (
          <div
            className={cn(
              "mt-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2",
              lastResult.ok
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {lastResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span className="font-mono text-xs">{lastResult.msg}</span>
          </div>
        )}
      </div>

      {/* Reports lists */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["daily", "weekly", "on-demand"] as const).map(kind => {
          const list = reportsQuery.data
            ? (kind === "on-demand" ? reportsQuery.data.onDemand : reportsQuery.data[kind])
            : [];
          return (
            <div key={kind} className="glass-card p-4">
              <h3 className="font-semibold text-sm capitalize mb-3 flex items-center gap-2">
                {kind === "daily"  && <CalendarDays  size={14} />}
                {kind === "weekly" && <CalendarRange size={14} />}
                {kind === "on-demand" && <FileText   size={14} />}
                {kind} reports
                <span className="text-muted-foreground font-normal">({list.length})</span>
              </h3>
              {list.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reports yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {list.slice(0, 20).map(f => (
                    <ReportRow
                      key={f.name}
                      kind={kind}
                      file={f}
                      onView={() => setViewerOpen({ kind, name: f.name })}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Forensic PDF panel */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileDown size={14} />
          Forensic PDF (single deal)
        </h3>
        <p className="text-xs text-muted-foreground">
          Renders a regulator-grade PDF of one negotiation with all 14 v6 audit blocks.
          Only deals with a v6 forensic audit available on disk are listed — every
          option here produces a real PDF.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            className="flex h-9 rounded-md border bg-background px-3 text-sm w-full sm:w-72"
            value={forensicId}
            onChange={(e) => setForensicId(e.target.value)}
          >
            <option value="">
              — pick a deal ({(dealsQuery.data ?? []).length} available) —
            </option>
            {(dealsQuery.data ?? []).map((d: AvailableDeal) => {
              const sym = d.currency === "USD" ? "$" : d.currency === "INR" ? "₹" : "";
              const valueLabel = d.totalDealValue != null
                ? ` · ${sym}${d.totalDealValue.toLocaleString()}`
                : "";
              const dateLabel = ` · ${d.generatedAt.slice(0, 10)}`;
              return (
                <option key={d.negotiationId} value={d.negotiationId}>
                  {d.negotiationId} ({d.outcome}{valueLabel}{dateLabel})
                </option>
              );
            })}
          </select>
          <Input
            placeholder="…or paste NEG-1779515273352"
            value={forensicId}
            onChange={(e) => setForensicId(e.target.value)}
            className="sm:w-72"
          />
          <Button
            onClick={onGenerateForensic}
            disabled={forensicMut.isPending || !forensicId.trim()}
            className="gap-1.5"
          >
            <FileDown size={14} />
            {forensicMut.isPending ? "Generating…" : "Generate forensic PDF"}
          </Button>
        </div>
      </div>

      {/* Viewer modal */}
      {viewerOpen && (
        <ReportViewerModal
          kind={viewerOpen.kind}
          name={viewerOpen.name}
          onClose={() => setViewerOpen(null)}
        />
      )}
    </div>
  );
}
