// 離場應繳金額：繳費機收款與出口放行共用同一套判斷，前後端都可以 import（不可引用 server-only 模組）
//
// 1. 有效的月租車 → 免費
// 2. 停車時間在進場緩衝內 → 免費
// 3. 已繳費且在離場結帳緩衝內 → 不用再繳
// 4. 超過離場結帳緩衝（或從沒繳過）：依費率算出整段停車的應收總額（已套用時段 / 單日最高收費，即收費上限）
//    - 已繳金額達到應收總額 → 已達收費上限，不用再繳
//    - 否則要補繳：上次繳費後多停的時間的費用，最多為「應收總額 − 已繳金額」

import type { KioskMonthlyInfo } from "./kiosk-payment-shared";
import { calculateFee, type RateSettings } from "./rate-shared";

export type ExitChargeStatus =
  /** 有效的月租車 */
  | "monthly"
  /** 停車時間在進場緩衝內 */
  | "entryBuffer"
  /** 已繳費，還在離場結帳緩衝內 */
  | "exitBuffer"
  /** 已繳金額已達收費上限（整段停車的應收總額） */
  | "capped"
  /** 要繳費（從沒繳過）或補繳（超過離場結帳緩衝） */
  | "due";

export interface ExitCharge {
  status: ExitChargeStatus;
  /** 現在還要繳的金額 */
  due: number;
  /** 依費率算出整段停車的應收總額（已套用收費上限）；月租、緩衝內為 0 */
  total: number;
  /** 已結帳金額 */
  paid: number;
  /** 最後一次繳費時間（ISO） */
  payTime: string | null;
  /** 離場結帳緩衝的截止時間（ISO）；沒繳過費時為 null */
  exitDeadline: string | null;
}

const MINUTE_MS = 60_000;

export function computeExitCharge(
  settings: RateSettings,
  entry: { entryTime: string; payTime: string | null; amount: number | null },
  monthly: KioskMonthlyInfo | null,
  now: Date,
): ExitCharge {
  const paid = entry.amount ?? 0;
  const payTime = entry.payTime ? new Date(entry.payTime) : null;
  const exitDeadline = payTime ? new Date(payTime.getTime() + settings.exitBufferMinutes * MINUTE_MS) : null;
  const base = { paid, payTime: entry.payTime, exitDeadline: exitDeadline?.toISOString() ?? null };
  const free = (status: ExitChargeStatus): ExitCharge => ({ ...base, status, due: 0, total: 0 });

  if (monthly?.status === "valid") return free("monthly");
  const entryTime = new Date(entry.entryTime);
  const minutes = Math.ceil((now.getTime() - entryTime.getTime()) / MINUTE_MS);
  if (minutes <= settings.entryBufferMinutes) return free("entryBuffer");
  if (exitDeadline && now <= exitDeadline) return free("exitBuffer");

  // 逾期的月租車從到期日隔天開始算，其他照進場時間算
  const from = monthly?.chargeFrom ? new Date(monthly.chargeFrom) : entryTime;
  const total = from < now ? calculateFee(settings, from, now).total : 0;
  if (paid >= total) return { ...base, status: "capped", due: 0, total };
  // 補繳：上次繳費之後多停的時間照費率算，但不超過收費上限減已繳金額
  const extra = payTime && payTime > from ? calculateFee(settings, payTime, now).total : total;
  const due = Math.max(0, Math.min(extra, total - paid));
  return { ...base, status: due > 0 ? "due" : "capped", due, total };
}
