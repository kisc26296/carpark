import "server-only";
import { onCashDeviceEvent } from "@/lib/cash-device/events";
import { getBillState } from "@/lib/cash-device/protocols/bill-acceptor";
import { getHopperState } from "@/lib/cash-device/protocols/hopper";
import { HOPPER_COIN_VALUES, HOPPER_DEVICES, type HopperDeviceId } from "@/lib/cash-device/shared";
import {
  emptyBills,
  emptyCoins,
  INVENTORY_BILLS,
  INVENTORY_COINS,
  type CashInventory,
  type CashInventoryAction,
  type CashInventoryLog,
  type CoinCounts,
} from "./cash-inventory-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 收找零紀錄（carpark.cash_inventory，只有一筆 _id: "current"）：
// - 目前數量：找零錢機每出一枚（繳費機找零 / 退幣、交班退幣）自動扣掉，盤點後可手動修改
// - 保留數量：補幣的目標數量；確定補幣 = 把目前數量補到（或取出到）保留數量
// - 收鈔機目前數量：紙鈔機收下紙鈔時依面額自動加一，取出鈔票後按收鈔機歸零
// 手動操作另外寫一筆紀錄到 cash_inventory_logs。
// 硬幣接收器收到的硬幣不會自動加進目前數量（分類器不一定把硬幣送進找零錢機）。

const DOC_ID = "current";

type Doc = Omit<CashInventory, "updatedAt"> & { _id: string; updatedAt?: Date };
type LogDoc = Omit<CashInventoryLog, "id" | "time"> & { time: Date };

async function collections() {
  const db = await getParkingDb();
  return {
    inventory: db.collection<Doc>(COLLECTIONS.cashInventory),
    logs: db.collection<LogDoc>(COLLECTIONS.cashInventoryLogs),
  };
}

export class CashInventoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getCashInventory(): Promise<CashInventory> {
  const { inventory } = await collections();
  const doc = await inventory.findOne({ _id: DOC_ID });
  return {
    current: { ...emptyCoins(), ...doc?.current },
    reserved: { ...emptyCoins(), ...doc?.reserved },
    cashBox: { ...emptyBills(), ...doc?.cashBox },
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

export async function listCashInventoryLogs(limit = 20): Promise<CashInventoryLog[]> {
  const { logs } = await collections();
  const docs = await logs.find().sort({ time: -1 }).limit(limit).toArray();
  return docs.map(({ _id, time, ...rest }) => ({ ...rest, id: _id.toHexString(), time: time.toISOString() }));
}

/** 原子增減數量，例如 { "current.50": -1 } */
async function increment(inc: Record<string, number>): Promise<void> {
  const { inventory } = await collections();
  await inventory.updateOne({ _id: DOC_ID }, { $inc: inc, $set: { updatedAt: new Date() } }, { upsert: true });
}

/** 檢查表單送來的各面額數量：0 以上的整數 */
function parseCoins(raw: unknown): CoinCounts {
  const values = (raw ?? {}) as Record<string, unknown>;
  const result = emptyCoins();
  for (const coin of INVENTORY_COINS) {
    const n = Number(values[coin]);
    if (!Number.isInteger(n) || n < 0) throw new CashInventoryError(`${coin} 元的數量必須是 0 以上的整數`, 400);
    result[coin] = n;
  }
  return result;
}

/** 修改目前數量、修改保留數量、確定補幣、收鈔機歸零，並寫一筆操作紀錄 */
export async function updateCashInventory(action: CashInventoryAction, values?: unknown): Promise<CashInventory> {
  const before = await getCashInventory();
  let set: Partial<CashInventory>;
  switch (action) {
    case "setCurrent":
      set = { current: parseCoins(values) };
      break;
    case "setReserved":
      set = { reserved: parseCoins(values) };
      break;
    case "refill":
      // 補幣後目前數量 = 保留數量（多的取出、少的補進）
      set = { current: { ...before.reserved } };
      break;
    case "clearCashBox":
      set = { cashBox: emptyBills() };
      break;
    default:
      throw new CashInventoryError("不支援的操作", 400);
  }

  const { inventory, logs } = await collections();
  await inventory.updateOne({ _id: DOC_ID }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true });
  const field = Object.keys(set)[0] as keyof CashInventory;
  await logs.insertOne({ time: new Date(), action, before: { [field]: before[field] }, after: set });
  return getCashInventory();
}

// ---- 依現金設備事件自動增減 ----

interface Tracker {
  unsubscribe: () => void;
  /** 各找零錢機上次看到的累計出幣枚數 */
  dispensed: Partial<Record<HopperDeviceId, number>>;
  /** 紙鈔機上次看到的累計金額 */
  billTotal: number | null;
}

const globalForInventory = globalThis as typeof globalThis & { _cashInventoryListener?: Tracker };

/**
 * 訂閱現金設備事件（伺服器啟動時呼叫一次）：
 * 找零錢機累計出幣枚數（totalDispensed）增加 → 扣目前數量；紙鈔機累計金額（total）增加 → 依面額加收鈔機數量
 */
export async function startCashInventoryTracking(): Promise<void> {
  if (globalForInventory._cashInventoryListener) return;
  const tracker: Tracker = {
    unsubscribe: () => {},
    dispensed: {},
    billTotal: null,
  };
  globalForInventory._cashInventoryListener = tracker;
  // 先記下目前的累計值當基準，之後的增加量才是新出的幣 / 新收的鈔
  const [bill, ...hoppers] = await Promise.all([getBillState(), ...HOPPER_DEVICES.map((d) => getHopperState(d))]);
  tracker.billTotal = bill.total;
  HOPPER_DEVICES.forEach((d, i) => (tracker.dispensed[d] = hoppers[i].totalDispensed));
  const report = (error: unknown) =>
    console.error("[cash-inventory] 更新數量失敗:", error instanceof Error ? error.message : error);

  tracker.unsubscribe = onCashDeviceEvent((event) => {
    if (event.type === "hopper" && (HOPPER_DEVICES as readonly string[]).includes(event.device)) {
      const total = event.state.totalDispensed;
      const last = tracker.dispensed[event.device];
      tracker.dispensed[event.device] = total;
      // 累計值變小（不應發生）時只重新記基準
      if (last === undefined || total <= last) return;
      increment({ [`current.${HOPPER_COIN_VALUES[event.device]}`]: -(total - last) }).catch(report);
    } else if (event.type === "bill") {
      const { total } = event.state;
      const last = tracker.billTotal;
      tracker.billTotal = total;
      if (last === null || total <= last) return;
      const value = total - last;
      // 一次只會收下一張；金額對不上任何面額就不記
      if ((INVENTORY_BILLS as readonly number[]).includes(value)) increment({ [`cashBox.${value}`]: 1 }).catch(report);
    }
  });
}
