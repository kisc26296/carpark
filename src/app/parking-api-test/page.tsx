"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DOWNLINK_COMMANDS,
  HTTP_RESULT_SAMPLE,
  UPLINK_COMMANDS,
  type CommandSpec,
} from "@/lib/parking/catalog";
import { DEFAULT_SN } from "@/lib/parking/protocol";
import { LED_COLORS, LED_DEFAULT_ADDRESS, type LedColor } from "@/lib/parking/led-protocol-shared";

type Tab = "http" | "uplink" | "downlink" | "records" | "devices" | "display" | "monitor";
type RecordKind = "messages" | "commands" | "devices" | "results";

interface RunResult {
  ok: boolean;
  httpStatus: number;
  label: string;
  body: unknown;
  ms: number;
}

interface DeviceSummary {
  sn: string;
  ip: string | null;
  online: boolean;
  deviceType: string | null;
  lastSeenAt: string | null;
}

interface Status {
  broker: string;
  platformConnected: boolean;
  error: string | null;
  simulators: { sn: string; connected: boolean; state: Record<string, unknown>; loginPort: number }[];
  devices: DeviceSummary[];
}

interface PlateResultEvent {
  id: string;
  source: "mqtt" | "http";
  command: string;
  device_sn: string;
  plate_raw: string;
  plate_color: unknown;
  confidence: number | null;
  is_car_exist: string | null;
  valid_plate: string | null;
  trigger_time: string;
  image_base64: string | null;
  image_saved_path: string | null;
  created_at: string;
}

/** 有實際偵測到車輛/辨識出車牌，才算「辨識成功」；car-free 的心跳式結果不算 */
const isSuccessfulRecognition = (e: PlateResultEvent) =>
  e.is_car_exist !== "car-free" && !!e.plate_raw && e.plate_raw !== "Unlicensed";

const TABS: { id: Tab; label: string }[] = [
  { id: "http", label: "HTTP" },
  { id: "uplink", label: "MQTT 上行（設備 → Server）" },
  { id: "downlink", label: "MQTT 下行（Server → 設備）" },
  { id: "records", label: "紀錄" },
  { id: "devices", label: "設備搜尋" },
  { id: "display", label: "顯示板訊息" },
  { id: "monitor", label: "即時監測" },
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
  quickActions,
}: {
  spec: CommandSpec;
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  onReset: () => void;
  busy: boolean;
  result?: RunResult;
  quickActions?: { label: string; tone: "on" | "off"; onClick: () => void }[];
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
        {quickActions?.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              a.tone === "on"
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-rose-600 text-white hover:bg-rose-700"
            }`}
          >
            {a.label}
          </button>
        ))}
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

interface ScanItem {
  ip: string;
  hostname: string | null;
}

interface ScanState {
  loading: boolean;
  error: string | null;
  subnet: string | null;
  localAddress: string | null;
  items: ScanItem[];
  truncated: boolean;
  ms: number | null;
}

interface ConnTestResult {
  ok: boolean;
  ms: number;
  message: string;
  sn?: string;
  deviceType?: string;
  firmwareVer?: string;
}

function DeviceScanPanel({ simulators }: { simulators: Status["simulators"] }) {
  const [scan, setScan] = useState<ScanState>({
    loading: false,
    error: null,
    subnet: null,
    localAddress: null,
    items: [],
    truncated: false,
    ms: null,
  });
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<ConnTestResult | null>(null);

  const runScan = async () => {
    setScan((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/parking/devices/scan");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "掃描失敗");
      setScan({
        loading: false,
        error: null,
        subnet: json.subnet,
        localAddress: json.localAddress,
        items: json.items,
        truncated: json.truncated,
        ms: json.ms,
      });
    } catch (e) {
      setScan((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const runTest = async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/parking/devices/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ip, port: Number(port), username, password }),
      });
      const json = await res.json();
      setTestResult({
        ok: json.ok,
        ms: json.ms ?? 0,
        message: json.message ?? json.error ?? "",
        sn: json.sn,
        deviceType: json.deviceType,
        firmwareVer: json.firmwareVer,
      });
    } catch (e) {
      setTestResult({ ok: false, ms: 0, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {simulators.length > 0 && (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          模擬設備登入測試：IP 填 127.0.0.1，Port 填{" "}
          {simulators.map((s) => (
            <code key={s.sn} className="font-mono">
              {s.loginPort}
            </code>
          ))}
          ，帳號密碼固定 <code className="font-mono">admin / admin</code>。
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runScan}
            disabled={scan.loading}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {scan.loading ? "掃描中…" : "掃描區網設備"}
          </button>
          {scan.subnet && (
            <span className="text-xs text-zinc-500">
              本機 {scan.localAddress}，網段 {scan.subnet}，耗時 {scan.ms} ms
            </span>
          )}
          {scan.truncated && (
            <span className="text-xs text-amber-700 dark:text-amber-400">網段過大，已截斷掃描範圍</span>
          )}
        </div>
        {scan.error && <p className="text-sm text-rose-600">{scan.error}</p>}
        {!scan.loading && scan.subnet && scan.items.length === 0 && (
          <p className="text-sm text-zinc-500">沒有掃到有回應的設備</p>
        )}
        {scan.items.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-zinc-500">共 {scan.items.length} 個回應的 IP，點選可帶入下方連線測試</p>
            <div className="flex flex-wrap gap-2">
              {scan.items.map((item) => (
                <button
                  key={item.ip}
                  onClick={() => setIp(item.ip)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-xs ${
                    ip === item.ip
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                  }`}
                >
                  {item.ip}
                  {item.hostname && <span className="ml-1 text-zinc-400">{item.hostname}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">連線測試（帳號密碼登入取得設備編號）</h2>
        <p className="text-xs text-zinc-500">
          ⚠️ 目前還沒有廠商的登入協定文件，這裡先用雛形協定（TCP + NDJSON，{"{"}action:&quot;login&quot;,
          username,password{"}"} → 設備回傳 sn）讓流程先跑通，細節見 device-login.ts。等拿到正式協定文件後會換成正確格式。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            IP
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value.trim())}
              placeholder="192.168.1.100"
              className="w-40 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            Port
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.trim())}
              placeholder="例如 9201"
              className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            帳號
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-36 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            密碼
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-36 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            onClick={runTest}
            disabled={testBusy || !ip || !port}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {testBusy ? "測試中…" : "測試連線"}
          </button>
          {testResult && <StatusBadge ok={testResult.ok}>{testResult.ms} ms</StatusBadge>}
        </div>
        {testResult && (
          <div className="text-sm">
            <p className={testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}>
              {testResult.message}
            </p>
            {testResult.ok && (testResult.deviceType || testResult.firmwareVer) && (
              <p className="text-xs text-zinc-500">
                {testResult.deviceType && <>設備類型 {testResult.deviceType} </>}
                {testResult.firmwareVer && <>韌體版本 {testResult.firmwareVer}</>}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface CaptureBrowseEntry {
  name: string;
  path: string;
}

interface CaptureSettingsState {
  dir: string | null;
  exists: boolean;
  loaded: boolean;
}

function CaptureSettingsPanel() {
  const [settings, setSettings] = useState<CaptureSettingsState>({ dir: null, exists: false, loaded: false });
  const [inputDir, setInputDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<CaptureBrowseEntry[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  const fetchSettings = useCallback(async (): Promise<CaptureSettingsState> => {
    try {
      const res = await fetch("/api/parking/capture-settings");
      const json = await res.json();
      return { dir: json.dir ?? null, exists: !!json.exists, loaded: true };
    } catch {
      return { dir: null, exists: false, loaded: true };
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const next = await fetchSettings();
    setSettings(next);
    setInputDir(next.dir ?? "");
  }, [fetchSettings]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings().then((next) => {
      if (cancelled) return;
      setSettings(next);
      setInputDir(next.dir ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  const applyDir = async (dir: string) => {
    if (!dir.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/parking/capture-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "設定失敗");
      } else {
        setMessage(null);
        setBrowsing(false);
        await loadSettings();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const clearDir = async () => {
    setSaving(true);
    try {
      await fetch("/api/parking/capture-settings", { method: "DELETE" });
      await loadSettings();
    } finally {
      setSaving(false);
    }
  };

  const loadBrowse = async (p: string | null) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const url = p ? `/api/parking/capture-settings/browse?path=${encodeURIComponent(p)}` : "/api/parking/capture-settings/browse";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || json.error) {
        setBrowseError(json.error ?? "讀取失敗");
        return;
      }
      setBrowsePath(json.path);
      setBrowseParent(json.parent);
      setBrowseEntries(json.entries ?? []);
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseLoading(false);
    }
  };

  const openBrowser = () => {
    setBrowsing(true);
    loadBrowse(settings.dir ?? null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">辨識圖片儲存資料夾</span>
        <input
          value={inputDir}
          onChange={(e) => setInputDir(e.target.value)}
          placeholder="例如 D:\parking-captures"
          className="w-80 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          onClick={() => applyDir(inputDir)}
          disabled={saving || !inputDir.trim()}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          儲存
        </button>
        <button
          onClick={openBrowser}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          瀏覽…
        </button>
        {settings.loaded && (
          <StatusBadge ok={!!settings.dir && settings.exists}>
            {settings.dir ? (settings.exists ? "已設定" : "資料夾不存在") : "尚未設定，辨識圖片不會存檔"}
          </StatusBadge>
        )}
        {settings.dir && (
          <button
            onClick={clearDir}
            disabled={saving}
            className="text-sm text-rose-600 hover:underline disabled:opacity-50"
          >
            清除
          </button>
        )}
      </div>
      {message && <p className="text-sm text-rose-600">{message}</p>}
      <p className="text-xs text-zinc-500">
        每筆車牌辨識結果（MQTT Result / HTTP 辨識結果）如果帶有圖片，會自動存一張到這個資料夾，檔名為「時間_車號.jpg」。
      </p>

      {browsing && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs text-zinc-600 dark:text-zinc-400">{browsePath ?? "選擇磁碟機"}</code>
            <div className="ml-auto flex gap-2">
              {browseParent && (
                <button
                  onClick={() => loadBrowse(browseParent)}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  ⬆ 上一層
                </button>
              )}
              {browsePath && (
                <button
                  onClick={() => applyDir(browsePath)}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  使用此資料夾
                </button>
              )}
              <button
                onClick={() => setBrowsing(false)}
                className="rounded-lg px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                關閉
              </button>
            </div>
          </div>
          {browseError && <p className="text-xs text-rose-600">{browseError}</p>}
          {browseLoading ? (
            <p className="text-xs text-zinc-500">載入中…</p>
          ) : browseEntries.length === 0 ? (
            <p className="text-xs text-zinc-500">（沒有子資料夾）</p>
          ) : (
            <div className="flex max-h-48 flex-col gap-0.5 overflow-auto">
              {browseEntries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => loadBrowse(entry.path)}
                  className="rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  📁 {entry.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DisplayLineResult {
  line: number;
  skipped?: boolean;
  ok?: boolean;
  overLimit?: boolean;
  contentBytes?: number;
  hex?: string;
  status?: string;
  error?: string;
}

function DisplayMessagePanel({ sn }: { sn: string }) {
  const [lines, setLines] = useState<[string, string, string, string]>(["", "", "", ""]);
  const [colors, setColors] = useState<[LedColor, LedColor, LedColor, LedColor]>([1, 1, 1, 1]);
  const [mode, setMode] = useState<"fixed" | "temporary">("fixed");
  const [durationSec, setDurationSec] = useState("10");
  const [address, setAddress] = useState(String(LED_DEFAULT_ADDRESS));
  const [busy, setBusy] = useState(false);
  const [lineResults, setLineResults] = useState<DisplayLineResult[] | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const setLine = (index: number, value: string) => {
    setLines((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[index] = value;
      return next;
    });
  };

  const setLineColor = (index: number, value: LedColor) => {
    setColors((prev) => {
      const next = [...prev] as [LedColor, LedColor, LedColor, LedColor];
      next[index] = value;
      return next;
    });
  };

  const send = async () => {
    setBusy(true);
    setLineResults(null);
    setRequestError(null);
    const start = performance.now();
    try {
      const res = await fetch("/api/parking/display-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sn,
          lines,
          colors,
          mode,
          durationSec: mode === "temporary" ? Number(durationSec) || 10 : undefined,
          address: Number(address) || LED_DEFAULT_ADDRESS,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setRequestError(String(json.error ?? res.statusText));
      } else {
        setLineResults(json.results as DisplayLineResult[]);
      }
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : String(e));
    } finally {
      setMs(Math.round(performance.now() - start));
      setBusy(false);
    }
  };

  const lineStatusLabel = (r: DisplayLineResult) => {
    if (r.skipped) return "空白，略過";
    if (r.overLimit) return r.error ?? "內容過長";
    if (r.error) return r.error;
    if (r.status === "sent") return "已送出（此命令設備不回覆）";
    if (r.status === "timeout") return "逾時，設備未回覆";
    return r.status ?? (r.ok ? "成功" : "失敗");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        依《LED点阵显示控制卡使用说明》實作：固定顯示對應 0x25 加載廣告內容指令（掉電保存），臨時訊息對應
        0x27 下發臨顯內容指令（顯示秒數到了自動恢復廣告內容）。每一行各自組成一個 RS485 命令帧，透過
        SerialData（4.14）下行命令轉送。文字會先轉成 GBK 編碼（顯示板需要 GBK，不是 UTF-8）。
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">顯示內容（4 行文字，每行最多 GBK 60 bytes，各行可分別選色）</h2>
        <div className="flex flex-col gap-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                第 {i + 1} 行
              </span>
              <input
                value={line}
                onChange={(e) => setLine(i, e.target.value)}
                placeholder={`第 ${i + 1} 行內容`}
                maxLength={60}
                className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <select
                value={colors[i]}
                onChange={(e) => setLineColor(i, Number(e.target.value) as LedColor)}
                className="w-20 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                {LED_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            顯示模式
            <div className="flex items-center gap-3 py-1.5">
              <label className="flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                <input type="radio" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
                固定顯示（掉電保存）
              </label>
              <label className="flex items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                <input
                  type="radio"
                  checked={mode === "temporary"}
                  onChange={() => setMode("temporary")}
                />
                臨時訊息
              </label>
            </div>
          </div>

          {mode === "temporary" && (
            <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              顯示秒數（1-255）
              <input
                type="number"
                min={1}
                max={255}
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
                className="w-28 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            RS485 地址
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          <button
            onClick={send}
            disabled={busy || !sn}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "送出中…" : "送出到設備"}
          </button>

          {ms !== null && <span className="text-xs text-zinc-500">{ms} ms</span>}
        </div>

        {requestError && <p className="text-sm text-rose-600">{requestError}</p>}

        {lineResults && (
          <div className="flex flex-col gap-1.5">
            {lineResults.map((r) => (
              <div key={r.line} className="flex items-center gap-2 text-sm">
                <StatusBadge ok={r.skipped ? true : !!r.ok}>第 {r.line} 行</StatusBadge>
                <span className={r.skipped ? "text-zinc-400" : r.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}>
                  {lineStatusLabel(r)}
                </span>
                {r.hex && <code className="text-xs text-zinc-400">{r.hex}</code>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MonitorEventCard({ e }: { e: PlateResultEvent }) {
  const success = isSuccessfulRecognition(e);
  const time = e.created_at ? new Date(e.created_at).toLocaleString() : "";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 ${
        success
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      {e.image_base64 ? (
        <img
          src={`data:image/jpeg;base64,${e.image_base64}`}
          alt={e.plate_raw || "辨識照片"}
          className="h-20 w-28 shrink-0 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
        />
      ) : (
        <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
          無照片
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {success ? (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
              ✅ 辨識成功
            </span>
          ) : (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              無車 / 待命
            </span>
          )}
          <span className="font-mono text-base font-semibold">{e.plate_raw || "—"}</span>
          <span className="text-xs text-zinc-500">{e.command}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
          <span>設備 {e.device_sn}</span>
          <span>來源 {e.source === "mqtt" ? "MQTT" : "HTTP"}</span>
          {e.confidence !== null && <span>信心度 {e.confidence}</span>}
          {e.valid_plate && <span>valid_plate {e.valid_plate}</span>}
          <span>觸發時間 {e.trigger_time || "—"}</span>
          <span>收到時間 {time}</span>
        </div>
        {e.image_saved_path && (
          <span className="truncate text-xs text-zinc-400" title={e.image_saved_path}>
            已存檔：{e.image_saved_path}
          </span>
        )}
      </div>
    </div>
  );
}

function MonitorPanel({ events, connected }: { events: PlateResultEvent[]; connected: boolean }) {
  const successCount = events.filter(isSuccessfulRecognition).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge ok={connected}>{connected ? "監測中（即時推播）" : "連線中斷，嘗試重新連線…"}</StatusBadge>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          共 {events.length} 筆，{successCount} 筆辨識成功
        </span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">目前還沒有辨識結果。設備有辨識結果時會即時顯示在這裡。</p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <MonitorEventCard key={e.id} e={e} />
          ))}
        </div>
      )}
    </div>
  );
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
  const selectedDeviceIp = status?.devices.find((d) => d.sn === sn)?.ip ?? null;

  // 即時監測：跟 tab 無關，整頁掛著就好，切頁籤不會斷線、收到辨識成功也能跳提示
  const [monitorEvents, setMonitorEvents] = useState<PlateResultEvent[]>([]);
  const [monitorConnected, setMonitorConnected] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; event: PlateResultEvent }[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/parking/results/stream");
    source.addEventListener("ready", () => setMonitorConnected(true));
    source.onerror = () => setMonitorConnected(false);
    source.addEventListener("result", (e) => {
      setMonitorConnected(true);
      const event = JSON.parse((e as MessageEvent).data) as PlateResultEvent;
      setMonitorEvents((prev) => [event, ...prev].slice(0, 50));
      if (isSuccessfulRecognition(event)) {
        setToasts((prev) => [...prev, { id: event.id, event }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== event.id)), 6000);
      }
    });
    return () => source.close();
  }, []);

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
    async (key: string, overrideData?: unknown): Promise<RunResult> => {
      const [kind, command] = key.split(":");
      const text = texts[key] ?? "";
      setBusy((b) => new Set(b).add(key));
      const start = performance.now();
      let result: RunResult;
      try {
        const data = overrideData !== undefined ? overrideData : text.trim() ? JSON.parse(text) : null;
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
    t === "http"
      ? [HTTP_KEY]
      : t === "uplink" || t === "downlink"
        ? cardsFor(t).map((c) => `${t}:${c.command}`)
        : [];
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
      {toasts.length > 0 && (
        <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-white p-2.5 shadow-lg dark:border-emerald-800 dark:bg-zinc-900"
            >
              {t.event.image_base64 ? (
                <img
                  src={`data:image/jpeg;base64,${t.event.image_base64}`}
                  alt={t.event.plate_raw}
                  className="h-14 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
                  無照片
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✅ 辨識成功</span>
                <span className="truncate font-mono text-sm font-semibold">{t.event.plate_raw}</span>
                <span className="truncate text-xs text-zinc-500">{t.event.device_sn}</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
              區網設備
              <select
                value={status?.devices.some((d) => d.sn === sn) ? sn : ""}
                onChange={(e) => e.target.value && setSn(e.target.value)}
                className="w-56 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="" disabled={!status?.devices.length}>
                  {status?.devices.length ? "— 選擇偵測到的設備 —" : "尚未偵測到設備"}
                </option>
                {status?.devices.map((d) => (
                  <option key={d.sn} value={d.sn}>
                    {d.sn} · {d.ip ?? "IP 未知"}
                    {d.online ? "" : "（離線）"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-sm">
              <span className="flex items-center gap-2">
                設備 SN
                <input
                  value={sn}
                  onChange={(e) => setSn(e.target.value.trim())}
                  className="w-64 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </span>
              {selectedDeviceIp && <span className="pl-[4.5rem] text-xs text-zinc-500">IP {selectedDeviceIp}</span>}
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

        <CaptureSettingsPanel />

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

        {(tab === "http" || tab === "uplink" || tab === "downlink") && (
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
              const setSwitch = (switchType: "on" | "off") => {
                const data = { switchType };
                setTexts((t) => ({ ...t, [key]: pretty(data) }));
                run(key, data);
              };
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
                  quickActions={
                    tab === "downlink" && spec.command === "LongOpen"
                      ? [
                          { label: "開啟常開", tone: "on", onClick: () => setSwitch("on") },
                          { label: "關閉常開", tone: "off", onClick: () => setSwitch("off") },
                        ]
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {tab === "records" && <RecordsPanel sn={sn} />}
        {tab === "devices" && <DeviceScanPanel simulators={status?.simulators ?? []} />}
        {tab === "display" && <DisplayMessagePanel sn={sn} />}
        {tab === "monitor" && <MonitorPanel events={monitorEvents} connected={monitorConnected} />}
      </div>
    </div>
  );
}
