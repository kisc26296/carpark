"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CASH_DEVICE_LABELS,
  HOPPER_COIN_VALUES,
  HOPPER_DEVICES,
  type CashDeviceStatus,
  type HopperDeviceId,
  type HopperState,
} from "@/lib/cash-device/shared";

// 交班 > 退幣作業：操作 4 台找零錢機（50、10、5、1 元）出幣、清空、重置、停止。
// 狀態用現金設備的 SSE（/api/cash-device/stream）即時更新；COM port 在「資料庫設定」設定。

const REFUND_KEYS: (number | "all")[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "all"];
/** 出幣機一次最多出 255 枚 */
const MAX_COUNT = 255;
// 由大到小排列
const HOPPERS = [...HOPPER_DEVICES].sort((a, b) => HOPPER_COIN_VALUES[b] - HOPPER_COIN_VALUES[a]);

const smallButtonClass =
  "whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-center">↑↓{title}</div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

const PAYOUT_MODE_TEXT = { passive: "出幣", active1: "出幣", active2: "出幣", empty: "清空" } as const;

/** 一台找零錢機的狀態：連線、出幣進度、異常 */
function HopperStatusCell({ device, status, state }: { device: HopperDeviceId; status?: CashDeviceStatus; state?: HopperState }) {
  const connected = status?.state === "connected";
  const payout = state?.payout;
  return (
    <div className="space-y-0.5 rounded border border-gray-200 bg-white p-2 text-gray-900">
      <div className="font-bold">{HOPPER_COIN_VALUES[device]} 元</div>
      <div className={connected ? "text-green-700" : "text-gray-500"}>
        {connected ? `已連線（${status?.port}）` : status?.state === "reconnecting" ? "自動重連中" : "未連線"}
      </div>
      {payout && (
        <div className={payout.done ? "text-gray-700" : "font-bold text-orange-600"}>
          {PAYOUT_MODE_TEXT[payout.mode]}
          {payout.requested !== null ? ` ${payout.dispensed}/${payout.requested} 枚` : ` 已出 ${payout.dispensed} 枚`}
          {payout.done ? "（結束）" : "（進行中）"}
        </div>
      )}
      {state?.lastMessage && <div className="text-xs text-gray-500">{state.lastMessage}</div>}
      {state && state.statusFlags.length > 0 && <div className="text-xs text-red-600">{state.statusFlags.join("、")}</div>}
    </div>
  );
}

export function RefundForm({ onClose }: { onClose: () => void }) {
  const [quantity, setQuantity] = useState<number | "all">(1);
  const [statuses, setStatuses] = useState<Partial<Record<HopperDeviceId, CashDeviceStatus>>>({});
  const [states, setStates] = useState<Partial<Record<HopperDeviceId, HopperState>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/cash-device/stream");
    const isHopper = (d: string): d is HopperDeviceId => (HOPPER_DEVICES as readonly string[]).includes(d);
    source.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        statuses: CashDeviceStatus[];
        hoppers: Record<HopperDeviceId, HopperState>;
      };
      setStatuses(Object.fromEntries(data.statuses.filter((s) => isHopper(s.device)).map((s) => [s.device, s])));
      setStates(data.hoppers);
    });
    source.addEventListener("status", (e) => {
      const status = JSON.parse((e as MessageEvent).data) as CashDeviceStatus;
      if (isHopper(status.device)) setStatuses((prev) => ({ ...prev, [status.device]: status }));
    });
    source.addEventListener("hopper", (e) => {
      const { device, state } = JSON.parse((e as MessageEvent).data) as { device: HopperDeviceId; state: HopperState };
      setStates((prev) => ({ ...prev, [device]: state }));
    });
    return () => source.close();
  }, []);

  /** 對一台或多台找零錢機送出指令，回傳失敗的說明 */
  const run = async (devices: HopperDeviceId[], action: string, count?: number): Promise<string[]> => {
    const results = await Promise.all(
      devices.map(async (device) => {
        try {
          const res = await fetch("/api/cash-device/hopper", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device, action, count }),
          });
          const json = (await res.json()) as { ok: boolean; error?: string };
          return json.ok ? null : `${HOPPER_COIN_VALUES[device]}元：${json.error ?? "失敗"}`;
        } catch {
          return `${HOPPER_COIN_VALUES[device]}元：連不到伺服器`;
        }
      }),
    );
    return results.filter((r): r is string => r !== null);
  };

  const act = async (devices: HopperDeviceId[], action: string, okText: string, count?: number) => {
    setBusy(true);
    setMessage(null);
    const errors = await run(devices, action, count);
    setMessage(errors.length ? { ok: false, text: errors.join("；") } : { ok: true, text: okText });
    setBusy(false);
  };

  const refund = (device: HopperDeviceId) => {
    const value = HOPPER_COIN_VALUES[device];
    if (quantity === "all") {
      if (!window.confirm(`清空 ${value} 元找零錢機，把裡面的硬幣全部退出？`)) return;
      act([device], "empty", `已送出：清空 ${value} 元找零錢機`);
    } else {
      act([device], "payoutReply", `已送出：退 ${value} 元 × ${quantity} 枚`, quantity);
    }
  };

  const running = (device: HopperDeviceId) => {
    const payout = states[device]?.payout;
    return !!payout && !payout.done;
  };
  const anyRunning = HOPPERS.some(running);
  const connected = (device: HopperDeviceId) => statuses[device]?.state === "connected";
  const validQuantity = quantity === "all" || (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_COUNT);

  return (
    <form className="rounded border border-gray-200" onSubmit={(e) => e.preventDefault()}>
      <div className="relative border-b border-gray-200 px-12 py-3 text-center">
        <h2 className="text-2xl font-bold">退幣作業</h2>
        <button type="button" onClick={onClose} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600">
          關閉
        </button>
      </div>

      <div className="space-y-4 p-4 text-teal-700">
        <Section title="找零錢機狀態">
          <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
            {HOPPERS.map((device) => (
              <HopperStatusCell key={device} device={device} status={statuses[device]} state={states[device]} />
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            找零錢機的 COM port 在「資料庫設定」設定；出幣機只回報出幣進度，不會回報機內剩餘枚數。
          </p>
        </Section>

        <Section title="退幣功能">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="grid w-60 grid-cols-3">
                {REFUND_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setQuantity(key)}
                    className={`h-16 border border-gray-400 text-xl font-bold ${
                      quantity === key ? "bg-red-500 text-white" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                    }`}
                  >
                    {key === "all" ? "全部" : key}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-gray-900">
                退幣數量
                <input
                  type="number"
                  min={1}
                  max={MAX_COUNT}
                  inputMode="numeric"
                  placeholder={quantity === "all" ? "全部" : "輸入數量"}
                  value={quantity === "all" ? "" : quantity}
                  onChange={(e) => setQuantity(Math.floor(Number(e.target.value)) || 1)}
                  className="w-32 rounded border border-gray-300 px-2 py-1"
                />
              </label>
              <p className="text-xs text-gray-500">
                {quantity === "all" ? "全部：清空該找零錢機" : `每次最多 ${MAX_COUNT} 枚`}
                {!validQuantity && <span className="ml-1 text-red-600">數量必須是 1～{MAX_COUNT}</span>}
              </p>
            </div>

            <div className="space-y-2 lg:w-1/2">
              <div className="flex flex-wrap gap-1">
                {HOPPERS.map((device) => (
                  <button
                    key={device}
                    type="button"
                    onClick={() => refund(device)}
                    disabled={busy || !validQuantity || !connected(device) || running(device)}
                    title={connected(device) ? undefined : `${CASH_DEVICE_LABELS[device]}未連線`}
                    className={smallButtonClass}
                  >
                    退{HOPPER_COIN_VALUES[device]}元
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("重置所有已連線的找零錢機？重新開機最長約 10 秒。")) {
                      act(HOPPERS.filter(connected), "reset", "已送出重置");
                    }
                  }}
                  disabled={busy || !HOPPERS.some(connected)}
                  className={smallButtonClass}
                >
                  退幣機RESET
                </button>
                <button
                  type="button"
                  onClick={() => act(HOPPERS.filter(running), "stop", "已送出停止")}
                  disabled={busy || !anyRunning}
                  className={`${smallButtonClass} border-red-300 text-red-700`}
                >
                  停止退幣
                </button>
              </div>
              {message && <div className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</div>}
            </div>
          </div>
        </Section>
      </div>

      <div className="flex justify-end border-t border-gray-200 px-4 py-3">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100">
          關閉
        </button>
      </div>
    </form>
  );
}
