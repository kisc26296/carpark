// 登入 session：把 { 使用者 id, 帳號, 到期時間 } 用 HMAC-SHA256 簽章後存在 httpOnly cookie。
// 只用 Web Crypto，proxy 與 route handler 都能驗證，不必查資料庫。

import { SESSION_MAX_AGE_SEC } from "./user-shared";

export interface SessionPayload {
  /** 使用者 _id */
  sub: string;
  username: string;
  /** 到期時間（epoch 毫秒） */
  exp: number;
}

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

// 簽章金鑰：.env.local 的 AUTH_SECRET；沒設定時由 mongodb_url 衍生（換掉任一個，所有人都要重新登入）
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.AUTH_SECRET || `carpark-session:${process.env.mongodb_url ?? ""}`;
    keyPromise = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
  }
  return keyPromise;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function createSessionToken(user: { id: string; username: string }): Promise<{ token: string; expires: Date }> {
  const payload: SessionPayload = { sub: user.id, username: user.username, exp: Date.now() + SESSION_MAX_AGE_SEC * 1000 };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(body)));
  return { token: `${body}.${toBase64Url(signature)}`, expires: new Date(payload.exp) };
}

/** 簽章正確且未過期才回傳內容，否則回傳 null */
export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await getKey(), fromBase64Url(signature), encoder.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
