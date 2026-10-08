import "server-only";
import net from "node:net";

// 設備 TCP 帳號密碼登入（server-only）
//
// ⚠️ 雛形協定：目前還沒有廠商提供「用帳號密碼登入取得設備編號(SN)」的通訊文件，
// 這裡先定義一個合理、簡單的雛形協定，方便介面跟流程先跑起來；等拿到正式文件後，
// 只需要替換這個檔案裡的編碼/解碼邏輯，呼叫端（API route、UI）不用跟著改。
//
// 雛形協定內容：
//   傳輸：純 TCP，一行一個 JSON（NDJSON），單次連線只做一次登入就關閉。
//   請求： {"action":"login","username":string,"password":string}\n
//   成功回應： {"ok":true,"sn":string,"deviceType"?:string,"firmwareVer"?:string}\n
//   失敗回應： {"ok":false,"error":string}\n
//
// src/lib/parking/simulator.ts 有實作一個符合這個雛形協定的模擬登入伺服器
// （帳號/密碼固定 admin/admin），可以用來端到端測試這支程式。

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIp(ip: string): boolean {
  const m = IP_RE.exec(ip);
  if (!m) return false;
  return m.slice(1).every((part) => Number(part) <= 255);
}

export interface DeviceLoginInput {
  ip: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface DeviceLoginResult {
  ok: boolean;
  ms: number;
  sn?: string;
  deviceType?: string;
  firmwareVer?: string;
  message: string;
}

export function loginDevice(input: DeviceLoginInput): Promise<DeviceLoginResult> {
  const { ip, port, username, password } = input;
  const timeoutMs = input.timeoutMs ?? 3000;

  if (!isValidIp(ip)) return Promise.resolve({ ok: false, ms: 0, message: "IP 格式錯誤" });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ ok: false, ms: 0, message: "連接埠需為 1-65535 的整數" });
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let buffer = "";

    const finish = (result: Omit<DeviceLoginResult, "ms">) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, ms: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish({ ok: false, message: "連線逾時" }));
    socket.once("error", (err) => finish({ ok: false, message: `連線失敗：${err.message}` }));
    socket.once("connect", () => {
      socket.write(JSON.stringify({ action: "login", username, password }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      let resp: Record<string, unknown>;
      try {
        resp = JSON.parse(line);
      } catch {
        finish({ ok: false, message: "設備回應格式錯誤（非 JSON），可能不是支援此雛形協定的設備" });
        return;
      }
      if (resp.ok) {
        const sn = typeof resp.sn === "string" ? resp.sn : undefined;
        finish({
          ok: true,
          sn,
          deviceType: typeof resp.deviceType === "string" ? resp.deviceType : undefined,
          firmwareVer: typeof resp.firmwareVer === "string" ? resp.firmwareVer : undefined,
          message: sn ? `登入成功，設備編號 ${sn}` : "登入成功，但設備未回傳編號",
        });
      } else {
        finish({ ok: false, message: String(resp.error ?? "登入失敗（帳號或密碼錯誤）") });
      }
    });

    socket.connect(port, ip);
  });
}
