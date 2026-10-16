// 繳費機收款流程：前後端共用的型別與常數，不可引用 server-only 模組

import type { PaymentMethod } from "./rate-shared";

/** 沒有投錢時的倒數秒數；每偵測到一次投錢（紙鈔或硬幣）重新倒數 */
export const KIOSK_PAYMENT_TIMEOUT_MS = 180_000;

/**
 * 月租車的判斷結果：
 * valid 月租有效，無須繳費；expired 已逾期，從到期日隔天 00:00（或進場時間，取較晚者）開始算臨停費；
 * disabled 月租已停用、notStarted 月租還沒開始，這兩種都從進場時間照臨停費率計算
 */
export interface KioskMonthlyInfo {
  no: number;
  name: string;
  startDate: string;
  endDate: string;
  status: "valid" | "expired" | "disabled" | "notStarted";
  /** 開始計費的時間（ISO）；valid 時為 null */
  chargeFrom: string | null;
}

export type KioskPaymentTarget =
  | {
      kind: "entry";
      entryId: string;
      plate: string;
      entryTime: string;
      /** 從進場到現在的停車分鐘數 */
      minutes: number;
      /** 月租車才有 */
      monthly: KioskMonthlyInfo | null;
    }
  | { kind: "charge"; code: string };

export interface KioskPaymentSession {
  id: string;
  target: KioskPaymentTarget;
  /** 應繳金額 */
  due: number;
  /** 已投金額 */
  paid: number;
  /** collecting：收款中；dispensing：找零 / 退幣中；done：結束 */
  status: "collecting" | "dispensing" | "done";
  /** paid：繳費完成；timeout：倒數結束退幣；cancelled：按取消退幣 */
  outcome: "paid" | "timeout" | "cancelled" | null;
  /** 要找零或退還的金額 */
  toReturn: number;
  /** 實際出幣的金額 */
  returned: number;
  /** 找零 / 退幣的各面額枚數（50、10、5、1 元）：planned 預計、dispensed 已出，出幣中即時更新 */
  coins: { value: number; planned: number; dispensed: number }[];
  /** 收款中時距離倒數結束的毫秒數，其他狀態為 0 */
  remainingMs: number;
  /** 設備異常等提示（例如紙鈔機沒連線、出幣不足） */
  message: string | null;
  /** 開始收款時費率設定裡啟用的支付方式，繳費機只顯示這些按鈕 */
  paymentMethods: PaymentMethod[];
}
