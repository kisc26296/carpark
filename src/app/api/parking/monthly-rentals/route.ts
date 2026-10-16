import {
  createMonthlyRental,
  listMonthlyRentals,
  MonthlyRentalError,
  updateMonthlyRental,
} from "@/lib/parking/monthly-rental";
import { validateMonthlyRental } from "@/lib/parking/monthly-rental-shared";

export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) =>
  error instanceof MonthlyRentalError
    ? Response.json({ ok: false, error: error.message }, { status: error.status })
    : Response.json({ ok: false, error: error instanceof Error ? error.message : "操作失敗" }, { status: 500 });

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 讀取全部月租客戶（依編號排序）：GET /api/parking/monthly-rentals
export async function GET() {
  try {
    return Response.json({ ok: true, items: await listMonthlyRentals() });
  } catch (error) {
    return errorResponse(error);
  }
}

// 新增月租客戶：POST /api/parking/monthly-rentals
// body: MonthlyRentalInput（編號留空自動給號）
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  const result = validateMonthlyRental(body);
  if (!result.ok) return Response.json({ ok: false, error: result.errors.join("、") }, { status: 400 });
  try {
    return Response.json({ ok: true, item: await createMonthlyRental(result.value) });
  } catch (error) {
    return errorResponse(error);
  }
}

// 修改月租客戶：PUT /api/parking/monthly-rentals
// body: { id, ...MonthlyRentalInput }（編號留空維持原編號）
export async function PUT(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  if (typeof body.id !== "string") return Response.json({ ok: false, error: "缺少 id" }, { status: 400 });
  const result = validateMonthlyRental(body);
  if (!result.ok) return Response.json({ ok: false, error: result.errors.join("、") }, { status: 400 });
  try {
    return Response.json({ ok: true, item: await updateMonthlyRental(body.id, result.value) });
  } catch (error) {
    return errorResponse(error);
  }
}
