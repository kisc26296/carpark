"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DISPLAY_SCENARIOS,
  DISPLAY_TAGS,
  formatDisplayTime,
  gbkLength,
  renderDisplayText,
  type DisplayBoardSettings as BoardSettings,
  type DisplayMessage,
  type DisplayScenario,
  type DisplayTag,
} from "@/lib/parking/display-board-shared";
import { LED_COLORS, LED_DEFAULT_ADDRESS, LED_MAX_CONTENT_BYTES, type LedColor } from "@/lib/parking/led-protocol-shared";
import { CAMERA_ROLE_LABELS, type CameraInfo, type CameraRole } from "@/lib/parking/parking-entry-shared";

// 設備設定 > 顯示板訊息：LED 點陣顯示板接在入口 / 出口攝影機的 RS485 上。
// - 情境訊息（存在 MongoDB）：有剩餘車位 / 無剩餘車位時的固定顯示由伺服器依車位數自動切換；
//   辨識到車輛時顯示臨時訊息。內容可插入 {車位數}、{車號}。
// - 手動送出：透過 /api/parking/display-message 立刻對指定為入口或出口的每台攝影機下發。

const buttonClass = "rounded px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50";
const CAPACITY_REFRESH_MS = 5000;

interface LineResult {
  line: number;
  skipped?: boolean;
  ok?: boolean;
  status?: string;
  error?: string;
}

interface SendResult {
  sn: string;
  ok: boolean;
  text: string;
}

function lineStatus(r: LineResult): string {
  if (r.skipped) return "空白略過";
  if (r.error) return r.error;
  if (r.status === "timeout") return "逾時，攝影機沒有回應";
  return r.ok ? "成功" : (r.status ?? "失敗");
}

const update = <T,>(list: T[], index: number, value: T) => list.map((v, i) => (i === index ? value : v));

/** 4 行輸入 + 顏色 + 插入變數按鈕 + 字數；有變數的行在下方預覽實際顯示內容 */
function LineEditor({
  lines,
  colors,
  tags,
  values,
  onChange,
}: {
  lines: string[];
  colors: LedColor[];
  tags: DisplayTag[];
  /** 預覽與字數用的變數值 */
  values: Partial<Record<DisplayTag, string | number>>;
  onChange: (lines: string[], colors: LedColor[]) => void;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  /** 在游標位置插入變數，插入後游標移到變數後面 */
  const insert = (index: number, tag: string) => {
    const input = inputs.current[index];
    const text = lines[index];
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    onChange(update(lines, index, text.slice(0, start) + tag + text.slice(end)), colors);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  return (
    <div className="space-y-2">
      {lines.map((text, i) => {
        const rendered = renderDisplayText(text, values);
        const length = gbkLength(rendered);
        const hasTag = rendered !== text;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 font-medium">第 {i + 1} 行</span>
            <input
              ref={(el) => {
                inputs.current[i] = el;
              }}
              value={text}
              onChange={(e) => onChange(update(lines, i, e.target.value), colors)}
              className={`min-w-0 flex-1 rounded border bg-white px-3 py-2 text-black ${
                length > LED_MAX_CONTENT_BYTES ? "border-red-500" : "border-gray-300"
              }`}
            />
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insert(i, DISPLAY_TAGS[tag].tag)}
                className="whitespace-nowrap rounded border border-sky-400 px-2 py-2 text-sky-600 hover:bg-sky-50"
              >
                插入{DISPLAY_TAGS[tag].label}
              </button>
            ))}
            <select
              value={colors[i]}
              onChange={(e) => onChange(lines, update(colors, i, Number(e.target.value) as LedColor))}
              className="rounded border border-gray-300 px-2 py-2"
            >
              {LED_COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className={`w-16 text-right text-xs ${length > LED_MAX_CONTENT_BYTES ? "text-red-600" : "text-gray-500"}`}>
              {length}/{LED_MAX_CONTENT_BYTES}
            </span>
            {hasTag && (
              <div className="basis-full pl-16 text-xs text-gray-500">
                顯示為：<span className="text-gray-900">{rendered}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 一個情境的訊息：啟用、4 行內容，辨識到車輛另外有顯示秒數 */
function ScenarioCard({
  scenario,
  message,
  durationSec,
  values,
  onChange,
  onDurationChange,
}: {
  scenario: (typeof DISPLAY_SCENARIOS)[number];
  message: DisplayMessage;
  durationSec?: number;
  values: Partial<Record<DisplayTag, string | number>>;
  onChange: (message: DisplayMessage) => void;
  onDurationChange?: (sec: number) => void;
}) {
  return (
    <div className="space-y-3 rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={message.enabled} onChange={(e) => onChange({ ...message, enabled: e.target.checked })} />
          {scenario.label}
        </label>
        <span className="text-xs text-gray-500">{scenario.hint}</span>
        {onDurationChange && (
          <label className="flex items-center gap-1">
            顯示
            <input
              type="number"
              min={1}
              max={255}
              value={durationSec}
              onChange={(e) => onDurationChange(Number(e.target.value))}
              className="w-20 rounded border border-gray-300 px-2 py-1"
            />
            秒
          </label>
        )}
      </div>
      <div className={message.enabled ? "" : "opacity-50"}>
        <LineEditor
          lines={message.lines}
          colors={message.colors}
          tags={scenario.tags}
          values={values}
          onChange={(lines, colors) => onChange({ ...message, lines, colors })}
        />
      </div>
    </div>
  );
}

export function DisplayBoardSettings() {
  const [cameras, setCameras] = useState<CameraInfo[] | null>(null);
  const [role, setRole] = useState<CameraRole>("entry");
  const [settings, setSettings] = useState<BoardSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lines, setLines] = useState<string[]>(["", "", "", ""]);
  const [colors, setColors] = useState<LedColor[]>([1, 1, 1, 1]);
  const [mode, setMode] = useState<"fixed" | "temporary">("temporary");
  const [durationSec, setDurationSec] = useState("10");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const loadCapacity = useCallback(async (): Promise<number | null> => {
    try {
      const json = (await (await fetch("/api/parking/capacity")).json()) as { ok: boolean; capacity?: { remaining: number } };
      const value = json.ok && json.capacity ? json.capacity.remaining : null;
      setRemaining(value);
      return value;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetch("/api/parking/cameras")
      .then((res) => res.json())
      .then((json: { ok: boolean; items?: CameraInfo[]; error?: string }) => {
        if (json.ok) setCameras(json.items ?? []);
        else setError(json.error ?? "讀取攝影機失敗");
      })
      .catch(() => setError("連不到伺服器"));
    fetch("/api/parking/display-board")
      .then((res) => res.json())
      .then((json: { ok: boolean; settings?: BoardSettings; error?: string }) => {
        if (json.ok && json.settings) setSettings(json.settings);
        else setSaveMessage({ ok: false, text: json.error ?? "讀取情境訊息失敗" });
      })
      .catch(() => setSaveMessage({ ok: false, text: "連不到伺服器" }));
  }, []);

  // 剩餘車位數隨進出場變動，定時重新讀取（預覽與字數用）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面先讀一次，之後定時重新讀取；setState 都在 await 之後
    loadCapacity();
    const timer = setInterval(loadCapacity, CAPACITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadCapacity]);

  const targets = (cameras ?? []).filter((c) => c.role === role);
  // 時間用目前時間預覽；車位數每 5 秒重新讀取時畫面也會跟著更新時間
  const previewValues = { spaces: remaining ?? 0, plate: DISPLAY_TAGS.plate.sample, time: formatDisplayTime(new Date()) };
  const address = settings?.address ?? LED_DEFAULT_ADDRESS;

  const setScenario = (scenario: DisplayScenario, message: DisplayMessage) =>
    settings &&
    setSettings({
      ...settings,
      boards: { ...settings.boards, [role]: { ...settings.boards[role], [scenario]: { ...settings.boards[role][scenario], ...message } } },
    });

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/parking/display-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: settings.address, boards: settings.boards }),
      });
      const json = (await res.json()) as { ok: boolean; settings?: BoardSettings; error?: string };
      if (json.ok && json.settings) {
        setSettings(json.settings);
        setSaveMessage({ ok: true, text: "已儲存，固定顯示會依目前車位數更新" });
      } else {
        setSaveMessage({ ok: false, text: json.error ?? "儲存失敗" });
      }
    } catch {
      setSaveMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setSaving(false);
    }
  };

  /** 對每台目標攝影機下發，整理成每台一行結果 */
  const sendAll = async (body: object, describe: (json: Record<string, unknown>) => { ok: boolean; text: string }) => {
    setBusy(true);
    setError(null);
    setResults(null);
    const out: SendResult[] = [];
    for (const camera of targets) {
      try {
        const res = await fetch("/api/parking/display-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sn: camera.sn, address, ...body }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        out.push({ sn: camera.sn, ...(json.error ? { ok: false, text: String(json.error) } : describe(json)) });
      } catch {
        out.push({ sn: camera.sn, ok: false, text: "連不到伺服器" });
      }
    }
    setResults(out);
    setBusy(false);
  };

  const manualLengths = lines.map((l) => gbkLength(renderDisplayText(l, previewValues)));
  const send = async () => {
    // 送出前重新讀一次，確保是當下的車位數
    const spaces = lines.some((l) => l.includes(DISPLAY_TAGS.spaces.tag)) ? await loadCapacity() : remaining;
    await sendAll(
      {
        lines: lines.map((l) => renderDisplayText(l, { spaces: spaces ?? 0, time: formatDisplayTime(new Date()) })),
        colors,
        mode,
        durationSec: mode === "temporary" ? Number(durationSec) || 10 : undefined,
      },
      (json) => {
        const lineResults = (json.results as LineResult[] | undefined) ?? [];
        return {
          ok: Boolean(json.ok),
          text: lineResults
            .filter((r) => !r.skipped)
            .map((r) => `第 ${r.line} 行${lineStatus(r)}`)
            .join("、"),
        };
      },
    );
  };

  const clearTemporary = () =>
    sendAll({ action: "cancelTemporary" }, (json) => ({
      ok: Boolean(json.ok),
      text: json.ok ? "已清除臨時訊息" : json.status === "timeout" ? "逾時，攝影機沒有回應" : String(json.status ?? "失敗"),
    }));

  return (
    <div className="space-y-6 text-sm text-gray-900">
      <div>
        <h2 className="text-lg font-medium">顯示板訊息</h2>
        <p className="mt-1 text-gray-500">
          LED 顯示板接在入口 / 出口攝影機的 RS485 上，訊息會送到指定為該出入口、且已連上 MQTT 的每一台攝影機。攝影機的入口 / 出口在「車輛進場紀錄」頁指定。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="font-medium">顯示板：</span>
        {(["entry", "exit"] as const).map((r) => (
          <label key={r} className="flex items-center gap-1">
            <input type="radio" name="board" checked={role === r} onChange={() => setRole(r)} />
            {CAMERA_ROLE_LABELS[r]}顯示板
          </label>
        ))}
        <span className="text-gray-500">
          {cameras === null
            ? "讀取攝影機中…"
            : targets.length
              ? `送到：${targets.map((c) => `${c.sn}${c.online === false ? "（離線）" : ""}`).join("、")}`
              : `尚未指定${CAMERA_ROLE_LABELS[role]}攝影機`}
        </span>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-medium">情境訊息（{CAMERA_ROLE_LABELS[role]}）</h3>
        <p className="text-xs text-gray-500">
          勾選啟用後自動顯示：伺服器每 10 秒與每次進出場後依剩餘車位數（目前 {remaining ?? "—"}）切換固定顯示，內容有變才重送；
          辨識到車牌時顯示臨時訊息。{"{時間}"} 為 HH:mm，固定顯示中有用到時間的行每分鐘更新一次。{"{車號}"} 預覽用 {DISPLAY_TAGS.plate.sample} 代替。空白的行在固定顯示時會清空。
        </p>
        {!settings ? (
          <div className="text-gray-500">讀取中…</div>
        ) : (
          DISPLAY_SCENARIOS.map((scenario) => {
            const board = settings.boards[role];
            return (
              <ScenarioCard
                key={`${role}-${scenario.id}`}
                scenario={scenario}
                message={board[scenario.id]}
                values={previewValues}
                onChange={(message) => setScenario(scenario.id, message)}
                {...(scenario.id === "detected"
                  ? {
                      durationSec: board.detected.durationSec,
                      onDurationChange: (sec: number) =>
                        setSettings({
                          ...settings,
                          boards: { ...settings.boards, [role]: { ...board, detected: { ...board.detected, durationSec: sec } } },
                        }),
                    }
                  : {})}
              />
            );
          })
        )}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="font-medium">顯示板地址：</span>
            <input
              type="number"
              min={0}
              max={255}
              value={address}
              onChange={(e) => settings && setSettings({ ...settings, address: Number(e.target.value) })}
              className="w-24 rounded border border-gray-300 px-2 py-1"
            />
            <span className="text-xs text-gray-500">控制卡預設 {LED_DEFAULT_ADDRESS}，沒改過不用動</span>
          </label>
          <button type="button" onClick={save} disabled={!settings || saving} className={`${buttonClass} bg-sky-400 hover:bg-sky-500`}>
            {saving ? "儲存中…" : "儲存情境訊息"}
          </button>
          {saveMessage && <span className={saveMessage.ok ? "text-green-700" : "text-red-600"}>{saveMessage.text}</span>}
        </div>
      </section>

      <hr className="border-gray-200" />

      <section className="space-y-3">
        <h3 className="text-base font-medium">手動送出（{CAMERA_ROLE_LABELS[role]}）</h3>
        <LineEditor
          lines={lines}
          colors={colors}
          tags={["spaces", "time"]}
          values={previewValues}
          onChange={(l, c) => {
            setLines(l);
            setColors(c);
          }}
        />
        <p className="text-xs text-gray-500">
          每行最多 {LED_MAX_CONTENT_BYTES} bytes（中文 2、英數 1）；空白的行不會變更顯示板上該行的內容。{"{車位數}"}、{"{時間}"} 送出時換成當下的剩餘車位數與時間（HH:mm）。
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-medium">顯示方式：</span>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "temporary"} onChange={() => setMode("temporary")} />
            臨時訊息
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
            固定顯示（斷電後保留；啟用情境訊息時會被自動切換蓋掉）
          </label>
          {mode === "temporary" && (
            <label className="flex items-center gap-1">
              顯示
              <input
                type="number"
                min={1}
                max={255}
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
                className="w-20 rounded border border-gray-300 px-2 py-1"
              />
              秒後恢復固定顯示
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={send}
            disabled={busy || !targets.length || lines.every((l) => !l.trim()) || manualLengths.some((n) => n > LED_MAX_CONTENT_BYTES)}
            className={`${buttonClass} bg-sky-400 hover:bg-sky-500`}
          >
            {busy ? "傳送中…" : "送出訊息"}
          </button>
          <button
            type="button"
            onClick={clearTemporary}
            disabled={busy || !targets.length}
            className={`${buttonClass} bg-gray-500 hover:bg-gray-600`}
          >
            清除臨時訊息
          </button>
        </div>
        {error && <div className="text-red-600">{error}</div>}
        {results && (
          <ul className="space-y-1">
            {results.map((r) => (
              <li key={r.sn} className={r.ok ? "text-green-700" : "text-red-600"}>
                {r.sn}：{r.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
