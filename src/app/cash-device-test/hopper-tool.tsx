"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CASH_DEVICE_LABELS,
  HOPPER_COIN_VALUES,
  HOPPER_DEVICES,
  HOPPER_MODELS,
  type CashDeviceStatus,
  type HopperDeviceId,
  type HopperAction,
  type HopperModel,
  type HopperSettings,
  type HopperState,
  type SerialLogEntry,
} from "@/lib/cash-device/shared";

// 仿 ICT 原廠出幣機測試工具（RED FLAG 協定）的找零錢機測試介面

const buttonClass =
  "h-12 w-full rounded border border-gray-400 bg-gray-100 px-2 text-sm leading-tight hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass = "w-full rounded border border-gray-300 px-2 py-1.5";
const readonlyClass = "min-h-9 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1.5";

const DIR_TEXT: Record<SerialLogEntry["dir"], string> = { rx: "收", tx: "送", info: "●" };

const MODE_TEXT = {
  passive: "不回報",
  active1: "逐枚回報",
  active2: "回報剩餘數",
  empty: "清空",
} as const;

async function postHopper(body: unknown): Promise<{ ok: boolean; error?: string; state?: HopperState }> {
  const res = await fetch("/api/cash-device/hopper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function Row({ button, label, children }: { button: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <div>{button}</div>
      <div className="self-center whitespace-nowrap">{label}</div>
      <div className="self-center">{children}</div>
    </>
  );
}

export function HopperTool({
  device,
  statuses,
  onDeviceChange,
  state,
  connected,
  logs,
  onState,
}: {
  device: HopperDeviceId;
  statuses: Partial<Record<string, CashDeviceStatus>>;
  onDeviceChange: (device: HopperDeviceId) => void;
  state: HopperState | null;
  connected: boolean;
  logs: SerialLogEntry[];
  onState: (state: HopperState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState("1");
  const [clearedAfter, setClearedAfter] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => logs.filter((l) => l.device === device && l.id > clearedAfter),
    [logs, device, clearedAfter],
  );

  // 跟原廠工具一樣新的在最下面，自動捲到底
  useEffect(() => {
    tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight });
  }, [rows.length]);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const json = await postHopper({ device, ...(body as object) });
      if (json.state) onState(json.state);
      if (!json.ok) setError(json.error ?? "操作失敗");
    } catch {
      setError("連不到伺服器");
    } finally {
      setBusy(false);
    }
  };

  const countNumber = Number(count);
  const countValid = Number.isInteger(countNumber) && countNumber >= 1 && countNumber <= 255;
  const action = (a: HopperAction) => run({ action: a, count: countNumber });
  const saveSettings = (patch: Partial<HopperSettings>) => state && run({ settings: { ...state.settings, ...patch } });

  const disabled = busy || !connected;
  const payout = state?.payout ?? null;
  const activeRunning = !!payout && payout.mode !== "passive" && payout.accepted && !payout.done;

  const button = (a: HopperAction, label: ReactNode, needsCount = false) => (
    <button
      type="button"
      onClick={() => action(a)}
      disabled={disabled || (needsCount && !countValid)}
      className={buttonClass}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h2 className="font-bold">找零錢機測試工具</h2>
        {!connected && (
          <span className="text-xs text-gray-500">{CASH_DEVICE_LABELS[device]}未連線，請先在上方連線</span>
        )}
      </div>

      {/* 4 台找零錢機切換，綠點代表已連線 */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200 px-3 pt-2">
        {HOPPER_DEVICES.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDeviceChange(d)}
            className={`flex items-center gap-1 rounded-t border border-b-0 px-3 py-1.5 text-sm ${
              d === device ? "border-gray-300 bg-white font-bold" : "border-transparent text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${statuses[d]?.state === "connected" ? "bg-green-500" : "bg-gray-300"}`}
            />
            {HOPPER_COIN_VALUES[d]} 元
          </button>
        ))}
      </div>

      {!state ? (
        <div className="p-4 text-sm text-gray-500">讀取中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-3 text-sm lg:grid-cols-[26rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-[7.5rem_auto_minmax(0,1fr)] gap-x-3 gap-y-2">
              <Row button={button("payoutNoReply", "出幣（不回報）", true)} label="出幣機位址">
                <select
                  value={state.settings.address}
                  onChange={(e) => saveSettings({ address: Number(e.target.value) })}
                  disabled={busy}
                  className={fieldClass}
                >
                  {[0, 1, 2, 3].map((a) => (
                    <option key={a} value={a}>
                      {a.toString(16).padStart(2, "0").toUpperCase()}
                    </option>
                  ))}
                </select>
              </Row>
              <Row button={button("payoutReply", "出幣（逐枚回報）", true)} label="出幣枚數">
                <input
                  type="number"
                  min={1}
                  max={255}
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className={`${fieldClass} ${countValid ? "" : "border-red-400"}`}
                />
              </Row>
              <Row button={button("status", "詢問狀態")} label="狀態">
                <div className={readonlyClass}>
                  {state.statusByte === null ? (
                    <span className="text-gray-400">—</span>
                  ) : state.statusByte === 0 ? (
                    <span className="text-green-700">正常</span>
                  ) : (
                    <span className="text-red-600">
                      {state.statusFlags.join("、")}（{state.statusByte.toString(16).padStart(2, "0").toUpperCase()}）
                    </span>
                  )}
                </div>
              </Row>
              <Row button={button("remain", "詢問未出幣數")} label="未出幣數">
                <div className={readonlyClass}>{state.remain ?? <span className="text-gray-400">—</span>}</div>
              </Row>
              <Row button={button("reset", "重置出幣機")} label="機型">
                <select
                  value={state.settings.model}
                  onChange={(e) => saveSettings({ model: e.target.value as HopperModel })}
                  disabled={busy}
                  className={fieldClass}
                >
                  {HOPPER_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Row>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {button("empty", "清空出幣機")}
              {button("payoutRemain", "出幣（回報剩餘數）", true)}
              <button
                type="button"
                onClick={() => action("stop")}
                disabled={disabled}
                className={`${buttonClass} border-red-400 text-red-700 hover:bg-red-50`}
              >
                緊急停止
              </button>
            </div>

            <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-2">
              <div>
                本次出幣：
                {payout ? (
                  <>
                    {payout.requested !== null ? `${payout.requested} 枚` : "清空"}（{MODE_TEXT[payout.mode]}）
                    {payout.mode !== "passive" && `，已出 ${payout.dispensed} 枚`}
                    {payout.done ? "，已結束" : payout.accepted ? "，出幣中" : "，等待回應"}
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div>累計出幣：{state.totalDispensed} 枚（逐枚回報、回報剩餘數、清空模式才計算）</div>
              <div>最後訊息：{state.lastMessage ?? "—"}</div>
              {activeRunning && (
                <div className="text-orange-600">主動回報出幣中，文件建議出幣結束前不要再下其他指令</div>
              )}
              {state.settings.model === "MH" && (
                <div className="text-xs text-gray-500">MH 機型不支援「緊急停止」指令（文件僅 EMH、UCH 支援）</div>
              )}
            </div>

            {error && <div className="text-red-600">{error}</div>}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                onClick={() => setClearedAfter(logs.at(-1)?.id ?? 0)}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-100"
              >
                清除紀錄
              </button>
            </div>
            <div ref={tableRef} className="h-80 overflow-auto border border-gray-400 bg-white lg:h-[26rem]">
              <table className="w-full border-collapse font-mono text-xs">
                <thead className="sticky top-0 bg-gray-100">
                  <tr>
                    <th className="border-b border-gray-300 px-2 py-1 text-left font-normal">收送</th>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <th key={n} className="w-8 border-b border-gray-300 px-1 py-1 text-left font-normal">
                        {n}
                      </th>
                    ))}
                    <th className="border-b border-gray-300 px-2 py-1 text-left font-normal">說明</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    const bytes = l.hex ? l.hex.split(" ") : [];
                    return (
                      <tr key={l.id} className="border-b border-gray-100 align-top">
                        <td className={`px-2 py-0.5 ${l.dir === "rx" ? "text-blue-700" : l.dir === "tx" ? "text-green-700" : "text-gray-500"}`}>
                          {DIR_TEXT[l.dir]}
                        </td>
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <td key={i} className="px-1 py-0.5">
                            {bytes[i] ?? ""}
                          </td>
                        ))}
                        <td className="px-2 py-0.5 font-sans">
                          {bytes.length > 6 && <span className="font-mono">{bytes.slice(6).join(" ")} </span>}
                          {l.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
