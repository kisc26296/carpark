"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BAUD_RATES,
  CASH_DEVICE_LABELS,
  CASH_DEVICES,
  DATA_BITS,
  PARITIES,
  STOP_BITS,
  type BillAcceptorState,
  type CashDeviceConfig,
  type CashDeviceId,
  type CashDeviceStatus,
  type CoinAcceptorState,
  type ComPortInfo,
  type ConnectionState,
  type HopperDeviceId,
  type HopperState,
  type SerialLogEntry,
} from "@/lib/cash-device/shared";
import { BillAcceptorTool } from "./bill-tool";
import { CoinAcceptorTool } from "./coin-tool";
import { HopperTool } from "./hopper-tool";

const LOG_LIMIT = 500;

const PARITY_LABELS: Record<(typeof PARITIES)[number], string> = {
  none: "None",
  even: "Even",
  odd: "Odd",
  mark: "Mark",
  space: "Space",
};

const STATE_LABELS: Record<ConnectionState, { text: string; className: string }> = {
  connected: { text: "已連線", className: "bg-green-100 text-green-700" },
  connecting: { text: "連線中", className: "bg-yellow-100 text-yellow-700" },
  reconnecting: { text: "自動重連中", className: "bg-orange-100 text-orange-700" },
  disconnected: { text: "未連線", className: "bg-gray-100 text-gray-600" },
};

const DIR_LABELS: Record<SerialLogEntry["dir"], { text: string; className: string }> = {
  rx: { text: "◀收", className: "text-blue-700" },
  tx: { text: "▶送", className: "text-green-700" },
  info: { text: "●", className: "text-gray-500" },
};

const inputClass = "rounded border border-gray-300 px-2 py-1 text-sm";
const buttonClass = "rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50";
const primaryButtonClass = "rounded bg-[#428bca] px-3 py-1 text-sm text-white hover:bg-[#3071a9] disabled:opacity-50";

const settingsKey = (c: CashDeviceConfig) => [c.port, c.baudRate, c.dataBits, c.parity, c.stopBits].join("|");

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString("zh-TW", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/** 把 HEX 轉成可讀字元，不可列印的位元組顯示為「.」 */
const hexToAscii = (hex: string) =>
  hex
    .split(" ")
    .filter(Boolean)
    .map((h) => {
      const code = parseInt(h, 16);
      return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : ".";
    })
    .join("");

async function callApi(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function DevicePanel({
  device,
  draft,
  saved,
  status,
  ports,
  onChange,
  onSaved,
  onStatuses,
}: {
  device: CashDeviceId;
  draft: CashDeviceConfig;
  saved: CashDeviceConfig;
  status: CashDeviceStatus | undefined;
  ports: ComPortInfo[];
  onChange: (patch: Partial<CashDeviceConfig>) => void;
  onSaved: (config: CashDeviceConfig) => void;
  onStatuses: (statuses: CashDeviceStatus[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [hex, setHex] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = settingsKey(draft) !== settingsKey(saved);
  const state = status?.state ?? "disconnected";
  const active = state !== "disconnected";
  const label = CASH_DEVICE_LABELS[device];

  // 設定中的 port 目前沒插著（例如 USB 轉 RS232 被拔掉）也要留在選單裡，不然會看不到原本設定
  const portOptions = useMemo(() => {
    const list = ports.map((p) => ({ ...p, missing: false }));
    if (draft.port && !list.some((p) => p.path.toUpperCase() === draft.port.toUpperCase())) {
      list.push({ path: draft.port, friendlyName: null, manufacturer: null, usedBy: device, missing: true });
    }
    return list;
  }, [ports, draft.port, device]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, successText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const json = await fn();
      setMessage(json.ok ? { ok: true, text: successText } : { ok: false, text: json.error ?? "操作失敗" });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "連不到伺服器" });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const { port, baudRate, dataBits, parity, stopBits } = draft;
      const json = await callApi("/api/cash-device/config", "PUT", { device, port, baudRate, dataBits, parity, stopBits });
      if (json.config) onSaved(json.config);
      if (json.statuses) onStatuses(json.statuses);
      return json;
    }, active ? "已儲存並用新設定重新連線" : "已儲存");

  const toggleConnect = () =>
    run(async () => {
      const json = await callApi("/api/cash-device/connect", "POST", { device, action: active ? "close" : "open" });
      if (json.statuses) onStatuses(json.statuses);
      return json;
    }, active ? "已中斷" : "已連線");

  const send = () => run(() => callApi("/api/cash-device/send", "POST", { device, hex }), "已送出");

  return (
    <section className="rounded border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
        <h2 className="font-bold">{label}</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${STATE_LABELS[state].className}`}>
          {STATE_LABELS[state].text}
          {status?.port && active ? ` ${status.port}` : ""}
        </span>
      </div>

      <div className="space-y-3 p-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="w-16 shrink-0">COM port</span>
          <select
            value={draft.port}
            onChange={(e) => onChange({ port: e.target.value })}
            className={`${inputClass} min-w-0 flex-1`}
          >
            <option value="">未設定</option>
            {portOptions.map((p) => {
              const usedByOther = p.usedBy !== null && p.usedBy !== device;
              return (
                <option key={p.path} value={p.path} disabled={usedByOther}>
                  {p.path}
                  {p.friendlyName ? ` - ${p.friendlyName}` : ""}
                  {p.missing ? "（未偵測到）" : ""}
                  {usedByOther ? `（${CASH_DEVICE_LABELS[p.usedBy!]}使用中）` : ""}
                </option>
              );
            })}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0">鮑率</span>
            <select
              value={draft.baudRate}
              onChange={(e) => onChange({ baudRate: Number(e.target.value) })}
              className={`${inputClass} min-w-0 flex-1`}
            >
              {BAUD_RATES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0">資料位元</span>
            <select
              value={draft.dataBits}
              onChange={(e) => onChange({ dataBits: Number(e.target.value) as CashDeviceConfig["dataBits"] })}
              className={`${inputClass} min-w-0 flex-1`}
            >
              {DATA_BITS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0">同位元</span>
            <select
              value={draft.parity}
              onChange={(e) => onChange({ parity: e.target.value as CashDeviceConfig["parity"] })}
              className={`${inputClass} min-w-0 flex-1`}
            >
              {PARITIES.map((v) => (
                <option key={v} value={v}>
                  {PARITY_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-12 shrink-0">停止位元</span>
            <select
              value={draft.stopBits}
              onChange={(e) => onChange({ stopBits: Number(e.target.value) as CashDeviceConfig["stopBits"] })}
              className={`${inputClass} min-w-0 flex-1`}
            >
              {STOP_BITS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={busy || !dirty} className={buttonClass}>
            儲存
          </button>
          <button
            type="button"
            onClick={toggleConnect}
            disabled={busy || (!active && (dirty || !saved.port))}
            className={primaryButtonClass}
          >
            {active ? "中斷" : "連線"}
          </button>
          {dirty && <span className="text-xs text-orange-600">設定已修改，請先儲存</span>}
        </div>

        {status?.error && <div className="text-xs text-red-600">{status.error}</div>}

        <div className="flex gap-2 border-t border-gray-200 pt-3">
          <input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && hex.trim() && state === "connected" && !busy && send()}
            placeholder="HEX，例如 02 00 03"
            className={`${inputClass} min-w-0 flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !hex.trim() || state !== "connected"}
            className={buttonClass}
          >
            送出
          </button>
        </div>

        {message && <div className={`text-xs ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</div>}
      </div>
    </section>
  );
}

export default function CashDeviceTestPage() {
  const [ports, setPorts] = useState<ComPortInfo[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<CashDeviceId, CashDeviceConfig> | null>(null);
  const [drafts, setDrafts] = useState<Record<CashDeviceId, CashDeviceConfig> | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<CashDeviceId, CashDeviceStatus>>>({});
  const [logs, setLogs] = useState<SerialLogEntry[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [filter, setFilter] = useState<CashDeviceId | "all">("all");
  const [showAscii, setShowAscii] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<SerialLogEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [billState, setBillState] = useState<BillAcceptorState | null>(null);
  const [coinState, setCoinState] = useState<CoinAcceptorState | null>(null);
  const [hopperStates, setHopperStates] = useState<Partial<Record<HopperDeviceId, HopperState>>>({});
  const [hopperTab, setHopperTab] = useState<HopperDeviceId>("hopper1");
  // 清除畫面只隱藏這個 id 以前的紀錄，不刪掉資料，紙鈔機 Memo 才不會跟著被清掉
  const [logClearedAfter, setLogClearedAfter] = useState(0);

  const applyStatuses = useCallback((list: CashDeviceStatus[]) => {
    setStatuses(Object.fromEntries(list.map((s) => [s.device, s])));
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const json = await callApi("/api/cash-device/ports", "GET");
      if (json.ok) {
        setPorts(json.ports);
        setPortsError(null);
      } else {
        setPortsError(json.error);
      }
    } catch {
      setPortsError("連不到伺服器");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 頁面載入時讀取一次 COM port 清單
    refreshPorts();
    callApi("/api/cash-device/config", "GET")
      .then((json) => {
        if (!json.ok) return setLoadError(json.error);
        const map = Object.fromEntries((json.configs as CashDeviceConfig[]).map((c) => [c.device, c])) as Record<
          CashDeviceId,
          CashDeviceConfig
        >;
        setSaved(map);
        setDrafts(map);
        applyStatuses(json.statuses);
      })
      .catch(() => setLoadError("連不到伺服器"));
  }, [refreshPorts, applyStatuses]);

  useEffect(() => {
    const source = new EventSource("/api/cash-device/stream");
    source.addEventListener("snapshot", (e) => {
      setStreamConnected(true);
      const data = JSON.parse((e as MessageEvent).data) as {
        statuses: CashDeviceStatus[];
        logs: SerialLogEntry[];
        bill: BillAcceptorState;
        coin: CoinAcceptorState;
        hoppers: Record<HopperDeviceId, HopperState>;
      };
      applyStatuses(data.statuses);
      setLogs(data.logs);
      setBillState(data.bill);
      setCoinState(data.coin);
      setHopperStates(data.hoppers);
    });
    source.addEventListener("bill", (e) => {
      setBillState(JSON.parse((e as MessageEvent).data) as BillAcceptorState);
    });
    source.addEventListener("coin", (e) => {
      setCoinState(JSON.parse((e as MessageEvent).data) as CoinAcceptorState);
    });
    source.addEventListener("hopper", (e) => {
      const { device, state } = JSON.parse((e as MessageEvent).data) as { device: HopperDeviceId; state: HopperState };
      setHopperStates((prev) => ({ ...prev, [device]: state }));
    });
    source.addEventListener("log", (e) => {
      const entry = JSON.parse((e as MessageEvent).data) as SerialLogEntry;
      setLogs((prev) => [...prev, entry].slice(-LOG_LIMIT));
    });
    source.addEventListener("status", (e) => {
      const status = JSON.parse((e as MessageEvent).data) as CashDeviceStatus;
      setStatuses((prev) => ({ ...prev, [status.device]: status }));
    });
    source.onerror = () => setStreamConnected(false);
    return () => source.close();
  }, [applyStatuses]);

  const togglePause = () => {
    if (!paused) setFrozen(logs);
    setPaused(!paused);
  };

  const visibleLogs = useMemo(
    () =>
      (paused ? frozen : logs)
        .filter((l) => l.id > logClearedAfter && (filter === "all" || l.device === filter))
        .reverse(),
    [paused, frozen, logs, filter, logClearedAfter],
  );

  return (
    <div className="min-h-screen space-y-4 bg-white p-3 text-gray-900 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">現金設備測試</h1>
        <div className="flex items-center gap-2 text-sm">
          {portsError && <span className="text-red-600">{portsError}</span>}
          <span className="text-gray-600">主機 COM port：{ports.map((p) => p.path).join("、") || "無"}</span>
          <button type="button" onClick={refreshPorts} className={buttonClass}>
            重新整理 COM port
          </button>
        </div>
      </div>

      {loadError && <div className="rounded bg-red-50 p-3 text-sm text-red-700">讀取設定失敗：{loadError}</div>}

      {saved && drafts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {CASH_DEVICES.map((device) => (
            <DevicePanel
              key={device}
              device={device}
              draft={drafts[device]}
              saved={saved[device]}
              status={statuses[device]}
              ports={ports}
              onChange={(patch) => setDrafts((prev) => prev && { ...prev, [device]: { ...prev[device], ...patch } })}
              onSaved={(config) => {
                setSaved((prev) => prev && { ...prev, [device]: config });
                setDrafts((prev) => prev && { ...prev, [device]: config });
                refreshPorts();
              }}
              onStatuses={applyStatuses}
            />
          ))}
        </div>
      )}

      <BillAcceptorTool
        state={billState}
        connected={statuses.bill?.state === "connected"}
        logs={logs}
        onState={setBillState}
      />

      <CoinAcceptorTool
        state={coinState}
        connected={statuses.coin?.state === "connected"}
        logs={logs}
        onState={setCoinState}
      />

      <HopperTool
        device={hopperTab}
        onDeviceChange={setHopperTab}
        statuses={statuses}
        state={hopperStates[hopperTab] ?? null}
        connected={statuses[hopperTab]?.state === "connected"}
        logs={logs}
        onState={(state) => setHopperStates((prev) => ({ ...prev, [hopperTab]: state }))}
      />

      <section className="rounded border border-gray-200">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <h2 className="font-bold">即時資料</h2>
          <span className={streamConnected ? "text-green-700" : "text-red-600"}>
            {streamConnected ? "● 監測中" : "● 未連上伺服器"}
          </span>
          <label className="flex items-center gap-1">
            篩選
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as CashDeviceId | "all")}
              className={inputClass}
            >
              <option value="all">全部</option>
              {CASH_DEVICES.map((d) => (
                <option key={d} value={d}>
                  {CASH_DEVICE_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showAscii} onChange={(e) => setShowAscii(e.target.checked)} />
            顯示 ASCII
          </label>
          <button type="button" onClick={togglePause} className={buttonClass}>
            {paused ? "繼續" : "暫停"}
          </button>
          <button
            type="button"
            onClick={() => {
              setLogClearedAfter(logs.at(-1)?.id ?? 0);
            }}
            className={buttonClass}
          >
            清除畫面
          </button>
          <span className="text-xs text-gray-500">最新的在最上面，最多保留 {LOG_LIMIT} 筆</span>
        </div>

        <div className="max-h-[60vh] overflow-auto font-mono text-xs">
          {visibleLogs.length === 0 ? (
            <div className="p-4 text-center text-gray-500">尚無資料</div>
          ) : (
            <table className="w-full">
              <tbody>
                {visibleLogs.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100 align-top">
                    <td className="whitespace-nowrap px-2 py-1 text-gray-500">{formatTime(l.time)}</td>
                    <td className="whitespace-nowrap px-2 py-1">{CASH_DEVICE_LABELS[l.device]}</td>
                    <td className={`whitespace-nowrap px-2 py-1 ${DIR_LABELS[l.dir].className}`}>{DIR_LABELS[l.dir].text}</td>
                    <td className="break-all px-2 py-1">
                      {l.hex}
                      {showAscii && l.hex && <div className="text-gray-500">{hexToAscii(l.hex)}</div>}
                    </td>
                    <td className="px-2 py-1 text-gray-700">{l.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
