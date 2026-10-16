"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CASH_INVENTORY_ACTION_LABELS,
  INVENTORY_BILLS,
  INVENTORY_COINS,
  type CashInventory,
  type CashInventoryAction,
  type CashInventoryLog,
  type CoinCounts,
} from "@/lib/parking/cash-inventory-shared";
import { formatDateTime } from "@/lib/parking/parking-entry-shared";

// 交班 > 自助機收找零紀錄作業：硬幣目前 / 保留數量、收鈔機數量，存在 MongoDB carpark.cash_inventory。
// 找零錢機出幣、紙鈔機收鈔時伺服器自動增減，畫面每 5 秒重新讀取。

const REFRESH_MS = 5000;

const tealButtonClass =
  "whitespace-nowrap rounded bg-sky-400 px-4 py-2 text-base text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50";
// 手機 2 欄、平板 3 欄、電腦 6 欄（第一欄放標題與按鈕，其後 5 欄為各面額）
const coinGridClass = "grid grid-cols-2 items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-3 lg:grid-cols-[auto_repeat(5,minmax(0,1fr))]";
const coinLabelCellClass = "col-span-2 flex items-center gap-2 whitespace-nowrap sm:col-span-3 lg:col-span-1 lg:justify-end";

function ChangeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-center">↑↓{title}</div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

type Draft = Record<(typeof INVENTORY_COINS)[number], string>;
const toDraft = (values: CoinCounts): Draft =>
  Object.fromEntries(INVENTORY_COINS.map((c) => [c, String(values[c])])) as Draft;

function CoinInputs({ draft, onChange }: { draft: Draft; onChange: (coin: keyof Draft, value: string) => void }) {
  return INVENTORY_COINS.map((coin) => (
    <label key={coin} className="flex items-center gap-1">
      <span className="w-10 shrink-0 text-right">{coin}元</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={draft[coin]}
        onChange={(e) => onChange(coin, e.target.value)}
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 font-bold text-gray-900"
      />
    </label>
  ));
}

function CoinCountsRow({ values, signed = false }: { values: CoinCounts; signed?: boolean }) {
  return INVENTORY_COINS.map((coin) => {
    const n = values[coin];
    return (
      <div key={coin} className={`text-center ${n < 0 ? "text-red-600" : ""}`}>
        {coin}元 {signed && n > 0 ? `+${n}` : n}
      </div>
    );
  });
}

/** 紀錄裡的數量變化，例如「50元 138→100、10元 304→140」 */
function describeLog(log: CashInventoryLog): string {
  const field = (Object.keys(log.after)[0] ?? "current") as "current" | "reserved" | "cashBox";
  const before = (log.before[field] ?? {}) as Record<string, number>;
  const after = (log.after[field] ?? {}) as Record<string, number>;
  const keys: readonly number[] = field === "cashBox" ? INVENTORY_BILLS : INVENTORY_COINS;
  const changes = keys.filter((k) => before[k] !== after[k]).map((k) => `${k}元 ${before[k] ?? 0}→${after[k] ?? 0}`);
  return changes.length ? changes.join("、") : "沒有變動";
}

export function ChangeRecordForm({ onClose }: { onClose: () => void }) {
  const [inventory, setInventory] = useState<CashInventory | null>(null);
  const [logs, setLogs] = useState<CashInventoryLog[]>([]);
  // 正在修改的欄位；null 代表沒在改，輸入框跟著資料庫的值更新
  const [currentDraft, setCurrentDraft] = useState<Draft | null>(null);
  const [reservedDraft, setReservedDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const json = (await (await fetch("/api/cash-inventory")).json()) as {
        ok: boolean;
        error?: string;
        inventory?: CashInventory;
        logs?: CashInventoryLog[];
      };
      if (json.ok && json.inventory) {
        setInventory(json.inventory);
        setLogs(json.logs ?? []);
      } else {
        setMessage({ ok: false, text: json.error ?? "讀取失敗" });
      }
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    }
  }, []);

  // 出幣、收鈔會在背景改變數量，定時重新讀取
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面先讀一次，之後定時重新讀取；setState 都在 await 之後
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const submit = async (action: CashInventoryAction, values?: Draft) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cash-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, values: values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; inventory?: CashInventory; logs?: CashInventoryLog[] };
      if (json.ok && json.inventory) {
        setInventory(json.inventory);
        setLogs(json.logs ?? []);
        if (action === "setCurrent" || action === "refill") setCurrentDraft(null);
        if (action === "setReserved") setReservedDraft(null);
        setMessage({ ok: true, text: `${CASH_INVENTORY_ACTION_LABELS[action]}完成` });
      } else {
        setMessage({ ok: false, text: json.error ?? "儲存失敗" });
      }
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setBusy(false);
    }
  };

  const confirmThen = (text: string, action: CashInventoryAction) => {
    if (window.confirm(text)) submit(action);
  };

  const current = inventory?.current;
  const reserved = inventory?.reserved;
  const currentValues = currentDraft ?? (current ? toDraft(current) : null);
  const reservedValues = reservedDraft ?? (reserved ? toDraft(reserved) : null);
  // 補幣要補進（正）或取出（負）的數量 = 保留數量 − 目前數量
  const diff =
    current && reserved
      ? (Object.fromEntries(INVENTORY_COINS.map((c) => [c, reserved[c] - current[c]])) as CoinCounts)
      : null;
  const needsRefill = diff !== null && INVENTORY_COINS.some((c) => diff[c] !== 0);

  return (
    <form className="rounded border border-gray-200" onSubmit={(e) => e.preventDefault()}>
      <div className="relative border-b border-gray-200 px-12 py-3 text-center">
        <h2 className="text-2xl font-bold">自助機收找零紀錄作業</h2>
        <button type="button" onClick={onClose} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600">
          關閉
        </button>
      </div>

      <div className="space-y-4 p-4 text-teal-700">
        <ChangeSection title="設定點餐機識別名">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" className={tealButtonClass}>
              列印 交班收找零表
            </button>
            <label className="flex items-center gap-1">
              店名: 亞洲電腦永義停車場
              <input defaultValue="亞洲電腦永義停車場" className="w-36 rounded border border-gray-300 px-2 py-1 font-bold text-gray-900" />
            </label>
            <label className="flex items-center gap-1">
              點餐機識別名: TSLA
              <input defaultValue="TSLA" className="w-36 rounded border border-gray-300 px-2 py-1 font-bold text-gray-900" />
            </label>
          </div>
        </ChangeSection>

        <ChangeSection title="設定硬幣數量">
          {!inventory && <div className="text-gray-500">{message?.ok === false ? message.text : "讀取中…"}</div>}
          {inventory && currentValues && reservedValues && diff && (
            <>
              <div className={coinGridClass}>
                <div className={coinLabelCellClass}>
                  <button
                    type="button"
                    onClick={() => confirmThen("鈔票已從收鈔機取出，把收鈔機數量歸零？", "clearCashBox")}
                    disabled={busy}
                    className={tealButtonClass}
                  >
                    收鈔機歸零
                  </button>
                </div>
                <div className="text-center">收鈔機目前數量</div>
                {INVENTORY_BILLS.map((note) => (
                  <div key={note} className="text-center">
                    {note}元 {inventory.cashBox[note]}
                  </div>
                ))}
              </div>

              <div className={`${coinGridClass} border-t border-gray-300`}>
                <div className={coinLabelCellClass}>目前數量</div>
                <CoinCountsRow values={inventory.current} />
                <div className={coinLabelCellClass}>
                  修改目前數量
                  <button
                    type="button"
                    onClick={() => submit("setCurrent", currentValues)}
                    disabled={busy || currentDraft === null}
                    className={tealButtonClass}
                  >
                    確定修改
                  </button>
                </div>
                <CoinInputs draft={currentValues} onChange={(coin, v) => setCurrentDraft({ ...currentValues, [coin]: v })} />
              </div>

              <div className={`${coinGridClass} border-t border-gray-300`}>
                <div className={coinLabelCellClass}>保留數量</div>
                <CoinCountsRow values={inventory.reserved} />
                <div className={coinLabelCellClass}>
                  修改保留數量
                  <button
                    type="button"
                    onClick={() => submit("setReserved", reservedValues)}
                    disabled={busy || reservedDraft === null}
                    className={tealButtonClass}
                  >
                    確定修改
                  </button>
                </div>
                <CoinInputs draft={reservedValues} onChange={(coin, v) => setReservedDraft({ ...reservedValues, [coin]: v })} />
              </div>

              <div className={`${coinGridClass} border-t border-gray-300`}>
                <div className={coinLabelCellClass}>
                  計算增減數量
                  <button
                    type="button"
                    onClick={() => confirmThen("硬幣已依增減數量補進 / 取出，把目前數量設為保留數量？", "refill")}
                    disabled={busy || !needsRefill}
                    className={tealButtonClass}
                  >
                    確定補幣
                  </button>
                </div>
                <CoinCountsRow values={diff} signed />
              </div>
              <p className="text-xs text-gray-500">
                增減數量 = 保留數量 − 目前數量：正數要補進、負數要取出。找零錢機出幣時目前數量自動扣掉，紙鈔機收鈔時收鈔機數量自動增加；
                硬幣接收器收到的硬幣不會自動加進目前數量，請盤點後用「修改目前數量」調整。
              </p>
              {message && <div className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</div>}
            </>
          )}
        </ChangeSection>

        {logs.length > 0 && (
          <ChangeSection title="操作紀錄（最近 20 筆）">
            <ul className="space-y-1 text-sm text-gray-800">
              {logs.map((log) => (
                <li key={log.id}>
                  <span className="mr-3 font-mono text-gray-500">{formatDateTime(log.time)}</span>
                  <span className="font-medium">{CASH_INVENTORY_ACTION_LABELS[log.action]}</span>：{describeLog(log)}
                </li>
              ))}
            </ul>
          </ChangeSection>
        )}
      </div>

      <div className="flex justify-end border-t border-gray-200 px-4 py-3">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100">
          關閉
        </button>
      </div>
    </form>
  );
}
