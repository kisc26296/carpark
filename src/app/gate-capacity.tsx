"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

// 進出口開關閘與車位數，放在車輛進場紀錄頁上方（設備設定頁也共用）。
// 剩餘車位數 = 最大車位數 − 場內車輛數，由伺服器依進出場紀錄自動計算，每 5 秒更新。

const buttonClass = "rounded bg-sky-400 px-4 py-2 text-lg text-white hover:bg-sky-500 disabled:opacity-50";
// 入口一組、出口一組，用不同顏色區分
const GATE_BUTTON_CLASS: Record<Role, string> = {
  entry: "rounded bg-sky-500 px-4 py-2 text-lg text-white hover:bg-sky-600 disabled:opacity-50",
  exit: "rounded bg-orange-500 px-4 py-2 text-lg text-white hover:bg-orange-600 disabled:opacity-50",
};
const fieldClass = "w-full max-w-md rounded border border-gray-300 px-3 py-2";

const REFRESH_MS = 5000;

type Role = "entry" | "exit";
type Action = "open" | "close";

interface Capacity {
  max: number;
  remaining: number;
  inside: number;
  updatedAt: string | null;
}

interface GateResult {
  sn: string;
  ok: boolean;
  status: string;
  error?: string;
}

const STATUS_TEXT: Record<Action, Record<string, string>> = {
  open: { success: "已開閘", sent: "已送出", timeout: "設備沒有回應", failed: "失敗" },
  close: { success: "已關閘", sent: "已送出", timeout: "設備沒有回應", failed: "失敗" },
};

const GATE_BUTTONS: { role: Role; action: Action; label: string }[] = [
  { role: "entry", action: "open", label: "入口開閘" },
  { role: "entry", action: "close", label: "入口關閘" },
  { role: "exit", action: "open", label: "出口開閘" },
  { role: "exit", action: "close", label: "出口關閘" },
];

export function GateAndCapacity() {
  const [busy, setBusy] = useState<string | null>(null);
  const [gateMessage, setGateMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  // 使用者正在修改的最大車位數；null 代表沒在改，顯示資料庫的值
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const [capacityMessage, setCapacityMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCapacity = useCallback(async () => {
    try {
      const json = (await (await fetch("/api/parking/capacity")).json()) as { ok: boolean; error?: string; capacity?: Capacity };
      if (json.ok && json.capacity) setCapacity(json.capacity);
      else setCapacityMessage({ ok: false, text: json.error ?? "讀取車位數失敗" });
    } catch {
      setCapacityMessage({ ok: false, text: "連不到伺服器" });
    }
  }, []);

  // 車輛進出場會改變剩餘車位數，和進場紀錄一樣定時重新讀取
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面先讀一次，之後定時重新讀取；setState 都在 await 之後
    loadCapacity();
    const timer = setInterval(loadCapacity, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadCapacity]);

  const gate = async ({ role, action, label }: (typeof GATE_BUTTONS)[number]) => {
    setBusy(label);
    setGateMessage(null);
    try {
      const res = await fetch("/api/parking/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, action }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; results?: GateResult[] };
      if (!json.results) {
        setGateMessage({ ok: false, text: json.error ?? `${label}失敗` });
      } else {
        const detail = json.results
          .map((r) => `${r.sn}：${STATUS_TEXT[action][r.status] ?? r.status}${r.error ? `（${r.error}）` : ""}`)
          .join("、");
        setGateMessage({ ok: json.ok, text: `${label} — ${detail}` });
      }
    } catch {
      setGateMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setBusy(null);
    }
  };

  const saveMax = async (e: FormEvent) => {
    e.preventDefault();
    if (maxDraft === null) return;
    setBusy("capacity");
    setCapacityMessage(null);
    try {
      const res = await fetch("/api/parking/capacity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: Number(maxDraft) }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; capacity?: Capacity };
      if (json.ok && json.capacity) {
        setCapacity(json.capacity);
        setMaxDraft(null);
        setCapacityMessage({ ok: true, text: "最大車位數已儲存" });
      } else {
        setCapacityMessage({ ok: false, text: json.error ?? "儲存失敗" });
      }
    } catch {
      setCapacityMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setBusy(null);
    }
  };

  const maxValue = maxDraft ?? (capacity ? String(capacity.max) : "");
  const dirty = maxDraft !== null && capacity !== null && maxDraft !== String(capacity.max);
  const full = capacity !== null && capacity.max > 0 && capacity.remaining === 0;

  return (
    <div className="space-y-4 text-sm text-gray-900">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-4">
          {(["entry", "exit"] as const).map((role) => (
            <div key={role} className="flex gap-1">
              {GATE_BUTTONS.filter((b) => b.role === role).map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => gate(b)}
                  disabled={busy !== null}
                  className={GATE_BUTTON_CLASS[role]}
                >
                  {busy === b.label ? `${b.label}中…` : b.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        {gateMessage && <div className={gateMessage.ok ? "text-green-700" : "text-red-600"}>{gateMessage.text}</div>}
      </div>

      <hr className="border-gray-200" />

      <form onSubmit={saveMax} className="space-y-3">
        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="font-medium sm:w-36 sm:shrink-0">最大車位數:</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={maxValue}
            onChange={(e) => setMaxDraft(e.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="font-medium sm:w-36 sm:shrink-0">剩餘車位數:</span>
          <div className={`${fieldClass} bg-gray-50 ${full ? "font-bold text-red-600" : ""}`}>
            {capacity ? (full ? `${capacity.remaining}（已滿）` : capacity.remaining) : "—"}
          </div>
        </div>
        {capacity && (
          <div className="text-xs text-gray-500 sm:pl-39">
            自動計算：最大車位數 {capacity.max} − 場內車輛 {capacity.inside} 台，每 {REFRESH_MS / 1000} 秒更新
            {capacity.inside > capacity.max && capacity.max > 0 && (
              <span className="ml-1 text-red-600">（場內車輛已超過最大車位數）</span>
            )}
          </div>
        )}

        <hr className="border-gray-200" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy !== null || !dirty} className={buttonClass}>
            車位確定修改
          </button>
          {capacityMessage && (
            <span className={capacityMessage.ok ? "text-green-700" : "text-red-600"}>{capacityMessage.text}</span>
          )}
        </div>
      </form>
    </div>
  );
}
