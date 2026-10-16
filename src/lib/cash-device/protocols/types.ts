// 各現金設備協定與 serial-manager 之間的介面：serial-manager 負責 COM port 收發與紀錄，
// 協定模組負責翻譯收到的資料、決定要不要自動回應、維護設備自己的狀態。

export interface ProtocolMessage {
  data: Uint8Array;
  /** 紀錄裡顯示的說明 */
  text: string;
  /** 例行查詢這類重複訊息不寫進紀錄，避免洗版 */
  quiet?: boolean;
}

export interface ProtocolContext {
  write(message: ProtocolMessage): Promise<void>;
}

export interface RxResult {
  text?: string;
  quiet?: boolean;
  /** 有封包格式的協定把收到的資料切成一個個封包，各自寫一筆紀錄；有給就取代 text */
  entries?: { data: Uint8Array; text: string; quiet?: boolean }[];
  /** 收到的資料裡至少有一個格式正確、看得懂的回應；連線測試用來判斷設備有沒有回應 */
  valid?: boolean;
  /** 收到資料後要自動回給設備的訊息；serial-manager 會先記下收到的資料再送出 */
  replies?: ProtocolMessage[];
}

export interface DeviceProtocol {
  onOpen(ctx: ProtocolContext): void;
  onClose(): void;
  onData(data: Uint8Array): RxResult;
  /** 連線測試要送的指令（詢問狀態），設備有回應就代表連線正常 */
  probe(): ProtocolMessage;
}
