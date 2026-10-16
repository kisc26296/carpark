import "server-only";
import { ObjectId, type WithId } from "mongodb";
import { COLLECTIONS, getParkingDb } from "./store";
import { normalizePlate, type MonthlyRental, type MonthlyRentalInput } from "./monthly-rental-shared";

// 月租客戶資料存取（carpark.monthly_rentals）。編號由唯一索引保證不重複；
// 同一個車牌不可同時屬於兩位客戶，否則進場時無法判斷是哪一筆月租。

type MonthlyRentalDoc = Omit<MonthlyRental, "id">;

/** 給 API 用的錯誤，帶 HTTP 狀態碼 */
export class MonthlyRentalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const toRental = ({ _id, ...doc }: WithId<MonthlyRentalDoc>): MonthlyRental => ({ id: _id.toHexString(), ...doc });

async function collection() {
  const db = await getParkingDb();
  return db.collection<MonthlyRentalDoc>(COLLECTIONS.monthlyRentals);
}

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

/** 車牌是否已被其他客戶使用；回傳衝突說明，沒有衝突回傳 null */
async function findPlateConflict(plates: string[], excludeId?: ObjectId): Promise<string | null> {
  const filled = plates.filter(Boolean);
  if (filled.length === 0) return null;
  const col = await collection();
  const other = await col.findOne({ plates: { $in: filled }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (!other) return null;
  const plate = filled.find((p) => other.plates.map(normalizePlate).includes(p));
  return `車牌 ${plate} 已登記在編號 ${other.no}（${other.name || "未命名"}）`;
}

export async function listMonthlyRentals(): Promise<MonthlyRental[]> {
  const col = await collection();
  const docs = await col.find().sort({ no: 1 }).toArray();
  return docs.map(toRental);
}

export async function createMonthlyRental(input: MonthlyRentalInput): Promise<MonthlyRental> {
  const col = await collection();
  const conflict = await findPlateConflict(input.plates);
  if (conflict) throw new MonthlyRentalError(conflict, 409);

  // 編號留空就用目前最大編號 + 1
  let no = input.no;
  if (no === null) {
    const last = await col.find({}, { projection: { no: 1 } }).sort({ no: -1 }).limit(1).next();
    no = (last?.no ?? 0) + 1;
  }

  const now = new Date().toISOString();
  const doc: MonthlyRentalDoc = { ...input, no, createdAt: now, updatedAt: now };
  try {
    const { insertedId } = await col.insertOne(doc);
    return toRental({ _id: insertedId, ...doc });
  } catch (error) {
    if (isDuplicateKey(error)) throw new MonthlyRentalError(`編號 ${no} 已經有人使用`, 409);
    throw error;
  }
}

export async function updateMonthlyRental(id: string, input: MonthlyRentalInput): Promise<MonthlyRental> {
  if (!ObjectId.isValid(id)) throw new MonthlyRentalError("id 格式錯誤", 400);
  const _id = new ObjectId(id);
  const col = await collection();

  const conflict = await findPlateConflict(input.plates, _id);
  if (conflict) throw new MonthlyRentalError(conflict, 409);

  // 修改時編號留空就維持原本的編號
  const { no, ...rest } = input;
  const patch: Partial<MonthlyRentalDoc> = { ...rest, ...(no !== null ? { no } : {}), updatedAt: new Date().toISOString() };
  try {
    const updated = await col.findOneAndUpdate({ _id }, { $set: patch }, { returnDocument: "after" });
    if (!updated) throw new MonthlyRentalError("找不到這筆月租資料", 404);
    return toRental(updated);
  } catch (error) {
    if (isDuplicateKey(error)) throw new MonthlyRentalError(`編號 ${no} 已經有人使用`, 409);
    throw error;
  }
}
