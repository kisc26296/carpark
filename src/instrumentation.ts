// server 啟動時先連上 MQTT Broker 並訂閱設備上行，不用等第一個 API 請求
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getPlatform } = await import("@/lib/parking/mqtt-platform");
    try {
      getPlatform();
    } catch (error) {
      console.error("[mqtt] 啟動失敗:", error instanceof Error ? error.message : error);
    }

    // 顯示板：依剩餘車位數切換「有剩餘車位 / 無剩餘車位」的固定顯示
    try {
      const { startDisplayBoardSync } = await import("@/lib/parking/display-board");
      startDisplayBoardSync();
    } catch (error) {
      console.error("[display-board] 啟動失敗:", error instanceof Error ? error.message : error);
    }

    // 收找零紀錄：找零錢機出幣、紙鈔機收鈔時自動增減數量（要在設備連線前開始訂閱）
    try {
      const { startCashInventoryTracking } = await import("@/lib/parking/cash-inventory");
      await startCashInventoryTracking();
    } catch (error) {
      console.error("[cash-inventory] 啟動失敗:", error instanceof Error ? error.message : error);
    }

    // 現金設備依上次的設定自動連回 COM port；開不起來會在背景每 5 秒重試
    try {
      const { getAllConfigs } = await import("@/lib/cash-device/config-store");
      const { openDevice } = await import("@/lib/cash-device/serial-manager");
      for (const config of await getAllConfigs()) {
        if (config.autoConnect && config.port) await openDevice(config.device, config, { retry: true });
      }
    } catch (error) {
      console.error("[cash-device] 自動連線失敗:", error instanceof Error ? error.message : error);
    }
  }
}
