const COLORS: Record<string, string> = {
  succeeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  requires_capture: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  requires_confirmation: "bg-white/10 text-white/60 border-white/20",
  processing: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  canceled: "bg-red-500/15 text-red-300 border-red-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] ?? "bg-white/10 text-white/60 border-white/20";
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
