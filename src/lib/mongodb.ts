import "server-only";
import { MongoClient, type Db } from "mongodb";

const DEFAULT_DB_NAME = "carpark";

// 開發模式下 HMR 會重新載入模組，把連線存在 globalThis 避免每次存檔都開新的連線池
const globalForMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise(): Promise<MongoClient> {
  if (globalForMongo._mongoClientPromise) {
    return globalForMongo._mongoClientPromise;
  }

  const uri = process.env.mongodb_url;
  if (!uri) {
    throw new Error("缺少環境變數 mongodb_url，請在 .env.local 設定");
  }

  const promise = new MongoClient(uri).connect();
  // 連線失敗時清掉快取，下一次呼叫才會重試，而不是一直拿到失敗的 promise
  promise.catch(() => {
    globalForMongo._mongoClientPromise = undefined;
  });
  globalForMongo._mongoClientPromise = promise;
  return promise;
}

/** 取得共用的 MongoClient（整個 server 共用同一個連線池） */
export async function getMongoClient(): Promise<MongoClient> {
  return getClientPromise();
}

/** 取得資料庫，預設為 carpark */
export async function getDb(dbName: string = DEFAULT_DB_NAME): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}
