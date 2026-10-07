// 規格文件中所有功能的目錄與範例資料，供測試頁顯示與預填（前後端共用）

export interface CommandSpec {
  command: string;
  section: string;
  title: string;
  description: string;
  /** 業務資料範例（送出時會序列化成 data 字串）；null 代表 data 為空字串 */
  sample: Record<string, unknown> | null;
  /** 高風險操作，規格建議限制權限並記錄 audit log */
  risky?: boolean;
}

const lcdAct = (items: string, voice: string, action: number) =>
  JSON.stringify({ cmdName: "SetLCDItems", template: 1, adID: 0, items, voice, action });

const plateResultSample = {
  IsCarExist: "Motor Vehicle",
  bodyColor: "",
  brand: "Peugeot",
  carNO: "ABC-1234",
  carNOC: "",
  carType: "",
  confid: 885,
  coordinate: "(18,85,32,94)",
  encrypted: "Unencrypted",
  fwConfid: 795,
  guid: "",
  imgT: "",
  memo: "",
  model: "",
  openGate: 0,
  picMin: "bbbb/SN/date/xxxMin.jpg",
  picMinFile: "",
  picMin_full: "https://example/xxxMin.jpg",
  picN: "bbbb/SN/date/xxx.jpg",
  picNFile: "",
  picN_full: "https://example/xxx.jpg",
  resultType: 0,
  triggT: "",
  validPlate: "TRUE",
};

/** 2.1 HTTP 車牌辨識結果 POST 範例 */
export const HTTP_RESULT_SAMPLE = {
  colorType: 1,
  license: "ABC-1234",
  sn: "YCOPCM-E10-LS24090006",
  imageFile: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////",
  attachInfo: {
    bodyColor: "",
    brand: "",
    carArriveTime: "",
    carType: "",
    confidence: 0.953,
    encryptInfo: "Unencrypted",
    isCarBack: "UNKNOWN",
    isFakePlate: "",
    model: "",
    observedFrames: 5,
  },
};

/** 3. MQTT 上行：設備 → Server（由模擬設備發出） */
export const UPLINK_COMMANDS: CommandSpec[] = [
  {
    command: "Conn",
    section: "3.1",
    title: "設備上線",
    description: "設備連上平台後回報設備/版本資訊；平台會回 Rtd(serverTime)。",
    sample: {
      devInfo:
        "devIP~172.18.24.67,devSubnet~255.255.0.0,devGateway~172.18.9.28,appVer~21.1.22,firmwareVer~21.2.0.2122,deviceType~PCM500FSPUTV14",
    },
  },
  {
    command: "Result",
    section: "3.2",
    title: "車牌辨識結果",
    description: "上報車輛通行/辨識結果（QoS 2）。guid、triggT、imgT 留空會自動產生；同一個 guid 只會記錄一次。",
    sample: plateResultSample,
  },
  {
    command: "OfflineResult",
    section: "3.3",
    title: "離線結果補傳",
    description: "設備重新上線後補傳離線期間的辨識結果，格式同 Result 但不傳小圖。",
    sample: Object.fromEntries(
      Object.entries(plateResultSample).filter(([key]) => !key.startsWith("picMin")),
    ),
  },
  {
    command: "Image",
    section: "3.4",
    title: "索取圖片上傳參數",
    description: "設備上電後詢問圖片走 MQTT Base64 或 OSS；平台會下發 Image(type)。",
    sample: null,
  },
  {
    command: "DlPassRule",
    section: "3.5",
    title: "索取通行規則",
    description: "收到 EnableUpdate 後設備主動拉取規則；平台會下發 DlPassRule。",
    sample: null,
  },
  {
    command: "DlCarInfo",
    section: "3.6",
    title: "索取固定車資料",
    description: "收到 EnableUpdate 後設備主動拉取固定車；平台會下發 DlCarInfo(url)。",
    sample: null,
  },
  {
    command: "OverUpdate",
    section: "3.7",
    title: "更新結果回報",
    description: "1 已更新、0 未更新、-1 更新失敗。",
    sample: { carinfo: 1, passruler: 1 },
  },
  {
    command: "CarInfo",
    section: "3.8",
    title: "固定車查詢結果",
    description: "回覆 QueryCarInfo；queryId 沿用平台下發值。",
    sample: { plate: "LA55555", queryId: "202411121609004", time: "2024-11-13", type: 1 },
  },
  {
    command: "SnapshotPic",
    section: "3.9",
    title: "快照結果",
    description: "回傳平台要求的即時快照。",
    sample: {
      picN: "bbbb/SN/date/snapshot.jpg",
      picNFile: "",
      picN_full: "https://example/snapshot.jpg",
      snapshotId: "202411121609004",
    },
  },
  {
    command: "Rtd",
    section: "3.10",
    title: "即時狀態心跳",
    description: "預設每 30 秒上報；hasCar 0 無車、1 有車、2 Unknown。",
    sample: { hasCar: 1 },
  },
  {
    command: "BackResult",
    section: "3.11",
    title: "車輛折返",
    description: "偵測到車輛折返時上報，格式同 Result。",
    sample: plateResultSample,
  },
  {
    command: "SerialConfig",
    section: "3.12",
    title: "序列埠設定狀態",
    description: "回報 SerialConfig 是否套用。",
    sample: { channel: 0, state: 0 },
  },
  {
    command: "SerialData",
    section: "3.13",
    title: "序列埠資料上傳",
    description: "RS485 外設回傳資料，data 為原始 bytes 的 Base64。",
    sample: { channel: 0, data: "SGVsbG8gQ2FycGFyaw==", len: 13 },
  },
  {
    command: "IOStatus",
    section: "3.14",
    title: "IO 狀態變化",
    description: "no 為 IO 編號 0/1；state 0 Low、1 High。",
    sample: { no: 0, state: 1 },
  },
  {
    command: "EncryptionStatus",
    section: "3.15",
    title: "加密狀態",
    description: "0 Unencrypted、1 SNTEncrypted、2 TPSDKEncrypted。",
    sample: { status: 0 },
  },
  {
    command: "EncryptDevice",
    section: "3.16",
    title: "加密設定結果",
    description: "0 執行成功、1 執行失敗。",
    sample: { status: 0 },
  },
  {
    command: "ChangeEncryptionKey",
    section: "3.17",
    title: "更換金鑰結果",
    description: "0 執行成功、1 執行失敗。",
    sample: { status: 0 },
  },
  {
    command: "CarRetention",
    section: "3.18",
    title: "車輛滯留",
    description: "出口車輛長時間停在柵欄前時上報。triggT 留空會自動產生。",
    sample: {
      carNO: "ABC-1234",
      carNOC: "",
      triggT: "",
      encrypted: "Unencrypted",
      picN: "bbbb/SN/date/retention.jpg",
      picN_full: "https://example/retention.jpg",
      picNFile: "",
    },
  },
];

/** 4. MQTT 下行：Server → 設備 */
export const DOWNLINK_COMMANDS: CommandSpec[] = [
  {
    command: "Image",
    section: "4.1",
    title: "設定圖片上傳方式",
    description: "type 0：Base64 走 MQTT；1：Alibaba OSS。回覆 ImageReply。",
    sample: { type: 0, dir: "", endpoint: "", bucketName: "", accessKeyId: "", accessKeySecret: "" },
  },
  { command: "Open", section: "4.2", title: "開閘", description: "繳費完成、月租車或人工放行。", sample: null },
  { command: "Close", section: "4.3", title: "關閘", description: "主動關閉柵欄。", sample: null },
  {
    command: "EnableUpdate",
    section: "4.4",
    title: "全量更新通知",
    description: "設備回 Receipt 後會上行 DlPassRule / DlCarInfo，平台下發後設備回 OverUpdate。",
    sample: { passruler: 1, carinfo: 1 },
  },
  {
    command: "SnapshotPic",
    section: "4.5",
    title: "要求快照",
    description: "snapshotId 需小於 32 字元；設備上行 SnapshotPic 回傳圖片。",
    sample: { snapshotId: "202411121609004" },
  },
  {
    command: "DlPassRule",
    section: "4.6",
    title: "下發通行規則",
    description: "臨停/白名單/黑名單規則；Act 欄位是序列化的 JSON 字串。設備回 OverUpdate。",
    sample: {
      tcarTiming: 1,
      wcarTiming: 0,
      bcarTiming: 2,
      tcarAct: lcdAct("1,{carType},{plate},Please enter", "26: Welcome", 0),
      wcarAct: lcdAct("1,{carType},{plate},Please enter", "{carType},{plate},26:Please enter", 1),
      bcarAct: lcdAct("1,{carType},{plate},{EntryTime}", "26: Welcome", 0),
    },
  },
  {
    command: "DlCarInfo",
    section: "4.7",
    title: "下發固定車檔案",
    description: "url 為固定車檔案連結，一行一筆。設備回 OverUpdate。",
    sample: { url: "https://example.com/carinfo.txt" },
  },
  {
    command: "AddCarInfo",
    section: "4.8",
    title: "新增/更新固定車",
    description: "存在則更新時間，不存在則新增。type 見 5.1 固定車類型。",
    sample: {
      carInfoList: [
        { plate: "LA55555", type: 1, time: "2024-11-13" },
        { plate: "JA66666", type: 1, time: "2024-11-13" },
      ],
    },
  },
  {
    command: "DeleteCarInfo",
    section: "4.9",
    title: "刪除固定車",
    description: "月租退租、黑白名單移除。",
    sample: { plateList: ["LA55555", "LA66666"] },
  },
  {
    command: "QueryCarInfo",
    section: "4.10",
    title: "查詢固定車",
    description: "設備上行 CarInfo 回覆。可先用 AddCarInfo 新增再查詢。",
    sample: { queryId: "202411121609004", plate: "LA55555" },
  },
  {
    command: "Rtd",
    section: "4.11",
    title: "心跳 / 平台時間",
    description: "下發平台時間；設備不會回覆。",
    sample: { serverTime: "" },
  },
  {
    command: "LongOpen",
    section: "4.12",
    title: "常開 / 車隊模式",
    description: "switchType on / off。",
    sample: { switchType: "on" },
    risky: true,
  },
  {
    command: "SerialConfig",
    section: "4.13",
    title: "序列埠參數",
    description: "未下發時設備預設 19200,0,1,8。",
    sample: { channel: 0, baudRate: 9600, parity: 0, stop: 0, databits: 8 },
  },
  {
    command: "SerialData",
    section: "4.14",
    title: "RS485 資料轉送",
    description: "一次可送多筆，data 為原始 bytes 的 Base64。回覆 SerialDataReply。",
    sample: { serialData: [{ channel: 0, data: "SGVsbG8gQ2FycGFyaw==", len: 13 }] },
  },
  {
    command: "IOStatus",
    section: "4.15",
    title: "查詢 IO 狀態",
    description: "設備上行 IOStatus(no, state)。",
    sample: { no: 0 },
  },
  {
    command: "SoftTriggerCapture",
    section: "4.16",
    title: "軟觸發辨識",
    description: "設備回 Receipt 後會再上行 Result，Result 才是真正的辨識結果。",
    sample: null,
  },
  {
    command: "ResetDevice",
    section: "4.17",
    title: "遠端重啟",
    description: "設備異常或維護時遠端重啟。",
    sample: null,
    risky: true,
  },
  {
    command: "EncryptionStatus",
    section: "4.18",
    title: "查詢加密狀態",
    description: "設備上行 EncryptionStatus(status)。",
    sample: null,
  },
  {
    command: "EncryptDevice",
    section: "4.19",
    title: "啟用/停用車牌加密",
    description: "key 為 Base64；enable 0 關閉、1 啟用。解密為 AES-128/ECB/zero padding。",
    sample: { key: "MTIzNDU2Nzk4", enable: 1 },
    risky: true,
  },
  {
    command: "ChangeEncryptionKey",
    section: "4.20",
    title: "更換加密金鑰",
    description: "currentKey 不符時設備回 status 1。原廠預設 key 為 123456798（MTIzNDU2Nzk4）。",
    sample: { currentKey: "MTIzNDU2Nzk4", newKey: "YWJjZDEyMzQ1" },
    risky: true,
  },
  {
    command: "EnableReply",
    section: "4.21",
    title: "啟用 Receipt",
    description: "enable 0 時設備不再回 errCode 類 Receipt，測試完請改回 1。",
    sample: { enable: 1 },
  },
  {
    command: "Config",
    section: "4.22",
    title: "MQTT 功能開關",
    description: "Receipt、離線補傳、IO0/IO1 上報。回覆 ConfigReply。",
    sample: { enableReply: 1, enableOffline: 1, enableIOStatus0: 1, enableIOStatus1: 1 },
  },
  {
    command: "ClearData",
    section: "4.23",
    title: "清除設備資料",
    description: "clearCarInfo 會清掉模擬設備的固定車清單。回覆 ClearDataReply。",
    sample: { clearCarInfo: 0, clearResult: 1, clearLog: 0 },
    risky: true,
  },
];

/** 5.1 固定車類型 */
export const CAR_TYPES: Record<number, string> = {
  1: "月租車",
  2: "自有車",
  3: "儲值車",
  4: "VIP",
  5: "黑名單",
  6: "自訂白名單",
  7: "自訂黑名單",
  9: "離線放行表達式",
};

/** 2.2 HTTP colorType 車牌顏色代碼（常用） */
export const HTTP_COLOR_TYPES: Record<number, string> = {
  0: "未知",
  1: "藍",
  2: "黃",
  3: "白",
  4: "黑",
  5: "綠",
  7: "紅",
  8: "多色",
};
