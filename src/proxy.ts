import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/user-shared";

// 登入檢查：沒有有效登入 cookie 時，頁面導到 /login，API 回 401。
// 這裡只驗證 cookie 簽章與到期時間；帳號是否還存在、是否為管理者由各 API 查資料庫判斷。

// 不用登入的頁面與 API：繳費機（自助繳費頁與它用到的 API）、攝影機上傳辨識結果、登入本身
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/parking-payment-kiosk",
  "/api/parking/kiosk-query",
  "/api/parking/kiosk-payment",
  "/api/parking/http/result",
];
// 只開放讀取（GET）：繳費機要顯示的車輛照片、影片與停車場名稱；修改設定仍要登入
const PUBLIC_GET_PATHS = ["/api/parking/entries/image", "/api/parking/kiosk-video", "/api/parking/lot-info"];

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  // 已登入還開登入頁 → 直接回首頁
  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (session || matches(pathname, PUBLIC_PATHS)) return NextResponse.next();
  if ((request.method === "GET" || request.method === "HEAD") && matches(pathname, PUBLIC_GET_PATHS)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return Response.json({ ok: false, error: "請先登入" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  const response = NextResponse.redirect(login);
  // 過期或被竄改的 cookie 一併清掉
  if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  // 靜態檔案、圖片最佳化、favicon、public 裡的圖片與廣告影片不經過登入檢查（繳費機要用）
  matcher: ["/((?!_next/static|_next/image|favicon.ico|ads/|images/|.*\\.(?:png|jpe?g|gif|svg|webp|ico|mp4|webm)$).*)"],
};
