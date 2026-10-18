"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isValidUbn } from "@/lib/einvoice/ezpay-shared";
import {
  CARRIER_PATTERN,
  KIOSK_INVOICE_CHOICE_MS,
  type KioskInvoice,
  type KioskInvoiceType,
} from "@/lib/parking/kiosk-payment-shared";
import { InvoicePrint } from "./invoice-print";

// 繳費完成後的發票畫面（蓋滿整個繳費機畫面，白底黑字，白天陽光下也看得清楚）：
// 1. 選擇：掃描手機載具 / 輸入統編 / 直接列印發票；KIOSK_INVOICE_CHOICE_MS 內沒選就自動直接列印，每次操作重新倒數
// 2. 掃描手機載具：條碼掃描器模擬鍵盤輸入（/ 開頭 8 碼，最後送 Enter），掃到正確格式就送出
// 3. 輸入統編：數字鍵盤輸入 8 碼，檢查碼正確才能送出
// 4. 開立中 → 開立完成（列印或存入載具）／開立失敗（可重試），顯示一段時間後回到首頁

export interface InvoiceChoice {
  type: KioskInvoiceType;
  carrierNum?: string;
  buyerUBN?: string;
}

type Screen = "choose" | "carrier" | "ubn";

// 開立完成後停留多久回首頁
const DONE_PRINT_MS = 12_000;
const DONE_CARRIER_MS = 6_000;
const FAILED_MS = 30_000;

const big = "text-[clamp(1.4rem,4.2vh,3rem)]";
const huge = "text-[clamp(1.8rem,6vh,4.5rem)]";
const actionButton =
  "rounded-xl border-[3px] border-black font-black shadow-[0_5px_0_#000] active:translate-y-[4px] active:shadow-none disabled:opacity-40";

function useCountdown(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** 倒數 ms 後呼叫 onDone，顯示剩餘秒數；用 key 重新計時 */
function AutoClose({ ms, onDone }: { ms: number; onDone: () => void }) {
  const [deadline] = useState(() => Date.now() + ms);
  const remaining = useCountdown(deadline);
  useEffect(() => {
    if (remaining === 0) onDone();
  }, [remaining, onDone]);
  return <>{remaining}</>;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[6vh] w-[6vh] shrink-0" fill="currentColor" aria-hidden>
      <path d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 3v14h10V4zm3 15v2h4v-2zM8 7h1v8H8zm2 0h2v8h-2zm3 0h1v8h-1zm2 0h1v8h-1z" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[6vh] w-[6vh] shrink-0" fill="currentColor" aria-hidden>
      <path d="M3 21V3h12v6h6v12zm2-2h2v-2H5zm0-4h2v-2H5zm0-4h2V9H5zm0-4h2V5H5zm4 12h2v-2H9zm0-4h2v-2H9zm0-4h2V9H9zm0-4h2V5H9zm6 12h4v-2h-4zm0-4h4v-2h-4zm0-4h4V9h-4z" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[6vh] w-[6vh] shrink-0" fill="currentColor" aria-hidden>
      <path d="M6 2h12v5H6zM3 8h18a1 1 0 0 1 1 1v8h-4v5H6v-5H2V9a1 1 0 0 1 1-1zm5 8v4h8v-4zm10-6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}

function ChoiceButton({
  icon,
  label,
  hint,
  className,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${actionButton} flex h-[14vh] w-full items-center gap-[3vw] px-[5vw] text-left ${className}`}
    >
      {icon}
      <span className="flex flex-col">
        <span className={huge}>{label}</span>
        <span className="text-[clamp(1rem,2.6vh,1.8rem)] font-bold">{hint}</span>
      </span>
    </button>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

function UbnKeypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-[1.5vw]">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() =>
            onChange(k === "clear" ? "" : k === "back" ? value.slice(0, -1) : value.length < 8 ? value + k : value)
          }
          className={`${actionButton} h-[8vh] bg-zinc-100 text-black ${k.length > 1 ? big : huge}`}
        >
          {k === "clear" ? "清除" : k === "back" ? "← 刪除" : k}
        </button>
      ))}
    </div>
  );
}

export function InvoiceStep({
  invoice,
  amount,
  paidText,
  sellerName,
  onChoose,
  onClose,
}: {
  invoice: KioskInvoice;
  amount: number;
  /** 繳費結果（例如「繳費完成，找零 50 元，謝謝光臨」） */
  paidText: string;
  sellerName: string;
  onChoose: (choice: InvoiceChoice) => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [carrier, setCarrier] = useState("");
  const [ubn, setUbn] = useState("");
  const [lastChoice, setLastChoice] = useState<InvoiceChoice>({ type: "print" });
  const [reprint, setReprint] = useState(0);
  // 選擇畫面的倒數；每次操作重新計時
  const [deadline, setDeadline] = useState(() => Date.now() + KIOSK_INVOICE_CHOICE_MS);
  const touch = () => setDeadline(Date.now() + KIOSK_INVOICE_CHOICE_MS);
  const remaining = useCountdown(deadline);

  const choose = (choice: InvoiceChoice) => {
    setLastChoice(choice);
    onChoose(choice);
  };

  // 沒選就自動直接列印
  const pending = invoice.status === "pending";
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });
  useEffect(() => {
    if (pending && remaining === 0) chooseRef.current({ type: "print" });
  }, [pending, remaining]);

  // 條碼掃描器像鍵盤一樣輸入，最後送 Enter
  const carrierRef = useRef(carrier);
  useEffect(() => {
    carrierRef.current = carrier;
  }, [carrier]);
  useEffect(() => {
    if (!pending || screen !== "carrier") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (CARRIER_PATTERN.test(carrierRef.current)) chooseRef.current({ type: "carrier", carrierNum: carrierRef.current });
        return;
      }
      if (e.key === "Backspace") {
        setCarrier((v) => v.slice(0, -1));
        return;
      }
      if (e.key.length !== 1) return;
      e.preventDefault();
      setDeadline(Date.now() + KIOSK_INVOICE_CHOICE_MS);
      const ch = e.key.toUpperCase();
      // 掃到 / 就是新的一筆條碼
      setCarrier((v) => (ch === "/" ? "/" : (v + ch).slice(0, 8)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, screen]);

  // 開立完成或失敗：停留一段時間後回首頁；重新列印時重新計時
  const autoClose = (ms: number) => <AutoClose key={`${invoice.status}:${reprint}`} ms={ms} onDone={onClose} />;

  const carrierOk = CARRIER_PATTERN.test(carrier);
  const ubnOk = isValidUbn(ubn);

  let body: ReactNode;
  if (invoice.status === "issuing") {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-[3vh]">
        <div className="h-[10vh] w-[10vh] animate-spin rounded-full border-[1.2vh] border-zinc-300 border-t-black" />
        <p className={`${huge} font-black`}>發票開立中，請稍候…</p>
      </div>
    );
  } else if (invoice.status === "issued") {
    const number = `${invoice.invoiceNumber.slice(0, 2)}-${invoice.invoiceNumber.slice(2)}`;
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
        <p className={`${huge} font-black text-green-800`}>
          {invoice.print ? "發票列印中，請取發票" : "發票已存入手機載具"}
        </p>
        <p className={`${big} font-bold`}>發票號碼：{number}</p>
        {invoice.carrierNum && <p className={`${big} font-mono font-bold`}>載具：{invoice.carrierNum}</p>}
        {invoice.type === "ubn" && invoice.print?.buyerUBN && (
          <p className={`${big} font-bold`}>買方統編：{invoice.print.buyerUBN}</p>
        )}
        <div className="mt-[2vh] flex gap-[3vw]">
          {invoice.print && (
            <button
              type="button"
              onClick={() => setReprint((n) => n + 1)}
              className={`${actionButton} ${big} bg-white px-[5vw] py-[2vh] text-black`}
            >
              沒印出來？重新列印
            </button>
          )}
          <button type="button" onClick={onClose} className={`${actionButton} ${big} bg-black px-[6vw] py-[2vh] text-white`}>
            完成（{autoClose(invoice.print ? DONE_PRINT_MS : DONE_CARRIER_MS)} 秒）
          </button>
        </div>
        {invoice.print && <InvoicePrint invoice={invoice.print} sellerName={sellerName} reprintKey={reprint} />}
      </div>
    );
  } else if (invoice.status === "failed") {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] text-center">
        <p className={`${huge} font-black text-red-700`}>發票開立失敗</p>
        <p className={`${big} font-bold`}>{invoice.error}</p>
        <p className={`${big} font-bold`}>請按「重試」，或洽管理人員</p>
        <div className="mt-[2vh] flex gap-[3vw]">
          <button
            type="button"
            onClick={() => choose(lastChoice)}
            className={`${actionButton} ${big} bg-amber-400 px-[6vw] py-[2vh] text-black`}
          >
            重試
          </button>
          <button type="button" onClick={onClose} className={`${actionButton} ${big} bg-white px-[6vw] py-[2vh] text-black`}>
            結束（{autoClose(FAILED_MS)} 秒）
          </button>
        </div>
      </div>
    );
  } else if (screen === "carrier") {
    body = (
      <div className="flex flex-1 flex-col gap-[3vh]">
        <p className={`${huge} font-black`}>請將手機條碼對準掃描器</p>
        <div
          className={`flex h-[12vh] items-center justify-center rounded-xl border-[4px] bg-zinc-50 font-mono ${huge} font-black tracking-[0.15em] ${
            carrier.length === 8 && !carrierOk ? "border-red-600 text-red-700" : "border-black text-black"
          }`}
        >
          {carrier || <span className="text-zinc-400">/ _ _ _ _ _ _ _</span>}
        </div>
        <p className={`${big} font-bold ${carrier.length === 8 && !carrierOk ? "text-red-700" : "text-zinc-700"}`}>
          {carrier.length === 8 && !carrierOk ? "條碼格式不正確，請重新掃描" : "手機條碼為 / 開頭共 8 碼，發票存入載具不列印"}
        </p>
        <div className="mt-auto grid grid-cols-3 gap-[2vw]">
          <button
            type="button"
            onClick={() => {
              touch();
              setScreen("choose");
              setCarrier("");
            }}
            className={`${actionButton} ${big} h-[9vh] bg-white text-black`}
          >
            ← 返回
          </button>
          <button
            type="button"
            onClick={() => {
              touch();
              setCarrier("");
            }}
            className={`${actionButton} ${big} h-[9vh] bg-white text-black`}
          >
            重新掃描
          </button>
          <button
            type="button"
            disabled={!carrierOk}
            onClick={() => choose({ type: "carrier", carrierNum: carrier })}
            className={`${actionButton} ${big} h-[9vh] bg-green-800 text-white`}
          >
            確定
          </button>
        </div>
      </div>
    );
  } else if (screen === "ubn") {
    body = (
      <div className="flex flex-1 flex-col gap-[2vh]">
        <p className={`${huge} font-black`}>請輸入公司統一編號</p>
        <div className="grid grid-cols-8 gap-[1vw]">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className={`flex h-[9vh] items-center justify-center rounded-lg border-[3px] bg-zinc-50 font-mono ${huge} font-black ${
                ubn.length === 8 && !ubnOk ? "border-red-600 text-red-700" : "border-black text-black"
              }`}
            >
              {ubn[i] ?? ""}
            </div>
          ))}
        </div>
        <p className={`${big} font-bold ${ubn.length === 8 && !ubnOk ? "text-red-700" : "text-zinc-700"}`}>
          {ubn.length === 8 && !ubnOk ? "統一編號不正確，請重新輸入" : "發票會印上買方統編（含銷售額與稅額）"}
        </p>
        <UbnKeypad
          value={ubn}
          onChange={(v) => {
            touch();
            setUbn(v);
          }}
        />
        <div className="mt-auto grid grid-cols-2 gap-[2vw]">
          <button
            type="button"
            onClick={() => {
              touch();
              setScreen("choose");
              setUbn("");
            }}
            className={`${actionButton} ${big} h-[9vh] bg-white text-black`}
          >
            ← 返回
          </button>
          <button
            type="button"
            disabled={!ubnOk}
            onClick={() => choose({ type: "ubn", buyerUBN: ubn })}
            className={`${actionButton} ${big} h-[9vh] bg-blue-900 text-white`}
          >
            確定，列印發票
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-1 flex-col gap-[3vh]">
        <p className={`${huge} font-black`}>請選擇發票開立方式</p>
        <ChoiceButton
          icon={<PhoneIcon />}
          label="掃描手機載具"
          hint="發票存入手機條碼，不列印"
          className="bg-green-800 text-white"
          onClick={() => {
            touch();
            setCarrier("");
            setScreen("carrier");
          }}
        />
        <ChoiceButton
          icon={<BuildingIcon />}
          label="輸入統編"
          hint="公司報帳用，列印有統編的發票"
          className="bg-blue-900 text-white"
          onClick={() => {
            touch();
            setUbn("");
            setScreen("ubn");
          }}
        />
        <ChoiceButton
          icon={<PrinterIcon />}
          label="直接列印發票"
          hint="列印電子發票證明聯"
          className="bg-amber-400 text-black"
          onClick={() => choose({ type: "print" })}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col gap-[3vh] border-[10px] border-amber-400 bg-white px-[5vw] py-[4vh] text-black">
      <div className="space-y-[1vh] border-b-4 border-black pb-[2vh]">
        <p className={`${huge} font-black text-green-800`}>✔ {paidText}</p>
        <p className={`${big} font-bold`}>發票金額：{amount} 元</p>
      </div>
      {body}
      {pending && (
        <p className={`${big} rounded-lg bg-black py-[1.5vh] text-center font-bold text-white`}>
          <span className="text-amber-300">{remaining}</span> 秒後自動列印發票
        </p>
      )}
    </div>
  );
}
