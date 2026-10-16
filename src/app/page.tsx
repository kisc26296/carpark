"use client";

import { useEffect, useState, type ReactNode } from "react";
import { hasPermission, ROLE_LABELS, type PublicUser } from "@/lib/auth/user-shared";
import { ChangeRecordForm } from "./change-record";
import { DatabaseSettings } from "./database-settings";
import { EntryRecords } from "./entry-records";
import { GateAndCapacity } from "./gate-capacity";
import { RefundForm } from "./hopper-refund";
import { MonthlySettings } from "./monthly-settings";
import { RateSettings } from "./rate-settings";
import { UserSettings } from "./user-settings";

// 停車場管理首頁：左側選單 + 右側設定內容。按鈕功能尚未實作，之後再補。

type MenuKey = "database" | "rate" | "device" | "entry" | "shift" | "report" | "monthly" | "users";

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
    {path}
  </svg>
);

const MENU: { key: MenuKey; label: string; icon: ReactNode }[] = [
  {
    key: "database",
    label: "資料庫設定",
    icon: icon(<path d="M6 3h12v5H6zM3 9h18v8h-3v4H6v-4H3zm5 6v4h8v-4z" />),
  },
  {
    key: "rate",
    label: "費率設定",
    icon: icon(<path d="M5 2h2v7a2 2 0 0 1-1 1.7V22H4V10.7A2 2 0 0 1 3 9V2h2v5h0V2zm3 0h2v7a2 2 0 0 1-1 1.7V22H7zm9 0c2 0 3 3 3 6s-1 4-2 4v10h-2V2z" />),
  },
  {
    key: "device",
    label: "設備設定",
    icon: icon(<path d="M5 4h14l2 10H3zM2 16h20v4H2z" />),
  },
  {
    key: "entry",
    label: "車輛進場紀錄",
    icon: icon(<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.3-1 1.7-5-3V7z" />),
  },
  {
    key: "shift",
    label: "交班",
    icon: icon(<path d="M4 4h10v2H6v12h12v-8h2v10H4zm15.3-2.3 3 3L13 14H10v-3z" />),
  },
  {
    key: "report",
    label: "報表",
    icon: icon(<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />),
  },
  {
    key: "monthly",
    label: "月租設定",
    icon: icon(<path d="M6 2h8l5 5v15H6zm7 1.5V8h4.5z" />),
  },
  {
    key: "users",
    label: "使用者設定",
    icon: icon(<path d="M3 3h5v5H3zm6.5 0h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5zM3 16h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5z" />),
  },
];

// 標題 + 輸入框一列：手機上下排、電腦左右排，皆靠左對齊
function Field({ label, defaultValue, type = "text" }: { label: string; defaultValue: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="font-medium sm:w-36 sm:shrink-0">{label}</span>
      <input type={type} defaultValue={defaultValue} className="w-full max-w-md rounded border border-gray-300 px-3 py-2" />
    </label>
  );
}

const buttonClass = "rounded bg-sky-400 px-4 py-2 text-lg text-white hover:bg-sky-500";

// TODO: 出入口設備 IP / 帳號的「確定修改」之後再實作；開閘與車位數用 GateAndCapacity（和進場紀錄頁共用）
function DeviceSettings() {
  return (
    <div className="space-y-5">
      <form className="space-y-5 text-sm text-gray-900" onSubmit={(e) => e.preventDefault()}>
        <div>
          <div className="text-xs text-gray-700">出入口設備</div>
          <div className="mt-2 space-y-3">
            <Field label="入口IP:" defaultValue="192.168.1.100" />
            <Field label="入口PORT:" defaultValue="80" />
            <Field label="入口登入帳號:" defaultValue="admin" />
            <Field label="入口登入密碼:" defaultValue="admin" type="password" />
          </div>
        </div>

        <hr className="border-gray-200" />

        <div className="space-y-3">
          <Field label="出口IP:" defaultValue="192.168.1.101" />
          <Field label="出口PORT:" defaultValue="80" />
          <Field label="出口登入帳號:" defaultValue="admin" />
          <Field label="出口登入密碼:" defaultValue="admin" type="password" />
        </div>

        <hr className="border-gray-200" />
        <button type="submit" className={buttonClass}>
          確定修改
        </button>
      </form>

      {/* 開閘與車位數有自己的表單，放在上面的 form 外面（form 不能巢狀） */}
      <hr className="border-gray-200" />
      <GateAndCapacity />
    </div>
  );
}

const grayButtonClass = "rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200";

// 範例數字，之後改由資料庫統計
const SHIFT_SUMMARY_LEFT: [string, number][] = [
  ["總營收", 535280],
  ["現金", 281390],
  ["信用卡", 253890],
  ["券類金額", 0],
  ["訂金金額", 0],
  ["使用訂金金額", 0],
  ["作廢金額", 20290],
];
const SHIFT_SUMMARY_RIGHT: ([string, number] | null)[] = [
  ["使用訂金現金", 0],
  null, // 截圖中此處空一行
  ["目前零用金", 5000],
  ["訂金現金", 0],
  ["營收現金", 281390],
  ["錢櫃金額", 286390],
];
const BILLS_LEFT = [2000, 1000, 500, 100];
const BILLS_RIGHT = [50, 10, 5, 1];

const panelInputClass = "w-full rounded border border-gray-300 px-3 py-1.5";

// 交班作業面板；確定送出的功能之後再實作
function ShiftForm({ onClose }: { onClose: () => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const total = [...BILLS_LEFT, ...BILLS_RIGHT].reduce((sum, bill) => sum + bill * (Number(counts[bill]) || 0), 0);

  const billInput = (bill: number) => (
    <input
      key={bill}
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={`${bill}元數量`}
      value={counts[bill] ?? ""}
      onChange={(e) => setCounts((prev) => ({ ...prev, [bill]: e.target.value }))}
      className={panelInputClass}
    />
  );
  const summary = (items: ([string, number] | null)[]) => (
    <div className="space-y-0.5 text-center text-base">
      {items.map((item, i) =>
        item ? (
          <div key={item[0]}>
            {item[0]}：{item[1]}
          </div>
        ) : (
          <div key={i} className="hidden h-6 md:block" />
        ),
      )}
    </div>
  );

  return (
    <form className="rounded border border-gray-200" onSubmit={(e) => e.preventDefault()}>
      <div className="relative border-b border-gray-200 px-12 py-3 text-center">
        <h2 className="text-2xl">交班作業</h2>
        <button type="button" onClick={onClose} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600">
          關閉
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-1 md:grid-cols-2">
          {summary(SHIFT_SUMMARY_LEFT)}
          {summary(SHIFT_SUMMARY_RIGHT)}
        </div>

        <hr className="border-gray-200" />

        <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          <div className="space-y-0.5">{BILLS_LEFT.map(billInput)}</div>
          <div className="space-y-0.5">{BILLS_RIGHT.map(billInput)}</div>
        </div>
        <div className="space-y-0.5">
          <p className="text-center">確認總額：{total}元。</p>
          <input placeholder="交班零用金額" className={panelInputClass} />
          <input placeholder="交班備註" className={panelInputClass} />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
        <button type="submit" className="rounded bg-[#428bca] px-4 py-2 text-white hover:bg-[#3071a9]">
          確定
        </button>
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100">
          關閉
        </button>
      </div>
    </form>
  );
}

function ShiftHandover() {
  const [panel, setPanel] = useState<"shift" | "change" | "refund" | null>(null);
  const close = () => setPanel(null);

  return (
    <div className="space-y-4 text-sm text-gray-900">
      <div>
        <div className="text-xs text-gray-700">交班</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setPanel("shift")} className={grayButtonClass}>
            交班
          </button>
          <button type="button" onClick={() => setPanel("change")} className={grayButtonClass}>
            收找零紀錄
          </button>
          <button type="button" onClick={() => setPanel("refund")} className={grayButtonClass}>
            退幣
          </button>
        </div>
      </div>
      <hr className="border-gray-200" />
      {panel === "shift" && <ShiftForm onClose={close} />}
      {panel === "change" && <ChangeRecordForm onClose={close} />}
      {panel === "refund" && <RefundForm onClose={close} />}
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-sm text-gray-600">
      <h2 className="mb-2 text-lg font-medium text-gray-900">{title}</h2>
      <p>此功能內容尚未建立。</p>
    </div>
  );
}

const logoutIcon = icon(<path d="M10 17l1.4-1.4L8.8 13H2v-2h6.8l-2.6-2.6L10 7l5 5zm3-14h7v18h-7v-2h5V5h-5z" />);

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.replace("/login");
}

export default function Home() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [active, setActive] = useState<MenuKey>("rate");

  // 目前登入的使用者；登入過期或帳號被刪除時回登入頁
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        const json = (await res.json()) as { ok: boolean; user?: PublicUser };
        if (!json.ok || !json.user) throw new Error();
        setUser(json.user);
      })
      .catch(() => window.location.replace("/login"));
  }, []);

  if (!user) return <div className="p-6 text-sm text-gray-500">讀取中…</div>;

  // 只顯示這個使用者可以用的功能
  const menu = MENU.filter((m) => hasPermission(user, m.key));
  const current = menu.find((m) => m.key === active) ?? menu[0];
  const shown = current?.key;

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-white p-3 md:flex-row">
      <aside className="w-full shrink-0 md:w-72">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-800">
          <span>停車場管理</span>
          <span>
            {user.name || user.username}（{ROLE_LABELS[user.role]}）
          </span>
        </div>
        {/* 手機：三欄格狀選單；電腦：直排側欄 */}
        <nav className="grid grid-cols-3 gap-1 bg-purple-50/60 p-1 md:grid-cols-1 md:gap-0 md:px-0 md:py-1">
          {menu.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActive(item.key)}
              className={`flex w-full items-center gap-0.5 px-2 py-2 text-left text-sm md:px-3 md:py-2.5 md:text-base ${
                item.key === shown
                  ? "rounded border-2 border-gray-900 bg-[#428bca] text-white"
                  : "text-[#428bca] hover:bg-purple-100/60"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-0.5 px-2 py-2 text-left text-sm text-[#428bca] hover:bg-purple-100/60 md:px-3 md:py-2.5 md:text-base"
          >
            {logoutIcon}
            登出
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {!current ? (
          <p className="text-sm text-gray-600">這個帳號沒有可使用的功能，請聯絡管理者開通權限。</p>
        ) : shown === "database" ? (
          <DatabaseSettings />
        ) : shown === "rate" ? (
          <RateSettings />
        ) : shown === "device" ? (
          <DeviceSettings />
        ) : shown === "entry" ? (
          <EntryRecords />
        ) : shown === "monthly" ? (
          <MonthlySettings />
        ) : shown === "shift" ? (
          <ShiftHandover />
        ) : shown === "users" ? (
          <UserSettings currentUserId={user.id} />
        ) : (
          <Placeholder title={current.label} />
        )}
      </main>
    </div>
  );
}
