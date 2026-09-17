"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { bifrostApi, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const { setApiKey } = useAuth();
  const [mode, setMode] = useState<"existing" | "register">("existing");
  const [keyInput, setKeyInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const useExistingKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setApiKey(keyInput.trim());
    router.push("/");
  };

  const registerMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { api_key } = await bifrostApi.register(name, email);
      setApiKey(api_key.secret_key);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="panel w-full max-w-md p-8">
        <h1 className="text-2xl font-bold gradient-text mb-1">Bifrost</h1>
        <p className="text-white/50 text-sm mb-6">Merchant dashboard</p>

        <div className="flex gap-2 mb-6 text-sm">
          <button
            className={`px-3 py-1.5 rounded-lg ${mode === "existing" ? "bg-white/10" : "text-white/50"}`}
            onClick={() => setMode("existing")}
          >
            Use a secret key
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg ${mode === "register" ? "bg-white/10" : "text-white/50"}`}
            onClick={() => setMode("register")}
          >
            Register test merchant
          </button>
        </div>

        {mode === "existing" ? (
          <form onSubmit={useExistingKey} className="flex flex-col gap-3">
            <input
              className="bg-black/30 border border-panel-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-border"
              placeholder="sk_test_..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button type="submit" className="btn-primary text-sm">
              Continue
            </button>
          </form>
        ) : (
          <form onSubmit={registerMerchant} className="flex flex-col gap-3">
            <input
              className="bg-black/30 border border-panel-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-border"
              placeholder="Merchant name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="bg-black/30 border border-panel-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent-border"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" disabled={loading} className="btn-primary text-sm">
              {loading ? "Registering..." : "Register & continue"}
            </button>
          </form>
        )}

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      </div>
    </main>
  );
}
