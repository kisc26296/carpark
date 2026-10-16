// 收找零紀錄：硬幣與收鈔機數量，前後端共用的型別與常數，不可引用 server-only 模組

/** 硬幣面額（收找零紀錄畫面上的欄位）；50、10、5、1 元各有一台找零錢機 */
export const INVENTORY_COINS = [100, 50, 10, 5, 1] as const;
/** 收鈔機紙鈔面額（紙鈔機收得到的面額） */
export const INVENTORY_BILLS = [1000, 500, 200, 100] as const;

export type CoinCounts = Record<(typeof INVENTORY_COINS)[number], number>;
export type BillCounts = Record<(typeof INVENTORY_BILLS)[number], number>;

export interface CashInventory {
  /** 目前數量：找零錢機出幣時自動扣掉，也可以手動修改 */
  current: CoinCounts;
  /** 保留數量：補幣的目標數量 */
  reserved: CoinCounts;
  /** 收鈔機目前數量：紙鈔機收下紙鈔時自動增加，收鈔機歸零時清空 */
  cashBox: BillCounts;
  updatedAt: string | null;
}

export type CashInventoryAction = "setCurrent" | "setReserved" | "refill" | "clearCashBox";

export const CASH_INVENTORY_ACTION_LABELS: Record<CashInventoryAction, string> = {
  setCurrent: "修改目前數量",
  setReserved: "修改保留數量",
  refill: "確定補幣",
  clearCashBox: "收鈔機歸零",
};

/** 手動操作的紀錄（cash_inventory_logs） */
export interface CashInventoryLog {
  id: string;
  time: string;
  action: CashInventoryAction;
  /** 操作前後的數量 */
  before: Partial<CashInventory>;
  after: Partial<CashInventory>;
}

export const emptyCoins = (): CoinCounts => ({ 100: 0, 50: 0, 10: 0, 5: 0, 1: 0 });
export const emptyBills = (): BillCounts => ({ 1000: 0, 500: 0, 200: 0, 100: 0 });
