import "server-only";
import { DEFAULT_RATE_SETTINGS, type RateSettings } from "./rate-shared";
import { COLLECTIONS, getParkingDb } from "./store";

// 費率設定存在 carpark.system_settings（_id: "rate"）；還沒設定過時用預設值（原畫面上的範例數字）

const RATE_ID = "rate";

async function collection() {
  const db = await getParkingDb();
  return db.collection<RateSettings & { _id: string; updatedAt?: Date }>(COLLECTIONS.systemSettings);
}

export async function getRateSettings(): Promise<RateSettings & { updatedAt: string | null }> {
  const doc = await (await collection()).findOne({ _id: RATE_ID });
  if (!doc) return { ...structuredClone(DEFAULT_RATE_SETTINGS), updatedAt: null };
  const { _id, updatedAt, ...settings } = doc;
  void _id;
  return { ...structuredClone(DEFAULT_RATE_SETTINGS), ...settings, updatedAt: updatedAt ? updatedAt.toISOString() : null };
}

export async function saveRateSettings(settings: RateSettings): Promise<RateSettings & { updatedAt: string | null }> {
  await (await collection()).updateOne(
    { _id: RATE_ID },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true },
  );
  return getRateSettings();
}
