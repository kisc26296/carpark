// 停車費率設定與計費：前後端共用（費率設定頁試算、之後繳費流程都用同一套），不可引用 server-only 模組

/** 星期一～星期日（index 0 = 星期一，6 = 星期日） */
export const RATE_WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;

/** 時段收費的一列；照畫面輸入的字串保存，不成立的列計費時略過 */
export interface RateRow {
  /** 開始時間 HHMM，0000～2400 */
  start: string;
  end: string;
  /** 計費單位（分鐘） */
  unit: string;
  /** 每單位金額（元） */
  amount: string;
  /** 該時段最高收費，0 或空白表示不限制 */
  max: string;
}

export interface RateSettings {
  /** 進場緩衝（分）：停車時間在此以內免費 */
  entryBufferMinutes: number;
  /** 離場結帳緩衝（分）：繳費後在此時間內出場不再加收 */
  exitBufferMinutes: number;
  /** 預設費率：每 unitMinutes 分鐘收 unitAmount 元（星期幾沒設定時段時使用） */
  unitMinutes: number;
  unitAmount: number;
  /** 星期一～星期日各 4 列時段收費 */
  weekdays: RateRow[][];
  /** calendar：當天 00:00～23:59 算一天；rolling：從車輛進場起每 24 小時算一天 */
  dayMode: "calendar" | "rolling";
  /** 單日最高收費，0 表示不限制；大於 0 時各時段的最高收費無效 */
  dailyMax: number;
  /** 單次收費：在繳費機輸入 4 位數代碼，收取固定金額 */
  singleCharges: SingleCharge[];
  /** 啟用的支付方式，繳費機只顯示這些按鈕 */
  paymentMethods: PaymentMethod[];
}

export const PAYMENT_METHODS = [
  { id: "cash", label: "現金結帳" },
  { id: "card", label: "信用卡結帳" },
  { id: "applePay", label: "Apple Pay" },
  { id: "linePay", label: "LINE Pay" },
  { id: "googlePay", label: "Google Pay" },
  { id: "samsungPay", label: "Samsung Pay" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["id"];

export interface SingleCharge {
  /** 4 位數字代碼，不可重複 */
  code: string;
  /** 收取金額（元） */
  amount: number;
}

export const SINGLE_CHARGE_CODE_PATTERN = /^\d{4}$/;

export const RATE_ROWS_PER_DAY = 4;

const emptyRow = (): RateRow => ({ start: "", end: "", unit: "", amount: "", max: "" });

export const DEFAULT_RATE_SETTINGS: RateSettings = {
  entryBufferMinutes: 5,
  exitBufferMinutes: 15,
  unitMinutes: 30,
  unitAmount: 10,
  weekdays: RATE_WEEKDAYS.map((_, i) =>
    // 原畫面範例：星期日全天每 30 分鐘 20 元，最高 150 元
    i === 6
      ? [{ start: "0000", end: "2400", unit: "30", amount: "20", max: "150" }, emptyRow(), emptyRow(), emptyRow()]
      : Array.from({ length: RATE_ROWS_PER_DAY }, emptyRow),
  ),
  dayMode: "rolling",
  dailyMax: 150,
  singleCharges: [],
  // 加入這個設定前繳費機六種都會顯示，預設維持全部啟用
  paymentMethods: PAYMENT_METHODS.map((m) => m.id),
};

/** 一列時段收費是否成立：時間都是 4 位數、開始早於結束，單位與金額都大於 0 */
export interface ValidRow {
  start: number; // 當天第幾分鐘
  end: number;
  unit: number;
  amount: number;
  max: number;
}

const hhmmToMinutes = (s: string): number | null => {
  if (!/^\d{4}$/.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2));
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
};

export function parseRow(row: RateRow): ValidRow | null {
  const start = hhmmToMinutes(row.start.trim());
  const end = hhmmToMinutes(row.end.trim());
  const unit = Number(row.unit);
  const amount = Number(row.amount);
  const max = Number(row.max) || 0;
  if (start === null || end === null || start >= end) return null;
  if (!(unit > 0) || !(amount > 0)) return null;
  return { start, end, unit, amount, max: max > 0 ? max : 0 };
}

/** 檢查並整理表單送來的設定；有錯回傳錯誤清單。時段列不成立不算錯（依規則略過） */
export function validateRateSettings(raw: unknown): { ok: true; value: RateSettings } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const int = (v: unknown, label: string, min = 0) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) errors.push(`${label}必須是 ${min} 以上的整數`);
    return n;
  };
  const entryBufferMinutes = int(r.entryBufferMinutes, "進場緩衝");
  const exitBufferMinutes = int(r.exitBufferMinutes, "離場結帳緩衝");
  const unitMinutes = int(r.unitMinutes, "預設收費的分鐘數", 1);
  const unitAmount = int(r.unitAmount, "預設收費的金額");
  const dailyMax = int(r.dailyMax, "單日最高收費");
  const dayMode = r.dayMode === "calendar" ? "calendar" : "rolling";

  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const rawDays = Array.isArray(r.weekdays) ? r.weekdays : [];
  const weekdays = RATE_WEEKDAYS.map((_, d) => {
    const rows = Array.isArray(rawDays[d]) ? (rawDays[d] as unknown[]) : [];
    return Array.from({ length: RATE_ROWS_PER_DAY }, (_, i) => {
      const row = (rows[i] ?? {}) as Record<string, unknown>;
      return { start: text(row.start), end: text(row.end), unit: text(row.unit), amount: text(row.amount), max: text(row.max) };
    });
  });

  // 單次收費：代碼與金額都空白的列略過，其他列代碼必須是 4 位數字且不重複
  const singleCharges: SingleCharge[] = [];
  const rawCharges = Array.isArray(r.singleCharges) ? r.singleCharges : [];
  rawCharges.forEach((item, i) => {
    const c = (item ?? {}) as Record<string, unknown>;
    const code = text(c.code);
    const amountText = text(c.amount);
    if (code === "" && amountText === "") return;
    const label = `單次收費第 ${i + 1} 筆`;
    if (!SINGLE_CHARGE_CODE_PATTERN.test(code)) errors.push(`${label}的代碼必須是 4 位數字`);
    else if (singleCharges.some((s) => s.code === code)) errors.push(`單次收費代碼 ${code} 重複`);
    const amount = Number(amountText);
    if (amountText === "" || !Number.isInteger(amount) || amount < 0) errors.push(`${label}的金額必須是 0 以上的整數`);
    singleCharges.push({ code, amount });
  });

  // 支付方式：只留認得的，依 PAYMENT_METHODS 的順序；沒帶這個欄位時用預設值
  const paymentMethods: PaymentMethod[] = Array.isArray(r.paymentMethods)
    ? PAYMENT_METHODS.map((m) => m.id).filter((id) => (r.paymentMethods as unknown[]).includes(id))
    : [...DEFAULT_RATE_SETTINGS.paymentMethods];

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      entryBufferMinutes,
      exitBufferMinutes,
      unitMinutes,
      unitAmount,
      weekdays,
      dayMode,
      dailyMax,
      singleCharges,
      paymentMethods,
    },
  };
}

// ---- 計費 ----

export interface FeeItem {
  /** 例如「星期日 00:00～24:00」或「預設費率」 */
  label: string;
  minutes: number;
  units: number;
  /** 依單位計算的金額（套用時段最高收費前） */
  raw: number;
  amount: number;
  /** 被時段最高收費限制 */
  capped: boolean;
}

export interface FeeDay {
  start: Date;
  end: Date;
  items: FeeItem[];
  /** 套用單日最高收費前的小計 */
  raw: number;
  amount: number;
  /** 被單日最高收費限制 */
  capped: boolean;
}

export interface FeeResult {
  /** 停車總分鐘數（未滿一分鐘以一分鐘計） */
  minutes: number;
  /** 在進場緩衝內，免費 */
  free: boolean;
  days: FeeDay[];
  total: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const minutesLabel = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** JavaScript getDay()：0 = 星期日；換成 0 = 星期一 */
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** 依費率設定計算從進場到出場的停車費，回傳明細 */
export function calculateFee(settings: RateSettings, entry: Date, exit: Date): FeeResult {
  const minutes = Math.max(0, Math.ceil((exit.getTime() - entry.getTime()) / 60000));
  if (minutes <= settings.entryBufferMinutes) return { minutes, free: true, days: [], total: 0 };

  const validRows = settings.weekdays.map((rows) => rows.map(parseRow));
  const useRowMax = !(settings.dailyMax > 0);

  // 切成一天一天：當天 00:00 起算，或從進場起每 24 小時
  const windows: [Date, Date][] = [];
  let cursor = new Date(entry);
  while (cursor < exit) {
    let next: Date;
    if (settings.dayMode === "calendar") {
      next = new Date(cursor);
      next.setHours(24, 0, 0, 0);
    } else {
      next = new Date(cursor.getTime() + DAY_MS);
    }
    if (next > exit) next = new Date(exit);
    windows.push([cursor, next]);
    cursor = next;
  }

  const days: FeeDay[] = windows.map(([ws, we]) => {
    // 逐分鐘歸到所屬的時段（星期幾 + 第幾列，或預設費率），同一天內同一時段的分鐘合併計費
    const buckets = new Map<string, { label: string; minutes: number; unit: number; amount: number; max: number }>();
    const totalMinutes = Math.ceil((we.getTime() - ws.getTime()) / 60000);
    for (let i = 0; i < totalMinutes; i++) {
      const t = new Date(ws.getTime() + i * 60000);
      const day = weekdayIndex(t);
      const tod = t.getHours() * 60 + t.getMinutes();
      const rows = validRows[day];
      const rowIndex = rows.findIndex((r) => r && tod >= r.start && tod < r.end);
      const key = rowIndex >= 0 ? `${day}-${rowIndex}` : "default";
      let bucket = buckets.get(key);
      if (!bucket) {
        const row = rowIndex >= 0 ? rows[rowIndex]! : null;
        bucket = row
          ? {
              label: `${RATE_WEEKDAYS[day]} ${minutesLabel(row.start)}～${minutesLabel(row.end)}（每 ${row.unit} 分 ${row.amount} 元）`,
              minutes: 0,
              unit: row.unit,
              amount: row.amount,
              max: row.max,
            }
          : {
              label: `預設費率（每 ${settings.unitMinutes} 分 ${settings.unitAmount} 元）`,
              minutes: 0,
              unit: settings.unitMinutes,
              amount: settings.unitAmount,
              max: 0,
            };
        buckets.set(key, bucket);
      }
      bucket.minutes += 1;
    }

    const items: FeeItem[] = [...buckets.values()].map((b) => {
      const units = Math.ceil(b.minutes / b.unit);
      const raw = units * b.amount;
      const capped = useRowMax && b.max > 0 && raw > b.max;
      return { label: b.label, minutes: b.minutes, units, raw, amount: capped ? b.max : raw, capped };
    });
    const raw = items.reduce((s, it) => s + it.amount, 0);
    const capped = settings.dailyMax > 0 && raw > settings.dailyMax;
    return { start: ws, end: we, items, raw, amount: capped ? settings.dailyMax : raw, capped };
  });

  return { minutes, free: false, days, total: days.reduce((s, d) => s + d.amount, 0) };
}
