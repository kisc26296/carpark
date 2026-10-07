"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DOWNLINK_COMMANDS,
  HTTP_RESULT_SAMPLE,
  UPLINK_COMMANDS,
  type CommandSpec,
} from "@/lib/parking/catalog";
import { DEFAULT_SN } from "@/lib/parking/protocol";

type Tab = "http" | "uplink" | "downlink" | "records";
type RecordKind = "messages" | "commands" | "devices" | "results";

interface RunResult {
  ok: boolean;
  httpStatus: number;
  label: string;
  body: unknown;
  ms: number;
}

interface Status {
  broker: string;
  platformConnected: boolean;
  error: string | null;
  simulators: { sn: string; connected: boolean; state: Record<string, unknown> }[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: "http", label: "HTTP" },
  { id: "uplink", label: "MQTT 上行（設備 → Server）" },
  { id: "downlink", label: "MQTT 下行（Server → 設備）" },
  { id: "records", label: "紀錄" },
];

const HTTP_KEY = "http:Result";
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const sampleText = (spec: CommandSpec) => (spec.sample ? pretty(spec.sample) : "");

function initialTexts(): Record<string, string> {
  const texts: Record<string, string> = { [HTTP_KEY]: pretty(HTTP_RESULT_SAMPLE) };
  for (const c of UPLINK_COMMANDS) texts[`uplink:${c.command}`] = sampleText(c);
  for (const c of DOWNLINK_COMMANDS) texts[`downlink:${c.command}`] = sampleText(c);
  return texts;
}

async function callApi(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
      {children}
    </span>
  );
}

function CommandCard({
  spec,
  text,
  onTextChange,
  onSend,
  onReset,
  busy,
  result,
}: {
  spec: CommandSpec;
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  onReset: () => void;
  busy: boolean;
  result?: RunResult;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">{spec.section}</span>
            <code className="font-mono text-sm font-semibold">{spec.command}</code>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{spec.title}</span>
            {spec.risky && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                高風險
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{spec.description}</p>
        </div>
        {result && <StatusBadge ok={result.ok}>{result.label}</StatusBadge>}
      </div>

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        placeholder="data 為空字串"
        rows={Math.min(Math.max(text.split("\n").length, 2), 12)}
        className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs leading-5 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onSend}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {busy ? "送出中…" : "送出"}
        </button>
        <button
          onClick={onReset}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          還原範例
        </button>
        {result && <span className="ml-auto text-xs text-zinc-500">{result.ms} ms</span>}
      </div>

      {result && (
        <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100">
          {pretty(result.body)}
        </pre>
      )}
    </div>
  );
}

async function fetchStatus(): Promise<Status | null> {
  try {
    const res = await fetch("/api/parking/status");
    return await res.json();
  } catch {
    return null;
  }
}

interface RecordsState {
  /** 這批資料對應的查詢條件，與目前條件不同代表載入中 */
  query: string;
  items: Record<string, unknown>[];
  error: string | null;
}

async function fetchRecords(query: string): Promise<RecordsState> {
  try {
    const res = await fetch(`/api/parking/records?${query}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? res.statusText);
    return { query, items: json.items, error: null };
  } catch (e) {
    return { query, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function RecordsPanel({ sn }: { sn: string }) {
  const [kind, setKind] = useState<RecordKind>("messages");
  const [onlyThisSn, setOnlyThisSn] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [records, setRecords] = useState<RecordsState>({ query: "", items: [], error: null });

  const qs = new URLSearchParams({ kind, limit: "100" });
  if (onlyThisSn && sn) qs.set("sn", sn);
  const query = qs.toString();
  const requestKey = `${query}#${reloadToken}`;

  useEffect(() => {
    let cancelled = false;
    fetchRecords(query).then((next) => {
      if (!cancelled) setRecords({ ...next, query: requestKey });
    });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const loading = records.query !== requestKey;
  const { items, error } = records;
  const reload = () => setReloadToken((n) => n + 1);

  const clearAll = async () => {
    if (!confirm("確定要清除所有停車設備測試紀錄嗎？（mqtt_messages、mqtt_commands、devices、plate_results）")) return;
    await fetch("/api/parking/records?kind=all", { method: "DELETE" });
    reload();
  };

  const kinds: { id: RecordKind; label: string }[] = [
    { id: "messages", label: "MQTT 封包" },
    { id: "commands", label: "下行命令 / Receipt" },
    { id: "devices", label: "設備" },
    { id: "results", label: "辨識結果" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {kinds.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              kind === k.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {k.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={onlyThisSn} onChange={(e) => setOnlyThisSn(e.target.checked)} />
          只看目前 SN
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={reload}
            className="rounded-lg bg-white px-3 py-1.5 text-sm hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {loading ? "載入中…" : "重新整理"}
          </button>
          <button
            onClick={clearAll}
            className="rounded-lg px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
          >
            清除全部紀錄
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <p className="text-xs text-zinc-500">共 {items.length} 筆（最新在前，最多 100 筆）</p>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <details
            key={String(item._id ?? i)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <summary className="cursor-pointer font-mono text-xs">{summarize(kind, item)}</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs leading-5 text-zinc-100">
              {pretty(item)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function summarize(kind: RecordKind, item: Record<string, unknown>): string {
  const t = (v: unknown) => (v ? new Date(String(v)).toLocaleTimeString() : "");
  switch (kind) {
    case "messages":
      return `${t(item.receivedAt)}  ${item.direction === "up" ? "↑" : "↓"} ${item.command}  ${item.sn}  req=${item.requestId}${item.origin === "auto-reply" ? "  (自動回覆)" : ""}${item.replyTo ? `  (回覆 ${item.replyTo})` : ""}`;
    case "commands":
      return `${t(item.sentAt)}  ${item.command}  ${item.sn}  [${item.status}]  req=${item.requestId}`;
    case "devices":
      return `${item.sn}  ${item.online ? "online" : "offline"}  最後訊息 ${item.lastCommand} @ ${t(item.lastSeenAt)}`;
    case "results":
      return `${t(item.created_at)}  [${item.source}/${item.command}]  ${item.plate_raw}  ${item.device_sn}`;
  }
}

export default function ParkingApiTestPage() {
  const [tab, setTab] = useState<Tab>("downlink");
  const [sn, setSn] = useState(DEFAULT_SN);
  const [status, setStatus] = useState<Status | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>(initialTexts);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [simBusy, setSimBusy] = useState(false);

  const refreshStatus = useCallback(() => fetchStatus().then(setStatus), []);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      fetchStatus().then((next) => {
        if (!cancelled) setStatus(next);
      });
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const simulator = status?.simulators.find((s) => s.sn === sn);

  const toggleSimulator = async () => {
    setSimBusy(true);
    try {
      const { json } = await callApi("/api/parking/simulator", { action: simulator ? "stop" : "start", sn });
      if (!json.ok) alert(json.error);
    } finally {
      setSimBusy(false);
      refreshStatus();
    }
  };

  const run = useCallback(
    async (key: string): Promise<RunResult> => {
      const [kind, command] = key.split(":");
      const text = texts[key] ?? "";
      setBusy((b) => new Set(b).add(key));
      const start = performance.now();
      let result: RunResult;
      try {
        const data = text.trim() ? JSON.parse(text) : null;
        let res: { status: number; json: Record<string, unknown> };
        if (kind === "http") {
          res = await callApi("/api/parking/http/result", data);
          result = {
            ok: res.status === 200,
            httpStatus: res.status,
            label: `HTTP ${res.status}`,
            body: res.json,
            ms: 0,
          };
        } else if (kind === "uplink") {
          res = await callApi("/api/parking/simulator/uplink", { sn, command, data });
          const log = (res.json.platformLog as { direction: string; command: string }[] | undefined) ?? [];
          const replies = log.filter((m) => m.direction === "down").map((m) => m.command);
          result = {
            ok: res.json.ok === true,
            httpStatus: res.status,
            label: res.json.ok
              ? replies.length
                ? `平台已收到，自動回覆 ${replies.join(", ")}`
                : "平台已收到"
              : String(res.json.error ?? "平台未收到"),
            body: res.json,
            ms: 0,
          };
        } else {
          res = await callApi("/api/parking/mqtt/command", { sn, command, data });
          const reply = res.json.reply as { envelope?: { command?: string } } | null;
          result = {
            ok: res.json.ok === true,
            httpStatus: res.status,
            label:
              res.json.status === "sent"
                ? "已送出（此命令設備不回覆）"
                : res.json.status === "timeout"
                  ? "逾時，設備未回覆"
                  : res.json.error
                    ? String(res.json.error)
                    : `${res.json.status} ← ${reply?.envelope?.command ?? ""}`,
            body: res.json,
            ms: 0,
          };
        }
      } catch (e) {
        result = {
          ok: false,
          httpStatus: 0,
          label: e instanceof SyntaxError ? "JSON 格式錯誤" : "請求失敗",
          body: { error: e instanceof Error ? e.message : String(e) },
          ms: 0,
        };
      }
      result.ms = Math.round(performance.now() - start);
      setResults((r) => ({ ...r, [key]: result }));
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
      return result;
    },
    [texts, sn],
  );

  const runAll = async (keys: string[]) => {
    setRunningAll(true);
    for (const key of keys) await run(key);
    setRunningAll(false);
  };

  const cardsFor = (kind: "uplink" | "downlink") => (kind === "uplink" ? UPLINK_COMMANDS : DOWNLINK_COMMANDS);
  const keysFor = (t: Tab) =>
    t === "http" ? [HTTP_KEY] : t === "records" ? [] : cardsFor(t).map((c) => `${t}:${c.command}`);
  const summary = (t: Tab) => {
    const keys = keysFor(t);
    const done = keys.filter((k) => results[k]);
    return { total: keys.length, done: done.length, passed: done.filter((k) => results[k].ok).length };
  };

  // 上行由模擬設備發出，一定要啟動；下行可以直接打到 SN 相同的實體設備
  const needsSimulator = tab === "uplink" && !simulator;
  const noDeviceHint = tab === "downlink" && !simulator;
  const s = summary(tab);

  return (
    <div className="min-h-full flex-1 bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-col gap-3">
          <div>
            <h1 className="text-xl font-semibold">O1S / O2S 停車設備 API 測試</h1>
            <p className="text-sm text-zinc-500">
              依「HTTP + MQTT 中文開發規格」測試所有功能。MQTT 透過本機 Mosquitto，設備端由模擬設備回應。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <label className="flex items-center gap-2 text-sm">
              設備 SN
              <input
                value={sn}
                onChange={(e) => setSn(e.target.value.trim())}
                className="w-64 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <StatusBadge ok={!!status?.platformConnected}>
              Broker {status?.broker || "-"} {status?.platformConnected ? "已連線" : "未連線"}
            </StatusBadge>
            <StatusBadge ok={!!simulator?.connected}>模擬設備{simulator ? "執行中" : "未啟動"}</StatusBadge>
            <button
              onClick={toggleSimulator}
              disabled={simBusy || !sn}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {simulator ? "停止模擬設備" : "啟動模擬設備"}
            </button>
            {simulator && (
              <span className="text-xs text-zinc-500">
                閘門 {String(simulator.state.gate)}・常開 {simulator.state.longOpen ? "on" : "off"}・固定車{" "}
                {Object.keys(simulator.state.carInfo as object).length} 筆・加密{" "}
                {(simulator.state.encryption as { enabled: boolean }).enabled ? "啟用" : "關閉"}
              </span>
            )}
            {status?.error && <span className="text-sm text-rose-600">{status.error}</span>}
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => {
            const ts = summary(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  tab === t.id
                    ? "border-zinc-900 font-medium dark:border-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {t.label}
                {ts.done > 0 && (
                  <span className="ml-1.5 text-xs text-zinc-500">
                    {ts.passed}/{ts.total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {tab !== "records" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => runAll(keysFor(tab))}
              disabled={runningAll || needsSimulator}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {runningAll ? "測試中…" : `全部測試（${s.total} 項）`}
            </button>
            {s.done > 0 && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                已測 {s.done}/{s.total}，通過 {s.passed}，失敗 {s.done - s.passed}
              </span>
            )}
            {needsSimulator && (
              <span className="text-sm text-amber-700 dark:text-amber-400">上行訊息由模擬設備發出，請先啟動模擬設備。</span>
            )}
            {noDeviceHint && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                模擬設備未啟動：命令會送到 download/{sn}，沒有實體設備回應時會逾時。
              </span>
            )}
          </div>
        )}

        {tab === "http" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              設備端 Server address 請設定為{" "}
              <code className="rounded bg-zinc-200 px-1 font-mono dark:bg-zinc-800">
                http://&lt;本機 IP&gt;:3000/api/parking/http/result
              </code>
              ；成功回 HTTP 200，失敗回 HTTP 500。
            </p>
            <CommandCard
              spec={{
                command: "POST",
                section: "2.1",
                title: "車牌辨識結果",
                description: "license、sn 必填；imageFile 為 JPEG Base64；attachInfo 選用。可刪掉 license 測試 500 回應。",
                sample: HTTP_RESULT_SAMPLE,
              }}
              text={texts[HTTP_KEY]}
              onTextChange={(v) => setTexts((t) => ({ ...t, [HTTP_KEY]: v }))}
              onReset={() => setTexts((t) => ({ ...t, [HTTP_KEY]: pretty(HTTP_RESULT_SAMPLE) }))}
              onSend={() => run(HTTP_KEY)}
              busy={busy.has(HTTP_KEY)}
              result={results[HTTP_KEY]}
            />
          </div>
        )}

        {(tab === "uplink" || tab === "downlink") && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {cardsFor(tab).map((spec) => {
              const key = `${tab}:${spec.command}`;
              return (
                <CommandCard
                  key={key}
                  spec={spec}
                  text={texts[key]}
                  onTextChange={(v) => setTexts((t) => ({ ...t, [key]: v }))}
                  onReset={() => setTexts((t) => ({ ...t, [key]: sampleText(spec) }))}
                  onSend={() => run(key)}
                  busy={busy.has(key) || needsSimulator}
                  result={results[key]}
                />
              );
            })}
          </div>
        )}

        {tab === "records" && <RecordsPanel sn={sn} />}
      </div>
    </div>
  );
}
