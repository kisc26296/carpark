"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  formatDateTime,
  toDateTimeLocal,
  type ParkingEntry,
} from "@/lib/parking/parking-entry-shared";
import { GateAndCapacity } from "./gate-capacity";

// 車輛進場紀錄：資料存在 MongoDB carpark.parking_entries。
// 入口攝影機辨識到車牌會自動新增、出口攝影機辨識到會自動設定出場（入口 / 出口在「資料庫設定」指定），頁面每 5 秒自動更新。

const grayButtonClass = "rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200";
const smallButtonClass =
  "whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50";
const inputClass = "rounded border border-gray-300 bg-white px-2 py-1";
const cellClass = "border border-gray-200 px-1.5 py-1";

const REFRESH_MS = 5000;

type Scope = "inside" | "all";

async function api<T = { ok: boolean; error?: string }>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  return res.json();
}

/** datetime-local 的本地時間轉 ISO，伺服器和瀏覽器時區不同也不會差時 */
const localToIso = (value: string) => new Date(value).toISOString();

function AddEntryForm({ onDone }: { onDone: (message: string) => void }) {
  const [plate, setPlate] = useState("");
  const [entryTime, setEntryTime] = useState(() => toDateTimeLocal(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const json = await api<{ ok: boolean; error?: string; item?: ParkingEntry }>("/api/parking/entries", {
        method: "POST",
        body: JSON.stringify({ plate, entryTime: localToIso(entryTime) }),
      });
      if (json.ok && json.item) onDone(`已新增 ${json.item.plate}（編號 ${json.item.no}）`);
      else setError(json.error ?? "新增失敗");
    } catch {
      setError("連不到伺服器");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-3">
      <label className="flex items-center gap-1">
        車牌
        <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={`${inputClass} w-32`} autoFocus />
      </label>
      <label className="flex items-center gap-1">
        入場時間
        <input
          type="datetime-local"
          step={1}
          value={entryTime}
          onChange={(e) => setEntryTime(e.target.value)}
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={busy || !plate.trim()} className={smallButtonClass}>
        確定新增
      </button>
      <button type="button" onClick={() => onDone("")} className={smallButtonClass}>
        取消
      </button>
      {error && <span className="w-full text-red-600">{error}</span>}
    </form>
  );
}

/** 修改車牌與入場時間的列內表單 */
function EditCells({
  entry,
  onDone,
}: {
  entry: ParkingEntry;
  onDone: (result: { message?: string; error?: string } | null) => void;
}) {
  const [plate, setPlate] = useState(entry.plate);
  const [entryTime, setEntryTime] = useState(() => toDateTimeLocal(entry.entryTime));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const json = await api("/api/parking/entries", {
        method: "PATCH",
        body: JSON.stringify({ id: entry.id, plate, entryTime: localToIso(entryTime) }),
      });
      onDone(json.ok ? { message: `已修改編號 ${entry.no}` } : { error: json.error ?? "修改失敗" });
    } catch {
      onDone({ error: "連不到伺服器" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={`${inputClass} w-28`} />
      <input
        type="datetime-local"
        step={1}
        value={entryTime}
        onChange={(e) => setEntryTime(e.target.value)}
        className={inputClass}
      />
      <button type="button" onClick={save} disabled={busy || !plate.trim()} className={smallButtonClass}>
        儲存
      </button>
      <button type="button" onClick={() => onDone(null)} className={smallButtonClass}>
        取消
      </button>
    </div>
  );
}

/** 車號校正標記：攝影機認錯已依台灣車牌格式修正、或格式不符需要人工確認；滑鼠移上去看說明 */
function PlateBadge({ entry }: { entry: ParkingEntry }) {
  if (!entry.plateValid) {
    return (
      <span title={entry.plateNote ?? undefined} className="whitespace-nowrap rounded bg-red-100 px-1.5 text-xs text-red-700">
        格式異常
      </span>
    );
  }
  if (entry.plateRaw) {
    return (
      <span title={entry.plateNote ?? undefined} className="whitespace-nowrap rounded bg-amber-100 px-1.5 text-xs text-amber-800">
        已修正（原 {entry.plateRaw}）
      </span>
    );
  }
  return null;
}

/** 手動新增（沒有攝影機照片）的車輛顯示的預設圖片，放在 public/images */
const MANUAL_ENTRY_IMAGE = "/images/manual-entry.jpg";

/** 場內車輛查詢的照片卡片：入場照片 + 車號；點照片另開視窗看原圖 */
function PhotoCard({ entry }: { entry: ParkingEntry }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/parking/entries/image?id=${entry.id}&kind=entry`;
  // 手動新增的紀錄沒有攝影機照片，不用發請求
  const hasImage = !!(entry.entryImagePath || entry.entryResultId) && !failed;

  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-white">
      {hasImage ? (
        <a href={src} target="_blank" rel="noreferrer" title="另開視窗看原圖">
          {/* eslint-disable-next-line @next/next/no-img-element -- 照片由 API 從本機檔案讀出，不經過 next/image 最佳化 */}
          <img
            src={src}
            alt={`${entry.plate} 入場照片`}
            loading="lazy"
            onError={() => setFailed(true)}
            className="aspect-video w-full bg-gray-100 object-contain"
          />
        </a>
      ) : entry.source === "manual" ? (
        // 手動新增的車輛沒有攝影機照片，顯示預設圖片
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- 小張預設圖，直接用 img 顯示 */}
          <img
            src={MANUAL_ENTRY_IMAGE}
            alt="手動新增的車輛（預設圖片）"
            className="aspect-video w-full bg-white object-contain"
          />
          <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 text-xs text-white">手動新增</span>
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-gray-100 text-gray-500">找不到照片</div>
      )}
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-wider">{entry.plate}</span>
          <PlateBadge entry={entry} />
        </span>
        <span className="text-xs text-gray-500">#{entry.no}</span>
      </div>
      <div className="px-3 pb-2 text-xs text-gray-600">入場 {formatDateTime(entry.entryTime)}</div>
    </div>
  );
}

export function EntryRecords() {
  const [items, setItems] = useState<ParkingEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("inside");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [showPhotos, setShowPhotos] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ scope, plate: query });
      const json = await api<{ ok: boolean; error?: string; items?: ParkingEntry[] }>(`/api/parking/entries?${params}`);
      if (json.ok) {
        setItems(json.items ?? []);
        setLoadError(null);
      } else {
        setLoadError(json.error ?? "讀取失敗");
      }
    } catch {
      setLoadError("連不到伺服器");
    }
  }, [scope, query]);

  // 攝影機自動建立的紀錄靠定時重新讀取顯示；修改中暫停，避免畫面跳動
  useEffect(() => {
    if (editingId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 進入頁面先讀一次，之後定時重新讀取；setState 都在 await 之後
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, editingId]);

  const act = async (request: Promise<{ ok: boolean; error?: string }>, success: string) => {
    try {
      const json = await request;
      setMessage(json.ok ? { ok: true, text: success } : { ok: false, text: json.error ?? "操作失敗" });
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    }
    load();
  };

  const exit = (r: ParkingEntry) => {
    if (!window.confirm(`確定把 ${r.plate}（編號 ${r.no}）設定為已出場？`)) return;
    act(api("/api/parking/entries", { method: "PATCH", body: JSON.stringify({ id: r.id, action: "exit" }) }), `${r.plate} 已設定出場`);
  };

  const remove = (r: ParkingEntry) => {
    if (!window.confirm(`確定刪除 ${r.plate}（編號 ${r.no}）的進場紀錄？刪除後無法復原。`)) return;
    act(api(`/api/parking/entries?id=${r.id}`, { method: "DELETE" }), `已刪除編號 ${r.no}`);
  };

  const onEdited = (result: { message?: string; error?: string } | null) => {
    if (result?.message) {
      setEditingId(null);
      setMessage({ ok: true, text: result.message });
    } else if (result?.error) {
      setMessage({ ok: false, text: result.error });
    } else {
      setEditingId(null);
    }
  };

  // 按「場內車輛查詢」：只查場內車輛，並用照片卡片顯示；沒輸入車牌就顯示全部場內車輛
  const search = (e: FormEvent) => {
    e.preventDefault();
    setShowPhotos(true);
    // 條件沒變時 load 不會因為 state 改變而重跑，手動讀一次
    if (scope === "inside" && query === keyword) load();
    setScope("inside");
    setQuery(keyword);
  };

  const exitCell = (r: ParkingEntry) =>
    r.exited ? (
      <span title={r.exitNote ?? undefined} className="whitespace-nowrap text-gray-600">
        {formatDateTime(r.exitTime) || "已出場"}
        {r.exitNote && <span className="block text-xs text-gray-500">{r.exitNote}</span>}
      </span>
    ) : (
      <button type="button" onClick={() => exit(r)} className={smallButtonClass}>
        設定已出場
      </button>
    );

  const sourceTag = (r: ParkingEntry) => (
    <span className="text-xs text-gray-500" title={r.entryDeviceSn ?? undefined}>
      {r.source === "auto" ? "自動" : "手動"}
    </span>
  );

  return (
    <div className="space-y-4 text-sm text-gray-900">
      <GateAndCapacity />
      <hr className="border-gray-200" />
      <div>
        <div className="text-xs text-gray-700">車輛進場紀錄</div>
        <form className="mt-1 flex" onSubmit={search}>
          <span className="flex items-center rounded-l border border-gray-300 bg-gray-100 px-3">車牌</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value.toUpperCase())}
            placeholder="車牌（可輸入部分）"
            className="min-w-0 flex-1 border-y border-gray-300 px-3 py-1.5"
          />
          <button type="submit" className="whitespace-nowrap rounded-r border border-gray-300 bg-gray-100 px-3 hover:bg-gray-200">
            場內車輛查詢
          </button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">
            <input type="radio" checked={scope === "inside"} onChange={() => setScope("inside")} />
            場內車輛
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={scope === "all"}
              onChange={() => {
                setScope("all");
                setShowPhotos(false);
              }}
            />
            全部紀錄（含已出場，最近 200 筆）
          </label>
          {query && (
            <button
              type="button"
              onClick={() => {
                setKeyword("");
                setQuery("");
              }}
              className={smallButtonClass}
            >
              清除查詢「{query}」
            </button>
          )}
        </div>
      </div>

      <hr className="border-gray-200" />
      {adding ? (
        <AddEntryForm
          onDone={(text) => {
            setAdding(false);
            if (text) setMessage({ ok: true, text });
            load();
          }}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={grayButtonClass}>
          手動新增場內車輛
        </button>
      )}
      <hr className="border-gray-200" />

      {message && <div className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</div>}
      {loadError && <div className="text-red-600">讀取進場紀錄失敗：{loadError}</div>}
      {!items && !loadError && <div className="text-gray-500">讀取中…</div>}
      {items?.length === 0 && (
        <div className="text-gray-500">{query ? `找不到車牌含「${query}」的紀錄。` : scope === "inside" ? "目前場內沒有車輛。" : "尚無進場紀錄。"}</div>
      )}

      {showPhotos && scope === "inside" && items && items.length > 0 && (
        <section className="space-y-2 rounded border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">
              {query ? `場內車輛查詢「${query}」` : "全部場內車輛"}：共 {items.length} 台
            </div>
            <button type="button" onClick={() => setShowPhotos(false)} className={smallButtonClass}>
              收起照片
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((r) => (
              <PhotoCard key={r.id} entry={r} />
            ))}
          </div>
        </section>
      )}

      {items && items.length > 0 && (
        <>
          <div className="text-xs text-gray-500">
            共 {items.length} 筆，每 {REFRESH_MS / 1000} 秒自動更新
          </div>

          {/* 手機、平板：卡片清單 */}
          <ul className="space-y-2 lg:hidden">
            {items.map((r) => (
              <li key={r.id} className="rounded border border-gray-200 p-3">
                {editingId === r.id ? (
                  <EditCells entry={r} onDone={onEdited} />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base font-medium">
                      {r.plate}
                      {sourceTag(r)}
                      <PlateBadge entry={r} />
                      <button type="button" onClick={() => setEditingId(r.id)} className={smallButtonClass}>
                        修改
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">#{r.no}</span>
                  </div>
                )}
                <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-y-0.5">
                  <dt className="text-gray-500">入場時間</dt>
                  <dd>{formatDateTime(r.entryTime)}</dd>
                  <dt className="text-gray-500">繳費時間</dt>
                  <dd>{formatDateTime(r.payTime) || "-"}</dd>
                  <dt className="text-gray-500">發票號碼</dt>
                  <dd>{r.invoiceNo || "-"}</dd>
                  <dt className="text-gray-500">金額</dt>
                  <dd>{r.amount ?? "-"}</dd>
                  <dt className="text-gray-500">出場</dt>
                  <dd>{r.exited ? formatDateTime(r.exitTime) || "已出場" : "場內"}</dd>
                </dl>
                <div className="mt-2 flex gap-2">
                  {!r.exited && exitCell(r)}
                  <button type="button" onClick={() => remove(r)} className={smallButtonClass}>
                    刪除
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* 電腦：表格；視窗偏窄時在框內左右捲動，不撐破頁面 */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[960px] border-collapse border border-gray-200 text-base">
              <thead>
                <tr className="bg-[#e8c35f] text-left">
                  {["編號", "入場時間", "繳費時間", "發票號碼", "金額", "車牌", "出場", "刪除"].map((h) => (
                    <th key={h} className={`${cellClass} font-medium`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className={cellClass}>{r.no}</td>
                    {editingId === r.id ? (
                      <td className={cellClass} colSpan={5}>
                        <EditCells entry={r} onDone={onEdited} />
                      </td>
                    ) : (
                      <>
                        <td className={`${cellClass} whitespace-nowrap`}>{formatDateTime(r.entryTime)}</td>
                        <td className={`${cellClass} whitespace-nowrap`}>{formatDateTime(r.payTime)}</td>
                        <td className={cellClass}>{r.invoiceNo}</td>
                        <td className={cellClass}>{r.amount ?? ""}</td>
                        <td className={cellClass}>
                          <div className="flex items-center gap-2">
                            {r.plate}
                            {sourceTag(r)}
                            <PlateBadge entry={r} />
                            <button type="button" onClick={() => setEditingId(r.id)} className={smallButtonClass}>
                              修改
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                    <td className={cellClass}>{exitCell(r)}</td>
                    <td className={cellClass}>
                      <button type="button" onClick={() => remove(r)} className={smallButtonClass}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
