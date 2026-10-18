"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { PrintedInvoice } from "@/lib/parking/kiosk-payment-shared";

// 電子發票證明聯（57mm 感熱紙）：用瀏覽器列印。只在列印時出現，畫面上看不到。
// 繳費機的瀏覽器請用 --kiosk-printing 啟動（Edge / Chrome），列印時不跳出對話框、直接送到預設印表機。
// 版面依財政部電子發票證明聯格式：營業人名稱、「電子發票證明聯」、期別、發票號碼、開立時間、
// 隨機碼、總計、賣方（與買方）統編、一維條碼（Code 39）、左右兩個 QR Code。

// Code 39：每個字 5 條 4 空交錯（條開始），n 窄、w 寬；發票條碼只會用到數字與大寫英文
const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
};
const WIDE = 2.5;

function Code39({ value }: { value: string }) {
  const bars = useMemo(() => {
    const rects: { x: number; w: number }[] = [];
    let x = 0;
    for (const ch of `*${value.toUpperCase()}*`) {
      const pattern = CODE39[ch];
      if (!pattern) continue;
      [...pattern].forEach((p, i) => {
        const w = p === "w" ? WIDE : 1;
        if (i % 2 === 0) rects.push({ x, w });
        x += w;
      });
      x += 1; // 字與字之間的窄空白
    }
    return { rects, width: x - 1 };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${bars.width} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" className="h-[9mm] w-full">
      {bars.rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={40} fill="#000" />
      ))}
    </svg>
  );
}

function QrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    // 錯誤修正等級 L：內容較長（含中文品名）時方塊比較大、比較好掃
    const { modules } = QRCode.create(value || " ", { errorCorrectionLevel: "L" });
    let d = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { d, size: modules.size };
  }, [value]);
  return (
    <svg viewBox={`-1 -1 ${path.size + 2} ${path.size + 2}`} shapeRendering="crispEdges" className="h-[23mm] w-[23mm]">
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/** 期別：條碼前 5 碼是民國年 3 碼 + 雙數月 2 碼，例如 11510 → 115年09-10月 */
function periodLabel(barCode: string): string {
  const year = barCode.slice(0, 3);
  const month = Number(barCode.slice(3, 5));
  if (!year || !month) return "";
  return `${year}年${String(month - 1).padStart(2, "0")}-${String(month).padStart(2, "0")}月`;
}

/** 列印電子發票證明聯；同一張發票只自動列印一次，reprintKey 改變時再印一次 */
export function InvoicePrint({ invoice, sellerName, reprintKey }: { invoice: PrintedInvoice; sellerName: string; reprintKey: number }) {
  const printed = useRef<string | null>(null);
  const key = `${invoice.invoiceNumber}#${reprintKey}`;

  useEffect(() => {
    if (printed.current === key) return;
    // 等條碼畫好再列印；真的印了才記下來（effect 被取消重跑時還會再排一次）
    const timer = setTimeout(() => {
      printed.current = key;
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, [key]);

  const b2b = invoice.buyerUBN !== "";
  const number = `${invoice.invoiceNumber.slice(0, 2)}-${invoice.invoiceNumber.slice(2)}`;

  return createPortal(
    <div id="kiosk-invoice-print" className="hidden bg-white font-sans text-black print:block">
      <style>{`
        @media print {
          @page { size: 57mm auto; margin: 0; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          body > *:not(#kiosk-invoice-print) { display: none !important; }
        }
      `}</style>
      <div className="w-[57mm] px-[4mm] py-[3mm] text-center leading-tight">
        <p className="text-[4mm] font-bold">{sellerName}</p>
        <p className="mt-[1mm] text-[6mm] font-black">電子發票證明聯</p>
        <p className="text-[6mm] font-black">{periodLabel(invoice.barCode)}</p>
        <p className="text-[6mm] font-black tracking-wide">{number}</p>
        <div className="mt-[1mm] space-y-[0.5mm] text-left text-[3mm]">
          <p className="flex justify-between">
            <span>{invoice.createTime}</span>
            {b2b && <span>格式 25</span>}
          </p>
          <p className="flex justify-between">
            <span>隨機碼 {invoice.randomNum}</span>
            <span>總計 {invoice.totalAmt}</span>
          </p>
          <p className="flex justify-between">
            <span>賣方 {invoice.sellerUBN}</span>
            {b2b && <span>買方 {invoice.buyerUBN}</span>}
          </p>
        </div>
        <div className="mt-[1.5mm]">
          <Code39 value={invoice.barCode} />
        </div>
        <div className="mt-[1.5mm] flex justify-between">
          <QrCode value={invoice.qrCodeL} />
          <QrCode value={invoice.qrCodeR} />
        </div>
        {b2b && (
          <div className="mt-[2mm] space-y-[0.5mm] border-t border-dashed border-black pt-[1.5mm] text-left text-[3mm]">
            <p className="flex justify-between">
              <span>停車費 1 次</span>
              <span>{invoice.amt}</span>
            </p>
            <p className="flex justify-between">
              <span>銷售額</span>
              <span>{invoice.amt}</span>
            </p>
            <p className="flex justify-between">
              <span>稅額</span>
              <span>{invoice.taxAmt}</span>
            </p>
            <p className="flex justify-between font-bold">
              <span>總計</span>
              <span>{invoice.totalAmt}</span>
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
