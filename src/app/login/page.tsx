"use client";

import { useState, type FormEvent } from "react";

// 登入頁：登入成功後保留 180 分鐘，回到原本要開的頁面（?next=）或首頁

/** 只允許站內路徑，避免 ?next= 被拿來導到別的網站 */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        window.location.replace(nextPath());
        return;
      }
      setError(json.error ?? "登入失敗");
    } catch {
      setError("連不到伺服器");
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-[#428bca]">停車場管理登入</h1>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">帳號</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">密碼</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-[#428bca] py-2 text-white hover:bg-[#3071a9] disabled:opacity-50"
        >
          {busy ? "登入中…" : "登入"}
        </button>
        <p className="text-center text-xs text-gray-500">登入後保留 180 分鐘</p>
      </form>
    </div>
  );
}
