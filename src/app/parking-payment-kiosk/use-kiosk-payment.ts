"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KioskInvoiceType, KioskPaymentSession } from "@/lib/parking/kiosk-payment-shared";

// 繳費機收款狀態：開始收款後每 0.5 秒向伺服器查詢已投金額與倒數，收款結束（繳費完成、逾時退幣、取消退幣）時呼叫 onDone。
// 倒數與退幣都在伺服器進行，這裡只負責顯示。
// 繳費完成後要開發票時，開立完成前繼續查詢（伺服器可能自動開立）。

const POLL_MS = 500;

interface PaymentResponse {
  ok: boolean;
  error?: string;
  session?: KioskPaymentSession;
}

export function useKioskPayment(onDone: (session: KioskPaymentSession) => void) {
  const [session, setSession] = useState<KioskPaymentSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 目前這筆收款的 id；換新的一筆或重設後，舊請求晚回來的結果直接丟掉
  const currentId = useRef<string | null>(null);
  const generation = useRef(0);
  const onDoneRef = useRef(onDone);
  const notified = useRef<string | null>(null);
  // 已送出發票選擇的收款 id：送出前發出的查詢晚回來（還是「等待選擇」）時不蓋掉畫面上的「開立中」
  const invoiceChosen = useRef<string | null>(null);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const accept = useCallback((json: PaymentResponse) => {
    if (json.ok && json.session && json.session.id === currentId.current) {
      const next = json.session;
      if (next.invoice?.status === "pending" && invoiceChosen.current === next.id) {
        setSession((prev) => ({ ...next, invoice: prev?.invoice ?? next.invoice }));
      } else setSession(next);
    }
    else if (!json.ok) setError(json.error ?? "收款狀態讀取失敗");
  }, []);

  const start = useCallback(async (body: { entryId: string } | { code: string }) => {
    const gen = ++generation.current;
    currentId.current = null;
    setSession(null);
    setError(null);
    try {
      const res = await fetch("/api/parking/kiosk-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as PaymentResponse;
      if (gen !== generation.current) return;
      if (json.ok && json.session) {
        currentId.current = json.session.id;
        setSession(json.session);
      } else {
        setError(json.error ?? "開始收款失敗");
      }
    } catch {
      if (gen === generation.current) setError("連不到伺服器");
    }
  }, []);

  const cancel = useCallback(async () => {
    const id = currentId.current;
    if (!id) return;
    try {
      accept((await (await fetch(`/api/parking/kiosk-payment?id=${id}`, { method: "DELETE" })).json()) as PaymentResponse);
    } catch {
      setError("連不到伺服器");
    }
  }, [accept]);

  /** 選擇發票開立方式（失敗時再呼叫一次就是重試），等開立完成才回來 */
  const chooseInvoice = useCallback(
    async (choice: { type: KioskInvoiceType; carrierNum?: string; buyerUBN?: string }) => {
      const id = currentId.current;
      if (!id) return;
      invoiceChosen.current = id;
      // 先顯示開立中，不用等 ezPay 回應
      setSession((prev) =>
        prev && prev.id === id && prev.invoice ? { ...prev, invoice: { status: "issuing", type: choice.type } } : prev,
      );
      try {
        const res = await fetch("/api/parking/kiosk-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...choice }),
        });
        const json = (await res.json()) as PaymentResponse;
        invoiceChosen.current = null;
        if (json.ok) accept(json);
        else
          setSession((prev) =>
            prev && prev.id === id ? { ...prev, invoice: { status: "failed", type: choice.type, error: json.error ?? "發票開立失敗" } } : prev,
          );
      } catch {
        invoiceChosen.current = null;
        setSession((prev) =>
          prev && prev.id === id ? { ...prev, invoice: { status: "failed", type: choice.type, error: "連不到伺服器" } } : prev,
        );
      }
    },
    [accept],
  );

  const reset = useCallback(() => {
    generation.current++;
    currentId.current = null;
    setSession(null);
    setError(null);
  }, []);

  const invoiceBusy = session?.invoice?.status === "pending" || session?.invoice?.status === "issuing";
  const active = session !== null && (session.status !== "done" || invoiceBusy);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const id = currentId.current;
      if (!id) return;
      try {
        accept((await (await fetch(`/api/parking/kiosk-payment?id=${id}`)).json()) as PaymentResponse);
      } catch {
        // 暫時連不到就等下一次
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, accept]);

  useEffect(() => {
    if (session?.status === "done" && notified.current !== session.id) {
      notified.current = session.id;
      onDoneRef.current(session);
    }
  }, [session]);

  const remainingSec = session?.status === "collecting" ? Math.ceil(session.remainingMs / 1000) : null;
  return { session, error, remainingSec, start, cancel, reset, chooseInvoice };
}
