import "server-only";
import { EventEmitter } from "node:events";
import type {
  BillAcceptorState,
  CashDeviceStatus,
  CoinAcceptorState,
  HopperDeviceId,
  HopperState,
  SerialLogEntry,
} from "./shared";

// 現金設備收發資料與連線狀態的即時事件匯流排，SSE route 訂閱後轉送給前端。
// 用 globalThis 存，避免開發模式 HMR 重新載入模組時又建一個新的 emitter。

export type CashDeviceEvent =
  | { type: "log"; entry: SerialLogEntry }
  | { type: "status"; status: CashDeviceStatus }
  | { type: "bill"; state: BillAcceptorState }
  | { type: "hopper"; device: HopperDeviceId; state: HopperState }
  | { type: "coin"; state: CoinAcceptorState };

const globalForEvents = globalThis as typeof globalThis & {
  _cashDeviceEmitter?: EventEmitter;
};

function getEmitter(): EventEmitter {
  if (!globalForEvents._cashDeviceEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    globalForEvents._cashDeviceEmitter = emitter;
  }
  return globalForEvents._cashDeviceEmitter;
}

export function emitCashDeviceEvent(event: CashDeviceEvent): void {
  getEmitter().emit("event", event);
}

/** 訂閱事件，回傳取消訂閱函式 */
export function onCashDeviceEvent(listener: (event: CashDeviceEvent) => void): () => void {
  const emitter = getEmitter();
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
