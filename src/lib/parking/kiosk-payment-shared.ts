// 繳費機收款流程：前後端共用的型別與常數，不可引用 server-only 模組

import type { ExitCharge } from "./exit-charge";
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
      /** 應繳 / 補繳金額的判斷（緩衝時間、已結帳金額、收費上限） */
      charge: ExitCharge;
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
  /** 繳費完成且有收錢時才有：電子發票開立狀態；免費、逾時、取消為 null */
  invoice: KioskInvoice | null;
}

// ---- 繳費完成後開立電子發票 ----

/** print：直接列印（B2C 紙本）、carrier：存入手機條碼載具、ubn：輸入統一編號（B2B，列印） */
export type KioskInvoiceType = "print" | "carrier" | "ubn";

export const KIOSK_INVOICE_TYPE_LABELS: Record<KioskInvoiceType, string> = {
  print: "直接列印發票",
  carrier: "掃描手機載具",
  ubn: "輸入統編",
};

/** 客人在繳費機上沒選發票開立方式時，幾秒後自動直接列印；每次操作重新倒數 */
export const KIOSK_INVOICE_CHOICE_MS = 30_000;

/** 列印電子發票證明聯需要的資料（ezPay 回傳的條碼與 QR Code 內容） */
export interface PrintedInvoice {
  invoiceNumber: string;
  randomNum: string;
  /** 開立時間，例：2026-10-18 21:49:04 */
  createTime: string;
  totalAmt: number;
  /** 銷售額（未稅）與稅額，B2B 證明聯要印 */
  amt: number;
  taxAmt: number;
  /** B2B 買方統一編號；B2C 為空字串 */
  buyerUBN: string;
  /** 賣方統一編號（從左邊 QR Code 內容取出） */
  sellerUBN: string;
  /** 一維條碼內容：期別 5 碼 + 發票號碼 10 碼 + 隨機碼 4 碼 */
  barCode: string;
  qrCodeL: string;
  qrCodeR: string;
}

export type KioskInvoice =
  /** 電子發票沒設定（.env.local 沒有 ezPay 金鑰），不開立 */
  | { status: "unavailable"; reason: string }
  /** 等客人選擇開立方式 */
  | { status: "pending" }
  | { status: "issuing"; type: KioskInvoiceType }
  | {
      status: "issued";
      type: KioskInvoiceType;
      invoiceNumber: string;
      /** 存入的手機條碼載具 */
      carrierNum: string | null;
      /** 要列印時才有（直接列印、統編） */
      print: PrintedInvoice | null;
    }
  | { status: "failed"; type: KioskInvoiceType; error: string };

/** 手機條碼載具：/ 加 7 碼（大寫英數或 +-.） */
export const CARRIER_PATTERN = /^\/[0-9A-Z+\-.]{7}$/;
