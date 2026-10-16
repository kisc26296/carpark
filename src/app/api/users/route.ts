import { createUser, deleteUser, listUsers, requireAdmin, updateUser, UserError, type UserInput } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// 使用者設定（只限管理者）：GET 列表、POST 新增、PUT ?id= 修改、DELETE ?id= 刪除

function fail(error: unknown, fallback: string) {
  const status = error instanceof UserError ? error.status : 500;
  return Response.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

async function readBody(request: Request): Promise<UserInput> {
  try {
    return (await request.json()) as UserInput;
  } catch {
    throw new UserError("body 不是合法的 JSON", 400);
  }
}

export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ ok: true, users: await listUsers() });
  } catch (error) {
    return fail(error, "讀取失敗");
  }
}

// POST body: { username, name, password, role: "admin" | "user", permissions: [...] }
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const user = await createUser(await readBody(request));
    return Response.json({ ok: true, user, users: await listUsers() });
  } catch (error) {
    return fail(error, "新增失敗");
  }
}

// PUT ?id=  body 同 POST，password 留空表示不修改
export async function PUT(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id");
    const user = await updateUser(id, await readBody(request));
    return Response.json({ ok: true, user, users: await listUsers() });
  } catch (error) {
    return fail(error, "儲存失敗");
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    await deleteUser(new URL(request.url).searchParams.get("id"), admin.id);
    return Response.json({ ok: true, users: await listUsers() });
  } catch (error) {
    return fail(error, "刪除失敗");
  }
}
