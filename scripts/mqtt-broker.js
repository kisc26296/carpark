// 本機開發用的 MQTT Broker（純 JS，不需要另外安裝 Mosquitto）
// 用法：node scripts/mqtt-broker.js [port]
const { Aedes } = require("aedes");
const net = require("net");

const port = Number(process.argv[2] || process.env.MQTT_BROKER_PORT || 1883);

async function main() {
  const aedes = await Aedes.createBroker();
  const server = net.createServer(aedes.handle);

  server.listen(port, () => {
    console.log(`[mqtt-broker] 監聽中 mqtt://localhost:${port}`);
  });

  aedes.on("client", (client) => {
    console.log(`[mqtt-broker] 設備連線: ${client.id}`);
  });

  aedes.on("clientDisconnect", (client) => {
    console.log(`[mqtt-broker] 設備斷線: ${client.id}`);
  });

  aedes.on("publish", (packet, client) => {
    if (client) {
      console.log(`[mqtt-broker] ${client.id} -> ${packet.topic}`);
    }
  });
}

main().catch((err) => {
  console.error("[mqtt-broker] 啟動失敗:", err);
  process.exit(1);
});
