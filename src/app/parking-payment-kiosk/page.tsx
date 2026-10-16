"use client";

import { useCallback, useEffect, useState } from "react";
import type { KioskMonthlyInfo, KioskPaymentSession } from "@/lib/parking/kiosk-payment-shared";
import type { KioskVideoPlayer } from "@/lib/parking/kiosk-video-shared";
import { formatDateTime } from "@/lib/parking/parking-entry-shared";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/parking/rate-shared";
import { useKioskPayment } from "./use-kiosk-payment";

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
// 錯誤訊息停留多久自動回到輸入畫面，避免下一位客人看到上一筆
const ERROR_TIMEOUT_MS = 3_000;
// 選擇車輛照片的倒數：時間到還沒點選照片就回到輸入畫面；翻頁會重新計時
const SELECT_TIMEOUT_MS = 180_000;
const VEHICLES_PER_PAGE = 4;
// 手動新增的進場紀錄沒有攝影機照片，用這張預設圖（和進場紀錄頁相同）
const MANUAL_ENTRY_IMAGE = "/images/manual-entry.jpg";

interface InsideVehicle {
  id: string;
  plate: string;
  entryTime: string;
  hasImage: boolean;
}

type QueryResult =
  | { kind: "vehicles"; items: InsideVehicle[] }
  | { kind: "charge"; code: string; amount: number }
  | { kind: "error"; text: string };

type Payment = ReturnType<typeof useKioskPayment>;

/** 蓋在照片上的訊息：text 大字，detail 為各面額硬幣明細 */
interface Banner {
  text: string;
  detail: string | null;
}

/** 收款結束後顯示的訊息，delay 毫秒後回到輸入車號頁面 */
interface Finish extends Banner {
  delay: number;
}

/** 各面額枚數，例如「50元×1、10元×2」 */
const coinsText = (coins: KioskPaymentSession["coins"], key: "planned" | "dispensed") =>
  coins
    .filter((c) => c[key] > 0)
    .map((c) => `${c.value}元×${c[key]}`)
    .join("、");

const ymd = (date: string) => date.replaceAll("-", "/");

/** 月租狀態說明，例如「有效（到期日 2026/12/31）」「已於 2026/09/30 到期，自 2026/10/01 00:00 起計費」 */
function monthlyText(m: KioskMonthlyInfo): string {
  switch (m.status) {
    case "valid":
      return `有效（到期日 ${ymd(m.endDate)}），無須繳費`;
    case "expired":
      return `已於 ${ymd(m.endDate)} 到期，自 ${formatDateTime(m.chargeFrom).slice(0, 16)} 起計費`;
    case "disabled":
      return "已停用，依臨停費率計費";
    case "notStarted":
      return `${ymd(m.startDate)} 才開始，依臨停費率計費`;
  }
}

function describeFinish(s: KioskPaymentSession): Finish {
  // 有效的月租車不用付錢，開始收款就直接結束
  if (s.outcome === "paid" && s.target.kind === "entry" && s.target.monthly?.status === "valid") {
    return { text: "月租車，無須繳費", detail: `月租到期日：${ymd(s.target.monthly.endDate)}`, delay: 5000 };
  }
  const kind = s.outcome === "paid" ? "找零" : "退幣";
  const detail = s.returned > 0 ? `${kind}：${coinsText(s.coins, "dispensed")}` : null;
  // 出幣機沒出足（沒連線、缺幣）時提醒找管理人員
  if (s.returned < s.toReturn) {
    const head = s.outcome === "paid" ? "繳費完成" : s.outcome === "timeout" ? "逾時未繳費" : "已取消";
    return {
      text: `${head}，應${kind} ${s.toReturn} 元，已${kind === "找零" ? "找" : "退"} ${s.returned} 元，請洽管理人員`,
      detail,
      delay: 10000,
    };
  }
  if (s.outcome === "paid") {
    return { text: `繳費完成${s.toReturn > 0 ? `，找零 ${s.returned} 元` : ""}，謝謝光臨`, detail, delay: 5000 };
  }
  const prefix = s.outcome === "timeout" ? "逾時未繳費" : "已取消";
  return s.paid > 0
    ? { text: `${prefix}，已退還 ${s.returned} 元`, detail, delay: 4000 }
    : { text: prefix, detail: null, delay: s.outcome === "timeout" ? 1500 : 0 };
}

/** 找零 / 退幣中顯示各面額進度，結束後顯示結果 */
function bannerFor(payment: Payment, finish: Finish | null): Banner | null {
  if (finish) return finish;
  const s = payment.session;
  if (s?.status !== "dispensing") return null;
  const kind = s.outcome === "paid" ? "找零" : "退幣";
  const progress = s.coins
    .filter((c) => c.planned > 0)
    .map((c) => `${c.value}元 ${c.dispensed}/${c.planned}`)
    .join("、");
  return { text: `${kind}中，共 ${s.toReturn} 元…`, detail: progress || null };
}

const vehicleImage = (v: InsideVehicle) =>
  v.hasImage ? `/api/parking/entries/image?id=${v.id}&kind=entry` : MANUAL_ENTRY_IMAGE;

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[min(5vh,2.6rem)] w-[min(5vh,2.6rem)] text-sky-500">
      <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.69-8.69a2.25 2.25 0 00-3.18 0l-8.69 8.69a.75.75 0 001.06 1.06l8.69-8.69z" />
      <path d="M12 5.43l8.16 8.16.09.08v6.2c0 1.04-.84 1.88-1.88 1.88H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.63a1.88 1.88 0 01-1.88-1.88v-6.2l.09-.08L12 5.43z" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[min(5vh,2.6rem)] w-[min(5vh,2.6rem)]">
      <circle cx="12" cy="12" r="11" className="fill-amber-300" />
      <path
        d={direction === "left" ? "M17 12H7m0 0l4-4m-4 4l4 4" : "M7 12h10m0 0l-4-4m4 4l-4 4"}
        fill="none"
        stroke="white"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 查到的場內車輛照片，一頁最多 4 台（2 × 2），點選照片計算應繳金額 */
function VehicleGrid({
  items,
  page,
  onPage,
  onSelect,
  onHome,
  remainingSec,
}: {
  items: InsideVehicle[];
  remainingSec: number;
  page: number;
  onPage: (page: number) => void;
  onSelect: (v: InsideVehicle) => void;
  onHome: () => void;
}) {
  const pageCount = Math.ceil(items.length / VEHICLES_PER_PAGE);
  const slots = Array.from({ length: VEHICLES_PER_PAGE }, (_, i) => items[page * VEHICLES_PER_PAGE + i] ?? null);
  const navClass =
    "flex min-h-0 items-center justify-between gap-[1vw] bg-zinc-200 px-[1.5vw] text-[clamp(0.9rem,3vh,1.6rem)] font-bold text-zinc-800 disabled:text-zinc-400";

  return (
    <div className="flex h-full w-full flex-col bg-zinc-700">
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[min(6vh,3rem)] shrink-0 flex-col items-center justify-center gap-[0.5vh] bg-white text-[clamp(1rem,3.5vh,2rem)] font-black leading-none text-red-600">
          {[..."點選照片繳費"].map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-[2px] bg-zinc-300 p-[2px]">
          {slots.map((v, i) =>
            v ? (
              <button
                key={v.id}
                type="button"
                onClick={() => onSelect(v)}
                className="relative min-h-0 overflow-hidden bg-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 照片由 API 從本機檔案讀出，不經過 next/image 最佳化 */}
                <img src={vehicleImage(v)} alt={v.plate} className="h-full w-full object-cover" />
                <span className="absolute left-[0.5vw] top-[0.5vh] bg-white px-[0.5vw] font-mono text-[clamp(0.9rem,3vh,1.8rem)] leading-tight text-black">
                  {v.plate}
                </span>
                <span className="absolute bottom-[0.5vh] left-[0.5vw] bg-white px-[0.5vw] font-mono text-[clamp(0.7rem,2.2vh,1.3rem)] leading-tight text-black">
                  {formatDateTime(v.entryTime)}
                </span>
              </button>
            ) : (
              <div key={`empty-${i}`} className="min-h-0 bg-zinc-600" />
            ),
          )}
        </div>
      </div>
      <div className="grid h-[min(8vh,4.5rem)] shrink-0 grid-cols-4 gap-[2px] bg-zinc-400">
        <div className="flex min-h-0 items-baseline justify-center gap-[0.5vw] bg-zinc-100 font-bold">
          <span className="text-[clamp(1.5rem,6vh,3.5rem)] leading-none text-red-700">{page + 1}</span>
          <span className="text-[clamp(0.8rem,2.2vh,1.2rem)] text-zinc-500">/ {pageCount}</span>
          <span className="ml-[1vw] self-center text-[clamp(0.8rem,2.6vh,1.4rem)]">
            <Countdown seconds={remainingSec} />
          </span>
        </div>
        <button type="button" onClick={onHome} className={navClass}>
          <HomeIcon />
          首頁
        </button>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} className={navClass}>
          <span className={page === 0 ? "opacity-40" : ""}>
            <ArrowIcon direction="left" />
          </span>
          上一頁
        </button>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1} className={navClass}>
          下一頁
          <span className={page >= pageCount - 1 ? "opacity-40" : ""}>
            <ArrowIcon direction="right" />
          </span>
        </button>
      </div>
    </div>
  );
}

/** 收款中的倒數秒數；剩 30 秒以內變紅色提醒 */
function Countdown({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <span className="text-zinc-700">—</span>;
  return (
    <span className={`font-bold ${seconds <= 30 ? "text-red-700" : "text-blue-900"}`}>
      {seconds} <span className="font-normal text-green-800">秒</span>
    </span>
  );
}

/** 應繳 / 已繳金額欄（黑底），車輛繳費與單次收費共用 */
function AmountPanel({ payment }: { payment: Payment }) {
  const { session, error } = payment;
  const labelClass = "text-[clamp(1.1rem,4vh,2.4rem)] font-bold text-white";
  const amountClass = "text-[clamp(2rem,9vh,5.5rem)] font-bold leading-none";
  return (
    <div className="flex min-h-0 w-1/3 flex-col gap-[2px] bg-zinc-300">
      <div className="flex min-h-0 flex-1 items-center bg-black px-[2vw]">
        <span className={labelClass}>應繳金額</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black text-center">
        {session ? (
          <span className={`${amountClass} text-red-600`}>{session.due}</span>
        ) : (
          <span className={`text-[clamp(0.9rem,3vh,1.6rem)] font-bold ${error ? "text-red-500" : "text-zinc-400"}`}>
            {error ?? "計算中…"}
          </span>
        )}
      </div>
      <div className="h-[1.5vh] shrink-0 bg-white" />
      <div className="flex min-h-0 flex-1 items-center bg-black px-[2vw]">
        <span className={labelClass}>已繳金額</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        <span className={`${amountClass} text-green-500`}>{session?.paid ?? 0}</span>
      </div>
    </div>
  );
}

/** 找零 / 退幣進度與收款結束的訊息，蓋在照片上 */
function FinishBanner({ payment, finish }: { payment: Payment; finish: Finish | null }) {
  const banner = bannerFor(payment, finish);
  if (!banner) return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.5vh] bg-black/70 px-[3vw] text-center">
      <p className="text-[clamp(1.4rem,6vh,3.5rem)] font-black text-amber-300">{banner.text}</p>
      {banner.detail && <p className="text-[clamp(1rem,3.5vh,2rem)] font-bold text-white">{banner.detail}</p>}
    </div>
  );
}

function CancelButton({ payment, onCancel }: { payment: Payment; onCancel: () => void }) {
  // 找零 / 退幣中不能取消
  const busy = payment.session !== null && payment.session.status !== "collecting";
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={busy}
      className="bg-orange-400 text-[clamp(1.2rem,4.5vh,2.6rem)] font-bold text-white disabled:opacity-60"
    >
      {payment.session?.status === "dispensing" ? "退幣中…" : "取消"}
    </button>
  );
}

// 廣告影片、停車場名稱多久重新讀一次，資料庫設定頁改了之後不用重新整理繳費機
const AD_REFRESH_MS = 60_000;
// 「資料庫設定」沒設定停車場名稱時的抬頭
const DEFAULT_TITLE = "停車場繳費系統";

/** 「資料庫設定」裡的停車場名稱，定時重新讀取；讀取中或未設定為空字串 */
function useParkingLotName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    const load = () =>
      fetch("/api/parking/lot-info")
        .then((res) => res.json())
        .then((json: { ok: boolean; info?: { name: string } }) => {
          if (json.ok && json.info) setName(json.info.name);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, AD_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return name;
}

/** 畫面下方的廣告影片，播放「資料庫設定」指定的影片檔或網路連結 */
function AdPlayer() {
  const [player, setPlayer] = useState<KioskVideoPlayer>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/parking/kiosk-video")
        .then((res) => res.json())
        .then((json: { ok: boolean; video?: { player: KioskVideoPlayer } }) => {
          if (!json.ok || !json.video) return;
          const next = json.video.player;
          // 內容沒變就不換，避免影片每分鐘從頭播放
          setPlayer((prev) => (prev?.type === next?.type && prev?.src === next?.src ? prev : next));
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, AD_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (!player) return null;
  if (player.type === "youtube") {
    // 不讓客人點到 YouTube 播放器
    return <iframe src={player.src} title="廣告影片" allow="autoplay; encrypted-media" className="pointer-events-none h-full w-full" />;
  }
  return <video key={player.src} src={player.src} className="h-full w-full object-cover" autoPlay loop muted playsInline />;
}

// 各支付方式按鈕的顏色；目前只有現金接上收款設備，其他按下時提示尚未開放
const METHOD_STYLES: Record<PaymentMethod, { className: string; available: boolean }> = {
  cash: { className: "bg-amber-400 text-zinc-900", available: true },
  card: { className: "bg-sky-600 text-white", available: false },
  applePay: { className: "bg-zinc-900 text-white ring-1 ring-zinc-500", available: false },
  linePay: { className: "bg-green-500 text-white", available: false },
  googlePay: { className: "bg-white text-zinc-800", available: false },
  samsungPay: { className: "bg-blue-800 text-white", available: false },
};

/** 繳費畫面下方的支付方式按鈕（蓋在廣告區上方），只顯示費率設定裡啟用的 */
function PaymentMethodBar({
  enabled,
  method,
  notice,
  disabled,
  onSelect,
}: {
  enabled: PaymentMethod[];
  method: PaymentMethod | null;
  notice: string | null;
  disabled: boolean;
  onSelect: (method: PaymentMethod) => void;
}) {
  const methods = PAYMENT_METHODS.filter((m) => enabled.includes(m.id));
  if (methods.length === 0) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-10 space-y-[1vh] bg-zinc-900/95 px-[2vw] py-[1.5vh]">
      <p className="text-[clamp(1rem,2.6vh,1.6rem)] font-bold text-amber-300">
        請選擇支付方式
        {notice && <span className="ml-[2vw] text-red-400">{notice}</span>}
      </p>
      <div className={`grid gap-[1vw] ${methods.length >= 3 ? "grid-cols-3" : methods.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            disabled={disabled}
            className={`h-[min(9vh,5rem)] rounded-lg text-[clamp(1rem,3.2vh,2rem)] font-bold disabled:opacity-50 ${
              METHOD_STYLES[m.id].className
            } ${method === m.id ? "outline outline-4 outline-offset-2 outline-amber-300" : ""} ${
              METHOD_STYLES[m.id].available ? "" : "opacity-80"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 點選車輛後的繳費畫面：左邊照片與停車資訊，右邊應繳 / 已繳金額 */
function FeeDetail({
  vehicle,
  payment,
  finish,
  onCancel,
}: {
  vehicle: InsideVehicle;
  payment: Payment;
  finish: Finish | null;
  onCancel: () => void;
}) {
  const { session } = payment;
  const minutes = session?.target.kind === "entry" ? session.target.minutes : null;
  const monthly = session?.target.kind === "entry" ? session.target.monthly : null;
  const infoLabelClass = "whitespace-nowrap text-right font-bold text-green-800";

  return (
    <div className="flex h-full w-full flex-col bg-zinc-700 text-[clamp(0.8rem,2.4vh,1.4rem)]">
      <div className="flex min-h-0 flex-1 gap-[2px]">
        <div className="flex min-h-0 w-2/3 flex-col">
          <div className="relative min-h-0 flex-1 bg-zinc-800">
            {/* eslint-disable-next-line @next/next/no-img-element -- 照片由 API 從本機檔案讀出，不經過 next/image 最佳化 */}
            <img src={vehicleImage(vehicle)} alt={vehicle.plate} className="h-full w-full object-cover" />
            <FinishBanner payment={payment} finish={finish} />
          </div>
          <div className="grid shrink-0 grid-cols-[auto_1fr] gap-x-[1.5vw] gap-y-[0.3vh] bg-zinc-400 px-[2vw] py-[0.8vh]">
            <span className={infoLabelClass}>車　　號：</span>
            <span className="font-mono font-bold text-blue-900">{vehicle.plate}</span>
            <span className={infoLabelClass}>入場時間：</span>
            <span className="font-mono text-blue-900">{formatDateTime(vehicle.entryTime)}</span>
            <span className={infoLabelClass}>停車時間：</span>
            <span className="text-zinc-900">
              {minutes !== null ? (
                <>
                  {Math.floor(minutes / 1440)} <span className="text-green-800">天</span> {Math.floor((minutes % 1440) / 60)}{" "}
                  <span className="text-green-800">時</span> {minutes % 60} <span className="text-green-800">分</span>
                </>
              ) : (
                "—"
              )}
            </span>
            {monthly && (
              <>
                <span className={infoLabelClass}>月　　租：</span>
                <span className={monthly.status === "valid" ? "font-bold text-green-800" : "font-bold text-red-700"}>
                  {monthlyText(monthly)}
                </span>
              </>
            )}
            <span className="whitespace-nowrap text-right font-bold text-red-700">折扣金額：</span>
            <span className="text-red-700">0元</span>
            <span className={infoLabelClass}>繳費倒數：</span>
            <Countdown seconds={payment.remainingSec} />
            {session?.message && <span className="col-span-2 text-red-700">{session.message}</span>}
          </div>
        </div>
        <AmountPanel payment={payment} />
      </div>
      <div className="grid h-[min(8vh,4.5rem)] shrink-0 grid-cols-3 gap-[2px] bg-zinc-300">
        <div className="col-span-2 flex items-center justify-center bg-orange-600 text-[clamp(1.2rem,4.5vh,2.6rem)] font-bold text-blue-950">
          汽車
        </div>
        <CancelButton payment={payment} onCancel={onCancel} />
      </div>
    </div>
  );
}

/** 單次收費的繳費畫面 */
function ChargePayment({
  code,
  payment,
  finish,
  onCancel,
}: {
  code: string;
  payment: Payment;
  finish: Finish | null;
  onCancel: () => void;
}) {
  const { session } = payment;
  return (
    <div className="flex h-full w-full flex-col bg-zinc-700 text-[clamp(0.8rem,2.4vh,1.4rem)]">
      <div className="flex min-h-0 flex-1 gap-[2px]">
        <div className="relative flex min-h-0 w-2/3 flex-col items-center justify-center gap-[2vh] bg-white text-blue-950">
          <p className="text-[clamp(1.2rem,4.5vh,2.6rem)] font-bold">單次收費</p>
          <p className="font-mono text-[clamp(2rem,9vh,5rem)] font-black tracking-[0.2em]">{code}</p>
          <p className="text-[clamp(1rem,3vh,1.8rem)]">
            繳費倒數：
            <Countdown seconds={payment.remainingSec} />
          </p>
          {session?.message && <p className="px-[2vw] text-center text-red-700">{session.message}</p>}
          <FinishBanner payment={payment} finish={finish} />
        </div>
        <AmountPanel payment={payment} />
      </div>
      <div className="grid h-[min(8vh,4.5rem)] shrink-0 grid-cols-3 gap-[2px] bg-zinc-300">
        <div className="col-span-2 flex items-center justify-center bg-orange-600 text-[clamp(1.2rem,4.5vh,2.6rem)] font-bold text-blue-950">
          請投入紙鈔或硬幣
        </div>
        <CancelButton payment={payment} onCancel={onCancel} />
      </div>
    </div>
  );
}

export default function ParkingPaymentKioskPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [plate, setPlate] = useState("");
  const [querying, setQuerying] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [page, setPage] = useState(0);
  // 選擇車輛照片畫面的倒數截止時間（epoch 毫秒）
  const [selectDeadline, setSelectDeadline] = useState<number | null>(null);
  const changePage = (next: number) => {
    setPage(next);
    setSelectDeadline(Date.now() + SELECT_TIMEOUT_MS);
  };
  const [selected, setSelected] = useState<InsideVehicle | null>(null);
  const [finish, setFinish] = useState<Finish | null>(null);
  // 使用者選的支付方式；null 代表還沒選，有啟用現金結帳時預設為現金
  const lotName = useParkingLotName();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [methodNotice, setMethodNotice] = useState<string | null>(null);

  // 收款結束（繳費完成、倒數結束退幣、取消退幣）：顯示結果與找零 / 退幣明細後回到輸入車號頁面
  const payment = useKioskPayment((session) => setFinish(describeFinish(session)));

  const handleDigit = (digit: string) => {
    setPlate((prev) => (prev.length < MAX_DIGITS ? prev + digit : prev));
  };

  const handleClear = () => setPlate("");

  const { reset: resetPayment, start: startCashPayment } = payment;
  // 每筆繳費都重新選支付方式
  const startPayment = (body: Parameters<typeof startCashPayment>[0]) => {
    setMethod(null);
    setMethodNotice(null);
    startCashPayment(body);
  };

  const enabledMethods = payment.session?.paymentMethods ?? [];
  const cashEnabled = enabledMethods.includes("cash");
  const currentMethod = method ?? (cashEnabled ? "cash" : null);

  const selectMethod = (id: PaymentMethod) => {
    if (METHOD_STYLES[id].available) {
      setMethod(id);
      setMethodNotice(null);
    } else {
      const label = PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;
      setMethodNotice(`${label}尚未開放${cashEnabled ? "，請使用現金結帳" : ""}`);
    }
  };

  useEffect(() => {
    if (!methodNotice) return;
    const timer = setTimeout(() => setMethodNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [methodNotice]);

  // 繳費畫面（點選車輛或單次收費）才顯示支付方式；找零 / 退幣中與結束後不能再選
  const paying = (result?.kind === "vehicles" && selected !== null) || result?.kind === "charge";
  const methodDisabled = finish !== null || (payment.session !== null && payment.session.status !== "collecting");
  const closeResult = useCallback(() => {
    resetPayment();
    setFinish(null);
    setResult(null);
    setSelected(null);
    setPage(0);
    setPlate("");
  }, [resetPayment]);

  useEffect(() => {
    if (!finish) return;
    const timer = setTimeout(closeResult, finish.delay);
    return () => clearTimeout(timer);
  }, [finish, closeResult]);

  // 取消：收款中就請伺服器依已繳金額退幣（結束後由 onDone 顯示結果再回輸入車號頁面）；
  // 還沒開始收款（計算中或出錯）直接回輸入車號頁面
  const handleCancel = () => {
    if (payment.session?.status === "collecting") payment.cancel();
    else if (!payment.session) closeResult();
  };

  // 查詢：車牌包含輸入數字的場內車輛 → 沒有才查單次收費代碼（由 API 判斷）；全部車輛：列出所有場內車輛
  const runQuery = async (all: boolean) => {
    if (querying) return;
    if (!all && plate.length === 0) {
      setResult({ kind: "error", text: `請輸入 1～${MAX_DIGITS} 位數字` });
      return;
    }
    setQuerying(true);
    try {
      const res = await fetch(`/api/parking/kiosk-query?${all ? "all=1" : `code=${plate}`}`);
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        kind?: "vehicles" | "charge";
        items?: InsideVehicle[];
        charge?: { code: string; amount: number };
      };
      setPage(0);
      setSelected(null);
      if (json.ok && json.kind === "vehicles" && json.items) {
        setResult({ kind: "vehicles", items: json.items });
        setSelectDeadline(Date.now() + SELECT_TIMEOUT_MS);
      }
      else if (json.ok && json.kind === "charge" && json.charge) {
        setResult({ kind: "charge", code: json.charge.code, amount: json.charge.amount });
        startPayment({ code: json.charge.code });
      } else setResult({ kind: "error", text: json.error ?? "查詢失敗" });
    } catch {
      setResult({ kind: "error", text: "連不到伺服器，請稍後再試" });
    } finally {
      setQuerying(false);
    }
  };

  // 點選照片後開始收款，應繳金額由伺服器依費率設定算到現在
  const selectVehicle = (vehicle: InsideVehicle) => {
    setSelected(vehicle);
    startPayment({ entryId: vehicle.id });
  };

  // 照片列表倒數結束、錯誤訊息顯示一段時間後自動回到輸入畫面；點選照片後改由收款倒數控制
  useEffect(() => {
    if (!result || selected || result.kind === "charge") return;
    const delay = result.kind === "error" ? ERROR_TIMEOUT_MS : Math.max(0, (selectDeadline ?? 0) - Date.now());
    const timer = setTimeout(closeResult, delay);
    return () => clearTimeout(timer);
  }, [result, selectDeadline, selected, closeResult]);
  const selectRemainingSec =
    selectDeadline && now ? Math.max(0, Math.ceil((selectDeadline - now.getTime()) / 1000)) : SELECT_TIMEOUT_MS / 1000;

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
      <div className="relative flex h-2/5 min-h-0 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-[1.5vw] bg-black px-[2vw] py-[0.5vh]">
          <div className="flex h-[min(3.5vh,1.6rem)] w-[min(3.5vh,1.6rem)] shrink-0 items-center justify-center rounded-md bg-white">
            <span className="text-[min(2.4vh,1.1rem)] font-black leading-none text-black">
              P
            </span>
          </div>
          <h1 className="truncate text-[clamp(0.8rem,2.4vh,1.2rem)] font-extrabold tracking-wide text-amber-400">
            {lotName || DEFAULT_TITLE}
          </h1>
        </div>

        {/* Instruction banner */}
        <div className="shrink-0 bg-zinc-800 px-[2vw] py-[0.5vh]">
          <p className="truncate text-[clamp(0.65rem,1.8vh,0.95rem)] font-bold leading-relaxed text-amber-300">
            請輸入車牌中的數字（1～4 碼），輸入完成後請按{" "}
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
            onClick={() => runQuery(false)}
            disabled={querying}
            className="flex min-h-0 items-center justify-center gap-[0.6vw] overflow-hidden bg-zinc-200 text-[clamp(1rem,4vh,2.2rem)] font-bold text-zinc-800 disabled:opacity-50"
          >
            <QueryIcon />
            {querying ? "查詢中" : "查詢"}
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
            onClick={() => runQuery(true)}
            disabled={querying}
            className="flex min-h-0 items-center justify-center gap-[0.6vw] overflow-hidden bg-zinc-200 text-blue-950 disabled:opacity-50"
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

        {/* 查詢結果：蓋在輸入區上方 */}
        {result?.kind === "vehicles" && (
          <div className="absolute inset-x-0 bottom-0 top-[min(4.5vh,2.2rem)]">
            {selected ? (
              <FeeDetail vehicle={selected} payment={payment} finish={finish} onCancel={handleCancel} />
            ) : (
              <VehicleGrid
                items={result.items}
                page={page}
                onPage={changePage}
                remainingSec={selectRemainingSec}
                onSelect={selectVehicle}
                onHome={closeResult}
              />
            )}
          </div>
        )}
        {result?.kind === "charge" && (
          <div className="absolute inset-x-0 bottom-0 top-[min(4.5vh,2.2rem)]">
            <ChargePayment code={result.code} payment={payment} finish={finish} onCancel={handleCancel} />
          </div>
        )}
        {result?.kind === "error" && (
          <div className="absolute inset-x-0 bottom-0 top-[min(4.5vh,2.2rem)] flex flex-col items-center justify-center gap-[2vh] bg-white px-[3vw] text-center text-blue-950">
            <p className="text-[clamp(1.2rem,4vh,2.2rem)] font-bold text-red-600">{result.text}</p>
            <button
              type="button"
              onClick={closeResult}
              className="rounded-lg bg-zinc-800 px-[6vw] py-[1vh] text-[clamp(1rem,3.5vh,2rem)] font-bold text-amber-300"
            >
              返回
            </button>
          </div>
        )}
      </div>

      {/* Ad section - lower 2/3 of the screen */}
      <div className="relative h-3/5 min-h-0 w-full overflow-hidden bg-black">
        {paying && (
          <PaymentMethodBar
            enabled={enabledMethods}
            method={currentMethod}
            notice={methodNotice}
            disabled={methodDisabled}
            onSelect={selectMethod}
          />
        )}
        <AdPlayer />
      </div>
    </div>
  );
}
