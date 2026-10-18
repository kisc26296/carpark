import { validateDisplayBoardSettings } from "@/lib/parking/display-board-shared";
import { getDisplayBoardSettings, saveDisplayBoardSettings } from "@/lib/parking/display-board";

export const dynamic = "force-dynamic";

// 顯示板情境訊息設定：GET 讀取、PUT 儲存（儲存後立刻依剩餘車位數重送固定顯示）
export async function GET() {
  try {
    return Response.json({ ok: true, settings: await getDisplayBoardSettings() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const result = validateDisplayBoardSettings(body);
  if (!result.ok) return Response.json({ ok: false, error: result.errors.join("；"), errors: result.errors }, { status: 400 });
  try {
    return Response.json({ ok: true, settings: await saveDisplayBoardSettings(result.value) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status: 500 });
  }
}
