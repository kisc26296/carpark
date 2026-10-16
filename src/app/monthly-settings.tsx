"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  DEFAULT_SCHEDULE,
  formatDate,
  formatSchedule,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  type MonthlyRental,
  type MonthlySchedule,
} from "@/lib/parking/monthly-rental-shared";

// 月租設定：月租客戶列表 + 新增 / 編輯表單，資料存在 MongoDB carpark.monthly_rentals

const grayButtonClass = "rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200";
const smallButtonClass = "whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100";
const inputClass = "w-full min-w-0 rounded border border-gray-300 bg-white px-2 py-1.5";
const cellClass = "border border-gray-200 px-1.5 py-1";

/** 表單用的資料：編號用字串，留空代表自動給號 */
type Draft = Omit<MonthlyRental, "no" | "createdAt" | "updatedAt"> & { no: string };

const today = () => new Date().toLocaleDateString("sv-SE");

/** 預設月租一個月：結束日 = 開始日加一個月再減一天 */
function oneMonthLater(start: string): string {
  const d = new Date(`${start}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE");
}

const emptyDraft = (): Draft => {
  const start = today();
  return {
    no: "",
    name: "",
    phone1: "",
    phone2: "",
    address: "",
    plates: ["", "", "", ""],
    startDate: start,
    endDate: oneMonthLater(start),
    disabled: false,
    schedule: DEFAULT_SCHEDULE,
  };
};

const toDraft = (r: MonthlyRental): Draft => ({ ...r, no: String(r.no), plates: [...r.plates] });

async function saveRental(draft: Draft): Promise<{ ok: boolean; error?: string; item?: MonthlyRental }> {
  const res = await fetch("/api/parking/monthly-rentals", {
    method: draft.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...draft, no: draft.no.trim() === "" ? null : draft.no }),
  });
  return res.json();
}

/** 框線標題置中的區塊，對應截圖的「基本資料」「車牌資料」「月租資料」 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded border border-gray-300 px-3 pt-1 pb-4 sm:px-6">
      <legend className="mx-auto px-2 text-lg font-medium">{title}</legend>
      <div className="mx-auto mt-2 max-w-3xl space-y-2">{children}</div>
    </fieldset>
  );
}

/** 標題 + 輸入框；手機上下排、電腦左右排 */
function LabeledInput({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="shrink-0 text-sm sm:w-24 sm:text-right">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </label>
  );
}

function ScheduleEditor({ value, onChange }: { value: MonthlySchedule; onChange: (s: MonthlySchedule) => void }) {
  const setDays = (days: number[]) => onChange({ ...value, days: [...days].sort((a, b) => a - b) });
  const toggleDay = (day: number, checked: boolean) =>
    setDays(checked ? [...value.days, day] : value.days.filter((d) => d !== day));

  return (
    <div className="space-y-3 rounded border border-gray-200 bg-white/60 p-3">
      <div className="font-medium">月租時段</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {WEEKDAY_ORDER.map((day) => (
          <label key={day} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={value.days.includes(day)}
              onChange={(e) => toggleDay(day, e.target.checked)}
            />
            星期{WEEKDAY_LABELS[day]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} className={smallButtonClass}>
          每天
        </button>
        <button type="button" onClick={() => setDays([1, 2, 3, 4, 5])} className={smallButtonClass}>
          平日（一～五）
        </button>
        <button type="button" onClick={() => setDays([0, 6])} className={smallButtonClass}>
          假日（六、日）
        </button>
        <button type="button" onClick={() => setDays([])} className={smallButtonClass}>
          清除
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1">
          <input type="radio" checked={value.allDay} onChange={() => onChange({ ...value, allDay: true })} />
          全天
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={!value.allDay} onChange={() => onChange({ ...value, allDay: false })} />
          指定時段
        </label>
        <div className="flex items-center gap-1">
          <input
            type="time"
            value={value.start}
            disabled={value.allDay}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            className={`${inputClass} w-32 disabled:bg-gray-100 disabled:text-gray-400`}
          />
          ～
          <input
            type="time"
            value={value.end}
            disabled={value.allDay}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            className={`${inputClass} w-32 disabled:bg-gray-100 disabled:text-gray-400`}
          />
        </div>
      </div>
      <div className="text-xs text-gray-600">
        目前設定：{value.days.length ? formatSchedule(value) : "未選星期"}
        {!value.allDay && "。結束時間早於開始時間代表跨夜，例如 22:00～06:00"}
      </div>
    </div>
  );
}

function RentalForm({
  initial,
  onSaved,
  onClose,
}: {
  initial: Draft;
  onSaved: (item: MonthlyRental) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial.id;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setPlate = (i: number, value: string) =>
    setDraft((d) => ({ ...d, plates: d.plates.map((p, j) => (j === i ? value.toUpperCase() : p)) as Draft["plates"] }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const json = await saveRental(draft);
      if (json.ok && json.item) onSaved(json.item);
      else setError(json.error ?? "儲存失敗");
    } catch {
      setError("連不到伺服器");
    } finally {
      setBusy(false);
    }
  };

  const text = (key: "name" | "phone1" | "phone2" | "address", props?: object) => (
    <input value={draft[key]} onChange={(e) => set(key, e.target.value)} className={inputClass} {...props} />
  );

  return (
    <form onSubmit={submit} className="space-y-5 text-sm text-gray-900">
      <h2 className="text-base font-medium">{isNew ? "新增月租客戶" : `編輯月租客戶（編號 ${initial.no}）`}</h2>

      <Section title="基本資料">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <LabeledInput label="編號">
            <input
              value={draft.no}
              onChange={(e) => set("no", e.target.value)}
              inputMode="numeric"
              placeholder={isNew ? "留空自動給號" : undefined}
              className={inputClass}
            />
          </LabeledInput>
          <LabeledInput label="承租人名稱">{text("name")}</LabeledInput>
          <LabeledInput label="電話1">{text("phone1", { type: "tel" })}</LabeledInput>
          <LabeledInput label="電話2">{text("phone2", { type: "tel" })}</LabeledInput>
        </div>
        <LabeledInput label="住址">{text("address")}</LabeledInput>
      </Section>

      <Section title="車牌資料">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {draft.plates.map((plate, i) => (
            <LabeledInput key={i} label={`車牌${i + 1}`}>
              <input value={plate} onChange={(e) => setPlate(i, e.target.value)} className={`${inputClass} uppercase`} />
            </LabeledInput>
          ))}
        </div>
      </Section>

      <Section title="月租資料">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <LabeledInput label="開始有效日期">
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              className={inputClass}
            />
          </LabeledInput>
          <LabeledInput label="結束有效日期">
            <input type="date" value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputClass} />
          </LabeledInput>
          <LabeledInput label="停用標籤">
            <select
              value={draft.disabled ? "yes" : "no"}
              onChange={(e) => set("disabled", e.target.value === "yes")}
              className={`${inputClass} w-24`}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </LabeledInput>
        </div>
        <ScheduleEditor value={draft.schedule} onChange={(s) => set("schedule", s)} />
      </Section>

      {error && <div className="text-center text-red-600">{error}</div>}

      <div className="flex justify-center">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isNew ? "確認新增" : "確認修改"}
        </button>
      </div>

      <div className="flex justify-end border-t border-gray-200 pt-3">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100">
          關閉
        </button>
      </div>
    </form>
  );
}

const COLUMNS = [
  "編修",
  "編號",
  "承租人名稱",
  "電話1",
  "車牌1",
  "開始有效日期",
  "結束有效日期",
  "月租時段",
  "停用標籤",
  "電話2",
  "住址",
  "車牌2",
  "車牌3",
  "車牌4",
];

export function MonthlySettings() {
  const [items, setItems] = useState<MonthlyRental[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/parking/monthly-rentals")
      .then((res) => res.json())
      .then((json) => (json.ok ? setItems(json.items) : setLoadError(json.error)))
      .catch(() => setLoadError("連不到伺服器"));
  }, []);

  const open = (draft: Draft) => {
    setMessage(null);
    setEditing(draft);
  };

  const onSaved = (item: MonthlyRental) => {
    const isNew = !editing?.id;
    setItems((prev) => {
      const rest = (prev ?? []).filter((r) => r.id !== item.id);
      return [...rest, item].sort((a, b) => a.no - b.no);
    });
    setEditing(null);
    setMessage(isNew ? `已新增編號 ${item.no}` : `已修改編號 ${item.no}`);
  };

  if (editing) {
    return <RentalForm initial={editing} onSaved={onSaved} onClose={() => setEditing(null)} />;
  }

  const editButton = (r: MonthlyRental) => (
    <button type="button" onClick={() => open(toDraft(r))} className={smallButtonClass}>
      編輯
    </button>
  );

  return (
    <div className="space-y-4 text-sm text-gray-900">
      <div>
        <div className="text-xs text-gray-700">月租設定</div>
        <button type="button" onClick={() => open(emptyDraft())} className={`${grayButtonClass} mt-1`}>
          新增月租客戶
        </button>
      </div>

      <hr className="border-gray-200" />

      {message && <div className="text-green-700">{message}</div>}
      {loadError && <div className="text-red-600">讀取月租資料失敗：{loadError}</div>}
      {!items && !loadError && <div className="text-gray-500">讀取中…</div>}
      {items?.length === 0 && <div className="text-gray-500">尚無月租客戶，按「新增月租客戶」建立第一筆。</div>}

      {items && items.length > 0 && (
        <>
          {/* 手機、平板：卡片清單 */}
          <ul className="space-y-2 lg:hidden">
            {items.map((r) => (
              <li key={r.id} className="rounded border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-base font-medium">
                    {r.plates.filter(Boolean).join("、")}
                    {editButton(r)}
                  </div>
                  <span className="text-xs text-gray-500">#{r.no}</span>
                </div>
                <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-y-0.5">
                  <dt className="text-gray-500">承租人名稱</dt>
                  <dd>{r.name || "-"}</dd>
                  <dt className="text-gray-500">電話</dt>
                  <dd>{[r.phone1, r.phone2].filter(Boolean).join("、") || "-"}</dd>
                  <dt className="text-gray-500">有效日期</dt>
                  <dd>
                    {formatDate(r.startDate)}～{formatDate(r.endDate)}
                  </dd>
                  <dt className="text-gray-500">月租時段</dt>
                  <dd>{formatSchedule(r.schedule)}</dd>
                  <dt className="text-gray-500">停用標籤</dt>
                  <dd className={r.disabled ? "text-red-600" : ""}>{r.disabled ? "Yes" : "No"}</dd>
                </dl>
              </li>
            ))}
          </ul>

          {/* 電腦：表格；視窗偏窄時在框內左右捲動，不撐破頁面 */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1200px] border-collapse border border-gray-200 text-base">
              <thead>
                <tr className="bg-[#e8c35f] text-left">
                  {COLUMNS.map((h) => (
                    <th key={h} className={`${cellClass} font-medium whitespace-nowrap`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className={cellClass}>{editButton(r)}</td>
                    <td className={cellClass}>{r.no}</td>
                    <td className={cellClass}>{r.name}</td>
                    <td className={cellClass}>{r.phone1}</td>
                    <td className={cellClass}>{r.plates[0]}</td>
                    <td className={`${cellClass} whitespace-nowrap`}>{formatDate(r.startDate)}</td>
                    <td className={`${cellClass} whitespace-nowrap`}>{formatDate(r.endDate)}</td>
                    <td className={`${cellClass} whitespace-nowrap`}>{formatSchedule(r.schedule)}</td>
                    <td className={`${cellClass} ${r.disabled ? "text-red-600" : ""}`}>{r.disabled ? "Yes" : "No"}</td>
                    <td className={cellClass}>{r.phone2}</td>
                    <td className={cellClass}>{r.address}</td>
                    <td className={cellClass}>{r.plates[1]}</td>
                    <td className={cellClass}>{r.plates[2]}</td>
                    <td className={cellClass}>{r.plates[3]}</td>
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
