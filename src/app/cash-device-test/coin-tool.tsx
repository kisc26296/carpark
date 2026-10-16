"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  COIN_CHANNELS,
  SORTER_OUTLETS,
  type CoinAcceptorState,
  type CoinAction,
  type SerialLogEntry,
} from "@/lib/cash-device/shared";

// 仿 ICT 原廠硬幣接收器測試工具（Communication Monitor）的中文測試介面

const buttonClass =
  "rounded border border-gray-400 bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40";

const PACKET_ROWS = 5;

async function postCoin(body: unknown): Promise<{ ok: boolean; error?: string; state?: CoinAcceptorState }> {
  const res = await fetch("/api/cash-device/coin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 監看畫面上的一個燈號：亮起時用指定顏色，沒亮時灰色 */
function Lamp({ on, color, children }: { on: boolean; color: string; children: ReactNode }) {
  return <div className={on ? `font-bold ${color}` : "text-gray-500"}>{children}</div>;
}

function MonitorColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-bold text-gray-200">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** 最近幾個封包，最新的在最下面並加深顯示 */
function PacketPane({ title, rows, className }: { title: string; rows: SerialLogEntry[]; className: string }) {
  const padded = [...Array(Math.max(0, PACKET_ROWS - rows.length)).fill(null), ...rows] as (SerialLogEntry | null)[];
  return (
    <div className="min-w-0">
      <div className="mb-1 text-center font-bold text-gray-200">{title}</div>
      <div className={`border border-gray-400 ${className}`}>
        {padded.map((row, i) => (
          <div
            key={row?.id ?? `empty-${i}`}
            title={row ? `${row.hex}\n${row.text ?? ""}` : undefined}
            className={`h-6 truncate border-b border-gray-400 px-2 leading-6 last:border-b-0 ${
              i === PACKET_ROWS - 1 ? "font-bold text-gray-900" : "text-gray-600"
            }`}
          >
            {row?.hex}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-gray-600">{label}</span>
      <span className="min-w-0 break-all">{value ?? <span className="text-gray-400">—</span>}</span>
    </div>
  );
}

export function CoinAcceptorTool({
  state,
  connected,
  logs,
  onState,
}: {
  state: CoinAcceptorState | null;
  connected: boolean;
  logs: SerialLogEntry[];
  onState: (state: CoinAcceptorState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 使用者改過的分類器設定；null 代表顯示硬幣接收器回報的設定
  const [sorterDraft, setSorterDraft] = useState<number[] | null>(null);

  const { txRows, rxRows } = useMemo(() => {
    const coinLogs = logs.filter((l) => l.device === "coin" && l.hex);
    return {
      txRows: coinLogs.filter((l) => l.dir === "tx").slice(-PACKET_ROWS),
      rxRows: coinLogs.filter((l) => l.dir === "rx").slice(-PACKET_ROWS),
    };
  }, [logs]);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const json = await postCoin(body);
      if (json.state) onState(json.state);
      if (!json.ok) setError(json.error ?? "操作失敗");
    } catch {
      setError("連不到伺服器");
    } finally {
      setBusy(false);
    }
  };

  const action = (a: CoinAction, extra?: object) => run({ action: a, ...extra });
  const disabled = busy || !connected;

  if (!state) {
    return (
      <section className="rounded border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 font-bold">硬幣接收器測試工具</div>
        <div className="p-4 text-sm text-gray-500">讀取中…</div>
      </section>
    );
  }

  const sorter = sorterDraft ?? state.sorter ?? Array(8).fill(0);
  const toggleChannel = (channel: number, checked: boolean) => {
    const set = new Set(state.settings.enabledChannels);
    if (checked) set.add(channel);
    else set.delete(channel);
    run({ settings: { enabledChannels: [...set] } });
  };

  return (
    <section className="rounded border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h2 className="font-bold">硬幣接收器測試工具</h2>
        {!connected && <span className="text-xs text-gray-500">硬幣接收器未連線，請先在上方連線</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 p-3 text-sm xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="rounded bg-black p-4 font-mono text-sm">
          <div className="mb-3 flex items-center justify-center gap-3">
            <h3 className="font-bold text-gray-200">通訊監看</h3>
            <span className={`px-2 text-xs font-bold text-white ${state.link ? "bg-green-600" : "bg-red-600"}`}>
              {state.link ? "通訊正常" : "通訊中斷"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-[auto_auto_auto_auto]">
            <MonitorColumn title="一般狀態">
              <Lamp on={state.normal === "idling"} color="text-green-400">待機中</Lamp>
              <Lamp on={state.normal === "accepting"} color="text-green-400">收幣中</Lamp>
              <Lamp on={state.normal === "disabled"} color="text-green-400">停用中</Lamp>
            </MonitorColumn>
            <MonitorColumn title="錯誤狀態">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Lamp key={n} on={state.error?.sensor === n} color="text-red-500">
                  感測器 {n} 錯誤
                </Lamp>
              ))}
              <Lamp on={state.error?.kind === "fishing"} color="text-red-500">釣魚</Lamp>
              <Lamp on={state.error?.kind === "checksum"} color="text-red-500">程式檢查碼錯誤</Lamp>
            </MonitorColumn>
            <MonitorColumn title="收幣狀態">
              <div className="grid grid-flow-col grid-rows-8 gap-x-4">
                {COIN_CHANNELS.map((c) => (
                  <Lamp key={c.channel} on={state.lastCoin?.channel === c.channel} color="text-cyan-300">
                    <span title={c.value ? `${c.value} 元` : "未定義面額"}>硬幣 {c.channel}</span>
                  </Lamp>
                ))}
              </div>
            </MonitorColumn>
            <MonitorColumn title="其他狀態">
              <Lamp on={state.other?.kind === "ack"} color="text-yellow-300">ACK</Lamp>
              <Lamp on={state.other?.kind === "nak"} color="text-yellow-300">NAK</Lamp>
              <Lamp on={state.other?.kind === "invalid"} color="text-yellow-300">無效封包</Lamp>
            </MonitorColumn>
          </div>

          {state.error && <div className="mt-3 text-red-400">目前錯誤：{state.error.text}</div>}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PacketPane title="主機 → 硬幣接收器" rows={txRows} className="bg-green-200" />
            <PacketPane title="硬幣接收器 → 主機" rows={rxRows} className="bg-blue-200" />
          </div>
          <div className="mt-2 text-xs text-gray-500">每 250ms 的例行狀態詢問與沒有變化的回應不顯示</div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => action("enable")} disabled={disabled} className={buttonClass}>
              啟用收幣
            </button>
            <button type="button" onClick={() => action("disable")} disabled={disabled} className={buttonClass}>
              停用收幣
            </button>
            <button type="button" onClick={() => action("status")} disabled={disabled} className={buttonClass}>
              詢問狀態
            </button>
            <button type="button" onClick={() => action("version")} disabled={disabled} className={buttonClass}>
              詢問版本
            </button>
            <button type="button" onClick={() => action("info")} disabled={disabled} className={buttonClass}>
              詢問製造商資訊
            </button>
          </div>

          <fieldset className="rounded border border-gray-300 px-3 pt-1 pb-2">
            <legend className="px-1">收幣通道</legend>
            <div className="grid grid-flow-col grid-cols-4 grid-rows-4 gap-x-3 gap-y-0.5">
              {COIN_CHANNELS.map((c) => (
                <label key={c.channel} className="flex items-center gap-1 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={state.settings.enabledChannels.includes(c.channel)}
                    onChange={(e) => toggleChannel(c.channel, e.target.checked)}
                    disabled={busy}
                  />
                  通道 {c.channel}
                  {c.value && <span className="text-gray-500">（{c.value}元）</span>}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => action("channels")} disabled={disabled} className={buttonClass}>
                送出通道設定
              </button>
              <span className="text-xs text-gray-500">勾選會先存起來，按「送出通道設定」才會傳給硬幣接收器</span>
            </div>
          </fieldset>

          <fieldset className="rounded border border-gray-300 px-3 pt-1 pb-2">
            <legend className="px-1">分類器設定（各硬幣的出口）</legend>
            <div className="grid grid-cols-4 gap-2">
              {sorter.map((outlet, i) => (
                <label key={i} className="flex items-center gap-1 whitespace-nowrap">
                  硬幣 {i + 1}
                  <select
                    value={outlet}
                    onChange={(e) => setSorterDraft(sorter.map((o, j) => (j === i ? Number(e.target.value) : o)))}
                    className="rounded border border-gray-300 px-1 py-0.5"
                  >
                    {SORTER_OUTLETS.map((name, value) => (
                      <option key={name} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSorterDraft(null);
                  action("sorterRead");
                }}
                disabled={disabled}
                className={buttonClass}
              >
                讀取分類器設定
              </button>
              <button
                type="button"
                onClick={() => action("sorterWrite", { sorter })}
                disabled={disabled}
                className={buttonClass}
              >
                送出分類器設定
              </button>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <span>釣魚進階回報</span>
            <button type="button" onClick={() => action("fishingOn")} disabled={disabled} className={buttonClass}>
              啟用
            </button>
            <button type="button" onClick={() => action("fishingOff")} disabled={disabled} className={buttonClass}>
              停用
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-2">
              <InfoRow label="收幣枚數" value={`${state.count} 枚`} />
              <InfoRow label="收幣金額" value={`${state.amount} 元`} />
              <InfoRow label="累計金額" value={`${state.total} 元`} />
              <button type="button" onClick={() => action("clearAmount")} disabled={busy} className={buttonClass}>
                金額歸零
              </button>
            </div>
            <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-2">
              <InfoRow label="版本" value={state.version?.text} />
              <InfoRow label="程式檢查碼" value={state.version?.checksum} />
              <InfoRow label="製造商" value={state.info?.manufacturer} />
              <InfoRow label="型號" value={state.info?.model} />
              <InfoRow label="序號" value={state.info?.serial} />
            </div>
          </div>

          {error && <div className="text-red-600">{error}</div>}
        </div>
      </div>
    </section>
  );
}
