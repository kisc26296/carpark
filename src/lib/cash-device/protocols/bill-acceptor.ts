import "server-only";
import { getBillSettings, saveBillSettings } from "../config-store";
import { emitCashDeviceEvent } from "../events";
import {
  BILL_TYPES,
  DEFAULT_BILL_SETTINGS,
  type BillAcceptorState,
  type BillAction,
  type BillSettings,
} from "../shared";
import type { DeviceProtocol, ProtocolContext, ProtocolMessage, RxResult } from "./types";

// ICT 紙鈔機協定（ICT104U Protocol V0.3，RS232 9600 8E1）。
// 每個指令都是單一位元組，沒有封包頭與檢查碼，所以逐位元組翻譯。
// 有時限的回應都在伺服器端自動處理，不依賴頁面有沒有開著：
//   - 開機通知 80 8F：2 秒內要回 02
//   - 收到紙鈔 81 + 4x：5 秒內要回 02 接受 / 0F 退回 / 18 暫存；
//     未勾選的面額自動退回，No Escrow 模式自動接受，Escrow 模式等操作人員按 Accept/Reject

const CMD = {
  accept: 0x02,
  reject: 0x0f,
  hold: 0x18,
  poll: 0x0c,
  enable: 0x3e,
  disable: 0x5e,
  reset: 0x30,
} as const;

// 定時查詢狀態用來判斷 Link；超過 LINK_TIMEOUT_MS 沒收到任何回應就顯示 No Link
const POLL_MS = 2000;
const LINK_TIMEOUT_MS = 5000;
// RESET 後紙鈔機會重新開機，這段時間不查詢，避免干擾開機流程
const RESET_QUIET_MS = 3000;
// 沒按 Escrow Hold 的紙鈔，紙鈔機 5 秒後會自己退鈔並回 11；
// 萬一 11 沒收到，超過這個時間就放棄等待，恢復定時查詢
const ESCROW_STALE_MS = 15000;

const ERRORS: Record<number, string> = {
  0x20: "馬達故障",
  0x21: "檢查碼錯誤",
  0x22: "卡鈔",
  0x23: "紙鈔被移除",
  0x24: "鈔箱開啟",
  0x25: "感測器異常",
  0x27: "釣魚（拉線盜鈔）",
  0x28: "鈔箱異常",
  0x29: "退鈔",
  0x2a: "無效指令",
};

interface Runtime {
  state: BillAcceptorState;
  ctx: ProtocolContext | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  lastRxAt: number;
  /** 剛收到 81（紙鈔驗證通過），下一個位元組是紙鈔種類 */
  expectType: boolean;
  pausePollUntil: number;
  settingsLoaded: Promise<void> | null;
}

const globalForBill = globalThis as typeof globalThis & {
  _billAcceptorRuntime?: Runtime;
};

function getRuntime(): Runtime {
  if (!globalForBill._billAcceptorRuntime) {
    globalForBill._billAcceptorRuntime = {
      state: {
        link: false,
        status: "unknown",
        error: null,
        escrow: null,
        count: 0,
        credit: 0,
        total: 0,
        settings: DEFAULT_BILL_SETTINGS,
      },
      ctx: null,
      pollTimer: null,
      lastRxAt: 0,
      expectType: false,
      pausePollUntil: 0,
      settingsLoaded: null,
    };
  }
  return globalForBill._billAcceptorRuntime;
}

const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();

function emit(): void {
  emitCashDeviceEvent({ type: "bill", state: structuredClone(getRuntime().state) });
}

function ensureSettings(): Promise<void> {
  const rt = getRuntime();
  if (!rt.settingsLoaded) {
    const loading: Promise<void> = getBillSettings()
      .then((settings) => {
        if (rt.settingsLoaded !== loading) return;
        rt.state.settings = settings;
        emit();
      })
      .catch((error) => {
        if (rt.settingsLoaded === loading) rt.settingsLoaded = null;
        console.error("[bill] 讀取紙鈔機設定失敗:", error instanceof Error ? error.message : error);
      });
    rt.settingsLoaded = loading;
  }
  return rt.settingsLoaded;
}

const message = (cmd: number, text: string, quiet?: boolean): ProtocolMessage => ({
  data: Uint8Array.of(cmd),
  text,
  quiet,
});

function send(cmd: number, text: string, quiet?: boolean): Promise<void> {
  const { ctx } = getRuntime();
  if (!ctx) return Promise.reject(new Error("紙鈔機尚未連線"));
  return ctx.write(message(cmd, text, quiet));
}

function poll(): void {
  const rt = getRuntime();
  if (!rt.ctx) return;
  const now = Date.now();

  if (rt.state.escrow && !rt.state.escrow.held && now - Date.parse(rt.state.escrow.since) > ESCROW_STALE_MS) {
    rt.state.escrow = null;
    emit();
  }
  // Escrow 等待中或 RESET 後的開機期間不查詢，也不判斷 Link，避免誤判斷線
  if (rt.state.escrow || now < rt.pausePollUntil) return;

  const link = now - rt.lastRxAt < LINK_TIMEOUT_MS;
  if (link !== rt.state.link) {
    rt.state.link = link;
    if (!link) rt.state.status = "unknown";
    emit();
  }
  send(CMD.poll, "查詢狀態", true).catch(() => {});
}

function handleBillType(typeIndex: number, replies: ProtocolMessage[]): string {
  const rt = getRuntime();
  const { value } = BILL_TYPES[typeIndex];
  const since = new Date().toISOString();
  const text = value ? `紙鈔 ${value} 元（第 ${typeIndex + 1} 種）` : `紙鈔第 ${typeIndex + 1} 種（未定義面額）`;

  if (!rt.state.settings.enabledTypes.includes(typeIndex)) {
    replies.push(message(CMD.reject, "自動退回：未勾選的面額"));
    rt.state.escrow = { typeIndex, value, since, held: false, decision: "reject" };
  } else if (!rt.state.settings.escrow) {
    replies.push(message(CMD.accept, "自動收下：自動收鈔模式"));
    rt.state.escrow = { typeIndex, value, since, held: false, decision: "accept" };
  } else {
    rt.state.escrow = { typeIndex, value, since, held: false, decision: null };
  }
  return text;
}

function onData(data: Uint8Array): RxResult {
  const rt = getRuntime();
  rt.lastRxAt = Date.now();
  const before = JSON.stringify(rt.state);
  if (!rt.state.link) rt.state.link = true;

  const texts: string[] = [];
  const replies: ProtocolMessage[] = [];
  // 只有例行查詢的回應（狀態沒變）才不寫進紀錄
  let quiet = true;

  for (const b of data) {
    if (rt.expectType) {
      rt.expectType = false;
      if (b >= 0x40 && b <= 0x4f) {
        texts.push(handleBillType(b - 0x40, replies));
        quiet = false;
        continue;
      }
    }

    if (b >= 0x40 && b <= 0x4f) {
      texts.push(handleBillType(b - 0x40, replies));
      quiet = false;
    } else if (b === 0x80) {
      texts.push("開機通知");
      quiet = false;
    } else if (b === 0x8f) {
      texts.push("開機通知");
      replies.push(message(CMD.accept, "自動回應：開機確認"));
      rt.state.escrow = null;
      quiet = false;
    } else if (b === 0x81) {
      texts.push("紙鈔驗證通過");
      rt.expectType = true;
      quiet = false;
    } else if (b === 0x10) {
      texts.push("已收進鈔箱");
      const value = rt.state.escrow?.value ?? 0;
      rt.state.count += 1;
      rt.state.credit += value;
      rt.state.total += value;
      rt.state.escrow = null;
      quiet = false;
    } else if (b === 0x11) {
      texts.push("已退鈔");
      rt.state.escrow = null;
      quiet = false;
    } else if (b === 0x3e || b === 0x5e) {
      const status = b === 0x3e ? "enabled" : "inhibited";
      texts.push(status === "enabled" ? "狀態：啟用中" : "狀態：停用中");
      if (rt.state.status !== status || rt.state.error) quiet = false;
      rt.state.status = status;
      rt.state.error = null;
    } else if (b === 0x2f) {
      texts.push("錯誤解除");
      if (rt.state.error) quiet = false;
      rt.state.error = null;
    } else if (b >= 0x20 && b <= 0x2f) {
      const error = ERRORS[b] ?? `保留的錯誤碼 0x${hex(b)}`;
      texts.push(`錯誤：${error}`);
      if (rt.state.error !== error) quiet = false;
      rt.state.error = error;
    } else {
      texts.push(`未定義的回應 0x${hex(b)}`);
      quiet = false;
    }
  }

  if (JSON.stringify(rt.state) !== before) emit();
  // 紙鈔機每個位元組都是一個訊息，只要有一個是協定裡定義的就算有效回應
  const valid = texts.some((t) => !t.startsWith("未定義的回應"));
  return { text: texts.join("；"), quiet, replies, valid };
}

export const billAcceptorProtocol: DeviceProtocol = {
  onOpen(ctx) {
    const rt = getRuntime();
    rt.ctx = ctx;
    rt.lastRxAt = 0;
    rt.expectType = false;
    rt.pausePollUntil = 0;
    rt.state.link = false;
    rt.state.status = "unknown";
    rt.state.error = null;
    rt.state.escrow = null;
    ensureSettings();
    if (rt.pollTimer) clearInterval(rt.pollTimer);
    rt.pollTimer = setInterval(poll, POLL_MS);
    emit();
    poll();
  },
  onClose() {
    const rt = getRuntime();
    rt.ctx = null;
    if (rt.pollTimer) clearInterval(rt.pollTimer);
    rt.pollTimer = null;
    rt.expectType = false;
    rt.state.link = false;
    rt.state.status = "unknown";
    rt.state.escrow = null;
    emit();
  },
  onData,
  probe: () => message(CMD.poll, "連線測試：查詢狀態"),
};

export async function getBillState(): Promise<BillAcceptorState> {
  await ensureSettings();
  return structuredClone(getRuntime().state);
}

/** 執行原廠測試工具上的按鈕功能 */
export async function runBillAction(action: BillAction): Promise<BillAcceptorState> {
  const rt = getRuntime();
  const { escrow } = rt.state;

  switch (action) {
    case "accept":
    case "reject":
      if (!escrow || escrow.decision) throw new Error("目前沒有等待處理的紙鈔");
      await send(action === "accept" ? CMD.accept : CMD.reject, action === "accept" ? "收下紙鈔" : "退回紙鈔");
      escrow.decision = action;
      break;
    case "hold":
      if (!escrow || escrow.decision) throw new Error("目前沒有等待處理的紙鈔");
      await send(CMD.hold, "暫存保留");
      escrow.held = true;
      break;
    case "enable":
      await send(CMD.enable, "啟用收鈔");
      break;
    case "disable":
      await send(CMD.disable, "停用收鈔");
      break;
    case "reset":
      await send(CMD.reset, "重置紙鈔機");
      rt.state.escrow = null;
      rt.expectType = false;
      rt.pausePollUntil = Date.now() + RESET_QUIET_MS;
      break;
    case "poll":
      await send(CMD.poll, "查詢狀態");
      break;
    case "clearCredit":
      rt.state.count = 0;
      rt.state.credit = 0;
      break;
  }

  emit();
  return structuredClone(rt.state);
}

export async function updateBillSettings(settings: BillSettings): Promise<BillAcceptorState> {
  const rt = getRuntime();
  await saveBillSettings(settings);
  // 已經手動存過設定，就不要讓還在讀取中的舊設定蓋回來
  rt.settingsLoaded = Promise.resolve();
  rt.state.settings = settings;
  emit();
  return structuredClone(rt.state);
}
