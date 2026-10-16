"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BILL_ESCROW_TIMEOUT_MS,
  BILL_TYPES,
  type BillAcceptorState,
  type BillAction,
  type BillSettings,
  type SerialLogEntry,
} from "@/lib/cash-device/shared";

// 仿 ICT 原廠測試工具（ICT Protocol）的紙鈔機測試介面

const buttonClass =
  "w-full rounded border border-gray-400 bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40";

const DIR_MARK: Record<SerialLogEntry["dir"], string> = { rx: "◀", tx: "▶", info: "●" };

const STATUS_TEXT: Record<BillAcceptorState["status"], string> = {
  unknown: "未知",
  enabled: "啟用中",
  inhibited: "停用中",
};

async function postBill(body: unknown): Promise<{ ok: boolean; error?: string; state?: BillAcceptorState }> {
  const res = await fetch("/api/cash-device/bill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 七段顯示器風格的數字；沒用到的位數顯示暗色的 8，模擬熄滅的燈段 */
function SegmentDisplay({ value, digits, label }: { value: number; digits: number; label: string }) {
  const text = String(Math.min(value, 10 ** digits - 1)).padStart(digits, " ");
  return (
    <div>
      <div className="mb-1 text-xs text-gray-600">{label}</div>
      <div className="inline-flex gap-0.5 rounded border-2 border-gray-700 bg-black p-1 font-mono text-2xl leading-none font-bold sm:text-3xl">
        {text.split("").map((ch, i) => (
          <span key={i} className="w-[0.9em] rounded-sm bg-[#062b06] py-1 text-center">
            {ch === " " ? <span className="text-[#0e4a0e]">8</span> : <span className="text-[#7CFC00]">{ch}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadmeDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded bg-white p-5 text-sm text-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">說明：ICT 紙鈔機協定（ICT104U V0.3）</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
            關閉
          </button>
        </div>
        <p className="mb-3">通訊參數 RS232 9600 / 8 / Even / 1，每個指令都是 1 個位元組。</p>

        <h4 className="mt-4 mb-1 font-bold">主機 → 紙鈔機</h4>
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {[
              ["02", "接受紙鈔；也用來回應開機通知"],
              ["0F", "退回紙鈔"],
              ["18", "暫存保留紙鈔，直到收到 02 或 0F"],
              ["0C", "查詢狀態"],
              ["3E / 5E", "啟用 / 停用收鈔"],
              ["30", "重置紙鈔機，之後紙鈔機會送開機通知"],
            ].map(([code, desc]) => (
              <tr key={code} className="border-b border-gray-200">
                <td className="w-24 py-1 pr-2">{code}</td>
                <td className="py-1 font-sans">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="mt-4 mb-1 font-bold">紙鈔機 → 主機</h4>
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {[
              ["80 8F", "開機通知，主機須在 2 秒內回 02（本工具自動回應）"],
              ["81 4x", "紙鈔驗證通過，4x 為紙鈔種類（40=第 1 種 … 4F=第 16 種），須在 5 秒內回應"],
              ["10 / 11", "已收進鈔箱 / 已退鈔"],
              ["20 ~ 2A", "錯誤：馬達故障、檢查碼錯誤、卡鈔、紙鈔被移除、鈔箱開啟、感測器異常、釣魚、鈔箱異常、退鈔、無效指令"],
              ["2F", "錯誤解除"],
              ["3E / 5E", "狀態：啟用中 / 停用中"],
            ].map(([code, desc]) => (
              <tr key={code} className="border-b border-gray-200">
                <td className="w-24 py-1 pr-2">{code}</td>
                <td className="py-1 font-sans">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="mt-4 mb-1 font-bold">本工具的行為</h4>
        <ul className="list-disc space-y-1 pl-5">
          <li>收鈔面額：未勾選的面額收到後自動退回。</li>
          <li>暫存確認：收到紙鈔後等待按「收下」或「退回」，5 秒內沒按紙鈔機會自行退鈔；按「暫存保留」可無限期暫存。</li>
          <li>自動收鈔：勾選的面額收到後自動收下。</li>
          <li>通訊狀態：每 2 秒查詢一次狀態，5 秒沒有回應顯示「通訊中斷」。例行查詢不寫進紀錄。</li>
          <li>張數、金額：收進鈔箱的張數與金額，按「金額歸零」歸零；累計：伺服器啟動後的總收款金額。</li>
          <li>開機確認、自動退回、自動收下都由伺服器處理，不需要開著這個頁面。</li>
        </ul>
      </div>
    </div>
  );
}

export function BillAcceptorTool({
  state,
  connected,
  logs,
  onState,
}: {
  state: BillAcceptorState | null;
  connected: boolean;
  logs: SerialLogEntry[];
  onState: (state: BillAcceptorState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReadme, setShowReadme] = useState(false);
  const [memoClearedAfter, setMemoClearedAfter] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const memoRef = useRef<HTMLDivElement>(null);

  const escrow = state?.escrow ?? null;
  const waiting = !!escrow && !escrow.decision;
  const remainingSec =
    waiting && !escrow.held
      ? Math.max(0, Math.ceil((Date.parse(escrow.since) + BILL_ESCROW_TIMEOUT_MS - now) / 1000))
      : null;

  // Escrow 倒數時每 250ms 更新一次畫面
  useEffect(() => {
    if (!waiting || escrow?.held) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting, escrow?.held]);

  const memo = useMemo(
    () => logs.filter((l) => l.device === "bill" && l.id > memoClearedAfter),
    [logs, memoClearedAfter],
  );

  // Memo 跟原廠工具一樣新的在最下面，自動捲到底
  useEffect(() => {
    memoRef.current?.scrollTo({ top: memoRef.current.scrollHeight });
  }, [memo.length]);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const json = await postBill(body);
      if (json.state) onState(json.state);
      if (!json.ok) setError(json.error ?? "操作失敗");
    } catch {
      setError("連不到伺服器");
    } finally {
      setBusy(false);
    }
  };

  const action = (a: BillAction) => run({ action: a });
  const saveSettings = (patch: Partial<BillSettings>) => state && run({ settings: { ...state.settings, ...patch } });

  const toggleType = (index: number, checked: boolean) => {
    if (!state) return;
    const set = new Set(state.settings.enabledTypes);
    if (checked) set.add(index);
    else set.delete(index);
    saveSettings({ enabledTypes: [...set].sort((a, b) => a - b) });
  };

  const disabledByConnection = busy || !connected;

  return (
    <section className="rounded border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h2 className="font-bold">紙鈔機測試工具</h2>
        {!connected && <span className="text-xs text-gray-500">紙鈔機未連線，請先在上方連線</span>}
      </div>

      {!state ? (
        <div className="p-4 text-sm text-gray-500">讀取中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-3 text-sm lg:grid-cols-[auto_10rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <fieldset className="rounded border border-gray-300 px-3 pt-1 pb-2">
              <legend className="px-1">收鈔面額</legend>
              <div className="grid grid-flow-col grid-cols-4 grid-rows-4 gap-x-4 gap-y-0.5">
                {BILL_TYPES.map((t) => (
                  <label key={t.index} className="flex items-center gap-1 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={state.settings.enabledTypes.includes(t.index)}
                      onChange={(e) => toggleType(t.index, e.target.checked)}
                      disabled={busy}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              <fieldset className="rounded border border-gray-300 px-3 pt-1 pb-2">
                <legend className="px-1">暫存設定</legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={state.settings.escrow}
                      onChange={() => saveSettings({ escrow: true })}
                      disabled={busy}
                    />
                    暫存確認
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={!state.settings.escrow}
                      onChange={() => saveSettings({ escrow: false })}
                      disabled={busy}
                    />
                    自動收鈔
                  </label>
                </div>
              </fieldset>
              <span className={`px-2 py-0.5 font-bold text-white ${state.link ? "bg-green-600" : "bg-red-600"}`}>
                {state.link ? "通訊正常" : "通訊中斷"}
              </span>
              <span className="text-gray-700">
                狀態：{STATUS_TEXT[state.status]}
                {state.error && <span className="ml-2 text-red-600">{state.error}</span>}
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <SegmentDisplay label="張數" value={state.count} digits={3} />
              <SegmentDisplay label="金額" value={state.credit} digits={6} />
            </div>
            <SegmentDisplay label="累計" value={state.total} digits={8} />

            <div className="min-h-6 text-gray-800">
              {escrow &&
                (escrow.decision ? (
                  <span>
                    {escrow.value ?? `第 ${escrow.typeIndex + 1} 種`} 元：
                    {escrow.decision === "accept" ? "已接受" : "已退回"}，等待紙鈔機回報…
                  </span>
                ) : (
                  <span className="font-bold text-orange-600">
                    紙鈔暫存中：{escrow.value ?? `第 ${escrow.typeIndex + 1} 種`} 元
                    {escrow.held ? "（暫存保留中）" : `，${remainingSec} 秒內請按「收下」或「退回」`}
                  </span>
                ))}
            </div>

            <div className="flex">
              <button
                type="button"
                onClick={() => action("accept")}
                disabled={disabledByConnection || !waiting}
                className="h-14 w-24 border border-gray-400 bg-gray-100 hover:bg-green-100 disabled:opacity-40"
              >
                收下
              </button>
              <button
                type="button"
                onClick={() => action("reject")}
                disabled={disabledByConnection || !waiting}
                className="h-14 w-24 border border-l-0 border-gray-400 bg-gray-100 hover:bg-red-100 disabled:opacity-40"
              >
                退回
              </button>
            </div>
          </div>

          <div className="flex flex-row flex-wrap gap-2 lg:flex-col">
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button type="button" onClick={() => setShowReadme(true)} className={buttonClass}>
                說明
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button type="button" onClick={() => action("clearCredit")} disabled={busy} className={buttonClass}>
                金額歸零
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button
                type="button"
                onClick={() => action(state.status === "inhibited" ? "enable" : "disable")}
                disabled={disabledByConnection}
                className={buttonClass}
              >
                {state.status === "inhibited" ? "啟用收鈔" : "停用收鈔"}
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button type="button" onClick={() => action("reset")} disabled={disabledByConnection} className={buttonClass}>
                重置
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button
                type="button"
                onClick={() => setMemoClearedAfter(logs.at(-1)?.id ?? 0)}
                className={buttonClass}
              >
                清除紀錄
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button
                type="button"
                onClick={() => action("hold")}
                disabled={disabledByConnection || !waiting || escrow?.held}
                className={buttonClass}
              >
                暫存保留
              </button>
            </div>
            <div className="w-[calc(50%-0.25rem)] lg:w-full">
              <button type="button" onClick={() => action("poll")} disabled={disabledByConnection} className={buttonClass}>
                查詢狀態
              </button>
            </div>
            {error && <div className="w-full text-xs text-red-600">{error}</div>}
          </div>

          <div
            ref={memoRef}
            className="h-72 overflow-auto border border-gray-400 bg-white p-2 font-mono text-xs lg:h-[26rem]"
          >
            {memo.map((l) => (
              <div key={l.id} className="break-all">
                <span className="text-gray-500">{new Date(l.time).toLocaleTimeString("zh-TW", { hour12: false })}</span>{" "}
                {DIR_MARK[l.dir]} {l.hex && <span className="text-blue-700">{l.hex}</span>} {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {showReadme && <ReadmeDialog onClose={() => setShowReadme(false)} />}
    </section>
  );
}
