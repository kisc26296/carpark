import {
  createManualEntry,
  deleteEntry,
  editEntry,
  listEntries,
  markExited,
  ParkingEntryError,
} from "@/lib/parking/parking-entries";

export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) =>
  error instanceof ParkingEntryError
    ? Response.json({ ok: false, error: error.message }, { status: error.status })
    : Response.json({ ok: false, error: error instanceof Error ? error.message : "操作失敗" }, { status: 500 });

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 查詢進場紀錄：GET /api/parking/entries?scope=inside|all&plate=&limit=
// scope=inside（預設）只列場內車輛；plate 為部分比對
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") === "all" ? "all" : "inside";
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 1000);
  try {
    return Response.json({ ok: true, items: await listEntries({ scope, plate: params.get("plate") ?? "", limit }) });
  } catch (error) {
    return errorResponse(error);
  }
}

// 手動新增場內車輛：POST /api/parking/entries  body: { plate, entryTime?: ISO 時間 }
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  try {
    return Response.json({ ok: true, item: await createManualEntry(body) });
  } catch (error) {
    return errorResponse(error);
  }
}

// 修改或設定出場：PATCH /api/parking/entries
// body: { id, plate?, entryTime? } 修改車牌 / 入場時間；{ id, action: "exit" } 設定已出場
export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  try {
    const item = body.action === "exit" ? await markExited(body.id) : await editEntry(body);
    return Response.json({ ok: true, item });
  } catch (error) {
    return errorResponse(error);
  }
}

// 刪除進場紀錄：DELETE /api/parking/entries?id=
export async function DELETE(request: Request) {
  try {
    await deleteEntry(new URL(request.url).searchParams.get("id"));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
