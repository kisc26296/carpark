import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// 給資料夾選擇器用的簡易伺服器端瀏覽：列出指定路徑底下的子資料夾
// GET 不帶 path：回傳磁碟機代號（Windows）或使用者家目錄（其他平台）
// GET ?path=xxx：回傳該路徑底下的子資料夾清單

async function listDrives(): Promise<string[]> {
  if (process.platform !== "win32") return [os.homedir()];
  const candidates = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`);
  const checks = await Promise.all(
    candidates.map(async (drive) => {
      try {
        await fs.access(drive);
        return drive;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((d): d is string => d !== null);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("path");

  if (!target) {
    const drives = await listDrives();
    return Response.json({
      path: null,
      parent: null,
      entries: drives.map((d) => ({ name: d, path: d })),
    });
  }

  try {
    const resolved = path.resolve(target);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return Response.json({ ok: false, error: "不是資料夾" }, { status: 400 });
    }
    const names = await fs.readdir(resolved, { withFileTypes: true });
    const entries = names
      .filter((n) => n.isDirectory() && !n.name.startsWith("."))
      .map((n) => ({ name: n.name, path: path.join(resolved, n.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

    const parsed = path.parse(resolved);
    const isRoot = resolved === parsed.root;
    const parent = isRoot ? null : path.dirname(resolved);

    return Response.json({ path: resolved, parent, entries });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取資料夾失敗" },
      { status: 400 },
    );
  }
}
