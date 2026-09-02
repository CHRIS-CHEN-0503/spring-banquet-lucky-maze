const clientCount = Math.max(1, Number(process.env.CLIENTS || 60));
const durationMs = Math.max(1_000, Number(process.env.DURATION_MS || 15_000));
const socketUrl = process.env.WS_URL || "ws://127.0.0.1:8788/ws/load-test";
const sockets = [];
const stats = {
  opened: 0,
  hello: 0,
  joined: 0,
  state: 0,
  positionBatches: 0,
  errors: [],
};

function waitFor(condition, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待逾時：${label}`));
      }
    }, 25);
  });
}

for (let index = 0; index < clientCount; index += 1) {
  const id = `p-load-${String(index + 1).padStart(3, "0")}`;
  const socket = new WebSocket(socketUrl);
  sockets.push({ id, socket, stateSeen: false, positionTimer: null });
  socket.addEventListener("open", () => {
    stats.opened += 1;
    socket.send(JSON.stringify({
      type: "join",
      role: "participant",
      clientId: id,
      name: `負載勇者${index + 1}`,
      employeeId: `LOAD${String(index + 1).padStart(3, "0")}`,
      character: ["yong", "hua", "dan", "liya", "robot", "cat"][index % 6],
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "hello") stats.hello += 1;
    if (message.type === "joined") stats.joined += 1;
    if (message.type === "state") {
      if (!sockets[index].stateSeen) stats.state += 1;
      sockets[index].stateSeen = true;
    }
    if (message.type === "positions") stats.positionBatches += 1;
    if (message.type === "error") stats.errors.push({ id, code: message.code, message: message.message });
  });
  socket.addEventListener("error", () => stats.errors.push({ id, code: "SOCKET_ERROR" }));
}

await waitFor(() => stats.state === clientCount, 12_000, `${clientCount} 位玩家加入`);

for (let index = 0; index < sockets.length; index += 1) {
  const record = sockets[index];
  let tick = 0;
  record.positionTimer = setInterval(() => {
    if (record.socket.readyState !== WebSocket.OPEN) return;
    tick += 1;
    record.socket.send(JSON.stringify({
      type: "position",
      x: (index % 10) * 1.5 + Math.sin(tick / 3),
      z: Math.floor(index / 10) * 1.5 + Math.cos(tick / 3),
      yaw: (tick % 32) / 10,
    }));
  }, 250);
}

await new Promise((resolve) => setTimeout(resolve, durationMs));

for (const record of sockets) {
  clearInterval(record.positionTimer);
  record.socket.close(1000, "load test complete");
}

if (stats.opened !== clientCount || stats.hello !== clientCount || stats.joined !== clientCount || stats.state !== clientCount) {
  throw new Error(`連線數不完整：${JSON.stringify(stats)}`);
}
if (stats.errors.length) throw new Error(`收到伺服器錯誤：${JSON.stringify(stats.errors.slice(0, 5))}`);
if (!stats.positionBatches) throw new Error("未收到任何位置批次");

console.log(JSON.stringify({
  ok: true,
  clients: clientCount,
  durationMs,
  opened: stats.opened,
  joined: stats.joined,
  initialStates: stats.state,
  positionBatches: stats.positionBatches,
  errors: stats.errors.length,
}, null, 2));
