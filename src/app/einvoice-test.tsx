"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EZPAY_ENV_LABELS, isValidUbn, type EzpayEnv, type InvoiceCategory } from "@/lib/einvoice/ezpay-shared";

// 電子發票測試（只限管理者）：透過 /api/einvoice/test 對 ezPay 電子發票加值中心開立、作廢、查詢發票。
// 商店代號與金鑰設定在 .env.local（測試平台 EZPAY_INVOICE_TEST_*、正式平台 EZPAY_INVOICE_PROD_*），
// 使用哪個平台在這頁切換（同時套用到繳費機），預設測試平台。
// 送出紀錄只存在這台瀏覽器（localStorage），方便拿剛開的發票號碼去作廢或查詢。

type Action = "issue" | "invalid" | "search";
type Delivery = "paper" | "carrier" | "love";
type SearchMode = "invoice" | "order";

interface CallResponse {
  ok: boolean;
  error?: string;
  label?: string;
  url?: string;
  fields?: Record<string, string | number>;
  httpStatus?: number;
  raw?: string;
  status?: string | null;
  message?: string | null;
  result?: Record<string, unknown> | null;
  checkCodeValid?: boolean | null;
  elapsedMs?: number;
  /** 送到哪個平台 */
  env?: EzpayEnv;
}

interface LogEntry extends CallResponse {
  id: string;
  action: Action;
  at: string;
}

const ACTION_LABELS: Record<Action, string> = { issue: "開立", invalid: "作廢", search: "查詢" };
const HISTORY_KEY = "einvoice-test-history";
const HISTORY_LIMIT = 30;

const inputClass = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-gray-900";
const buttonClass = "rounded bg-[#428bca] px-4 py-2 text-white hover:bg-[#3071a9] disabled:cursor-not-allowed disabled:opacity-50";
const smallButtonClass = "rounded border border-sky-400 px-2 py-1 text-xs text-sky-600 hover:bg-sky-50";

/** 回傳結果裡值得一眼看到的欄位 */
const RESULT_FIELDS: [string, string][] = [
  ["InvoiceNumber", "發票號碼"],
  ["RandomNum", "隨機碼"],
  ["MerchantOrderNo", "自訂編號"],
  ["TotalAmt", "金額"],
  ["CreateTime", "開立時間"],
  ["InvalidTime", "作廢時間"],
  ["InvoiceStatus", "發票狀態"],
  ["InvoiceTransNo", "ezPay 開立序號"],
];

const INVOICE_STATUS: Record<string, string> = { "1": "開立", "2": "作廢" };

function loadHistory(): LogEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: LogEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // 瀏覽器不允許儲存時就只留在畫面上
  }
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Badge({ tone, children }: { tone: "ok" | "bad" | "muted"; children: ReactNode }) {
  const cls = {
    ok: "bg-green-100 text-green-800",
    bad: "bg-red-100 text-red-700",
    muted: "bg-gray-100 text-gray-600",
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

interface PlatformStatus {
  configured: boolean;
  merchantId: string | null;
  missing: string[];
  problems: string[];
}

interface Status {
  env: EzpayEnv;
  updatedAt: string | null;
  updatedBy: string | null;
  platforms: Record<EzpayEnv, PlatformStatus>;
  selfTest: { checkCode: { ok: boolean }; aes: { ok: boolean } };
}

const PLATFORM_HINTS: Record<EzpayEnv, string> = {
  test: "cinv.ezpay.com.tw，發票不會上傳財政部",
  production: "inv.ezpay.com.tw，發票會上傳財政部，具法律效力",
};

function PlatformCard({
  env,
  status,
  active,
  switching,
  onSwitch,
}: {
  env: EzpayEnv;
  status: PlatformStatus;
  active: boolean;
  switching: boolean;
  onSwitch: () => void;
}) {
  const prod = env === "production";
  return (
    <div
      className={`space-y-2 rounded border-2 p-3 ${
        active ? (prod ? "border-red-500 bg-red-50" : "border-green-600 bg-green-50") : "border-gray-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium">{EZPAY_ENV_LABELS[env]}</span>
        {active ? (
          <Badge tone={prod ? "bad" : "ok"}>使用中</Badge>
        ) : (
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching || !status.configured}
            className={`rounded px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              prod ? "bg-red-600 hover:bg-red-700" : "bg-green-700 hover:bg-green-800"
            }`}
          >
            {switching ? "切換中…" : `切換到${EZPAY_ENV_LABELS[env]}`}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">{PLATFORM_HINTS[env]}</p>
      <p>
        商店代號：{status.merchantId ?? <span className="text-gray-400">未設定</span>}　金鑰：
        {status.configured ? <Badge tone="ok">已設定</Badge> : <Badge tone="bad">未設定</Badge>}
      </p>
      {!status.configured && (
        <div className="text-xs text-red-600">
          {status.missing.length > 0 && <p>請在 .env.local 設定：{status.missing.join("、")}，改完後重新啟動伺服器。</p>}
          {status.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPanel({
  status,
  error,
  switching,
  onSwitch,
}: {
  status: Status | null;
  error: string;
  switching: boolean;
  onSwitch: (env: EzpayEnv) => void;
}) {
  if (!status) return <p className={error ? "text-red-600" : "text-gray-500"}>{error || "讀取設定中…"}</p>;
  const selfOk = status.selfTest.checkCode.ok && status.selfTest.aes.ok;
  return (
    <div className="space-y-3 rounded border border-gray-200 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        {(["test", "production"] as const).map((env) => (
          <PlatformCard
            key={env}
            env={env}
            status={status.platforms[env]}
            active={status.env === env}
            switching={switching}
            onSwitch={() => onSwitch(env)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-600">
        <span>這裡的切換同時套用到繳費機開立發票</span>
        {status.updatedAt && (
          <span>
            上次切換：{new Date(status.updatedAt).toLocaleString("zh-TW", { hour12: false })}
            {status.updatedBy && `（${status.updatedBy}）`}
          </span>
        )}
        <span>
          加密自我檢查：{selfOk ? <Badge tone="ok">通過</Badge> : <Badge tone="bad">失敗</Badge>}
        </span>
      </div>
      {error && <p className="text-red-600">{error}</p>}
      {status.env === "production" && (
        <p className="font-medium text-red-600">目前使用正式平台：開立的發票會真的上傳財政部，測試請記得作廢。</p>
      )}
    </div>
  );
}

const CATEGORY_OPTIONS: [InvoiceCategory, string, string][] = [
  ["B2C", "B2C 個人", "買受人為個人；可存載具、捐贈或索取紙本，品項金額為含稅"],
  ["B2B", "B2B 公司（有統編）", "買受人為營業人；必填統一編號、一律開紙本，品項金額為未稅"],
];

function IssueForm({ busy, locked, onSubmit }: { busy: boolean; locked: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const [category, setCategory] = useState<InvoiceCategory>("B2C");
  const [totalAmt, setTotalAmt] = useState("100");
  const [itemName, setItemName] = useState("停車費");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerUBN, setBuyerUBN] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("paper");
  const [carrierNum, setCarrierNum] = useState("");
  const [loveCode, setLoveCode] = useState("");
  const [merchantOrderNo, setMerchantOrderNo] = useState("");
  const [comment, setComment] = useState("");

  const b2b = category === "B2B";
  const total = Number(totalAmt);
  const validTotal = Number.isInteger(total) && total >= 1;
  const amt = validTotal ? Math.round(total / 1.05) : 0;
  const ubnOk = isValidUbn(buyerUBN);
  const ubnHint =
    buyerUBN.length === 8 && !ubnOk ? "統一編號檢查碼不正確" : "8 碼數字，必填";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      action: "issue",
      category,
      totalAmt: total,
      itemName,
      buyerName,
      buyerEmail,
      buyerUBN: b2b ? buyerUBN : "",
      buyerAddress,
      carrierNum: !b2b && delivery === "carrier" ? carrierNum.trim().toUpperCase() : "",
      loveCode: !b2b && delivery === "love" ? loveCode.trim() : "",
      merchantOrderNo,
      comment,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <span className="font-medium">發票種類</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={`rounded border px-3 py-1.5 ${
                category === value ? "border-[#428bca] bg-[#428bca] text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {CATEGORY_OPTIONS.find(([value]) => value === category)![2]}。應稅 5%、單一品項，金額請輸入含稅價。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="金額（含稅）"
          hint={
            validTotal
              ? `銷售額 ${amt} 元 + 稅額 ${total - amt} 元${b2b ? `；品項單價送未稅 ${amt} 元` : ""}`
              : "請輸入 1 以上的整數"
          }
        >
          <input type="number" min={1} step={1} value={totalAmt} onChange={(e) => setTotalAmt(e.target.value)} className={inputClass} />
        </Field>
        <Field label="品名">
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="停車費" className={inputClass} />
        </Field>
        {b2b && (
          <Field label="買方統一編號" hint={ubnHint}>
            <input
              value={buyerUBN}
              onChange={(e) => setBuyerUBN(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              inputMode="numeric"
              className={`${inputClass} ${buyerUBN.length === 8 && !ubnOk ? "border-red-400" : ""}`}
            />
          </Field>
        )}
        <Field label={b2b ? "公司名稱" : "買受人名稱"} hint={b2b ? "留空會帶統一編號；最多 60 字" : "留空為「消費者」；最多 30 字"}>
          <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} maxLength={b2b ? 60 : 30} className={inputClass} />
        </Field>
        {b2b && (
          <Field label="公司地址">
            <input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} maxLength={100} className={inputClass} />
          </Field>
        )}
        <Field label="買受人 Email" hint="有填會收到 ezPay 的開立通知">
          <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={inputClass} />
        </Field>
      </div>

      {b2b ? (
        <p>
          <span className="font-medium">發票索取方式：</span>紙本（B2B 發票規定索取紙本，可在 ezPay 平台列印）
        </p>
      ) : (
        <div className="space-y-2">
          <span className="font-medium">發票索取方式</span>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["paper", "紙本"],
                ["carrier", "手機條碼載具"],
                ["love", "捐贈"],
              ] as [Delivery, string][]
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1">
                <input type="radio" name="delivery" checked={delivery === value} onChange={() => setDelivery(value)} />
                {label}
              </label>
            ))}
          </div>
          {delivery === "carrier" && (
            <input
              value={carrierNum}
              onChange={(e) => setCarrierNum(e.target.value.toUpperCase())}
              placeholder="/ABC+123（斜線加 7 碼）"
              maxLength={8}
              className={`${inputClass} md:w-64`}
            />
          )}
          {delivery === "love" && (
            <input
              value={loveCode}
              onChange={(e) => setLoveCode(e.target.value.replace(/\D/g, ""))}
              placeholder="捐贈碼（3～7 碼數字）"
              maxLength={7}
              inputMode="numeric"
              className={`${inputClass} md:w-64`}
            />
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="自訂編號" hint="留空自動產生（T + 日期時間 + 3 碼）；英數與 _，20 字以內，不可重複">
          <input value={merchantOrderNo} onChange={(e) => setMerchantOrderNo(e.target.value)} maxLength={20} className={inputClass} />
        </Field>
        <Field label="備註">
          <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <button type="submit" disabled={busy || locked || !validTotal || (b2b && !ubnOk)} className={buttonClass}>
        {busy ? "送出中…" : `開立 ${category} 發票`}
      </button>
    </form>
  );
}

function InvalidForm({
  busy,
  locked,
  invoiceNumber,
  setInvoiceNumber,
  onSubmit,
}: {
  busy: boolean;
  locked: boolean;
  invoiceNumber: string;
  setInvoiceNumber: (v: string) => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [reason, setReason] = useState("測試作廢");
  const valid = /^[A-Z]{2}\d{8}$/.test(invoiceNumber);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm(`確定作廢發票 ${invoiceNumber}？`)) onSubmit({ action: "invalid", invoiceNumber, invalidReason: reason });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="發票號碼" hint="2 碼英文 + 8 碼數字，例如 AB12345678">
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            maxLength={10}
            className={inputClass}
          />
        </Field>
        <Field label="作廢原因">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={20} className={inputClass} />
        </Field>
      </div>
      <button type="submit" disabled={busy || locked || !valid} className={buttonClass}>
        {busy ? "送出中…" : "作廢發票"}
      </button>
    </form>
  );
}

interface SearchValues {
  invoiceNumber: string;
  randomNum: string;
  merchantOrderNo: string;
  totalAmt: string;
}

function SearchForm({
  busy,
  locked,
  mode,
  setMode,
  values,
  setValues,
  onSubmit,
}: {
  busy: boolean;
  locked: boolean;
  mode: SearchMode;
  setMode: (m: SearchMode) => void;
  values: SearchValues;
  setValues: (v: SearchValues) => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const set = (key: keyof SearchValues) => (e: { target: { value: string } }) => setValues({ ...values, [key]: e.target.value });
  const valid =
    mode === "invoice"
      ? /^[A-Z]{2}\d{8}$/.test(values.invoiceNumber) && /^\d{4}$/.test(values.randomNum)
      : values.merchantOrderNo.trim() !== "" && /^\d+$/.test(values.totalAmt);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          mode === "invoice"
            ? { action: "search", invoiceNumber: values.invoiceNumber, randomNum: values.randomNum }
            : { action: "search", merchantOrderNo: values.merchantOrderNo, totalAmt: values.totalAmt },
        );
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "invoice"} onChange={() => setMode("invoice")} />
          用發票號碼 + 隨機碼
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "order"} onChange={() => setMode("order")} />
          用自訂編號 + 金額
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {mode === "invoice" ? (
          <>
            <Field label="發票號碼">
              <input
                value={values.invoiceNumber}
                onChange={(e) => setValues({ ...values, invoiceNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                maxLength={10}
                className={inputClass}
              />
            </Field>
            <Field label="隨機碼" hint="4 碼數字">
              <input value={values.randomNum} onChange={set("randomNum")} maxLength={4} inputMode="numeric" className={inputClass} />
            </Field>
          </>
        ) : (
          <>
            <Field label="自訂編號">
              <input value={values.merchantOrderNo} onChange={set("merchantOrderNo")} maxLength={20} className={inputClass} />
            </Field>
            <Field label="金額（含稅）">
              <input value={values.totalAmt} onChange={set("totalAmt")} inputMode="numeric" className={inputClass} />
            </Field>
          </>
        )}
      </div>
      <button type="submit" disabled={busy || locked || !valid} className={buttonClass}>
        {busy ? "送出中…" : "查詢發票"}
      </button>
    </form>
  );
}

function ResultCard({
  entry,
  onInvalid,
  onSearch,
}: {
  entry: LogEntry;
  onInvalid: (invoiceNumber: string) => void;
  onSearch: (v: SearchValues) => void;
}) {
  const r = entry.result ?? {};
  const invoiceNumber = str(r.InvoiceNumber);
  const shown = RESULT_FIELDS.filter(([key]) => str(r[key]) !== "");
  return (
    <div className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{ACTION_LABELS[entry.action]}</span>
        {entry.env && <Badge tone={entry.env === "production" ? "bad" : "muted"}>{EZPAY_ENV_LABELS[entry.env]}</Badge>}
        {entry.ok ? <Badge tone="ok">成功</Badge> : <Badge tone="bad">失敗</Badge>}
        {entry.status && <span className="font-mono text-xs">{entry.status}</span>}
        <span className="text-xs text-gray-500">
          {new Date(entry.at).toLocaleString("zh-TW", { hour12: false })}
          {entry.elapsedMs !== undefined && `・${entry.elapsedMs} ms`}
        </span>
        {entry.checkCodeValid === true && <Badge tone="ok">檢查碼正確</Badge>}
        {entry.checkCodeValid === false && <Badge tone="bad">檢查碼不符</Badge>}
      </div>

      {(entry.message || entry.error) && <p className={entry.ok ? "text-gray-700" : "text-red-600"}>{entry.message || entry.error}</p>}

      {shown.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 md:grid-cols-[auto_1fr_auto_1fr]">
          {shown.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-mono break-all">{key === "InvoiceStatus" ? (INVOICE_STATUS[str(r[key])] ?? str(r[key])) : str(r[key])}</dd>
            </div>
          ))}
        </dl>
      )}

      {invoiceNumber && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={smallButtonClass}
            onClick={() =>
              onSearch({ invoiceNumber, randomNum: str(r.RandomNum), merchantOrderNo: str(r.MerchantOrderNo), totalAmt: str(r.TotalAmt) })
            }
          >
            查詢這張
          </button>
          {entry.action !== "invalid" && (
            <button type="button" className={smallButtonClass} onClick={() => onInvalid(invoiceNumber)}>
              作廢這張
            </button>
          )}
        </div>
      )}

      {(entry.fields || entry.raw) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500">送出欄位與平台原始回應</summary>
          <div className="mt-2 space-y-2">
            {entry.url && <p className="font-mono break-all text-gray-500">POST {entry.url}（HTTP {entry.httpStatus}）</p>}
            {entry.fields && (
              <pre className="overflow-x-auto rounded bg-gray-50 p-2">{JSON.stringify(entry.fields, null, 2)}</pre>
            )}
            {entry.raw && <pre className="overflow-x-auto rounded bg-gray-50 p-2 whitespace-pre-wrap break-all">{entry.raw}</pre>}
          </div>
        </details>
      )}
    </div>
  );
}

export function EinvoiceTest() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState("");
  const [tab, setTab] = useState<Action>("issue");
  const [busy, setBusy] = useState(false);
  // 首頁登入後才會顯示這個元件（只在瀏覽器端渲染），可以直接讀 localStorage
  const [history, setHistory] = useState<LogEntry[]>(loadHistory);
  // 作廢與查詢的輸入放在這裡，結果卡片的「作廢這張」「查詢這張」可以直接帶入
  const [invalidNumber, setInvalidNumber] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("invoice");
  const [searchValues, setSearchValues] = useState<SearchValues>({ invoiceNumber: "", randomNum: "", merchantOrderNo: "", totalAmt: "" });

  const [switching, setSwitching] = useState(false);

  const loadStatus = () =>
    fetch("/api/einvoice/test")
      .then(async (res) => {
        const json = (await res.json()) as Status & { ok: boolean; error?: string };
        if (!json.ok) throw new Error(json.error ?? "讀取設定失敗");
        setStatus(json);
      })
      .catch((e: unknown) => setStatusError(e instanceof Error ? e.message : "讀取設定失敗"));

  useEffect(() => {
    loadStatus();
  }, []);

  const switchPlatform = async (env: EzpayEnv) => {
    const warning =
      env === "production"
        ? "切換到正式平台？\n\n切換後這一頁和繳費機開立的發票都會真的上傳財政部，具法律效力。"
        : "切換到測試平台？\n\n切換後繳費機開立的發票只在測試平台，不會上傳財政部（客人拿到的發票無效）。";
    if (!confirm(warning)) return;
    setSwitching(true);
    setStatusError("");
    try {
      const res = await fetch("/api/einvoice/test", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) setStatusError(json.error ?? "切換失敗");
      await loadStatus();
    } catch {
      setStatusError("連不到伺服器");
    } finally {
      setSwitching(false);
    }
  };

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    let response: CallResponse;
    try {
      const res = await fetch("/api/einvoice/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      response = (await res.json()) as CallResponse;
    } catch (e) {
      response = { ok: false, error: e instanceof Error ? e.message : "送出失敗" };
    }
    const entry: LogEntry = { ...response, id: crypto.randomUUID(), action: body.action as Action, at: new Date().toISOString() };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, HISTORY_LIMIT);
      saveHistory(next);
      return next;
    });
    setBusy(false);
  };

  const clearHistory = () => {
    if (!confirm("清除這台瀏覽器上的測試紀錄？（不會影響 ezPay 上的發票）")) return;
    setHistory([]);
    saveHistory([]);
  };

  // 金鑰沒設定好就不能送
  const locked = !status || !status.platforms[status.env].configured || switching;

  return (
    <div className="space-y-6 text-sm text-gray-900">
      <div className="space-y-3">
        <h2 className="text-lg font-medium">電子發票測試（ezPay 加值中心）</h2>
        <StatusPanel status={status} error={statusError} switching={switching} onSwitch={switchPlatform} />
      </div>

      <div className="space-y-3 rounded border border-gray-200 p-3">
        <div className="flex gap-1 border-b border-gray-200">
          {(Object.keys(ACTION_LABELS) as Action[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px rounded-t border px-4 py-2 ${
                tab === key ? "border-gray-200 border-b-white bg-white font-medium text-gray-900" : "border-transparent text-[#428bca] hover:bg-gray-50"
              }`}
            >
              {ACTION_LABELS[key]}
            </button>
          ))}
        </div>
        {tab === "issue" && <IssueForm busy={busy} locked={locked} onSubmit={send} />}
        {tab === "invalid" && (
          <InvalidForm busy={busy} locked={locked} invoiceNumber={invalidNumber} setInvoiceNumber={setInvalidNumber} onSubmit={send} />
        )}
        {tab === "search" && (
          <SearchForm
            busy={busy} locked={locked}
            mode={searchMode}
            setMode={setSearchMode}
            values={searchValues}
            setValues={setSearchValues}
            onSubmit={send}
          />
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">測試紀錄</h3>
          {history.length > 0 && (
            <button type="button" onClick={clearHistory} className="text-xs text-gray-500 hover:text-gray-700">
              清除紀錄
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-gray-500">還沒有送出過。</p>
        ) : (
          history.map((entry) => (
            <ResultCard
              key={entry.id}
              entry={entry}
              onInvalid={(n) => {
                setInvalidNumber(n);
                setTab("invalid");
              }}
              onSearch={(v) => {
                setSearchValues(v);
                setSearchMode(v.randomNum ? "invoice" : "order");
                setTab("search");
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
