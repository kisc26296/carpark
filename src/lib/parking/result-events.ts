import "server-only";
import { EventEmitter } from "node:events";

// 車牌辨識結果的即時事件匯流排：有新結果（MQTT Result/OfflineResult/BackResult/CarRetention
// 或 HTTP 辨識結果）存檔成功時會 emit 一次，SSE route 訂閱後轉送給前端做即時監測。
// 用 globalThis 存，避免開發模式 HMR 重新載入模組時又建一個新的 emitter。

export interface PlateResultEvent {
  id: string;
  source: "mqtt" | "http";
  command: string;
  device_sn: string;
  plate_raw: string;
  plate_color: unknown;
  confidence: number | null;
  is_car_exist: string | null;
  valid_plate: string | null;
  trigger_time: string;
  image_base64: string | null;
  image_saved_path: string | null;
  created_at: string;
}

const globalForEvents = globalThis as typeof globalThis & {
  _parkingResultEmitter?: EventEmitter;
};

function getEmitter(): EventEmitter {
  if (!globalForEvents._parkingResultEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    globalForEvents._parkingResultEmitter = emitter;
  }
  return globalForEvents._parkingResultEmitter;
}

export function emitPlateResult(event: PlateResultEvent): void {
  getEmitter().emit("result", event);
}

export function onPlateResult(listener: (event: PlateResultEvent) => void): () => void {
  const emitter = getEmitter();
  emitter.on("result", listener);
  return () => emitter.off("result", listener);
}
