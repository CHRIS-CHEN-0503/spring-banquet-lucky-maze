import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreError,
  DROP_COOLDOWN_MS,
  ITEM_EVENT_COOLDOWN_MS,
  RECLAIM_BLOCK_MS,
  claimTicket,
  configurePrizes,
  createInitialState,
  drawPrize,
  dropTicket,
  finishParticipant,
  joinParticipant,
  markDraw,
  normalizePosition,
  projectState,
  releaseCooldowns,
  resetRoom,
  setTicketsLocked,
  useItemEvent,
} from "../src/room-core.js";

const NOW = 1_000_000;

function participant(clientId, employeeId, name = "測試勇者") {
  return {
    clientId,
    employeeId,
    name,
    character: "lion",
  };
}

function addParticipant(state, suffix, employeeId = `E${suffix}`) {
  return joinParticipant(
    state,
    participant(`client-${String(suffix).padStart(2, "0")}`, employeeId),
    NOW,
  ).state;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof CoreError && error.code === code);
}

test("initial room has 80 unique tickets and 24 unique token stations", () => {
  const state = createInitialState(NOW);
  assert.equal(state.tickets.length, 80);
  assert.equal(new Set(state.tickets.map((ticket) => ticket.number)).size, 80);
  assert.equal(state.stations.length, 24);
  assert.equal(new Set(state.stations.map((station) => station.tokenId)).size, 24);
});

test("participant input is sanitized and same employee cannot connect twice", () => {
  let state = createInitialState(NOW);
  state = joinParticipant(state, {
    clientId: "client-001",
    name: " <b>王 小明</b> \u0000 ",
    employeeId: " A 123 ",
    character: "lion",
  }, NOW).state;
  assert.equal(state.participants["client-001"].name, "王 小明");
  assert.equal(state.participants["client-001"].employeeId, "A123");
  assert.equal(state.startedAt, NOW);
  expectCode(() => joinParticipant(state, {
    clientId: "client-002",
    name: "冒名者",
    employeeId: "A123",
    character: "lion",
  }, NOW + 1), "EMPLOYEE_ALREADY_CONNECTED");
});

test("startedAt is fixed by the first participant and not changed by later joins", () => {
  let state = createInitialState(NOW);
  assert.equal(state.startedAt, null);
  state = joinParticipant(state, participant("client-001", "E1"), NOW + 100).state;
  state = joinParticipant(state, participant("client-002", "E2"), NOW + 900).state;
  assert.equal(state.startedAt, NOW + 100);
});

test("disconnected employee may reconnect with a new client id and retain ticket", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW + 1, () => 0).state;
  state.participants["client-01"].connected = false;
  const originalTicketId = state.participants["client-01"].ticketId;
  state = joinParticipant(state, participant("client-new", "E1", "重新連線"), NOW + 2).state;
  assert.equal(state.participants["client-01"], undefined);
  assert.equal(state.participants["client-new"].ticketId, originalTicketId);
  assert.equal(state.tickets.find((ticket) => ticket.id === originalTicketId).holderClientId, "client-new");
});

test("claim is server authoritative and participant state reveals only own number", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = addParticipant(state, 2);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW + 1, () => 0).state;
  state = claimTicket(state, { clientId: "client-02", tokenId: "token-02" }, NOW + 2, () => 0).state;

  const first = projectState(state, "participant", "client-01", NOW + 2);
  const secondTicket = state.tickets.find((ticket) => ticket.holderClientId === "client-02");
  assert.equal(first.self.ticketNumber, 1);
  assert.deepEqual(first.tickets, []);
  assert.equal(first.players.some((player) => "ticketNumber" in player || "ticketId" in player), false);
  assert.equal(first.draws.length, 0);
  assert.notEqual(first.self.ticketNumber, secondTicket.number);

  const admin = projectState(state, "admin", null, NOW + 2);
  assert.equal(admin.tickets.filter((ticket) => ticket.status === "held").length, 2);
  assert.equal(admin.participants.find((item) => item.clientId === "client-02").ticketNumber, 2);
});

test("one participant can hold only one ticket and invalid stations are rejected", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  expectCode(() => claimTicket(state, {
    clientId: "client-01",
    tokenId: "fake-token",
  }, NOW, () => 0), "INVALID_TOKEN");
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  expectCode(() => claimTicket(state, {
    clientId: "client-01",
    tokenId: "token-02",
  }, NOW + 1, () => 0), "ALREADY_HAS_TICKET");
});

test("dropped ticket returns after 10 seconds but old owner cannot reclaim it for 30 seconds", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  const heldId = state.participants["client-01"].ticketId;
  state = dropTicket(state, "client-01", NOW + 100).state;
  const dropped = state.tickets.find((ticket) => ticket.id === heldId);
  assert.equal(dropped.availableAt, NOW + 100 + DROP_COOLDOWN_MS);
  assert.equal(dropped.reclaimBlockedUntil, NOW + 100 + RECLAIM_BLOCK_MS);

  const before = releaseCooldowns(state, NOW + 100 + DROP_COOLDOWN_MS - 1);
  assert.equal(before.releasedTicketIds.length, 0);
  state = releaseCooldowns(state, NOW + 100 + DROP_COOLDOWN_MS).state;
  assert.equal(state.tickets.find((ticket) => ticket.id === heldId).status, "available");

  for (const ticket of state.tickets) {
    if (ticket.id !== heldId) ticket.status = "held";
  }
  expectCode(() => claimTicket(state, {
    clientId: "client-01",
    tokenId: "token-01",
  }, NOW + 100 + DROP_COOLDOWN_MS, () => 0), "NO_TICKET_AVAILABLE");
  state = claimTicket(state, {
    clientId: "client-01",
    tokenId: "token-01",
  }, NOW + 100 + RECLAIM_BLOCK_MS, () => 0).state;
  assert.equal(state.participants["client-01"].ticketId, heldId);
});

test("another participant may claim a returned ticket after the global cooldown", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = addParticipant(state, 2);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  const heldId = state.participants["client-01"].ticketId;
  state = dropTicket(state, "client-01", NOW + 1).state;
  state = releaseCooldowns(state, NOW + 1 + DROP_COOLDOWN_MS).state;
  for (const ticket of state.tickets) {
    if (ticket.id !== heldId) ticket.status = "held";
  }
  state = claimTicket(state, {
    clientId: "client-02",
    tokenId: "token-04",
  }, NOW + 1 + DROP_COOLDOWN_MS, () => 0).state;
  assert.equal(state.participants["client-02"].ticketId, heldId);
});

test("finish requires a currently held ticket and records stable unique ranks", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = addParticipant(state, 2);
  expectCode(() => finishParticipant(state, "client-01", NOW + 1), "TICKET_REQUIRED_TO_FINISH");
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW + 2, () => 0).state;
  state = claimTicket(state, { clientId: "client-02", tokenId: "token-02" }, NOW + 3, () => 0).state;

  const first = finishParticipant(state, "client-02", NOW + 10);
  state = first.state;
  assert.equal(first.event.rank, 1);
  assert.equal(state.participants["client-02"].ticketId, "ticket-002");
  const second = finishParticipant(state, "client-01", NOW + 20);
  state = second.state;
  assert.equal(second.event.rank, 2);
  expectCode(() => finishParticipant(state, "client-02", NOW + 30), "ALREADY_FINISHED");

  const participantState = projectState(state, "participant", "client-02", NOW + 30);
  assert.equal(participantState.startedAt, NOW);
  assert.equal(participantState.finishedCount, 2);
  assert.equal(participantState.finishers[0].clientId, "client-02");
  assert.equal(participantState.self.finishRank, 1);
  assert.equal("ticketNumber" in participantState.finishers[0], false);
});

test("party item events validate kind and enforce a per-client 30 second cooldown", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  expectCode(() => useItemEvent(state, "client-01", "fireworks", NOW + 1), "INVALID_ITEM_EVENT");
  const prank = useItemEvent(state, "client-01", "prank", NOW + 2);
  state = prank.state;
  assert.equal(prank.event.type, "party_prank");
  assert.equal(prank.event.sourceClientId, "client-01");
  expectCode(() => useItemEvent(
    state,
    "client-01",
    "whistle",
    NOW + 2 + ITEM_EVENT_COOLDOWN_MS - 1,
  ), "ITEM_EVENT_RATE_LIMITED");
  const whistle = useItemEvent(
    state,
    "client-01",
    "whistle",
    NOW + 2 + ITEM_EVENT_COOLDOWN_MS,
  );
  assert.equal(whistle.event.type, "party_whistle");
});

test("ticket locking blocks claims and draw requires a locked room", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = configurePrizes(state, [{ id: "grand", name: "頭獎", quantity: 1 }], NOW).state;
  expectCode(() => drawPrize(state, "grand", NOW, () => 0), "TICKETS_NOT_LOCKED");
  state = setTicketsLocked(state, true, NOW).state;
  expectCode(() => claimTicket(state, {
    clientId: "client-01",
    tokenId: "token-01",
  }, NOW, () => 0), "TICKETS_LOCKED");
});

test("draw selects held tickets, enforces one win per person and prize quantity", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = addParticipant(state, 2);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  state = claimTicket(state, { clientId: "client-02", tokenId: "token-02" }, NOW, () => 0).state;
  state = configurePrizes(state, [{ id: "lucky", name: "幸運獎", quantity: 2 }], NOW).state;
  state = setTicketsLocked(state, true, NOW).state;
  const first = drawPrize(state, "lucky", NOW + 1, () => 0);
  state = first.state;
  assert.equal(first.event.ticketNumber, 1);
  const participantState = projectState(state, "participant", "client-02", NOW + 1);
  assert.equal("ticketNumber" in participantState.draws[0], false);
  const displayState = projectState(state, "display", null, NOW + 1);
  assert.equal(displayState.draws[0].ticketNumber, 1);
  const second = drawPrize(state, "lucky", NOW + 2, () => 0);
  state = second.state;
  assert.equal(second.event.ticketNumber, 2);
  assert.notEqual(second.event.clientId, first.event.clientId);
  expectCode(() => drawPrize(state, "lucky", NOW + 3, () => 0), "PRIZE_COMPLETE");
});

test("marking a draw for redraw returns winner to the candidate pool", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  state = configurePrizes(state, [{ id: "one", name: "獎品", quantity: 1 }], NOW).state;
  state = setTicketsLocked(state, true, NOW).state;
  const result = drawPrize(state, "one", NOW + 1, () => 0);
  state = markDraw(result.state, result.event.id, "redraw", NOW + 2).state;
  assert.equal(state.participants["client-01"].hasWon, false);
  const redrawn = drawPrize(state, "one", NOW + 3, () => 0);
  assert.equal(redrawn.event.clientId, "client-01");
});

test("reset keeps registered players but clears tickets, prizes and wins", () => {
  let state = addParticipant(createInitialState(NOW), 1);
  state = claimTicket(state, { clientId: "client-01", tokenId: "token-01" }, NOW, () => 0).state;
  state.participants["client-01"].hasWon = true;
  state.prizes = [{ id: "one", name: "獎品", quantity: 1 }];
  state = resetRoom(state, NOW + 1).state;
  assert.equal(Object.keys(state.participants).length, 1);
  assert.equal(state.participants["client-01"].ticketId, null);
  assert.equal(state.participants["client-01"].hasWon, false);
  assert.equal(state.startedAt, NOW + 1);
  assert.equal(state.finishers.length, 0);
  assert.equal(state.prizes.length, 0);
  assert.equal(state.tickets.every((ticket) => ticket.status === "available"), true);
});

test("position input is finite, rounded and clamped", () => {
  assert.deepEqual(normalizePosition({ x: 999, z: -999, yaw: Math.PI * 3 }), {
    x: 200,
    z: -200,
    yaw: -3.142,
  });
  expectCode(() => normalizePosition({ x: "oops", z: 0, yaw: 0 }), "INVALID_POSITION");
});
