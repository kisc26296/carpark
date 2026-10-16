import { validateRateSettings } from "@/lib/parking/rate-shared";
import { getRateSettings, saveRateSettings } from "@/lib/parking/rate-settings";

export const dynamic = "force-dynamic";

// 讀取費率設定：GET /api/parking/rate（還沒設定過時回傳預設值，updatedAt 為 null）
export async function GET() {
  try {
    return Response.json({ ok: true, settings: await getRateSettings() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "讀取失敗" }, { status: 500 });
  }
}

// 儲存費率設定：PUT /api/parking/rate  body: RateSettings
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const result = validateRateSettings(body);
  if (!result.ok) return Response.json({ ok: false, error: result.errors.join("、") }, { status: 400 });
  try {
    return Response.json({ ok: true, settings: await saveRateSettings(result.value) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "儲存失敗" }, { status: 500 });
  }
}
