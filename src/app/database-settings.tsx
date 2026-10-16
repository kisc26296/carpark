"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CASH_DEVICE_LABELS,
  CASH_DEVICES,
  type CashDeviceConfig,
  type CashDeviceId,
  type CashDeviceStatus,
  type ComPortInfo,
} from "@/lib/cash-device/shared";
import { CAMERA_ROLE_LABELS, type CameraInfo, type CameraRole } from "@/lib/parking/parking-entry-shared";

// 資料庫設定：現金設備的 COM port 與連線測試、入口 / 出口攝影機照片儲存位置

const smallButtonClass =
  "whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "rounded border border-gray-300 bg-white px-2 py-1";
const cellClass = "border border-gray-200 px-2 py-1.5";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  return res.json();
}

const STATE_TEXT: Record<CashDeviceStatus["state"], { text: string; className: string }> = {
  connected: { text: "已連線", className: "text-green-700" },
  connecting: { text: "連線中", className: "text-yellow-700" },
  reconnecting: { text: "自動重連中", className: "text-orange-600" },
  disconnected: { text: "未連線", className: "text-gray-500" },
};

interface TestResult {
  ok: boolean;
  message: string;
  responseHex: string | null;
}

function CashDeviceSettings() {
  const [ports, setPorts] = useState<ComPortInfo[]>([]);
  const [configs, setConfigs] = useState<Record<CashDeviceId, CashDeviceConfig> | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<CashDeviceId, string>>>({});
  const [statuses, setStatuses] = useState<Partial<Record<CashDeviceId, CashDeviceStatus>>>({});
  const [busy, setBusy] = useState<CashDeviceId | null>(null);
  const [results, setResults] = useState<Partial<Record<CashDeviceId, TestResult | { ok: boolean; message: string }>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);

  const applyStatuses = (list: CashDeviceStatus[]) => setStatuses(Object.fromEntries(list.map((s) => [s.device, s])));

  const load = useCallback(async () => {
    try {
      const [portJson, configJson] = await Promise.all([
        api<{ ok: boolean; error?: string; ports?: ComPortInfo[] }>("/api/cash-device/ports"),
        api<{ ok: boolean; error?: string; configs?: CashDeviceConfig[]; statuses?: CashDeviceStatus[] }>(
          "/api/cash-device/config",
        ),
      ]);
      if (portJson.ok) setPorts(portJson.ports ?? []);
      if (!configJson.ok) return setError(configJson.error ?? "讀取設定失敗");
      const map = Object.fromEntries((configJson.configs ?? []).map((c) => [c.device, c])) as Record<
        CashDeviceId,
        CashDeviceConfig
      >;
      setConfigs(map);
      setDrafts(Object.fromEntries(CASH_DEVICES.map((d) => [d, map[d]?.port ?? ""])));
      applyStatuses(configJson.statuses ?? []);
      setError(null);
    } catch {
      setError("連不到伺服器");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面讀一次設定與 COM port 清單；setState 都在 await 之後
    load();
  }, [load]);

  const save = async (device: CashDeviceId) => {
    const config = configs?.[device];
    if (!config) return;
    setBusy(device);
    try {
      const { port: _old, ...serial } = config;
      void _old;
      const json = await api<{ ok: boolean; error?: string; config?: CashDeviceConfig; statuses?: CashDeviceStatus[] }>(
        "/api/cash-device/config",
        { method: "PUT", body: JSON.stringify({ ...serial, device, port: drafts[device] ?? "" }) },
      );
      if (json.config) setConfigs((prev) => prev && { ...prev, [device]: json.config! });
      if (json.statuses) applyStatuses(json.statuses);
      setResults((prev) => ({ ...prev, [device]: json.ok ? { ok: true, message: "已儲存" } : { ok: false, message: json.error ?? "儲存失敗" } }));
      // 重新讀 COM port 清單，更新「哪台設備使用中」
      const portJson = await api<{ ok: boolean; ports?: ComPortInfo[] }>("/api/cash-device/ports");
      if (portJson.ok) setPorts(portJson.ports ?? []);
    } catch {
      setResults((prev) => ({ ...prev, [device]: { ok: false, message: "連不到伺服器" } }));
    } finally {
      setBusy(null);
    }
  };

  const test = async (device: CashDeviceId) => {
    setBusy(device);
    setResults((prev) => ({ ...prev, [device]: undefined }));
    try {
      const json = await api<{ ok: boolean; error?: string; result?: TestResult }>("/api/cash-device/test", {
        method: "POST",
        body: JSON.stringify({ device, port: drafts[device] ?? "" }),
      });
      setResults((prev) => ({
        ...prev,
        [device]: json.ok && json.result ? json.result : { ok: false, message: json.error ?? "測試失敗" },
      }));
    } catch {
      setResults((prev) => ({ ...prev, [device]: { ok: false, message: "連不到伺服器" } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-700">現金設備 COM port 設定</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">主機 COM port：{ports.map((p) => p.path).join("、") || "無"}</span>
          <button type="button" onClick={load} className={smallButtonClass}>
            重新整理
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        COM port 是執行伺服器那台電腦上的 port。「測試連線」會送出詢問狀態指令，1.5 秒內設備有正確回應就代表接線與 COM port 正確；
        可以先選好 port 測試，再按儲存。詳細的設備操作請到 <a href="/cash-device-test" className="text-[#428bca] underline">現金設備測試頁</a>。
      </p>
      {error && <div className="text-red-600">{error}</div>}
      {!configs && !error && <div className="text-gray-500">讀取中…</div>}

      {configs && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse border border-gray-200">
            <thead>
              <tr className="bg-[#e8c35f] text-left">
                {["設備", "COM port", "目前狀態", "操作", "結果"].map((h) => (
                  <th key={h} className={`${cellClass} font-medium whitespace-nowrap`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CASH_DEVICES.map((device) => {
                const draft = drafts[device] ?? "";
                const saved = configs[device]?.port ?? "";
                const status = statuses[device];
                const result = results[device];
                // 設定中的 port 目前沒插著也要留在選單裡
                const options = ports.some((p) => p.path === draft) || !draft ? ports : [...ports, { path: draft, friendlyName: "（未偵測到）", manufacturer: null, usedBy: device }];
                return (
                  <tr key={device}>
                    <td className={`${cellClass} whitespace-nowrap font-medium`}>{CASH_DEVICE_LABELS[device]}</td>
                    <td className={cellClass}>
                      <select
                        value={draft}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [device]: e.target.value }))}
                        className={`${inputClass} w-full min-w-48`}
                      >
                        <option value="">未設定</option>
                        {options.map((p) => {
                          const usedByOther = p.usedBy !== null && p.usedBy !== device;
                          return (
                            <option key={p.path} value={p.path} disabled={usedByOther}>
                              {p.path}
                              {p.friendlyName ? ` ${p.friendlyName}` : ""}
                              {usedByOther ? `（${CASH_DEVICE_LABELS[p.usedBy!]}使用中）` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                    <td className={`${cellClass} whitespace-nowrap`}>
                      {status ? (
                        <span className={STATE_TEXT[status.state].className}>
                          {STATE_TEXT[status.state].text}
                          {status.port && status.state !== "disconnected" ? ` ${status.port}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${cellClass} whitespace-nowrap`}>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => save(device)}
                          disabled={busy !== null || draft === saved}
                          className={smallButtonClass}
                        >
                          儲存
                        </button>
                        <button
                          type="button"
                          onClick={() => test(device)}
                          disabled={busy !== null || !draft}
                          className={smallButtonClass}
                        >
                          {busy === device ? "測試中…" : "測試連線"}
                        </button>
                      </div>
                      {draft !== saved && <div className="mt-1 text-xs text-orange-600">尚未儲存</div>}
                    </td>
                    <td className={cellClass}>
                      {result && (
                        <div className={result.ok ? "text-green-700" : "text-red-600"}>
                          {result.message}
                          {"responseHex" in result && result.responseHex && (
                            <div className="font-mono text-xs text-gray-500">回應：{result.responseHex}</div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type CaptureTarget = "entry" | "exit" | "default";

interface CaptureInfo {
  dir: string | null;
  exists: boolean;
  entryDir: string | null;
  entryExists: boolean;
  exitDir: string | null;
  exitExists: boolean;
}

const CAPTURE_ROWS: { target: CaptureTarget; label: string; hint: string }[] = [
  { target: "entry", label: "入口攝影機", hint: "未設定時存到共用資料夾" },
  { target: "exit", label: "出口攝影機", hint: "未設定時存到共用資料夾" },
  { target: "default", label: "共用資料夾", hint: "未指定入口／出口的攝影機，以及入口／出口未設定時使用；清除後不再存照片" },
];

const captureValue = (info: CaptureInfo, target: CaptureTarget) =>
  target === "entry"
    ? { dir: info.entryDir, exists: info.entryExists }
    : target === "exit"
      ? { dir: info.exitDir, exists: info.exitExists }
      : { dir: info.dir, exists: info.exists };

/** 伺服器端資料夾瀏覽，選好後回傳完整路徑 */
function FolderPicker({ initial, onPick, onClose }: { initial: string; onPick: (dir: string) => void; onClose: () => void }) {
  const [current, setCurrent] = useState<{ path: string | null; parent: string | null; entries: { name: string; path: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (p: string | null) => {
    try {
      const url = p ? `/api/parking/capture-settings/browse?path=${encodeURIComponent(p)}` : "/api/parking/capture-settings/browse";
      const json = await api<{ ok?: boolean; error?: string; path: string | null; parent: string | null; entries: { name: string; path: string }[] }>(url);
      if (json.ok === false) return setError(json.error ?? "讀取資料夾失敗");
      setCurrent(json);
      setError(null);
    } catch {
      setError("連不到伺服器");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 開啟時讀取起始資料夾；setState 都在 await 之後
    open(initial || null);
  }, [open, initial]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-medium">選擇資料夾（伺服器主機上）</div>
        <div className="mb-2 break-all rounded bg-gray-50 px-2 py-1 font-mono text-xs">{current?.path ?? "選擇磁碟機"}</div>
        {error && <div className="mb-2 text-red-600">{error}</div>}
        <div className="min-h-40 flex-1 overflow-auto rounded border border-gray-200">
          {current?.path && (
            <button type="button" onClick={() => open(current.parent)} className="block w-full px-3 py-1.5 text-left hover:bg-gray-100">
              ⬆ 上一層
            </button>
          )}
          {current?.entries.map((e) => (
            <button key={e.path} type="button" onClick={() => open(e.path)} className="block w-full px-3 py-1.5 text-left hover:bg-gray-100">
              📁 {e.name}
            </button>
          ))}
          {current && current.entries.length === 0 && <div className="px-3 py-2 text-gray-500">沒有子資料夾</div>}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={smallButtonClass}>
            取消
          </button>
          <button
            type="button"
            onClick={() => current?.path && onPick(current.path)}
            disabled={!current?.path}
            className="rounded bg-[#428bca] px-3 py-1 text-sm text-white hover:bg-[#3071a9] disabled:opacity-50"
          >
            使用這個資料夾
          </button>
        </div>
      </div>
    </div>
  );
}

/** 勾選哪些區網攝影機是入口（或出口）；勾選另一邊已指定的攝影機會把它改過來 */
function CameraPicker({
  role,
  cameras,
  onChange,
  busy,
}: {
  role: CameraRole;
  cameras: CameraInfo[] | null;
  onChange: (sn: string, role: CameraRole | null) => void;
  busy: boolean;
}) {
  const other: CameraRole = role === "entry" ? "exit" : "entry";
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-xs sm:pl-26">
      <span className="shrink-0 font-medium text-gray-700">指定攝影機：</span>
      {!cameras && <span className="text-gray-500">讀取中…</span>}
      {cameras?.length === 0 && (
        <span className="text-gray-500">區網內還沒有攝影機連線過（攝影機連上 MQTT 或上傳過辨識結果後才會出現）</span>
      )}
      {cameras?.map((c) => (
        <label key={c.sn} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={c.role === role}
            disabled={busy}
            onChange={(e) => onChange(c.sn, e.target.checked ? role : null)}
          />
          <span className="font-mono">{c.sn}</span>
          <span className="text-gray-500">
            （{[
              c.deviceType === "SIMULATOR" ? "模擬器" : c.deviceType,
              c.ip ?? (c.online === null ? "HTTP 上傳" : "IP 未知"),
              c.online ? "在線" : c.online === false ? "離線" : null,
            ]
              .filter(Boolean)
              .join("，")}
            ）
          </span>
          {c.role === other && <span className="text-orange-600">目前是{CAMERA_ROLE_LABELS[other]}</span>}
        </label>
      ))}
    </div>
  );
}

function CaptureFolderSettings() {
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<CaptureTarget, string>>>({});
  const [picking, setPicking] = useState<CaptureTarget | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await api<CaptureInfo>("/api/parking/capture-settings");
      setInfo(json);
      setDrafts({ entry: json.entryDir ?? "", exit: json.exitDir ?? "", default: json.dir ?? "" });
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面讀一次設定；setState 都在 await 之後
    load();
  }, [load]);

  const [cameras, setCameras] = useState<CameraInfo[] | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const loadCameras = useCallback(async () => {
    try {
      const json = await api<{ ok: boolean; error?: string; items?: CameraInfo[] }>("/api/parking/cameras");
      if (json.ok) setCameras(json.items ?? []);
      else setCameraError(json.error ?? "讀取攝影機失敗");
    } catch {
      setCameraError("連不到伺服器");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面讀一次攝影機清單；setState 都在 await 之後
    loadCameras();
  }, [loadCameras]);

  const setCameraRole = async (sn: string, role: CameraRole | null) => {
    setCameraBusy(true);
    setCameraError(null);
    try {
      const json = await api<{ ok: boolean; error?: string; items?: CameraInfo[] }>("/api/parking/cameras", {
        method: "PUT",
        body: JSON.stringify({ sn, role }),
      });
      if (json.ok) setCameras(json.items ?? []);
      else setCameraError(json.error ?? "設定攝影機失敗");
    } catch {
      setCameraError("連不到伺服器");
    } finally {
      setCameraBusy(false);
    }
  };

  const save = async (target: CaptureTarget, label: string) => {
    const dir = (drafts[target] ?? "").trim();
    try {
      const json = dir
        ? await api<{ ok: boolean; error?: string; dir?: string }>("/api/parking/capture-settings", {
            method: "POST",
            body: JSON.stringify({ dir, target }),
          })
        : await api<{ ok: boolean; error?: string }>(`/api/parking/capture-settings?target=${target}`, { method: "DELETE" });
      setMessage(json.ok ? { ok: true, text: dir ? `${label}照片資料夾已設定` : `${label}照片資料夾已清除` } : { ok: false, text: json.error ?? "儲存失敗" });
      await load();
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    }
  };

  return (
    <section className="space-y-2">
      <div className="text-xs text-gray-700">辨識攝影機照片儲存位置</div>
      <p className="text-xs text-gray-500">
        資料夾在執行伺服器的主機上，不存在會自動建立。入口、出口各自勾選要使用的區網攝影機（可複選，例如有兩個入口）；
        入口攝影機辨識到車牌會新增進場紀錄，出口攝影機辨識到會設定出場。
      </p>
      {message && <div className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</div>}
      {!info && <div className="text-gray-500">讀取中…</div>}
      {info && (
        <div className="space-y-3">
          {CAPTURE_ROWS.map(({ target, label, hint }) => {
            const { dir, exists } = captureValue(info, target);
            const draft = drafts[target] ?? "";
            return (
              <div key={target} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 font-medium">{label}</span>
                  <input
                    value={draft}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [target]: e.target.value }))}
                    placeholder="例如 D:\停車照片\入口"
                    className={`${inputClass} min-w-0 flex-1 font-mono`}
                  />
                  <button type="button" onClick={() => setPicking(target)} className={smallButtonClass}>
                    瀏覽…
                  </button>
                  <button type="button" onClick={() => save(target, label)} disabled={draft.trim() === (dir ?? "")} className={smallButtonClass}>
                    {draft.trim() || !dir ? "儲存" : "清除"}
                  </button>
                </div>
                <div className="pl-26 text-xs text-gray-500 sm:pl-26">
                  {dir ? (
                    <>
                      目前：<span className="font-mono">{dir}</span>{" "}
                      {exists ? <span className="text-green-700">（資料夾存在）</span> : <span className="text-red-600">（資料夾不存在）</span>}
                    </>
                  ) : (
                    `目前未設定，${hint}`
                  )}
                </div>
                {target !== "default" && (
                  <CameraPicker
                    role={target}
                    cameras={cameras}
                    onChange={setCameraRole}
                    busy={cameraBusy}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {cameraError && <div className="text-red-600">{cameraError}</div>}
      {picking && (
        <FolderPicker
          initial={drafts[picking] || info?.dir || ""}
          onClose={() => setPicking(null)}
          onPick={(dir) => {
            setDrafts((prev) => ({ ...prev, [picking]: dir }));
            setPicking(null);
          }}
        />
      )}
    </section>
  );
}

export function DatabaseSettings() {
  return (
    <div className="space-y-6 text-sm text-gray-900">
      <p className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">
        這頁的設定都存在 MongoDB 的 carpark 資料庫（COM port：cash_device_config；入口／出口攝影機：devices；照片資料夾：system_settings），
        伺服器啟動時自動讀取，不需要每次重新設定。
      </p>
      <CashDeviceSettings />
      <hr className="border-gray-200" />
      <CaptureFolderSettings />
    </div>
  );
}
