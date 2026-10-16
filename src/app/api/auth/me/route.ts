import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/user-shared";
import { getCurrentUser } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// GET：目前登入的使用者；帳號已被刪除時清掉 cookie 並回 401
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      (await cookies()).delete(SESSION_COOKIE);
      return Response.json({ ok: false, error: "請先登入" }, { status: 401 });
    }
    return Response.json({ ok: true, user });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}
