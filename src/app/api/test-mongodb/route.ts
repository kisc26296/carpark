import { getDb } from "@/lib/mongodb";

// 測試 MongoDB 連線：GET /api/test-mongodb
export async function GET() {
  const start = Date.now();

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();

    return Response.json({
      ok: true,
      database: db.databaseName,
      collections: collections.map((c) => c.name),
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    console.error("MongoDB 連線測試失敗:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "未知錯誤",
        latencyMs: Date.now() - start,
      },
      { status: 500 },
    );
  }
}
