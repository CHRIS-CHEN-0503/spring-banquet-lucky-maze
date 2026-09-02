export const TICKET_COUNT = 80;
export const STATION_COUNT = 24;
export const DROP_COOLDOWN_MS = 10_000;
export const RECLAIM_BLOCK_MS = 30_000;
export const ITEM_EVENT_COOLDOWN_MS = 30_000;

const CHARACTER_PATTERN = /^[a-z0-9_-]{1,24}$/i;
const CLIENT_ID_PATTERN = /^[a-z0-9_-]{8,64}$/i;
const PRIZE_ID_PATTERN = /^[a-z0-9_-]{1,40}$/i;
const DRAW_STATUSES = new Set(["pending", "claimed", "no-show", "redraw"]);

export class CoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeName(value) {
  const name = cleanText(value, 24);
  if (!name) throw new CoreError("INVALID_NAME", "請輸入姓名");
  return name;
}

export function sanitizeEmployeeId(value) {
  const employeeId = cleanText(value, 20).replace(/\s/g, "");
  if (!employeeId) throw new CoreError("INVALID_EMPLOYEE_ID", "請輸入員工編號");
  return employeeId;
}

export function sanitizeClientId(value) {
  const clientId = String(value ?? "").trim();
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new CoreError("INVALID_CLIENT_ID", "裝置識別碼格式不正確");
  }
  return clientId;
}

export function sanitizeCharacter(value) {
  const character = String(value ?? "").trim();
  if (!CHARACTER_PATTERN.test(character)) {
    throw new CoreError("INVALID_CHARACTER", "請選擇有效角色");
  }
  return character;
}

export function normalizeRoomId(value) {
  const roomId = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,48}$/.test(roomId)) {
    throw new CoreError("INVALID_ROOM", "房號只可使用英數字與連字號");
  }
  return roomId;
}

export function normalizePosition(input) {
  const x = Number(input?.x);
  const z = Number(input?.z);
  const yaw = Number(input?.yaw);
  if (![x, z, yaw].every(Number.isFinite)) {
    throw new CoreError("INVALID_POSITION", "位置資料格式不正確");
  }
  return {
    x: Math.max(-200, Math.min(200, Math.round(x * 100) / 100)),
    z: Math.max(-200, Math.min(200, Math.round(z * 100) / 100)),
    yaw: Math.round((((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * 1000) / 1000,
  };
}

function createStations() {
  const coordinates = [
    [-30, -30], [-18, -30], [-6, -30], [6, -30], [18, -30], [30, -30],
    [-30, -10], [-18, -10], [-6, -10], [6, -10], [18, -10], [30, -10],
    [-30, 10], [-18, 10], [-6, 10], [6, 10], [18, 10], [30, 10],
    [-30, 30], [-18, 30], [-6, 30], [6, 30], [18, 30], [30, 30],
  ];
  return coordinates.map(([x, z], index) => ({
    tokenId: `token-${String(index + 1).padStart(2, "0")}`,
    x,
    z,
  }));
}

export function createInitialState(now = Date.now()) {
  return {
    schemaVersion: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    locked: false,
    stations: createStations(),
    tickets: Array.from({ length: TICKET_COUNT }, (_, index) => ({
      id: `ticket-${String(index + 1).padStart(3, "0")}`,
      number: index + 1,
      status: "available",
      holderClientId: null,
      claimedAt: null,
      claimedAtTokenId: null,
      availableAt: now,
      lastOwnerClientId: null,
      reclaimBlockedUntil: 0,
    })),
    participants: {},
    finishers: [],
    prizes: [],
    draws: [],
    nextDrawSequence: 1,
  };
}

function touch(state, now) {
  state.revision += 1;
  state.updatedAt = now;
  return state;
}

export function releaseCooldowns(state, now = Date.now()) {
  const next = clone(state);
  const releasedTicketIds = [];
  for (const ticket of next.tickets) {
    if (ticket.status === "cooldown" && ticket.availableAt <= now) {
      ticket.status = "available";
      releasedTicketIds.push(ticket.id);
    }
  }
  if (releasedTicketIds.length) touch(next, now);
  return { state: next, releasedTicketIds };
}

export function nextCooldownAt(state) {
  const times = state.tickets
    .filter((ticket) => ticket.status === "cooldown")
    .map((ticket) => ticket.availableAt);
  return times.length ? Math.min(...times) : null;
}

function eligibleTickets(state, clientId, now) {
  return state.tickets.filter((ticket) => (
    ticket.status === "available"
    && ticket.availableAt <= now
    && !(ticket.lastOwnerClientId === clientId && ticket.reclaimBlockedUntil > now)
  ));
}

export function joinParticipant(state, input, now = Date.now()) {
  const clientId = sanitizeClientId(input.clientId);
  const name = sanitizeName(input.name);
  const employeeId = sanitizeEmployeeId(input.employeeId);
  const character = sanitizeCharacter(input.character);
  const next = clone(state);

  const duplicate = Object.values(next.participants).find((participant) => (
    participant.employeeId === employeeId && participant.clientId !== clientId
  ));
  if (duplicate?.connected) {
    throw new CoreError("EMPLOYEE_ALREADY_CONNECTED", "此員工編號已在其他裝置連線");
  }

  let participant = next.participants[clientId];
  if (duplicate && !duplicate.connected) {
    participant = { ...duplicate, clientId };
    delete next.participants[duplicate.clientId];
    if (participant.ticketId) {
      const ticket = next.tickets.find((item) => item.id === participant.ticketId);
      if (ticket) ticket.holderClientId = clientId;
    }
  }

  if (participant && participant.employeeId !== employeeId) {
    const oldTicket = participant.ticketId
      ? next.tickets.find((ticket) => ticket.id === participant.ticketId)
      : null;
    if (oldTicket) {
      throw new CoreError("CLIENT_ID_IN_USE", "此裝置識別碼已綁定其他參加者");
    }
  }

  next.participants[clientId] = {
    clientId,
    name,
    employeeId,
    character,
    ticketId: participant?.ticketId ?? null,
    hasWon: participant?.hasWon ?? false,
    finishedAt: participant?.finishedAt ?? null,
    finishRank: participant?.finishRank ?? null,
    lastItemEventAt: participant?.lastItemEventAt ?? 0,
    joinedAt: participant?.joinedAt ?? now,
    lastSeenAt: now,
    connected: true,
  };
  if (next.startedAt === null) next.startedAt = now;
  touch(next, now);
  return { state: next, participant: clone(next.participants[clientId]) };
}

export function setParticipantConnected(state, clientId, connected, now = Date.now()) {
  if (!state.participants[clientId]) return { state, changed: false };
  if (state.participants[clientId].connected === connected) return { state, changed: false };
  const next = clone(state);
  next.participants[clientId].connected = connected;
  next.participants[clientId].lastSeenAt = now;
  touch(next, now);
  return { state: next, changed: true };
}

export function claimTicket(state, input, now = Date.now(), random = Math.random) {
  const clientId = sanitizeClientId(input.clientId);
  const tokenId = String(input.tokenId ?? "");
  const released = releaseCooldowns(state, now).state;
  if (released.locked) throw new CoreError("TICKETS_LOCKED", "尋籤已由主辦人鎖定");
  if (!released.stations.some((station) => station.tokenId === tokenId)) {
    throw new CoreError("INVALID_TOKEN", "找不到這座尋籤台");
  }
  const participant = released.participants[clientId];
  if (!participant) throw new CoreError("NOT_JOINED", "請先加入房間");
  if (participant.ticketId) throw new CoreError("ALREADY_HAS_TICKET", "每人同時只能持有一支籤");

  const candidates = eligibleTickets(released, clientId, now);
  if (!candidates.length) throw new CoreError("NO_TICKET_AVAILABLE", "目前沒有可拾取的籤，請稍後再試");
  const sample = Number(random());
  const index = Number.isFinite(sample)
    ? Math.min(candidates.length - 1, Math.max(0, Math.floor(sample * candidates.length)))
    : 0;
  const selectedId = candidates[index].id;
  const next = clone(released);
  const ticket = next.tickets.find((item) => item.id === selectedId);
  ticket.status = "held";
  ticket.holderClientId = clientId;
  ticket.claimedAt = now;
  ticket.claimedAtTokenId = tokenId;
  ticket.availableAt = 0;
  next.participants[clientId].ticketId = ticket.id;
  next.participants[clientId].lastSeenAt = now;
  touch(next, now);
  return {
    state: next,
    event: {
      type: "ticket_claimed",
      clientId,
      name: next.participants[clientId].name,
      tokenId,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
    },
  };
}

export function dropTicket(state, clientIdValue, now = Date.now()) {
  const clientId = sanitizeClientId(clientIdValue);
  const participant = state.participants[clientId];
  if (!participant) throw new CoreError("NOT_JOINED", "請先加入房間");
  if (!participant.ticketId) throw new CoreError("NO_HELD_TICKET", "目前沒有可放棄的籤");
  const next = clone(state);
  const nextParticipant = next.participants[clientId];
  const ticket = next.tickets.find((item) => item.id === nextParticipant.ticketId);
  if (!ticket || ticket.holderClientId !== clientId) {
    throw new CoreError("TICKET_STATE_CONFLICT", "籤號狀態不一致，請重新連線");
  }
  ticket.status = "cooldown";
  ticket.holderClientId = null;
  ticket.claimedAt = null;
  ticket.claimedAtTokenId = null;
  ticket.availableAt = now + DROP_COOLDOWN_MS;
  ticket.lastOwnerClientId = clientId;
  ticket.reclaimBlockedUntil = now + RECLAIM_BLOCK_MS;
  nextParticipant.ticketId = null;
  nextParticipant.lastSeenAt = now;
  touch(next, now);
  return {
    state: next,
    event: {
      type: "ticket_dropped",
      clientId,
      name: nextParticipant.name,
      availableAt: ticket.availableAt,
    },
  };
}

export function finishParticipant(state, clientIdValue, now = Date.now()) {
  const clientId = sanitizeClientId(clientIdValue);
  const participant = state.participants[clientId];
  if (!participant) throw new CoreError("NOT_JOINED", "請先加入房間");
  if (participant.finishRank || participant.finishedAt) {
    throw new CoreError("ALREADY_FINISHED", "你已經完成尋籤迷宮");
  }
  if (!participant.ticketId) {
    throw new CoreError("TICKET_REQUIRED_TO_FINISH", "必須先取得籤號才能通過出口");
  }
  const ticket = state.tickets.find((item) => item.id === participant.ticketId);
  if (!ticket || ticket.status !== "held" || ticket.holderClientId !== clientId) {
    throw new CoreError("TICKET_REQUIRED_TO_FINISH", "持籤狀態無效，請重新拾取籤號");
  }
  const next = clone(state);
  const rank = next.finishers.length + 1;
  const finisher = {
    clientId,
    name: participant.name,
    character: participant.character,
    finishedAt: now,
    rank,
  };
  next.participants[clientId].finishedAt = now;
  next.participants[clientId].finishRank = rank;
  next.participants[clientId].lastSeenAt = now;
  next.finishers.push(finisher);
  touch(next, now);
  return {
    state: next,
    event: { type: "player_finished", ...clone(finisher) },
  };
}

export function useItemEvent(state, clientIdValue, kindValue, now = Date.now()) {
  const clientId = sanitizeClientId(clientIdValue);
  const kind = String(kindValue ?? "").trim();
  if (kind !== "prank" && kind !== "whistle") {
    throw new CoreError("INVALID_ITEM_EVENT", "互動道具只接受調皮鬼或集合口哨");
  }
  const participant = state.participants[clientId];
  if (!participant) throw new CoreError("NOT_JOINED", "請先加入房間");
  const retryAt = (participant.lastItemEventAt ?? 0) + ITEM_EVENT_COOLDOWN_MS;
  if (participant.lastItemEventAt && now < retryAt) {
    throw new CoreError("ITEM_EVENT_RATE_LIMITED", `互動道具冷卻中，請於 ${Math.ceil((retryAt - now) / 1000)} 秒後再試`);
  }
  const next = clone(state);
  next.participants[clientId].lastItemEventAt = now;
  next.participants[clientId].lastSeenAt = now;
  touch(next, now);
  return {
    state: next,
    event: {
      type: kind === "prank" ? "party_prank" : "party_whistle",
      kind,
      clientId,
      sourceClientId: clientId,
      sourceName: participant.name,
      at: now,
    },
  };
}

export function setTicketsLocked(state, locked, now = Date.now()) {
  if (state.locked === Boolean(locked)) return { state, changed: false };
  const next = clone(state);
  next.locked = Boolean(locked);
  touch(next, now);
  return { state: next, changed: true };
}

function normalizePrize(prize, index) {
  const rawId = String(prize?.id ?? `prize-${index + 1}`).trim().toLowerCase();
  if (!PRIZE_ID_PATTERN.test(rawId)) {
    throw new CoreError("INVALID_PRIZE_ID", `第 ${index + 1} 個獎項代碼格式不正確`);
  }
  const name = cleanText(prize?.name, 40);
  if (!name) throw new CoreError("INVALID_PRIZE_NAME", `請輸入第 ${index + 1} 個獎項名稱`);
  const quantity = Math.floor(Number(prize?.quantity));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    throw new CoreError("INVALID_PRIZE_QUANTITY", "每個獎項數量需介於 1 到 50");
  }
  return { id: rawId, name, quantity };
}

export function configurePrizes(state, prizesValue, now = Date.now()) {
  if (!Array.isArray(prizesValue) || prizesValue.length < 1 || prizesValue.length > 40) {
    throw new CoreError("INVALID_PRIZES", "請設定 1 到 40 個獎項");
  }
  const prizes = prizesValue.map(normalizePrize);
  if (new Set(prizes.map((prize) => prize.id)).size !== prizes.length) {
    throw new CoreError("DUPLICATE_PRIZE_ID", "獎項代碼不可重複");
  }
  for (const prize of prizes) {
    const activeDraws = state.draws.filter((draw) => draw.prizeId === prize.id && draw.status !== "redraw").length;
    if (prize.quantity < activeDraws) {
      throw new CoreError("PRIZE_QUANTITY_TOO_LOW", `${prize.name} 的數量不可低於已抽出數量`);
    }
  }
  const existingIds = new Set(prizes.map((prize) => prize.id));
  if (state.draws.some((draw) => draw.status !== "redraw" && !existingIds.has(draw.prizeId))) {
    throw new CoreError("PRIZE_IN_USE", "不可移除已有抽獎結果的獎項");
  }
  const next = clone(state);
  next.prizes = prizes;
  touch(next, now);
  return { state: next };
}

export function drawPrize(state, prizeIdValue, now = Date.now(), random = Math.random) {
  if (!state.locked) throw new CoreError("TICKETS_NOT_LOCKED", "抽獎前請先鎖定尋籤");
  const prizeId = String(prizeIdValue ?? "").trim().toLowerCase();
  const prize = state.prizes.find((item) => item.id === prizeId);
  if (!prize) throw new CoreError("PRIZE_NOT_FOUND", "找不到指定獎項");
  const usedQuantity = state.draws.filter((draw) => draw.prizeId === prizeId && draw.status !== "redraw").length;
  if (usedQuantity >= prize.quantity) throw new CoreError("PRIZE_COMPLETE", "此獎項已抽完");

  const candidates = Object.values(state.participants).filter((participant) => (
    participant.ticketId && !participant.hasWon
  ));
  if (!candidates.length) throw new CoreError("NO_DRAW_CANDIDATE", "目前沒有可抽出的持籤者");
  const sample = Number(random());
  const index = Number.isFinite(sample)
    ? Math.min(candidates.length - 1, Math.max(0, Math.floor(sample * candidates.length)))
    : 0;
  const winner = candidates[index];
  const ticket = state.tickets.find((item) => item.id === winner.ticketId);
  if (!ticket || ticket.status !== "held") {
    throw new CoreError("TICKET_STATE_CONFLICT", "中獎候選人的籤號狀態不一致");
  }

  const next = clone(state);
  next.participants[winner.clientId].hasWon = true;
  const draw = {
    id: `draw-${String(next.nextDrawSequence).padStart(3, "0")}`,
    prizeId: prize.id,
    prizeName: prize.name,
    clientId: winner.clientId,
    winnerName: winner.name,
    employeeId: winner.employeeId,
    ticketId: ticket.id,
    ticketNumber: ticket.number,
    status: "pending",
    drawnAt: now,
    updatedAt: now,
  };
  next.nextDrawSequence += 1;
  next.draws.push(draw);
  touch(next, now);
  return { state: next, event: { type: "draw_result", ...clone(draw) } };
}

export function markDraw(state, drawIdValue, statusValue, now = Date.now()) {
  const drawId = String(drawIdValue ?? "").trim();
  const status = String(statusValue ?? "").trim();
  if (!DRAW_STATUSES.has(status) || status === "pending") {
    throw new CoreError("INVALID_DRAW_STATUS", "結果狀態只可標記為已領、缺席或重抽");
  }
  const drawIndex = state.draws.findIndex((draw) => draw.id === drawId);
  if (drawIndex < 0) throw new CoreError("DRAW_NOT_FOUND", "找不到抽獎結果");
  const next = clone(state);
  next.draws[drawIndex].status = status;
  next.draws[drawIndex].updatedAt = now;
  const clientId = next.draws[drawIndex].clientId;
  const hasActiveWin = next.draws.some((draw) => draw.clientId === clientId && draw.status !== "redraw");
  if (next.participants[clientId]) next.participants[clientId].hasWon = hasActiveWin;
  touch(next, now);
  return { state: next, draw: clone(next.draws[drawIndex]) };
}

export function resetRoom(state, now = Date.now()) {
  const next = createInitialState(now);
  for (const participant of Object.values(state.participants)) {
    next.participants[participant.clientId] = {
      ...clone(participant),
      ticketId: null,
      hasWon: false,
      finishedAt: null,
      finishRank: null,
      lastItemEventAt: 0,
      lastSeenAt: now,
    };
  }
  next.revision = state.revision + 1;
  next.createdAt = state.createdAt;
  next.startedAt = Object.keys(next.participants).length ? now : null;
  next.updatedAt = now;
  return { state: next };
}

function publicDraw(draw, includeTicketNumber = false) {
  const result = {
    id: draw.id,
    prizeId: draw.prizeId,
    prizeName: draw.prizeName,
    winnerName: draw.winnerName,
    status: draw.status,
    drawnAt: draw.drawnAt,
  };
  if (includeTicketNumber) result.ticketNumber = draw.ticketNumber;
  return result;
}

function publicPlayer(participant) {
  return {
    clientId: participant.clientId,
    name: participant.name,
    character: participant.character,
    connected: participant.connected,
    hasWon: participant.hasWon,
  };
}

export function projectState(state, role, clientId = null, now = Date.now()) {
  const players = Object.values(state.participants).map(publicPlayer);
  const connectedCount = players.filter((player) => player.connected).length;
  const ownEligible = role === "participant" ? eligibleTickets(state, clientId, now) : eligibleTickets(state, "", now);
  const earliestAvailableAt = state.tickets
    .filter((ticket) => ticket.status === "cooldown")
    .reduce((earliest, ticket) => Math.min(earliest, ticket.availableAt), Number.POSITIVE_INFINITY);
  const availableTickets = ownEligible.length;
  const stationAvailableAt = availableTickets ? now : (Number.isFinite(earliestAvailableAt) ? earliestAvailableAt : 0);
  const base = {
    type: "state",
    revision: state.revision,
    startedAt: state.startedAt,
    phase: state.locked ? "draw" : "search",
    locked: state.locked,
    participantCount: players.length,
    connectedCount,
    finishedCount: state.finishers.length,
    finishers: clone(state.finishers),
    availableTickets,
    stations: state.stations.map((station) => ({
      ...station,
      available: !state.locked && availableTickets > 0,
      availableAt: stationAvailableAt,
    })),
    prizes: clone(state.prizes),
    draws: state.draws.map((draw) => publicDraw(draw, false)),
    players,
  };

  if (role === "admin") {
    return {
      ...base,
      participants: Object.values(state.participants).map((participant) => {
        const ticket = participant.ticketId
          ? state.tickets.find((item) => item.id === participant.ticketId)
          : null;
        return { ...clone(participant), ticketNumber: ticket?.number ?? null };
      }),
      tickets: clone(state.tickets),
      draws: clone(state.draws),
      self: null,
    };
  }

  if (role === "participant") {
    const participant = state.participants[clientId] ?? null;
    const ticket = participant?.ticketId
      ? state.tickets.find((item) => item.id === participant.ticketId)
      : null;
    return {
      ...base,
      tickets: [],
      self: participant ? {
        clientId: participant.clientId,
        name: participant.name,
        employeeId: participant.employeeId,
        character: participant.character,
        hasWon: participant.hasWon,
        finishedAt: participant.finishedAt,
        finishRank: participant.finishRank,
        ticketId: ticket?.id ?? null,
        ticketNumber: ticket?.number ?? null,
      } : null,
    };
  }

  return {
    ...base,
    draws: state.draws.map((draw) => publicDraw(draw, true)),
    players: [],
    stations: [],
    tickets: [],
    self: null,
  };
}
