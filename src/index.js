import {
  CoreError,
  claimTicket,
  configurePrizes,
  createInitialState,
  drawPrize,
  dropTicket,
  finishParticipant,
  markDraw,
  nextCooldownAt,
  normalizePosition,
  normalizeRoomId,
  projectState,
  releaseCooldowns,
  resetRoom,
  setParticipantConnected,
  setTicketsLocked,
  joinParticipant,
  useItemEvent,
} from "./room-core.js";

const POSITION_INPUT_INTERVAL_MS = 250;
const POSITION_BATCH_MS = 150;
const MAX_MESSAGE_BYTES = 16_384;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function secureRandom() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 4_294_967_296;
}

function pinMatches(actualValue, expectedValue) {
  const actual = String(actualValue ?? "");
  const expected = String(expectedValue ?? "");
  if (!expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function errorPayload(error) {
  if (error instanceof CoreError) {
    return { type: "error", code: error.code, message: error.message };
  }
  console.error("SpringRoom error", error);
  return { type: "error", code: "SERVER_ERROR", message: "伺服器暫時無法處理，請稍後再試" };
}

function parseRoomId(pathname) {
  const match = pathname.match(/^\/ws\/([^/]+)$/);
  return match ? normalizeRoomId(decodeURIComponent(match[1])) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        service: "春酒尋籤迷宮",
        version: env.APP_VERSION ?? "1.0.0",
        build: env.BUILD_SHA ?? "local",
      });
    }

    if (url.pathname.startsWith("/ws/")) {
      let roomId;
      try {
        roomId = parseRoomId(url.pathname);
      } catch (error) {
        return jsonResponse(errorPayload(error), 400);
      }
      if (!roomId) return jsonResponse({ ok: false, message: "WebSocket 房號路徑不正確" }, 404);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonResponse({ ok: false, message: "此端點只接受 WebSocket 連線" }, 426, { upgrade: "websocket" });
      }
      const roomObject = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      return roomObject.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class SpringRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.roomId = "spring-party";
    this.positions = new Map();
    this.lastPositionAt = new Map();
    this.positionFlushTimer = null;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const [savedRoom, savedRoomId] = await Promise.all([
        this.ctx.storage.get("room"),
        this.ctx.storage.get("roomId"),
      ]);
      this.room = savedRoom ?? createInitialState();
      this.roomId = savedRoomId ?? this.roomId;
      const released = releaseCooldowns(this.room);
      this.room = released.state;
      if (!savedRoom || released.releasedTicketIds.length) {
        await this.ctx.storage.put("room", this.room);
      }
      await this.scheduleCooldownAlarm();
    });
  }

  async fetch(request) {
    await this.ready;
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ ok: false, message: "此房間只接受 WebSocket 連線" }, 426);
    }
    const url = new URL(request.url);
    const roomId = parseRoomId(url.pathname);
    if (!roomId) return jsonResponse({ ok: false, message: "房號不正確" }, 400);
    if (this.roomId !== roomId) {
      this.roomId = roomId;
      await this.ctx.storage.put("roomId", roomId);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`room:${roomId}`]);
    server.serializeAttachment({ role: "pending", clientId: null, roomId });
    this.safeSend(server, {
      type: "hello",
      roomId,
      version: this.env.APP_VERSION ?? "1.0.0",
      build: this.env.BUILD_SHA ?? "local",
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    await this.ready;
    try {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
        throw new CoreError("MESSAGE_TOO_LARGE", "訊息內容過大");
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new CoreError("INVALID_JSON", "訊息格式不正確");
      }
      if (!data || typeof data.type !== "string") {
        throw new CoreError("INVALID_MESSAGE", "訊息缺少操作類型");
      }
      await this.handleMessage(socket, data);
    } catch (error) {
      this.safeSend(socket, errorPayload(error));
    }
  }

  async handleMessage(socket, data) {
    if (data.type === "join") {
      await this.handleJoin(socket, data);
      return;
    }
    const attachment = socket.deserializeAttachment() ?? { role: "pending", clientId: null };
    if (attachment.role === "pending") throw new CoreError("NOT_JOINED", "請先選擇身分並加入房間");

    if (data.type === "position") {
      this.handlePosition(attachment, data);
      return;
    }
    if (data.type === "claim") {
      this.requireParticipant(attachment);
      const result = claimTicket(this.room, {
        clientId: attachment.clientId,
        tokenId: data.tokenId,
      }, Date.now(), secureRandom);
      this.room = result.state;
      await this.persistAndSchedule();
      this.safeSend(socket, result.event);
      this.broadcastEvent({
        type: "ticket_claimed",
        clientId: result.event.clientId,
        name: result.event.name,
        availableTickets: projectState(this.room, "display").availableTickets,
      }, socket);
      this.broadcastStates();
      return;
    }
    if (data.type === "drop") {
      this.requireParticipant(attachment);
      const result = dropTicket(this.room, attachment.clientId);
      this.room = result.state;
      await this.persistAndSchedule();
      this.broadcastEvent(result.event);
      this.broadcastStates();
      return;
    }
    if (data.type === "finish") {
      this.requireParticipant(attachment);
      const result = finishParticipant(this.room, attachment.clientId);
      this.room = result.state;
      await this.ctx.storage.put("room", this.room);
      this.broadcastEvent(result.event);
      this.broadcastStates();
      return;
    }
    if (data.type === "item_event") {
      this.requireParticipant(attachment);
      const result = useItemEvent(this.room, attachment.clientId, data.kind);
      this.room = result.state;
      await this.ctx.storage.put("room", this.room);
      this.broadcastEvent(result.event);
      this.broadcastStates();
      return;
    }

    this.requireAdmin(attachment, data.pin);
    if (data.type === "admin_config") {
      this.room = configurePrizes(this.room, data.prizes).state;
      await this.persistAndBroadcast();
    } else if (data.type === "admin_lock") {
      this.room = setTicketsLocked(this.room, true).state;
      await this.persistAndBroadcast({ type: "tickets_locked" });
    } else if (data.type === "admin_unlock") {
      this.room = setTicketsLocked(this.room, false).state;
      await this.persistAndBroadcast({ type: "tickets_unlocked" });
    } else if (data.type === "admin_draw") {
      const result = drawPrize(this.room, data.prizeId, Date.now(), secureRandom);
      this.room = result.state;
      await this.ctx.storage.put("room", this.room);
      this.broadcastEvent(result.event);
      this.broadcastStates();
    } else if (data.type === "admin_mark") {
      const result = markDraw(this.room, data.drawId, data.status);
      this.room = result.state;
      await this.persistAndBroadcast({ type: "draw_marked", draw: result.draw });
    } else if (data.type === "admin_reset") {
      this.room = resetRoom(this.room).state;
      this.positions.clear();
      await this.persistAndSchedule();
      this.broadcastEvent({ type: "room_reset" });
      this.broadcastStates();
    } else {
      throw new CoreError("UNKNOWN_ACTION", "不支援此操作");
    }
  }

  async handleJoin(socket, data) {
    const role = String(data.role ?? "");
    if (!new Set(["participant", "admin", "display"]).has(role)) {
      throw new CoreError("INVALID_ROLE", "身分必須是參加者、主辦人或大螢幕");
    }
    let clientId = null;
    if (role === "participant") {
      const result = joinParticipant(this.room, data);
      this.room = result.state;
      clientId = result.participant.clientId;
      socket.serializeAttachment({ role, clientId, roomId: this.roomId });
      this.closeSupersededParticipantSockets(socket, clientId);
      await this.ctx.storage.put("room", this.room);
    } else if (role === "admin") {
      if (!pinMatches(data.pin, this.env.ADMIN_PIN)) {
        throw new CoreError("ADMIN_UNAUTHORIZED", "主辦人密碼不正確");
      }
      socket.serializeAttachment({ role, clientId: null, roomId: this.roomId });
    } else {
      socket.serializeAttachment({ role, clientId: null, roomId: this.roomId });
    }
    this.safeSend(socket, { type: "joined", role, clientId, roomId: this.roomId });
    this.sendState(socket);
    if (role === "participant") this.broadcastStates(socket);
  }

  handlePosition(attachment, data) {
    this.requireParticipant(attachment);
    const now = Date.now();
    const lastAt = this.lastPositionAt.get(attachment.clientId) ?? 0;
    if (now - lastAt < POSITION_INPUT_INTERVAL_MS) return;
    const position = normalizePosition(data);
    this.lastPositionAt.set(attachment.clientId, now);
    this.positions.set(attachment.clientId, {
      clientId: attachment.clientId,
      ...position,
      at: now,
    });
    if (!this.positionFlushTimer) {
      this.positionFlushTimer = setTimeout(() => {
        this.positionFlushTimer = null;
        this.flushPositions();
      }, POSITION_BATCH_MS);
    }
  }

  flushPositions() {
    if (!this.positions.size) return;
    const cutoff = Date.now() - 10_000;
    for (const [clientId, position] of this.positions) {
      if (position.at < cutoff) this.positions.delete(clientId);
    }
    this.broadcastEvent({ type: "positions", players: [...this.positions.values()] });
  }

  requireParticipant(attachment) {
    if (attachment.role !== "participant" || !attachment.clientId) {
      throw new CoreError("PARTICIPANT_REQUIRED", "此操作只供參加者使用");
    }
  }

  requireAdmin(attachment, pin) {
    if (attachment.role !== "admin" || !pinMatches(pin, this.env.ADMIN_PIN)) {
      throw new CoreError("ADMIN_UNAUTHORIZED", "主辦人驗證失敗");
    }
  }

  closeSupersededParticipantSockets(currentSocket, clientId) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === currentSocket) continue;
      const attachment = socket.deserializeAttachment();
      if (attachment?.role === "participant" && attachment.clientId === clientId) {
        try {
          socket.close(4001, "已由新連線接續");
        } catch {
          // The old edge connection may already be gone.
        }
      }
    }
  }

  async webSocketClose(socket) {
    await this.handleSocketGone(socket);
  }

  async webSocketError(socket) {
    await this.handleSocketGone(socket);
  }

  async handleSocketGone(socket) {
    await this.ready;
    const attachment = socket.deserializeAttachment();
    if (attachment?.role !== "participant" || !attachment.clientId) return;
    const stillConnected = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket) return false;
      const other = candidate.deserializeAttachment();
      return other?.role === "participant" && other.clientId === attachment.clientId;
    });
    if (stillConnected) return;
    const result = setParticipantConnected(this.room, attachment.clientId, false);
    if (!result.changed) return;
    this.room = result.state;
    this.positions.delete(attachment.clientId);
    await this.ctx.storage.put("room", this.room);
    this.broadcastStates();
    this.flushPositions();
  }

  async alarm() {
    await this.ready;
    const result = releaseCooldowns(this.room);
    this.room = result.state;
    if (result.releasedTicketIds.length) {
      await this.ctx.storage.put("room", this.room);
      this.broadcastEvent({
        type: "ticket_available",
        count: result.releasedTicketIds.length,
        availableTickets: projectState(this.room, "display").availableTickets,
      });
      this.broadcastStates();
    }
    await this.scheduleCooldownAlarm();
  }

  async persistAndBroadcast(event = null) {
    await this.ctx.storage.put("room", this.room);
    if (event) this.broadcastEvent(event);
    this.broadcastStates();
  }

  async persistAndSchedule() {
    await this.ctx.storage.put("room", this.room);
    await this.scheduleCooldownAlarm();
  }

  async scheduleCooldownAlarm() {
    const alarmAt = nextCooldownAt(this.room);
    if (alarmAt !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, alarmAt));
  }

  sendState(socket) {
    const attachment = socket.deserializeAttachment() ?? { role: "pending" };
    if (attachment.role === "pending") return;
    const state = projectState(this.room, attachment.role, attachment.clientId);
    this.safeSend(socket, { ...state, roomId: this.roomId });
  }

  broadcastStates(exceptSocket = null) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exceptSocket) this.sendState(socket);
    }
  }

  broadcastEvent(event, exceptSocket = null) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exceptSocket) this.safeSend(socket, event);
    }
  }

  safeSend(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // A following close/error callback updates connection state.
    }
  }
}
