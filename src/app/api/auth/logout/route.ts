import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/user-shared";

export const dynamic = "force-dynamic";

// POST：登出，刪除登入 cookie
export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
