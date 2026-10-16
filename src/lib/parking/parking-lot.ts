import "server-only";
import { COLLECTIONS, getParkingDb } from "./store";

// 停車場基本資料，存在 carpark.system_settings（_id: "parking-lot"）；目前只有名稱，顯示在繳費機上方抬頭

const SETTINGS_ID = "parking-lot";
export const PARKING_LOT_NAME_MAX = 40;

export interface ParkingLotInfo {
  /** 停車場名稱；空字串代表未設定 */
  name: string;
  updatedAt: string | null;
}

async function collection() {
  const db = await getParkingDb();
  return db.collection<{ _id: string; name: string; updatedAt: Date }>(COLLECTIONS.systemSettings);
}

export async function getParkingLotInfo(): Promise<ParkingLotInfo> {
  const doc = await (await collection()).findOne({ _id: SETTINGS_ID });
  return { name: doc?.name ?? "", updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null };
}

export async function saveParkingLotName(name: string): Promise<ParkingLotInfo> {
  await (await collection()).updateOne(
    { _id: SETTINGS_ID },
    { $set: { name, updatedAt: new Date() } },
    { upsert: true },
  );
  return getParkingLotInfo();
}
