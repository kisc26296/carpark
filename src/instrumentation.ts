// server 啟動時先連上 MQTT Broker 並訂閱設備上行，不用等第一個 API 請求
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getPlatform } = await import("@/lib/parking/mqtt-platform");
    try {
      getPlatform();
    } catch (error) {
      console.error("[mqtt] 啟動失敗:", error instanceof Error ? error.message : error);
    }
  }
}
