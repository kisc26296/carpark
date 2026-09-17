"use client";

import { useEffect, useState } from "react";

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[min(6vh,2.2rem)] w-[min(6vh,2.2rem)]"
    >
      <path d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

function AllVehiclesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[min(6vh,2.2rem)] w-[min(6vh,2.2rem)]"
    >
      <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

function QueryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[min(6vh,2.2rem)] w-[min(6vh,2.2rem)] text-emerald-600"
    >
      <path d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

const KEYPAD_ROWS = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
];

const MAX_DIGITS = 4;

export default function ParkingPaymentPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [plate, setPlate] = useState("");

  const handleDigit = (digit: string) => {
    setPlate((prev) => (prev.length < MAX_DIGITS ? prev + digit : prev));
  };

  const handleClear = () => setPlate("");

  useEffect(() => {
    const tick = () => setNow(new Date());
    const immediate = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, []);

  const timeLabel = now
    ? `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(
        now.getDate(),
      ).padStart(2, "0")}  ${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes(),
      ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
    : "";

  return (
    <div className="box-border flex h-screen w-screen flex-col overflow-hidden border-[10px] border-amber-400 bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-[1.5vw] bg-black px-[2vw] py-[1.2vh]">
        <div className="flex h-[min(7vh,3.5rem)] w-[min(7vh,3.5rem)] shrink-0 items-center justify-center rounded-md bg-white">
          <span className="text-[min(5vh,2.5rem)] font-black leading-none text-black">
            P
          </span>
        </div>
        <h1 className="truncate text-[clamp(4rem,3.2vw,2.25rem)] font-extrabold tracking-wide text-amber-400">
          停車場繳費系統
        </h1>
      </div>

      {/* Instruction banner */}
      <div className="shrink-0 bg-zinc-800 px-[2vw] py-[1.4vh]">
        <p className="text-[clamp(2rem,2vw,3rem)] font-bold leading-relaxed text-amber-300">
          請輸入車牌後四碼，輸入完成後請按{" "}
          <span className="text-white">「查詢」</span>
        </p>
      </div>

      {/* Input + query + Keypad */}
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-5 gap-[2px] overflow-hidden bg-zinc-400">
        <div className="col-span-2 flex min-h-0 items-center justify-center overflow-hidden bg-white px-[1.5vw]">
          <span className="truncate font-mono text-[clamp(2rem,9vh,5rem)] font-bold tracking-[0.7em] text-blue-950">
            {plate || " "}
          </span>
        </div>
        <button
          type="button"
          className="flex min-h-0 items-center justify-center gap-[0.8vw] overflow-hidden bg-zinc-200 text-[clamp(1.5rem,7vh,4rem)] font-bold text-zinc-800"
        >
          <QueryIcon />
          查詢
        </button>

        {KEYPAD_ROWS.flatMap((row) =>
          row.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              className="flex min-h-0 items-center justify-center overflow-hidden bg-zinc-200 text-[clamp(1.5rem,7vh,4rem)] font-bold text-blue-950"
            >
              {digit}
            </button>
          )),
        )}

        <button
          type="button"
          onClick={handleClear}
          className="flex min-h-0 items-center justify-center gap-[0.8vw] overflow-hidden bg-zinc-200 text-blue-950"
        >
          <ClearIcon />
          <span className="text-[clamp(3rem,7vh,4rem)] font-bold">
            清除
          </span>
        </button>
        <button
          type="button"
          onClick={() => handleDigit("0")}
          className="flex min-h-0 items-center justify-center overflow-hidden bg-zinc-200 text-[clamp(1.5rem,7vh,4rem)] font-bold text-blue-950"
        >
          0
        </button>
        <button
          type="button"
          className="flex min-h-0 items-center justify-center gap-[0.8vw] overflow-hidden bg-zinc-200 text-blue-950"
        >
          <AllVehiclesIcon />
          <span className="text-[clamp(1.5rem,7vh,4rem)] font-bold">
            全部車輛
          </span>
        </button>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between bg-white px-[2vw] py-[0.8vh] text-[clamp(2.5rem,1.4vw,4rem)] text-blue-950">
        <span>目前時間:{timeLabel}</span>
        <span>Ver 1.0.0</span>
      </div>
    </div>
  );
}
