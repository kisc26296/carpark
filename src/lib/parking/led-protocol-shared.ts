// LED 點陣顯示控制卡（RS485）前後端共用的常數，不可引入 server-only 模組（iconv-lite / CRC 實作見 led-protocol.ts）

export type LedColor = 1 | 2 | 3;

export const LED_COLORS: { value: LedColor; label: string }[] = [
  { value: 1, label: "紅" },
  { value: 2, label: "綠" },
  { value: 3, label: "黃" },
];

export const LED_DEFAULT_ADDRESS = 100;

/** 單行內容上限（依規格：加載廣告/臨顯內容的 0~60 bytes，GBK 編碼後的位元組數） */
export const LED_MAX_CONTENT_BYTES = 60;
