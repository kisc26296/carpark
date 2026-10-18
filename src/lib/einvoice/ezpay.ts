import "server-only";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";
import { EZPAY_ENV_LABELS, isValidUbn, type EzpayEnv, type InvoiceCategory } from "./ezpay-shared";

// ezPay 電子發票加值服務平台串接（依《電子發票技術串接手冊 EZP_INVI_1.2.2》）
//
// - 以標準 Form Post 送出 MerchantID_ 與 PostData_（注意兩個參數名稱後面都有底線）
// - PostData_：把發票欄位用 http_build_query 組成字串，補位到 32 bytes 的倍數（PKCS#7 格式，區塊大小 32），
//   用 AES-256-CBC（Key = HashKey、IV = HashIV，不再自動補位）加密後轉小寫 hex（附件一）
// - 回傳的 CheckCode：InvoiceTransNo、MerchantID、MerchantOrderNo、RandomNum、TotalAmt 依名稱排序串成
//   query string，前後加上 HashIV=…& 與 &HashKey=…，SHA256 後轉大寫（附件二）
//
// 商店代號與金鑰放在 .env.local：
//   測試平台 EZPAY_INVOICE_TEST_MERCHANT_ID、EZPAY_INVOICE_TEST_HASH_KEY（32 字元）、EZPAY_INVOICE_TEST_HASH_IV（16 字元）
//   正式平台 EZPAY_INVOICE_PROD_MERCHANT_ID、EZPAY_INVOICE_PROD_HASH_KEY、EZPAY_INVOICE_PROD_HASH_IV
// 兩個平台是不同的商店、金鑰也不同。目前用哪個平台存在 carpark.system_settings（_id: "einvoice"），
// 由「電子發票測試」頁切換（只限管理者），預設測試平台；繳費機開立發票也照這個設定。

export { type EzpayEnv } from "./ezpay-shared";
export type EzpayAction = "issue" | "invalid" | "search";

const BASE_URLS: Record<EzpayEnv, string> = {
  test: "https://cinv.ezpay.com.tw/Api",
  production: "https://inv.ezpay.com.tw/Api",
};

const ACTIONS: Record<EzpayAction, { path: string; version: string; label: string }> = {
  issue: { path: "invoice_issue", version: "1.5", label: "開立發票" },
  invalid: { path: "invoice_invalid", version: "1.0", label: "作廢發票" },
  search: { path: "invoice_search", version: "1.3", label: "查詢發票" },
};

const REQUEST_TIMEOUT_MS = 20_000;

export class EzpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface EzpayConfig {
  env: EzpayEnv;
  merchantId: string;
  hashKey: string;
  hashIV: string;
}

export interface EzpayCredentials {
  config: EzpayConfig | null;
  /** 商店代號（沒設定為 null），給頁面顯示用；金鑰不回傳 */
  merchantId: string | null;
  missing: string[];
  problems: string[];
}

const ENV_PREFIX: Record<EzpayEnv, string> = { test: "EZPAY_INVOICE_TEST_", production: "EZPAY_INVOICE_PROD_" };

/** 讀取 .env.local 裡某個平台的商店代號與金鑰；缺少時回傳缺了哪些 */
export function readEzpayCredentials(env: EzpayEnv): EzpayCredentials {
  const prefix = ENV_PREFIX[env];
  const read = (name: string) => process.env[prefix + name]?.trim() ?? "";
  const merchantId = read("MERCHANT_ID");
  const hashKey = read("HASH_KEY");
  const hashIV = read("HASH_IV");
  const missing = ["MERCHANT_ID", "HASH_KEY", "HASH_IV"]
    .filter((name) => !read(name))
    .map((name) => prefix + name);
  const problems: string[] = [];
  if (hashKey && Buffer.byteLength(hashKey) !== 32) problems.push(`HashKey 應為 32 字元（目前 ${Buffer.byteLength(hashKey)}）`);
  if (hashIV && Buffer.byteLength(hashIV) !== 16) problems.push(`HashIV 應為 16 字元（目前 ${Buffer.byteLength(hashIV)}）`);
  return {
    config: missing.length || problems.length ? null : { env, merchantId, hashKey, hashIV },
    merchantId: merchantId || null,
    missing,
    problems,
  };
}

// ---- 目前使用的平台 ----

const SETTINGS_ID = "einvoice";

interface EinvoiceSettingsDoc {
  _id: string;
  env: EzpayEnv;
  updatedAt: Date;
  updatedBy: string | null;
}

async function settingsCollection() {
  return (await getParkingDb()).collection<EinvoiceSettingsDoc>(COLLECTIONS.systemSettings);
}

/** 目前使用的平台與最後切換的時間、人員；沒設定過為測試平台 */
export async function getEzpaySettings(): Promise<{ env: EzpayEnv; updatedAt: string | null; updatedBy: string | null }> {
  const doc = await (await settingsCollection()).findOne({ _id: SETTINGS_ID });
  return {
    env: doc?.env === "production" ? "production" : "test",
    updatedAt: doc?.updatedAt?.toISOString() ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

/** 切換平台；要切過去的平台金鑰沒設定好就不能切 */
export async function setEzpayEnv(env: unknown, updatedBy: string): Promise<void> {
  if (env !== "test" && env !== "production") throw new EzpayError("平台必須是 test 或 production", 400);
  const { config, missing, problems } = readEzpayCredentials(env);
  if (!config) {
    const reason = [missing.length ? `缺少 ${missing.join("、")}` : "", ...problems].filter(Boolean).join("；");
    throw new EzpayError(`${EZPAY_ENV_LABELS[env]}的金鑰還沒設定好（${reason}），請先在 .env.local 設定並重新啟動伺服器`, 400);
  }
  await (await settingsCollection()).updateOne(
    { _id: SETTINGS_ID },
    { $set: { env, updatedAt: new Date(), updatedBy } },
    { upsert: true },
  );
}

/** 目前使用的平台的設定；env 指定時改用那個平台（例如繳費機重試時沿用開始時的平台） */
export async function getEzpayConfig(env?: EzpayEnv): Promise<EzpayCredentials> {
  return readEzpayCredentials(env ?? (await getEzpaySettings()).env);
}

// ---- 加解密與檢查碼 ----

/** 同 PHP http_build_query：依欄位順序組成 a=1&b=2，空白編成 + */
export function buildQuery(fields: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])).toString();
}

/** 附件一 addpadding()：補到 32 bytes 的倍數，每個補位 byte 的值等於補位長度 */
function addPadding(data: Buffer, blockSize = 32): Buffer {
  const pad = blockSize - (data.length % blockSize);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

export function encryptPostData(plain: string, hashKey: string, hashIV: string): string {
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(addPadding(Buffer.from(plain, "utf8"))), cipher.final()]).toString("hex");
}

export function decryptPostData(hex: string, hashKey: string, hashIV: string): string {
  const decipher = createDecipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  decipher.setAutoPadding(false);
  const data = Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]);
  return data.subarray(0, data.length - data[data.length - 1]).toString("utf8");
}

const CHECK_CODE_FIELDS = ["InvoiceTransNo", "MerchantID", "MerchantOrderNo", "RandomNum", "TotalAmt"] as const;

/** 附件二：回傳資料的 CheckCode */
export function makeCheckCode(values: Record<(typeof CHECK_CODE_FIELDS)[number], string | number>, hashKey: string, hashIV: string) {
  const sorted = [...CHECK_CODE_FIELDS].sort().map((k) => `${k}=${values[k]}`).join("&");
  return createHash("sha256").update(`HashIV=${hashIV}&${sorted}&HashKey=${hashKey}`).digest("hex").toUpperCase();
}

/** 回傳的 Result 有檢查碼需要的 5 個欄位才驗證；欄位不足（例如作廢的回傳）回傳 null */
function verifyCheckCode(result: Record<string, unknown>, config: EzpayConfig): boolean | null {
  if (typeof result.CheckCode !== "string" || !CHECK_CODE_FIELDS.every((k) => result[k] !== undefined)) return null;
  const values = Object.fromEntries(CHECK_CODE_FIELDS.map((k) => [k, String(result[k])])) as Record<
    (typeof CHECK_CODE_FIELDS)[number],
    string
  >;
  return makeCheckCode(values, config.hashKey, config.hashIV) === result.CheckCode.toUpperCase();
}

/** 不需要商店金鑰的自我檢查：用手冊附件二的範例驗證檢查碼演算法，並確認加解密來回一致 */
export function selfTest() {
  const docKey = "abcdefghijklmnopqrstuvwxyzabcdef";
  const docIV = "1234567891234567";
  const checkCode = makeCheckCode(
    { InvoiceTransNo: "14061313541640927", MerchantID: "3622183", MerchantOrderNo: "201409170000001", RandomNum: "0142", TotalAmt: "500" },
    docKey,
    docIV,
  );
  const expected = "303AB800650B724733B5D91CBCE075D9EA09E4CDE9CD33461D45F07D5EC7EECB";
  const sample = buildQuery({ RespondType: "JSON", Version: "1.5", BuyerName: "王大品", ItemName: "停車費|商品二" });
  const encrypted = encryptPostData(sample, docKey, docIV);
  return {
    checkCode: { ok: checkCode === expected, expected, actual: checkCode },
    aes: { ok: decryptPostData(encrypted, docKey, docIV) === sample, sample, encryptedLength: encrypted.length },
  };
}

// ---- 送出 ----

export interface EzpayCallResult {
  action: EzpayAction;
  label: string;
  url: string;
  env: EzpayEnv;
  /** 加密前送出的欄位（方便對照手冊） */
  fields: Record<string, string | number>;
  httpStatus: number;
  /** 平台原始回應 */
  raw: string;
  status: string | null;
  message: string | null;
  /** 解析後的 Result */
  result: Record<string, unknown> | null;
  /** null = 回傳資料沒有檢查碼需要的欄位，無法驗證 */
  checkCodeValid: boolean | null;
  elapsedMs: number;
}

export async function callEzpay(
  action: EzpayAction,
  data: Record<string, string | number>,
  env?: EzpayEnv,
): Promise<EzpayCallResult> {
  const { config, missing, problems } = await getEzpayConfig(env);
  if (!config) {
    throw new EzpayError(
      [missing.length ? `請在 .env.local 設定 ${missing.join("、")}` : "", ...problems].filter(Boolean).join("；"),
      400,
    );
  }
  const spec = ACTIONS[action];
  const fields = {
    RespondType: "JSON",
    Version: spec.version,
    TimeStamp: Math.floor(Date.now() / 1000),
    ...data,
  };
  const url = `${BASE_URLS[config.env]}/${spec.path}`;
  const body = buildQuery({ MerchantID_: config.merchantId, PostData_: encryptPostData(buildQuery(fields), config.hashKey, config.hashIV) });

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ezPay" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EzpayError(`連不到 ezPay 平台（${url}）：${error instanceof Error ? error.message : error}`, 502);
  }
  const raw = await res.text();

  let status: string | null = null;
  let message: string | null = null;
  let result: Record<string, unknown> | null = null;
  try {
    const json = JSON.parse(raw) as { Status?: string; Message?: string; Result?: unknown };
    status = json.Status ?? null;
    message = json.Message ?? null;
    // Result 是包在 JSON 裡的 JSON 字串
    if (typeof json.Result === "string" && json.Result) result = JSON.parse(json.Result);
    else if (json.Result && typeof json.Result === "object") result = json.Result as Record<string, unknown>;
  } catch {
    // 不是 JSON（例如平台錯誤頁），原始內容放在 raw
  }

  return {
    action,
    label: spec.label,
    url,
    env: config.env,
    fields,
    httpStatus: res.status,
    raw,
    status,
    message,
    result,
    checkCodeValid: result ? verifyCheckCode(result, config) : null,
    elapsedMs: Date.now() - start,
  };
}

// ---- 測試用的預設發票內容 ----

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 自訂編號：限英數與 _、20 字以內、同商店不可重複 */
export function newMerchantOrderNo(date = new Date()): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `T${stamp}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

export interface IssueInput {
  /** 預設 B2C */
  category?: unknown;
  totalAmt?: unknown;
  itemName?: unknown;
  buyerName?: unknown;
  buyerEmail?: unknown;
  /** B2B 必填：買方統一編號 */
  buyerUBN?: unknown;
  buyerAddress?: unknown;
  merchantOrderNo?: unknown;
  /** 手機條碼載具，例如 /ABC+123 */
  carrierNum?: unknown;
  loveCode?: unknown;
  comment?: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * 開立測試發票：應稅 5%、單一品項（停車費），輸入的 totalAmt 是含稅金額
 * - B2C：買受人為個人，可用載具、捐贈或紙本；品項單價與小計為含稅
 * - B2B：買受人為營業人，必填統一編號、一律紙本（PrintFlag=Y）、不可用載具與捐贈；品項單價與小計為未稅
 */
export function buildIssueFields(input: IssueInput): Record<string, string | number> {
  const category: InvoiceCategory = text(input.category).toUpperCase() === "B2B" ? "B2B" : "B2C";
  const totalAmt = input.totalAmt === undefined ? 100 : Number(input.totalAmt);
  if (!Number.isInteger(totalAmt) || totalAmt < 1) throw new EzpayError("totalAmt 必須是 1 以上的整數", 400);
  const merchantOrderNo = text(input.merchantOrderNo) || newMerchantOrderNo();
  if (!/^[A-Za-z0-9_]{1,20}$/.test(merchantOrderNo)) throw new EzpayError("merchantOrderNo 限英數與 _，20 字以內", 400);
  const carrierNum = text(input.carrierNum);
  const loveCode = text(input.loveCode);
  const buyerUBN = text(input.buyerUBN);
  if (category === "B2B") {
    if (!isValidUbn(buyerUBN)) throw new EzpayError("B2B 發票的買方統一編號必須是 8 碼且檢查碼正確", 400);
    if (carrierNum || loveCode) throw new EzpayError("B2B 發票不能使用載具或捐贈", 400);
  } else if (buyerUBN) {
    throw new EzpayError("有統一編號請開 B2B 發票", 400);
  }
  if (carrierNum && !/^\/[0-9A-Z+\-.]{7}$/.test(carrierNum)) throw new EzpayError("手機條碼載具格式錯誤（/ 加 7 碼大寫英數或 +-.）", 400);
  if (loveCode && !/^\d{3,7}$/.test(loveCode)) throw new EzpayError("捐贈碼為 3～7 碼數字", 400);
  if (carrierNum && loveCode) throw new EzpayError("載具與捐贈碼只能擇一", 400);

  // 銷售額 = 含稅金額 / 1.05 四捨五入，稅額 = 發票金額 − 銷售額
  const amt = Math.round(totalAmt / 1.05);
  const itemName = text(input.itemName) || "停車費";
  // 品項金額：B2C 含稅、B2B 未稅
  const itemAmt = category === "B2B" ? amt : totalAmt;
  const buyerName = text(input.buyerName);
  if (buyerName.length > (category === "B2B" ? 60 : 30)) {
    throw new EzpayError(`買受人名稱最多 ${category === "B2B" ? 60 : 30} 字`, 400);
  }
  return {
    TransNum: "",
    MerchantOrderNo: merchantOrderNo,
    Status: "1",
    CreateStatusTime: "",
    Category: category,
    // B2B 沒有公司名稱時，手冊說明可以帶統一編號
    BuyerName: buyerName || (category === "B2B" ? buyerUBN : "消費者"),
    BuyerUBN: category === "B2B" ? buyerUBN : "",
    BuyerAddress: text(input.buyerAddress),
    BuyerEmail: text(input.buyerEmail),
    CarrierType: carrierNum ? "0" : "",
    CarrierNum: carrierNum ? encodeURIComponent(carrierNum) : "",
    LoveCode: loveCode,
    PrintFlag: category === "B2B" || !(carrierNum || loveCode) ? "Y" : "N",
    TaxType: "1",
    TaxRate: "5",
    Amt: amt,
    TaxAmt: totalAmt - amt,
    TotalAmt: totalAmt,
    ItemName: itemName,
    ItemCount: "1",
    ItemUnit: "次",
    ItemPrice: itemAmt,
    ItemAmt: itemAmt,
    Comment: text(input.comment),
  };
}

export function buildInvalidFields(input: { invoiceNumber?: unknown; invalidReason?: unknown }): Record<string, string> {
  const invoiceNumber = text(input.invoiceNumber).toUpperCase();
  if (!/^[A-Z]{2}\d{8}$/.test(invoiceNumber)) throw new EzpayError("invoiceNumber 格式為 2 碼英文 + 8 碼數字", 400);
  const invalidReason = text(input.invalidReason) || "測試作廢";
  return { InvoiceNumber: invoiceNumber, InvalidReason: invalidReason };
}

export function buildSearchFields(input: {
  invoiceNumber?: unknown;
  randomNum?: unknown;
  merchantOrderNo?: unknown;
  totalAmt?: unknown;
}): Record<string, string> {
  const invoiceNumber = text(input.invoiceNumber).toUpperCase();
  const randomNum = text(input.randomNum);
  if (invoiceNumber && randomNum) {
    return { SearchType: "0", MerchantOrderNo: text(input.merchantOrderNo), TotalAmt: text(String(input.totalAmt ?? "")), InvoiceNumber: invoiceNumber, RandomNum: randomNum };
  }
  const merchantOrderNo = text(input.merchantOrderNo);
  const totalAmt = String(input.totalAmt ?? "").trim();
  if (merchantOrderNo && totalAmt) {
    return { SearchType: "1", MerchantOrderNo: merchantOrderNo, TotalAmt: totalAmt, InvoiceNumber: "", RandomNum: "" };
  }
  throw new EzpayError("查詢需要 invoiceNumber + randomNum，或 merchantOrderNo + totalAmt", 400);
}
