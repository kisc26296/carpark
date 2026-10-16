"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  calculateFee,
  parseRow,
  PAYMENT_METHODS,
  RATE_WEEKDAYS,
  SINGLE_CHARGE_CODE_PATTERN,
  type FeeResult,
  type RateRow,
  type RateSettings as RateSettingsData,
} from "@/lib/parking/rate-shared";
import { toDateTimeLocal } from "@/lib/parking/parking-entry-shared";

// 費率設定：存在 MongoDB carpark.system_settings（_id: "rate"），下方可用目前畫面上的設定試算停車費
// 單次收費（4 位數代碼 + 金額）也存在同一筆設定，繳費機輸入代碼查詢金額

const inputClass = "border border-gray-400 px-1 py-0.5";
const cellInputClass = "w-full border border-gray-400 px-1 py-0.5";
const buttonClass = "rounded bg-sky-400 px-4 py-2 text-lg text-white hover:bg-sky-500 disabled:opacity-50";
const smallButtonClass = "whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100";

const ROW_FIELDS: { key: keyof RateRow; label: string }[] = [
  { key: "start", label: "開始時間" },
  { key: "end", label: "結束時間" },
  { key: "unit", label: "單位(分)" },
  { key: "amount", label: "金額(元)" },
  { key: "max", label: "最高收費" },
];

/** 表單裡數字欄位用字串，才能讓使用者清空再輸入 */
type Draft = Omit<
  RateSettingsData,
  "entryBufferMinutes" | "exitBufferMinutes" | "unitMinutes" | "unitAmount" | "dailyMax" | "singleCharges"
> & {
  entryBufferMinutes: string;
  exitBufferMinutes: string;
  unitMinutes: string;
  unitAmount: string;
  dailyMax: string;
  singleCharges: { code: string; amount: string }[];
};

const toDraft = (s: RateSettingsData): Draft => ({
  ...s,
  entryBufferMinutes: String(s.entryBufferMinutes),
  exitBufferMinutes: String(s.exitBufferMinutes),
  unitMinutes: String(s.unitMinutes),
  unitAmount: String(s.unitAmount),
  dailyMax: String(s.dailyMax),
  weekdays: s.weekdays.map((rows) => rows.map((r) => ({ ...r }))),
  singleCharges: s.singleCharges.map((c) => ({ code: c.code, amount: String(c.amount) })),
});

const fromDraft = (d: Draft): RateSettingsData => ({
  ...d,
  entryBufferMinutes: Number(d.entryBufferMinutes),
  exitBufferMinutes: Number(d.exitBufferMinutes),
  unitMinutes: Number(d.unitMinutes),
  unitAmount: Number(d.unitAmount),
  dailyMax: Number(d.dailyMax),
  // 金額空白時送 NaN（JSON 變 null），讓伺服器檢查擋下，不要默默變成 0 元
  singleCharges: d.singleCharges.map((c) => ({
    code: c.code.trim(),
    amount: c.amount.trim() === "" ? NaN : Number(c.amount),
  })),
});

// 標題 + 輸入框一列：手機上下排、電腦左右排，皆靠左對齊
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="font-medium sm:w-36 sm:shrink-0">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-md rounded border border-gray-300 px-3 py-2"
      />
    </label>
  );
}

function FeeTrial({ settings }: { settings: RateSettingsData | null }) {
  const [entry, setEntry] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 2, 0, 0, 0);
    return toDateTimeLocal(d).slice(0, 16);
  });
  const [exit, setExit] = useState(() => toDateTimeLocal(new Date()).slice(0, 16));

  const result: FeeResult | string | null = useMemo(() => {
    if (!settings) return null;
    const a = new Date(entry);
    const b = new Date(exit);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "請輸入進場與出場時間";
    if (b <= a) return "出場時間必須晚於進場時間";
    if (b.getTime() - a.getTime() > 366 * 24 * 3600 * 1000) return "停車時間超過一年，請確認時間";
    return calculateFee(settings, a, b);
  }, [settings, entry, exit]);

  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${toDateTimeLocal(d).slice(11, 16)}`;

  return (
    <div className="space-y-3 rounded border border-gray-200 bg-white/60 p-3">
      <div className="font-medium">費用試算（用目前畫面上的設定計算，尚未儲存的修改也會套用）</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          進場
          <input type="datetime-local" value={entry} onChange={(e) => setEntry(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-center gap-1">
          出場
          <input type="datetime-local" value={exit} onChange={(e) => setExit(e.target.value)} className={inputClass} />
        </label>
      </div>
      {typeof result === "string" && <div className="text-red-600">{result}</div>}
      {result && typeof result !== "string" && (
        <div className="space-y-2">
          <div className="text-lg">
            停車 {Math.floor(result.minutes / 60)} 小時 {result.minutes % 60} 分，應收{" "}
            <span className="text-2xl font-bold text-red-600">{result.total}</span> 元
            {result.free && <span className="ml-2 text-green-700">（在進場緩衝時間內，免費）</span>}
          </div>
          {result.days.map((day, i) => (
            <div key={i} className="rounded border border-gray-200 bg-white p-2">
              <div className="font-medium">
                第 {i + 1} 天：{fmt(day.start)} ～ {fmt(day.end)}，小計 {day.amount} 元
                {day.capped && <span className="ml-1 text-orange-600">（{day.raw} 元，超過單日最高收費）</span>}
              </div>
              <ul className="mt-1 list-disc pl-5 text-gray-700">
                {day.items.map((it, j) => (
                  <li key={j}>
                    {it.label}：{it.minutes} 分 → {it.units} 單位 = {it.raw} 元
                    {it.capped && <span className="text-orange-600">，時段最高收費 {it.amount} 元</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RateSettings() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [weekday, setWeekday] = useState(6);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/parking/rate")
      .then((res) => res.json())
      .then((json: { ok: boolean; error?: string; settings?: RateSettingsData & { updatedAt: string | null } }) => {
        if (!json.ok || !json.settings) return setMessage({ ok: false, text: json.error ?? "讀取費率設定失敗" });
        const { updatedAt: at, ...settings } = json.settings;
        const d = toDraft(settings);
        setDraft(d);
        setSaved(JSON.stringify(d));
        setUpdatedAt(at);
      })
      .catch(() => setMessage({ ok: false, text: "連不到伺服器" }));
  }, []);

  const settings = useMemo(() => (draft ? fromDraft(draft) : null), [draft]);

  if (!draft) {
    return <div className="text-sm text-gray-500">{message ? <span className="text-red-600">{message.text}</span> : "讀取中…"}</div>;
  }

  const dirty = JSON.stringify(draft) !== saved;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => d && { ...d, [key]: value });
  const setCell = (row: number, key: keyof RateRow, value: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          weekdays: d.weekdays.map((rows, w) =>
            w === weekday ? rows.map((r, i) => (i === row ? { ...r, [key]: value } : r)) : rows,
          ),
        },
    );
  const setCharge = (index: number, key: "code" | "amount", value: string) =>
    setDraft(
      (d) => d && { ...d, singleCharges: d.singleCharges.map((c, i) => (i === index ? { ...c, [key]: value } : c)) },
    );
  const addCharge = () => setDraft((d) => d && { ...d, singleCharges: [...d.singleCharges, { code: "", amount: "" }] });
  const removeCharge = (index: number) =>
    setDraft((d) => d && { ...d, singleCharges: d.singleCharges.filter((_, i) => i !== index) });
  const copyToAllDays = () => {
    if (!window.confirm(`把${RATE_WEEKDAYS[weekday]}的時段設定複製到其他每一天？`)) return;
    setDraft((d) => d && { ...d, weekdays: d.weekdays.map(() => d.weekdays[weekday].map((r) => ({ ...r }))) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/parking/rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fromDraft(draft)),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; settings?: RateSettingsData & { updatedAt: string | null } };
      if (json.ok && json.settings) {
        const { updatedAt: at, ...s } = json.settings;
        const d = toDraft(s);
        setDraft(d);
        setSaved(JSON.stringify(d));
        setUpdatedAt(at);
        setMessage({ ok: true, text: "費率設定已儲存" });
      } else {
        setMessage({ ok: false, text: json.error ?? "儲存失敗" });
      }
    } catch {
      setMessage({ ok: false, text: "連不到伺服器" });
    } finally {
      setBusy(false);
    }
  };

  // 有設定時段的星期幾在選項旁加註，方便看出哪幾天用預設費率
  const daysWithRows = draft.weekdays.map((rows) => rows.some((r) => parseRow(r) !== null));

  return (
    <form className="space-y-5 text-sm text-gray-900" onSubmit={submit}>
      <div>
        <div className="text-xs text-gray-700">支付方式</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {PAYMENT_METHODS.map((m) => (
            <label key={m.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.paymentMethods.includes(m.id)}
                onChange={(e) =>
                  set(
                    "paymentMethods",
                    PAYMENT_METHODS.map((p) => p.id).filter((id) =>
                      id === m.id ? e.target.checked : draft.paymentMethods.includes(id),
                    ),
                  )
                }
              />
              {m.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">勾選啟用的支付方式才會顯示在繳費機的繳費畫面；目前只有現金結帳接上收款設備</p>
      </div>

      <hr className="border-gray-200" />
      <div>
        <div className="text-xs text-gray-700">固定費率</div>
        <div className="mt-2 space-y-3">
          <Field label="進場緩衝(分):" value={draft.entryBufferMinutes} onChange={(v) => set("entryBufferMinutes", v)} />
          <Field label="離場結帳緩衝(分):" value={draft.exitBufferMinutes} onChange={(v) => set("exitBufferMinutes", v)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        停車每{" "}
        <input
          type="number"
          min={1}
          value={draft.unitMinutes}
          onChange={(e) => set("unitMinutes", e.target.value)}
          className={`${inputClass} w-24 sm:w-40`}
        />{" "}
        分鐘，就收費{" "}
        <input
          type="number"
          min={0}
          value={draft.unitAmount}
          onChange={(e) => set("unitAmount", e.target.value)}
          className={`${inputClass} w-24 sm:w-40`}
        />{" "}
        元
      </div>

      <p className="pt-2">若 以下 星期幾未設定值 就以上述收費 若未滿 設定的分鐘 就以 設定的分鐘 計</p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {RATE_WEEKDAYS.map((day, i) => (
          <label key={day} className="flex items-center gap-0.5">
            <input type="radio" name="weekday" checked={weekday === i} onChange={() => setWeekday(i)} />
            {day}
            {daysWithRows[i] && <span className="text-xs text-sky-600">●</span>}
          </label>
        ))}
        <button type="button" onClick={copyToAllDays} className={smallButtonClass}>
          複製到每一天
        </button>
      </div>
      <p className="text-xs text-gray-500">● 表示該天有設定時段；正在編輯：{RATE_WEEKDAYS[weekday]}</p>

      <div className="overflow-x-auto">
        <table className="w-full max-w-4xl table-fixed border-collapse text-sm sm:text-base">
          <thead>
            <tr className="text-left">
              {ROW_FIELDS.map((f) => (
                <th key={f.key} className="font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.weekdays[weekday].map((row, i) => {
              const filled = Object.values(row).some((v) => v.trim() !== "");
              const invalid = filled && parseRow(row) === null;
              return (
                <tr key={i} className={invalid ? "bg-red-50" : ""} title={invalid ? "此筆設定不成立，計費時不採用" : undefined}>
                  {ROW_FIELDS.map((f) => (
                    <td key={f.key} className="p-0">
                      <input
                        value={row[f.key]}
                        onChange={(e) => setCell(i, f.key, e.target.value)}
                        inputMode="numeric"
                        className={cellInputClass}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5">
        <p>開始時間 結束時間 設定為4位數 從 0000 到 2400 若有一項不是4位數 表示此筆設定不成立</p>
        <p>單位 金額 若有一項為0 表示此筆設定不成立</p>
        <p>最高收費 若為0 表示不限制</p>
        <p className="text-xs text-red-600">紅底的列表示設定不成立，計費時不會採用</p>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-0.5">
          <input type="radio" name="dayStart" checked={draft.dayMode === "calendar"} onChange={() => set("dayMode", "calendar")} />
          計時從當天00:00算起
        </label>
        <p>選此表示 從當天00:00算起 到當天23:59結束 算一天</p>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-0.5">
          <input type="radio" name="dayStart" checked={draft.dayMode === "rolling"} onChange={() => set("dayMode", "rolling")} />
          計時從車輛進場算起
        </label>
        <p>選此表示 從車輛進場算起 經過24小時 算一天</p>
      </div>

      <div className="space-y-1.5">
        <label className="flex flex-wrap items-center gap-1">
          單日最高收費
          <input
            type="number"
            min={0}
            value={draft.dailyMax}
            onChange={(e) => set("dailyMax", e.target.value)}
            className={`${inputClass} w-24 sm:w-40`}
          />
        </label>
        <p>單日最高收費 設為0 表示沒有最高收費 大於0表示一天最多收費設定值 且各自時段所設最高收費無效</p>
      </div>

      <hr className="border-gray-200" />
      <div className="space-y-2">
        <div className="text-xs text-gray-700">單次收費</div>
        <p>在繳費機輸入 4 位數代碼並按「查詢」，即收取設定的金額</p>
        <p className="text-xs text-gray-500">代碼和場內車輛的車牌後四碼相同時，繳費機以場內車輛為主</p>
        {draft.singleCharges.length > 0 && (
          <table className="w-full max-w-md table-fixed border-collapse text-sm sm:text-base">
            <thead>
              <tr className="text-left">
                <th className="font-medium">代碼(4位數)</th>
                <th className="font-medium">金額(元)</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {draft.singleCharges.map((c, i) => {
                const filled = c.code.trim() !== "" || c.amount.trim() !== "";
                const duplicate =
                  c.code.trim() !== "" && draft.singleCharges.some((o, j) => j !== i && o.code.trim() === c.code.trim());
                const invalid =
                  filled && (!SINGLE_CHARGE_CODE_PATTERN.test(c.code.trim()) || c.amount.trim() === "" || duplicate);
                return (
                  <tr
                    key={i}
                    className={invalid ? "bg-red-50" : ""}
                    title={duplicate ? "代碼重複" : invalid ? "代碼須為 4 位數字，金額不可空白" : undefined}
                  >
                    <td className="p-0">
                      <input
                        value={c.code}
                        onChange={(e) => setCharge(i, "code", e.target.value.replace(/\D/g, "").slice(0, 4))}
                        inputMode="numeric"
                        maxLength={4}
                        className={cellInputClass}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        type="number"
                        min={0}
                        value={c.amount}
                        onChange={(e) => setCharge(i, "amount", e.target.value)}
                        inputMode="numeric"
                        className={cellInputClass}
                      />
                    </td>
                    <td className="pl-2">
                      <button type="button" onClick={() => removeCharge(i)} className={smallButtonClass}>
                        刪除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button type="button" onClick={addCharge} className={smallButtonClass}>
          新增單次收費
        </button>
        <p className="text-xs text-red-600">紅底的列表示代碼不是 4 位數字、代碼重複或金額空白，無法儲存</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !dirty} className={buttonClass}>
          確定修改
        </button>
        {dirty && <span className="text-orange-600">設定已修改，尚未儲存</span>}
        {message && <span className={message.ok ? "text-green-700" : "text-red-600"}>{message.text}</span>}
        {!dirty && !message && (
          <span className="text-xs text-gray-500">
            {updatedAt ? `上次儲存：${new Date(updatedAt).toLocaleString("zh-TW", { hour12: false })}` : "尚未儲存過，目前顯示預設值"}
          </span>
        )}
      </div>

      <hr className="border-gray-200" />
      <FeeTrial settings={settings} />
    </form>
  );
}
