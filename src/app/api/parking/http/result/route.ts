import { saveHttpPlateResult } from "@/lib/parking/results";

// 規格 2.1：設備辨識車牌後 POST 到此 URL（需在設備端設定 Server address）
// 成功回 HTTP 200，失敗回 HTTP 500，body 為 { message }
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "body 不是合法的 JSON" }, { status: 500 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "body 必須是 JSON 物件" }, { status: 500 });
  }
  if (typeof body.license !== "string" || !body.license) {
    return Response.json({ message: "缺少 license（車牌號碼）" }, { status: 500 });
  }
  if (typeof body.sn !== "string" || !body.sn) {
    return Response.json({ message: "缺少 sn（設備序號）" }, { status: 500 });
  }

  try {
    const outcome = await saveHttpPlateResult(body);
    return Response.json({ message: "success", id: outcome.id });
  } catch (error) {
    console.error("HTTP 辨識結果保存失敗:", error);
    return Response.json({ message: error instanceof Error ? error.message : "保存失敗" }, { status: 500 });
  }
}
