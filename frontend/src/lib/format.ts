// Amounts are always minor units (paise) per the OpenAPI spec's Money schema -- divide by 100
// and format as rupees here rather than anywhere data is fetched, so every call site displays
// the same way.
export function formatMoney(amountMinorUnits: number, currency: string): string {
  const major = amountMinorUnits / 100;
  const symbol = currency === "INR" ? "₹" : currency + " ";
  return `${symbol}${major.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
