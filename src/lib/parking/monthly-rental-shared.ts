// 月租客戶資料：前後端共用的型別、驗證與顯示格式，不可引用 server-only 模組

/** 星期，0 = 星期日 … 6 = 星期六（同 JavaScript Date.getDay()） */
export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;
/** 畫面上從星期一排到星期日 */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export interface MonthlySchedule {
  /** 可停的星期（0～6） */
  days: number[];
  /** true：全天可停，忽略 start / end */
  allDay: boolean;
  /** HH:mm，00:00～23:59；end 早於 start 代表跨夜（例如 22:00～06:00） */
  start: string;
  end: string;
}

export interface MonthlyRental {
  /** MongoDB _id 字串，新增前沒有 */
  id?: string;
  /** 編號，不可重複 */
  no: number;
  /** 承租人名稱（個人姓名或公司、單位名稱） */
  name: string;
  phone1: string;
  phone2: string;
  address: string;
  /** 車牌 1～4，空字串代表未填 */
  plates: [string, string, string, string];
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  /** 停用標籤：true 時月租資格暫停 */
  disabled: boolean;
  schedule: MonthlySchedule;
  createdAt?: string;
  updatedAt?: string;
}

/** 新增或修改時送給 API 的資料；編號留空時由伺服器自動給號 */
export type MonthlyRentalInput = Omit<MonthlyRental, "id" | "no" | "createdAt" | "updatedAt"> & { no: number | null };

export const DEFAULT_SCHEDULE: MonthlySchedule = { days: [0, 1, 2, 3, 4, 5, 6], allDay: true, start: "00:00", end: "23:59" };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 格式正確且日期真的存在（2024-02-30 這種會被 Date 自動進位的不算） */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 車牌統一轉大寫、去掉空白與連字號，比對重複時才不會因格式不同而漏掉 */
export const normalizePlate = (plate: string) => plate.toUpperCase().replace(/[\s-]/g, "");

/**
 * 檢查並整理表單送來的資料；有錯回傳錯誤訊息清單，沒錯回傳整理過的資料。
 * 不檢查編號與車牌是否和其他客戶重複，那要查資料庫，交給伺服器端處理。
 */
export function validateMonthlyRental(raw: unknown): { ok: true; value: MonthlyRentalInput } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  let no: number | null = null;
  if (r.no !== null && r.no !== undefined && r.no !== "") {
    no = Number(r.no);
    if (!Number.isInteger(no) || no < 1) errors.push("編號必須是正整數");
  }

  const rawPlates = Array.isArray(r.plates) ? r.plates : [];
  const plates = [0, 1, 2, 3].map((i) => normalizePlate(text(rawPlates[i]))) as MonthlyRental["plates"];
  if (!plates.some(Boolean)) errors.push("至少要填一個車牌");
  const filled = plates.filter(Boolean);
  if (new Set(filled).size !== filled.length) errors.push("同一位客戶的車牌重複");

  const startDate = text(r.startDate);
  const endDate = text(r.endDate);
  if (!isValidDate(startDate)) errors.push("開始有效日期格式錯誤");
  if (!isValidDate(endDate)) errors.push("結束有效日期格式錯誤");
  if (isValidDate(startDate) && isValidDate(endDate) && startDate > endDate) {
    errors.push("結束有效日期不可早於開始有效日期");
  }

  const s = (r.schedule ?? {}) as Record<string, unknown>;
  const days = Array.isArray(s.days)
    ? [...new Set(s.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
    : [];
  if (days.length === 0) errors.push("月租時段至少要選一天");
  const allDay = s.allDay !== false;
  const start = text(s.start) || DEFAULT_SCHEDULE.start;
  const end = text(s.end) || DEFAULT_SCHEDULE.end;
  if (!allDay) {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) errors.push("月租時段的時間格式必須是 00:00～23:59");
    else if (start === end) errors.push("月租時段的開始與結束時間不可相同");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      no,
      name: text(r.name),
      phone1: text(r.phone1),
      phone2: text(r.phone2),
      address: text(r.address),
      plates,
      startDate,
      endDate,
      disabled: r.disabled === true,
      schedule: { days, allDay, start, end },
    },
  };
}

/** 星期顯示：連續的天數合併，例如「一～五」「六、日」「每天」 */
export function formatDays(days: number[]): string {
  if (days.length === 7) return "每天";
  // 依畫面順序（一…日）找連續區段
  const order = WEEKDAY_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_ORDER.indexOf(d));
  const parts: string[] = [];
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1] === order[j] + 1) j++;
    const from = WEEKDAY_LABELS[WEEKDAY_ORDER[order[i]]];
    const to = WEEKDAY_LABELS[WEEKDAY_ORDER[order[j]]];
    parts.push(j - i >= 2 ? `${from}～${to}` : j > i ? `${from}、${to}` : from);
    i = j + 1;
  }
  return parts.join("、");
}

/** 月租時段顯示，例如「每天 全天」「一～五 08:00～18:00」「每天 22:00～06:00（跨夜）」 */
export function formatSchedule(schedule: MonthlySchedule): string {
  const days = formatDays(schedule.days);
  if (schedule.allDay) return `${days} 全天`;
  const overnight = schedule.end < schedule.start ? "（跨夜）" : "";
  return `${days} ${schedule.start}～${schedule.end}${overnight}`;
}

/** YYYY-MM-DD → YYYY/MM/DD */
export const formatDate = (s: string) => s.replaceAll("-", "/");
