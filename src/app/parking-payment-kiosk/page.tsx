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
      className="h-[min(3vh,1.2rem)] w-[min(3vh,1.2rem)]"
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
      className="h-[min(3vh,1.2rem)] w-[min(3vh,1.2rem)]"
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
      className="h-[min(3vh,1.2rem)] w-[min(3vh,1.2rem)] text-emerald-600"
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

export default function ParkingPaymentKioskPage() {
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
      {/* Payment section - upper 1/3 of a 16:9 (9:16) vertical screen */}
      <div className="flex h-2/5 min-h-0 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-[1.5vw] bg-black px-[2vw] py-[0.5vh]">
          <div className="flex h-[min(3.5vh,1.6rem)] w-[min(3.5vh,1.6rem)] shrink-0 items-center justify-center rounded-md bg-white">
            <span className="text-[min(2.4vh,1.1rem)] font-black leading-none text-black">
              P
            </span>
          </div>
          <h1 className="truncate text-[clamp(0.8rem,2.4vh,1.2rem)] font-extrabold tracking-wide text-amber-400">
            停車場繳費系統
          </h1>
        </div>

        {/* Instruction banner */}
        <div className="shrink-0 bg-zinc-800 px-[2vw] py-[0.5vh]">
          <p className="truncate text-[clamp(0.65rem,1.8vh,0.95rem)] font-bold leading-relaxed text-amber-300">
            請輸入車牌後四碼，輸入完成後請按{" "}
            <span className="text-white">「查詢」</span>
          </p>
        </div>

        {/* Input + query + Keypad */}
        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-5 gap-[2px] overflow-hidden bg-zinc-400">
          <div className="col-span-2 flex min-h-0 items-center justify-center overflow-hidden bg-white px-[1.5vw]">
            <span className="truncate font-mono text-[clamp(1.1rem,4.5vh,2.4rem)] font-bold tracking-[0.4em] text-blue-950">
              {plate || " "}
            </span>
          </div>
          <button
            type="button"
            className="flex min-h-0 items-center justify-center gap-[0.6vw] overflow-hidden bg-zinc-200 text-[clamp(1rem,4vh,2.2rem)] font-bold text-zinc-800"
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
                className="flex min-h-0 items-center justify-center overflow-hidden bg-zinc-200 text-[clamp(1rem,4vh,2.2rem)] font-bold text-blue-950"
              >
                {digit}
              </button>
            )),
          )}

          <button
            type="button"
            onClick={handleClear}
            className="flex min-h-0 items-center justify-center gap-[0.6vw] overflow-hidden bg-zinc-200 text-blue-950"
          >
            <ClearIcon />
            <span className="text-[clamp(1rem,4vh,2.2rem)] font-bold">清除</span>
          </button>
          <button
            type="button"
            onClick={() => handleDigit("0")}
            className="flex min-h-0 items-center justify-center overflow-hidden bg-zinc-200 text-[clamp(1rem,4vh,2.2rem)] font-bold text-blue-950"
          >
            0
          </button>
          <button
            type="button"
            className="flex min-h-0 items-center justify-center gap-[0.6vw] overflow-hidden bg-zinc-200 text-blue-950"
          >
            <AllVehiclesIcon />
            <span className="text-[clamp(1rem,4vh,2.2rem)] font-bold">
              全部車輛
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between bg-white px-[2vw] py-[0.2vh] text-[clamp(1.5rem,1.4vw,3rem)] text-blue-950">
          <span>目前時間:{timeLabel}</span>
          <span>Ver 1.0.0</span>
        </div>
      </div>

      {/* Ad section - lower 2/3 of the screen */}
      <div className="relative h-3/5 min-h-0 w-full overflow-hidden bg-black">
        <video
          className="h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          poster="/ads/parking-ad-poster.jpg"
        >
          {/* TODO: 替換成實際廣告影片路徑（可放在 public/ads/ 目錄下） */}
          <source src="/ads/parking-ad.mp4" type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
