import { loginDevice } from "@/lib/parking/device-login";

// 設備連線測試：body { ip, port, username, password }
// 用帳號密碼透過 TCP 登入設備並取得編號(SN)；協定細節見 device-login.ts 開頭說明
export async function POST(request: Request) {
  let body: { ip?: unknown; port?: unknown; username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const port = Number(body.port);
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!ip) return Response.json({ ok: false, error: "缺少 ip" }, { status: 400 });

  const result = await loginDevice({ ip, port, username, password });
  return Response.json({
    ok: result.ok,
    ms: result.ms,
    message: result.message,
    sn: result.sn,
    deviceType: result.deviceType,
    firmwareVer: result.firmwareVer,
    ip,
    port,
  });
}
