import "server-only";
import { ObjectId } from "mongodb";
import {
  buildIssueFields,
  buildSearchFields,
  callEzpay,
  getEzpayConfig,
  newMerchantOrderNo,
  type EzpayEnv,
} from "@/lib/einvoice/ezpay";
import type { KioskInvoice, KioskInvoiceType, PrintedInvoice } from "./kiosk-payment-shared";
import { addInvoiceNo } from "./parking-entries";
import { COLLECTIONS, getParkingDb } from "./store";

// 繳費機開立電子發票（ezPay，應稅 5%，金額為這次實收的應繳金額）：
// - 直接列印：B2C 紙本，回傳證明聯要印的條碼與 QR Code
// - 手機載具：B2C 存入載具，不列印
// - 統編：B2B 紙本（B2B 規定索取紙本），證明聯印上買方統編
// 每筆收款用固定的自訂編號；重試前先用自訂編號查詢，上一次其實已經開立（例如回應逾時）就直接用那張，避免重複開立。
// 每次開立結果（含失敗）都存進 carpark.invoices，成功時把發票號碼寫進進場紀錄。

export interface KioskInvoiceOrder {
  /** 收款 id，記錄用 */
  sessionId: string;
  /** 這筆收款的自訂編號，重試時沿用 */
  merchantOrderNo: string;
  /** 繳費完成時使用的平台；中途切換平台，重試仍送到同一個平台 */
  env: EzpayEnv;
  totalAmt: number;
  itemName: string;
  entryId: string | null;
  plate: string | null;
  chargeCode: string | null;
}

export interface KioskInvoiceChoice {
  type: KioskInvoiceType;
  carrierNum?: string;
  buyerUBN?: string;
}

/** 目前使用的平台；金鑰沒設定好時回傳原因 */
export async function currentInvoicePlatform(): Promise<{ env: EzpayEnv } | { reason: string }> {
  const { config } = await getEzpayConfig();
  return config ? { env: config.env } : { reason: "電子發票尚未設定" };
}

export const newKioskOrderNo = () => newMerchantOrderNo().replace(/^T/, "K");

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown) => Number(v) || 0;
const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** 從 ezPay 開立或查詢的 Result 整理出列印用的資料；沒有條碼（存入載具）回傳 null */
function toPrinted(r: Record<string, unknown>, fallback: { amt: number; taxAmt: number; buyerUBN: string }): PrintedInvoice | null {
  const barCode = str(r.BarCode);
  const qrCodeL = str(r.QRcodeL);
  if (!barCode || !qrCodeL) return null;
  return {
    invoiceNumber: str(r.InvoiceNumber),
    randomNum: str(r.RandomNum),
    createTime: str(r.CreateTime),
    totalAmt: num(r.TotalAmt),
    amt: r.Amt !== undefined ? num(r.Amt) : fallback.amt,
    taxAmt: r.TaxAmt !== undefined ? num(r.TaxAmt) : fallback.taxAmt,
    buyerUBN: str(r.BuyerUBN) || fallback.buyerUBN,
    // 左邊 QR Code：發票號碼 10 + 日期 7 + 隨機碼 4 + 銷售額 8 + 總計額 8 + 買方統編 8 + 賣方統編 8 + …
    sellerUBN: qrCodeL.slice(45, 53),
    barCode,
    qrCodeL,
    qrCodeR: str(r.QRcodeR),
  };
}

async function save(doc: Record<string, unknown>): Promise<void> {
  try {
    await (await getParkingDb()).collection(COLLECTIONS.invoices).insertOne({ ...doc, createdAt: new Date() });
  } catch (error) {
    console.error("[kiosk-invoice] 發票紀錄寫入失敗", error);
  }
}

/** 開立（或找回已開立的）發票；不丟例外，失敗時回傳 failed */
export async function issueKioskInvoice(
  order: KioskInvoiceOrder,
  choice: KioskInvoiceChoice,
  retry: boolean,
): Promise<Extract<KioskInvoice, { status: "issued" | "failed" }>> {
  const { type } = choice;
  const b2b = type === "ubn";
  const carrierNum = type === "carrier" ? (choice.carrierNum ?? "").trim().toUpperCase() : "";
  const buyerUBN = b2b ? (choice.buyerUBN ?? "").trim() : "";
  const record = {
    sessionId: order.sessionId,
    merchantOrderNo: order.merchantOrderNo,
    type,
    category: b2b ? "B2B" : "B2C",
    carrierNum: carrierNum || null,
    buyerUBN: buyerUBN || null,
    totalAmt: order.totalAmt,
    itemName: order.itemName,
    entryId: order.entryId && ObjectId.isValid(order.entryId) ? new ObjectId(order.entryId) : null,
    plate: order.plate,
    chargeCode: order.chargeCode,
    env: order.env,
  };

  try {
    const fields = buildIssueFields({
      category: b2b ? "B2B" : "B2C",
      totalAmt: order.totalAmt,
      itemName: order.itemName,
      merchantOrderNo: order.merchantOrderNo,
      carrierNum,
      buyerUBN,
    });
    const fallback = { amt: Number(fields.Amt), taxAmt: Number(fields.TaxAmt), buyerUBN };

    // 重試：上一次可能其實開立成功了（回應逾時、連線中斷），先查詢
    let result: Record<string, unknown> | null = null;
    if (retry) {
      const found = await callEzpay(
        "search",
        buildSearchFields({ merchantOrderNo: order.merchantOrderNo, totalAmt: order.totalAmt }),
        order.env,
      );
      if (found.status === "SUCCESS" && found.result?.InvoiceNumber) result = found.result;
    }
    if (!result) {
      const issued = await callEzpay("issue", fields, order.env);
      if (issued.status !== "SUCCESS" || !issued.result?.InvoiceNumber) {
        throw new Error(`${issued.message ?? "開立失敗"}${issued.status ? `（${issued.status}）` : ""}`);
      }
      result = issued.result;
    }

    const invoiceNumber = str(result.InvoiceNumber);
    // 查詢找回的發票以實際開立的方式為準（例如上次選列印、這次改選載具）
    const foundCarrier = retry ? safeDecode(str(result.CarrierNum)) : carrierNum;
    const actualType: KioskInvoiceType = !retry
      ? type
      : str(result.BuyerUBN)
        ? "ubn"
        : foundCarrier
          ? "carrier"
          : str(result.InvoiceNumber) && str(result.BarCode)
            ? "print"
            : type;
    const print = actualType === "carrier" ? null : toPrinted(result, fallback);
    await save({
      ...record,
      type: actualType,
      carrierNum: actualType === "carrier" ? foundCarrier || carrierNum : null,
      status: "issued",
      invoiceNumber,
      randomNum: str(result.RandomNum),
      invoiceTransNo: str(result.InvoiceTransNo),
      createTime: str(result.CreateTime),
      amt: fallback.amt,
      taxAmt: fallback.taxAmt,
      barCode: print?.barCode ?? null,
      qrCodeL: print?.qrCodeL ?? null,
      qrCodeR: print?.qrCodeR ?? null,
    });
    if (order.entryId) {
      await addInvoiceNo(order.entryId, invoiceNumber).catch((error) =>
        console.error("[kiosk-invoice] 發票號碼寫入進場紀錄失敗", error),
      );
    }
    return {
      status: "issued",
      type: actualType,
      invoiceNumber,
      carrierNum: actualType === "carrier" ? foundCarrier || carrierNum : null,
      print,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "開立失敗";
    await save({ ...record, status: "failed", error: message });
    return { status: "failed", type, error: message };
  }
}
