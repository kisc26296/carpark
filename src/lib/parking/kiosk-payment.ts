import "server-only";
import { randomUUID } from "node:crypto";
import { onCashDeviceEvent } from "@/lib/cash-device/events";
import { getBillState, runBillAction } from "@/lib/cash-device/protocols/bill-acceptor";
import { getCoinState, runCoinAction } from "@/lib/cash-device/protocols/coin-acceptor";
import { getHopperState, runHopperAction } from "@/lib/cash-device/protocols/hopper";
import { HOPPER_COIN_VALUES, type HopperDeviceId } from "@/lib/cash-device/shared";
import {
  KIOSK_PAYMENT_TIMEOUT_MS,
  type KioskMonthlyInfo,
  type KioskPaymentSession,
  type KioskPaymentTarget,
} from "./kiosk-payment-shared";
import { findMonthlyRentalByPlate } from "./monthly-rental";
import type { MonthlyRental } from "./monthly-rental-shared";
import { getInsideEntry, markPaid } from "./parking-entries";
import { calculateFee } from "./rate-shared";
import { getRateSettings } from "./rate-settings";

// 繳費機收款流程（一台繳費機同時只有一筆收款）：
// 1. 開始收款時啟用紙鈔機與硬幣接收器，倒數 180 秒
// 2. 紙鈔機或硬幣接收器的累計金額（total）增加就算偵測到投錢，加進已投金額並重新倒數；
//    紙鈔機在 Escrow 模式等待確認時自動收下
// 月租車：有效期間內無須繳費；已逾期從到期日隔天 00:00 起算臨停費（見 checkMonthly）
// 3. 已投金額達到應繳金額 → 停用收款、找零、記錄繳費；倒數結束或按取消 → 停用收款、退還已投金額
// 倒數在伺服器計時，繳費機頁面關掉也會照常退幣。

export class KioskPaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Session extends Omit<KioskPaymentSession, "remainingMs"> {
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Runtime {
  session: Session | null;
  /** 上次看到的紙鈔機 / 硬幣接收器累計金額，用來算出這次投了多少 */
  billTotal: number;
  coinTotal: number;
  unsubscribe: (() => void) | null;
}

// 用 globalThis 存，避免開發模式 HMR 重新載入模組時遺失進行中的收款
const globalForPayment = globalThis as typeof globalThis & { _kioskPayment?: Runtime };

function getRuntime(): Runtime {
  globalForPayment._kioskPayment ??= { session: null, billTotal: 0, coinTotal: 0, unsubscribe: null };
  return globalForPayment._kioskPayment;
}

function toPublic(s: Session): KioskPaymentSession {
  const { deadline, timer, ...rest } = s;
  void timer;
  return { ...rest, remainingMs: s.status === "collecting" ? Math.max(0, deadline - Date.now()) : 0 };
}

const addMessage = (s: Session, text: string) => {
  s.message = s.message ? `${s.message}；${text}` : text;
};

function restartCountdown(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.deadline = Date.now() + KIOSK_PAYMENT_TIMEOUT_MS;
  s.timer = setTimeout(() => void finish(s, "timeout"), KIOSK_PAYMENT_TIMEOUT_MS);
}

function addPaid(amount: number): void {
  const s = getRuntime().session;
  if (!s || s.status !== "collecting" || amount <= 0) return;
  s.paid += amount;
  if (s.paid >= s.due) void finish(s, "paid");
  else restartCountdown(s);
}

/** 只訂閱一次現金設備事件，依累計金額的增加量算出投了多少錢 */
function ensureListener(): void {
  const rt = getRuntime();
  if (rt.unsubscribe) return;
  rt.unsubscribe = onCashDeviceEvent((event) => {
    if (event.type === "bill") {
      const { total, escrow } = event.state;
      const delta = total - rt.billTotal;
      rt.billTotal = total;
      if (delta > 0) addPaid(delta);
      // Escrow 模式下紙鈔在等待確認：收款中就收下，找零 / 退幣中就退回；
      // 沒有收款時不處理，留給現金設備測試頁手動操作
      const s = rt.session;
      if (escrow && escrow.decision === null && s && s.status !== "done") {
        if (s.status === "collecting") restartCountdown(s);
        runBillAction(s.status === "collecting" ? "accept" : "reject").catch(() => {});
      }
    } else if (event.type === "coin") {
      const delta = event.state.total - rt.coinTotal;
      rt.coinTotal = event.state.total;
      if (delta > 0) addPaid(delta);
    }
  });
}

async function setAcceptors(enabled: boolean, s: Session | null): Promise<void> {
  const results = await Promise.allSettled([
    runBillAction(enabled ? "enable" : "disable"),
    runCoinAction(enabled ? "enable" : "disable"),
  ]);
  if (!s || !enabled) return;
  const offline = (["紙鈔機", "硬幣接收器"] as const).filter((_, i) => results[i].status === "rejected");
  if (offline.length) addMessage(s, `${offline.join("、")}無法啟用`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 出幣 count 枚並等待出幣機回報完成，回傳實際出幣枚數；出幣機沒連線或拒絕出幣時回傳已出的枚數 */
async function payoutAndWait(device: HopperDeviceId, count: number): Promise<number> {
  try {
    await runHopperAction(device, "payoutReply", count);
  } catch {
    return 0;
  }
  const deadline = Date.now() + 5000 + count * 1000;
  while (Date.now() < deadline) {
    await sleep(200);
    const { payout } = await getHopperState(device);
    if (!payout || payout.done) return payout?.dispensed ?? 0;
  }
  // 太久沒回報完成，停止出幣避免多出
  await runHopperAction(device, "stop").catch(() => {});
  await sleep(500);
  return (await getHopperState(device)).payout?.dispensed ?? 0;
}

const HOPPERS_BY_VALUE = (Object.keys(HOPPER_COIN_VALUES) as HopperDeviceId[]).sort(
  (a, b) => HOPPER_COIN_VALUES[b] - HOPPER_COIN_VALUES[a],
);

/** 依金額從大面額開始算出各面額要出幾枚（50、10、5、1 元） */
function planCoins(amount: number): KioskPaymentSession["coins"] {
  let remaining = amount;
  return HOPPERS_BY_VALUE.map((device) => {
    const value = HOPPER_COIN_VALUES[device];
    const planned = Math.floor(remaining / value);
    remaining -= planned * value;
    return { value, planned, dispensed: 0 };
  });
}

/**
 * 依 s.coins 從大面額開始出幣，直到出足 amount；某台出幣機沒連線或出不足時，
 * 剩下的改用較小面額重新計算。s.coins 隨出幣即時更新，回傳實際出幣金額
 */
async function dispense(s: Session, amount: number): Promise<number> {
  let remaining = amount;
  for (const [i, device] of HOPPERS_BY_VALUE.entries()) {
    const coin = s.coins[i];
    coin.planned = coin.dispensed + Math.floor(remaining / coin.value);
    while (remaining >= coin.value) {
      const count = Math.min(255, Math.floor(remaining / coin.value));
      const dispensed = await payoutAndWait(device, count);
      coin.dispensed += dispensed;
      remaining -= dispensed * coin.value;
      if (dispensed < count) {
        // 這個面額出不足，剩下的交給較小面額
        coin.planned = coin.dispensed;
        break;
      }
    }
  }
  return amount - remaining;
}

async function finish(s: Session, outcome: NonNullable<Session["outcome"]>): Promise<void> {
  if (s.status !== "collecting") return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.status = "dispensing";
  s.outcome = outcome;
  await setAcceptors(false, null);

  s.toReturn = outcome === "paid" ? s.paid - s.due : s.paid;
  if (s.toReturn > 0) {
    s.coins = planCoins(s.toReturn);
    s.returned = await dispense(s, s.toReturn);
    if (s.returned < s.toReturn) {
      addMessage(s, `${outcome === "paid" ? "找零" : "退幣"}不足 ${s.toReturn - s.returned} 元，請洽管理人員`);
    }
  }
  if (outcome === "paid" && s.target.kind === "entry") {
    await markPaid(s.target.entryId, s.due).catch((error) =>
      addMessage(s, `繳費紀錄寫入失敗：${error instanceof Error ? error.message : "未知錯誤"}`),
    );
  }
  s.status = "done";
}

/** YYYY-MM-DD 當天 00:00（本地時間），addDays 往後推幾天 */
const localDate = (ymd: string, addDays = 0) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d + addDays);
};

/** 判斷月租車在 now 時的狀態；不是月租車回傳 null */
function checkMonthly(rental: MonthlyRental | null, entryTime: Date, now: Date): KioskMonthlyInfo | null {
  if (!rental) return null;
  const base = { no: rental.no, name: rental.name, startDate: rental.startDate, endDate: rental.endDate };
  const fromEntry = entryTime.toISOString();
  if (rental.disabled) return { ...base, status: "disabled", chargeFrom: fromEntry };
  if (now < localDate(rental.startDate)) return { ...base, status: "notStarted", chargeFrom: fromEntry };
  // 到期日當天整天都還有效，隔天 00:00 起算臨停費
  const expiredAt = localDate(rental.endDate, 1);
  if (now < expiredAt) return { ...base, status: "valid", chargeFrom: null };
  const chargeFrom = entryTime > expiredAt ? entryTime : expiredAt;
  return { ...base, status: "expired", chargeFrom: chargeFrom.toISOString() };
}

/** 開始收款：entryId（場內車輛，依費率設定算到現在；月租車另外判斷）或 code（單次收費代碼） */
export async function startPayment(input: { entryId?: unknown; code?: unknown }): Promise<KioskPaymentSession> {
  const settings = await getRateSettings();
  let target: KioskPaymentTarget;
  let due: number;
  if (input.entryId !== undefined) {
    const entry = await getInsideEntry(input.entryId);
    const now = new Date();
    const entryTime = new Date(entry.entryTime);
    const monthly = checkMonthly(await findMonthlyRentalByPlate(entry.plate), entryTime, now);
    const minutes = Math.max(0, Math.ceil((now.getTime() - entryTime.getTime()) / 60000));
    target = { kind: "entry", entryId: entry.id, plate: entry.plate, entryTime: entry.entryTime, minutes, monthly };
    if (monthly?.status === "valid") due = 0;
    else {
      // 逾期的月租車從到期日隔天開始算，其他照進場時間算
      const from = monthly?.chargeFrom ? new Date(monthly.chargeFrom) : entryTime;
      due = from < now ? calculateFee(settings, from, now).total : 0;
    }
  } else {
    const code = typeof input.code === "string" ? input.code : "";
    const charge = settings.singleCharges.find((c) => c.code === code);
    if (!charge) throw new KioskPaymentError("查無此單次收費代碼", 404);
    target = { kind: "charge", code };
    due = charge.amount;
  }

  // 上一筆還沒結束（例如頁面重新整理）先當作取消，已投的錢退還
  const rt = getRuntime();
  if (rt.session?.status === "collecting") await finish(rt.session, "cancelled");

  ensureListener();
  const [bill, coin] = await Promise.all([getBillState(), getCoinState()]);
  rt.billTotal = bill.total;
  rt.coinTotal = coin.total;

  const s: Session = {
    id: randomUUID(),
    target,
    due,
    paid: 0,
    status: "collecting",
    outcome: null,
    toReturn: 0,
    returned: 0,
    coins: [],
    message: null,
    paymentMethods: settings.paymentMethods,
    deadline: 0,
    timer: null,
  };
  rt.session = s;
  if (due <= 0) {
    // 免費（例如在進場緩衝時間內）直接完成
    await finish(s, "paid");
  } else {
    restartCountdown(s);
    // 費率設定沒啟用現金結帳時不啟用紙鈔機與硬幣接收器
    if (settings.paymentMethods.includes("cash")) await setAcceptors(true, s);
    else addMessage(s, "現金結帳未啟用");
  }
  return toPublic(s);
}

function findSession(id: unknown): Session {
  const s = getRuntime().session;
  if (!s || s.id !== id) throw new KioskPaymentError("找不到這筆收款，可能已被新的收款取代", 404);
  return s;
}

export function getPayment(id: unknown): KioskPaymentSession {
  return toPublic(findSession(id));
}

/** 按取消：停止收款並退還已投金額，等退幣完成才回傳 */
export async function cancelPayment(id: unknown): Promise<KioskPaymentSession> {
  const s = findSession(id);
  await finish(s, "cancelled");
  return toPublic(s);
}
