import { cookies } from "next/headers";
import { createSessionToken } from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/user-shared";
import { verifyLogin } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// POST body: { username, password }；成功時寫入 180 分鐘的登入 cookie
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  if (typeof body.username !== "string" || typeof body.password !== "string" || !body.username.trim()) {
    return Response.json({ ok: false, error: "請輸入帳號與密碼" }, { status: 400 });
  }
  try {
    const user = await verifyLogin(body.username, body.password);
    if (!user) return Response.json({ ok: false, error: "帳號或密碼錯誤" }, { status: 401 });
    const { token, expires } = await createSessionToken(user);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // 區網用 http 連線時不能加 secure，否則瀏覽器不會存 cookie
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
      expires,
    });
    return Response.json({ ok: true, user, expiresAt: expires.toISOString() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "登入失敗" }, { status: 500 });
  }
}
