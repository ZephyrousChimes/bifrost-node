"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { bifrostApi, ApiError, Balance, Payment, BifrostEvent } from "@/lib/api";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

const POLL_MS = 5000;

export default function DashboardPage() {
  const router = useRouter();
  const { apiKey, clearApiKey, loaded } = useAuth();

  const [balance, setBalance] = useState<Balance | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<BifrostEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (key: string) => {
    try {
      const [balanceRes, paymentsRes, eventsRes] = await Promise.all([
        bifrostApi.getBalance(key),
        bifrostApi.listPayments(key, 20),
        bifrostApi.listEvents(key, 15),
      ]);
      setBalance(balanceRes);
      setPayments(paymentsRes.data);
      setEvents(eventsRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the Bifrost API.");
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!apiKey) {
      router.push("/login");
      return;
    }
    refresh(apiKey);
    const interval = setInterval(() => refresh(apiKey), POLL_MS);
    return () => clearInterval(interval);
  }, [loaded, apiKey, refresh, router]);

  if (!loaded || !apiKey) return null;

  return (
    <main className="min-h-screen px-6 py-10 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold gradient-text">Bifrost</h1>
        <button
          className="text-xs text-white/50 hover:text-white/80"
          onClick={() => {
            clearApiKey();
            router.push("/login");
          }}
        >
          Log out
        </button>
      </header>

      {error && (
        <div className="panel border-red-500/30 p-4 mb-6 text-sm text-red-300">
          {error} — is the API running at {process.env.NEXT_PUBLIC_BIFROST_API ?? "http://localhost:8080"}?
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 mb-8">
        {(balance?.pending ?? []).map((m) => (
          <div key={`pending-${m.currency}`} className="panel p-5">
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2">Pending</p>
            <p className="text-2xl font-bold">{formatMoney(m.amount, m.currency)}</p>
          </div>
        ))}
        {(balance?.available ?? []).map((m) => (
          <div key={`available-${m.currency}`} className="panel p-5">
            <p className="text-white/50 text-xs uppercase tracking-wide mb-2">Available</p>
            <p className="text-2xl font-bold">{formatMoney(m.amount, m.currency)}</p>
          </div>
        ))}
        {balance && balance.pending.length === 0 && balance.available.length === 0 && (
          <div className="panel p-5 col-span-2 text-white/40 text-sm">
            No balance yet — capture a payment to see it here.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 panel p-5">
          <h2 className="text-sm font-semibold text-white/70 mb-4">Recent payments</h2>
          {payments.length === 0 ? (
            <p className="text-white/40 text-sm">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs uppercase">
                    <th className="pb-2 font-normal">ID</th>
                    <th className="pb-2 font-normal">Amount</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 font-normal">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="py-2.5 font-mono text-xs text-white/60">{p.id}</td>
                      <td className="py-2.5">{formatMoney(p.amount, p.currency)}</td>
                      <td className="py-2.5">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2.5 text-white/40 text-xs">{formatRelativeTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold text-white/70 mb-4">Event feed</h2>
          {events.length === 0 ? (
            <p className="text-white/40 text-sm">No events yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.id} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white/80">{e.type}</span>
                    <span className="text-white/30">{formatRelativeTime(e.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
