// ezPay 電子發票：前後端共用，不可引用 server-only 模組

export type InvoiceCategory = "B2C" | "B2B";

/** 統一編號檢查碼（財政部 112 年起的規則：加總能被 5 整除；第 7 碼為 7 時加總 +1 也算） */
export function isValidUbn(ubn: string): boolean {
  if (!/^\d{8}$/.test(ubn)) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  const sum = weights.reduce((acc, w, i) => {
    const product = Number(ubn[i]) * w;
    return acc + Math.floor(product / 10) + (product % 10);
  }, 0);
  return sum % 5 === 0 || (ubn[6] === "7" && (sum + 1) % 5 === 0);
}
