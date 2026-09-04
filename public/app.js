(function () {
  'use strict';

  var THREE = window.THREE;
  var ROOM_FALLBACK = 'spring-party';
  var POSITION_INTERVAL = 250;
  var REMOTE_LIMIT = 10;
  var PLAYER_RADIUS = 0.38;
  var CELL_SIZE = 4;
  var GRID_W = 15;
  var GRID_H = 11;
  var CLIENT_VERSION = '1.1.0';
  var WALL_EVENT_DELAY = 120000;
  var WALL_LOWER_DURATION = 30000;
  var ITEM_RESPAWN_MS = 35000;
  var FOOD_RESPAWN_MS = 22000;
  var ITEM_DEFS = {
    speed: { name: '加速藥水', duration: 8, color: 0x38e4ff },
    superspeed: { name: '強力加速', duration: 6, color: 0xff54b8 },
    shovel: { name: '鐵鍬', duration: 0, color: 0xc9dae4 },
    map: { name: '魔法地圖', duration: 12, color: 0x66f2a2 },
    compass: { name: '指南針', duration: 15, color: 0xffc748 },
    ghost: { name: '穿牆斗篷', duration: 5, color: 0xae7dff },
    timegem: { name: '時間寶石', duration: 15, color: 0x4aa8ff },
    star: { name: '幸運星', duration: 0, color: 0xffe45b },
    prank: { name: '調皮鬼', duration: 0, color: 0xff664f },
    whistle: { name: '集合口哨', duration: 0, color: 0xe9f4ff }
  };
  var FOOD_DEFS = {
    candy: { name: '糖果', restore: 10, color: 0xff6dad },
    cookie: { name: '餅乾', restore: 15, color: 0xc98b4b },
    apple: { name: '蘋果', restore: 20, color: 0xf33f42 },
    riceball: { name: '飯糰', restore: 30, color: 0xf5eee0 },
    ramen: { name: '拉麵', restore: 40, color: 0xffae35 },
    drumstick: { name: '雞腿', restore: 50, color: 0xb96a35 },
    bento: { name: '超級便當', restore: 80, color: 0x61d66d }
  };
  var CLASS_DEFS = {
    yong: { name: '疾風跑者', ability: '移動速度 +12%' },
    hua: { name: '美食家', ability: '食物回復 ×1.5' },
    dan: { name: '耐力王', ability: '飽足耗損 -35%' },
    liya: { name: '小魔法師', ability: '限時效果 ×1.5' },
    robot: { name: '工程師', ability: '鐵鍬 45 秒補充' },
    cat: { name: '尋路貓', ability: '迷宮變化顯示路線' }
  };
  var screens = {};
  var dom = {};
  var route = 'home';
  var role = 'participant';
  var roomId = getRoomId();
  var clientId = getClientId();
  var joinData = null;
  var adminPin = '';
  var socket = null;
  var reconnectTimer = 0;
  var reconnectAttempt = 0;
  var intentionalClose = false;
  var serverState = {};
  var allPlayers = new Map();
  var playerProfiles = new Map();
  var adminPrizeDraft = [];
  var availableTicketIds = [];
  var stationSnapshot = [];
  var selfTicket = null;
  var ticketLocked = false;
  var lastDraw = null;
  var startedAt = 0;
  var game = null;

  function getRoomId() {
    var value = new URLSearchParams(window.location.search).get('room') || ROOM_FALLBACK;
    value = String(value).trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    return value || ROOM_FALLBACK;
  }

  function getClientId() {
    var key = 'spring-maze-client-id';
    var saved = '';
    try { saved = window.localStorage.getItem(key) || ''; } catch (error) { saved = ''; }
    if (/^[a-z0-9-]{12,80}$/i.test(saved)) return saved;
    saved = 'p-' + randomHex(16);
    try { window.localStorage.setItem(key, saved); } catch (error) { /* Private mode. */ }
    return saved;
  }

  function randomHex(bytes) {
    var values = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else for (var i = 0; i < bytes; i += 1) values[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(values, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  function clean(value, max) {
    return String(value || '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function cacheDom() {
    screens.home = document.getElementById('home-screen');
    screens.participant = document.getElementById('participant-screen');
    screens.game = document.getElementById('game-screen');
    screens.admin = document.getElementById('admin-screen');
    screens.display = document.getElementById('display-screen');
    dom.rotate = document.getElementById('rotate-overlay');
    dom.toast = document.getElementById('toast-region');
    dom.canvas = document.getElementById('game-canvas');
    dom.lookZone = document.getElementById('look-zone');
    dom.minimap = document.getElementById('minimap-canvas');
    dom.joystick = document.getElementById('joystick-zone');
    dom.action = document.getElementById('action-button');
    dom.actionLabel = document.getElementById('action-label');
    dom.view = document.getElementById('view-button');
    dom.viewLabel = document.getElementById('view-label');
    dom.leave = document.getElementById('leave-button');
    dom.drop = document.getElementById('drop-ticket-button');
    dom.shovel = document.getElementById('shovel-button');
    dom.shovelCount = document.getElementById('shovel-count');
    dom.skill = document.getElementById('skill-button');
    dom.skillCooldown = document.getElementById('skill-cooldown');
    dom.inventory = document.getElementById('inventory-button');
    dom.inventoryCount = document.getElementById('inventory-count');
    dom.inventoryPanel = document.getElementById('inventory-panel');
    dom.inventoryList = document.getElementById('inventory-list');
    dom.satietyValue = document.getElementById('satiety-value');
    dom.satietyBar = document.getElementById('satiety-bar');
    dom.joyScore = document.getElementById('joy-score');
    dom.activeItemName = document.getElementById('active-item-name');
    dom.activeItemTimer = document.getElementById('active-item-timer');
    dom.activeItemBar = document.getElementById('active-item-bar');
    dom.wallStatus = document.getElementById('wall-event-status');
    dom.wallCountdown = document.getElementById('wall-countdown');
    dom.exitHint = document.getElementById('exit-hint');
    dom.exitHintLabel = dom.exitHint && dom.exitHint.querySelector('span');
    dom.finishOverlay = document.getElementById('finish-overlay');
    dom.finishRank = document.getElementById('finish-rank');
    dom.finishCount = document.getElementById('finish-count');
    dom.finishTotal = document.getElementById('finish-total');
    dom.finishProgress = document.getElementById('finish-progress-bar');
    dom.finishWait = document.getElementById('finish-wait-message');
    dom.leaveDialog = document.getElementById('leave-dialog');
    dom.participantForm = document.getElementById('participant-form');
    dom.playerName = document.getElementById('player-name');
    dom.employeeId = document.getElementById('employee-id');
    dom.adminForm = document.getElementById('admin-login-form');
    dom.adminPin = document.getElementById('admin-pin');
    dom.adminDashboard = document.getElementById('admin-dashboard');
  }

  function bindInterface() {
    bindClick('enter-participant', function () { navigate('participant'); });
    bindClick('enter-admin', function () { navigate('admin'); });
    bindClick('enter-display', function () { navigate('display'); connectDisplay(); });
    bindClick('back-home', function () { navigate('home'); });
    bindClick('participant-back', function () { navigate('home'); });
    bindClick('admin-back', leaveNonGameView);
    bindClick('display-back', leaveNonGameView);
    if (dom.participantForm) dom.participantForm.addEventListener('submit', submitParticipant);
    if (dom.adminForm) dom.adminForm.addEventListener('submit', submitAdmin);
    if (dom.action) dom.action.addEventListener('click', useAction);
    if (dom.drop) dom.drop.addEventListener('click', dropTicketWithConfirmation);
    if (dom.shovel) dom.shovel.addEventListener('click', useShovel);
    if (dom.skill) dom.skill.addEventListener('click', showClassAbility);
    if (dom.inventory) dom.inventory.addEventListener('click', toggleInventory);
    bindClick('inventory-close', toggleInventory);
    if (dom.inventoryList) dom.inventoryList.addEventListener('click', handleInventoryClick);
    if (dom.view) dom.view.addEventListener('click', cycleView);
    if (dom.leave) dom.leave.addEventListener('click', leaveWithConfirmation);
    bindClick('lock-tickets', function () { sendAdmin('admin_lock'); });
    bindClick('unlock-tickets', function () { sendAdmin('admin_unlock'); });
    bindClick('draw-prize', drawPrize);
    bindClick('reset-room', resetRoom);
    var prizeForm = document.getElementById('prize-form');
    if (prizeForm) prizeForm.addEventListener('submit', addPrize);
    var prizeSelect = document.getElementById('prize-select');
    if (prizeSelect) prizeSelect.addEventListener('change', function () {
      var draw = document.getElementById('draw-prize');
      if (draw) draw.disabled = !ticketLocked || !prizeSelect.value;
    });
    bindClick('cancel-leave', function () { if (dom.leaveDialog && dom.leaveDialog.open) dom.leaveDialog.close('cancel'); });
    bindClick('confirm-leave', confirmLeave);
    if (dom.adminDashboard) dom.adminDashboard.addEventListener('click', handleAdminDelegation);
    window.addEventListener('hashchange', routeFromLocation);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && socket && socket.readyState !== WebSocket.OPEN) connectSocket(role, joinData || {});
    });
    window.addEventListener('beforeunload', function () { intentionalClose = true; closeSocket(); });
  }

  function bindClick(id, handler) {
    var element = document.getElementById(id);
    if (element) element.addEventListener('click', handler);
  }

  function leaveNonGameView() {
    intentionalClose = true;
    closeSocket();
    role = 'participant';
    navigate('home');
  }

  function navigate(next, replace) {
    route = next || 'home';
    Object.keys(screens).forEach(function (name) {
      if (!screens[name]) return;
      var visible = name === route;
      screens[name].hidden = !visible;
      screens[name].setAttribute('aria-hidden', visible ? 'false' : 'true');
      screens[name].classList.toggle('is-active', visible);
    });
    var newHash = '#' + route;
    if (window.location.hash !== newHash) {
      if (replace) window.history.replaceState(null, '', newHash);
      else window.history.pushState(null, '', newHash);
    }
    document.body.setAttribute('data-route', route);
    if (route === 'game' && game) setTimeout(handleResize, 0);
    updateOrientation();
  }

  function routeFromLocation() {
    var requested = String(window.location.hash || '').replace(/^#\/?/, '').split(/[?&]/)[0];
    if (!screens[requested]) requested = 'home';
    if (requested === 'game') {
      resumeStoredGame();
      return;
    }
    if (requested === 'display') connectDisplay();
    navigate(requested, true);
  }

  function initialRoute() {
    var requestedRole = new URLSearchParams(window.location.search).get('role');
    var hash = String(window.location.hash || '').replace(/^#\/?/, '');
    if (!hash && /^(participant|admin|display)$/.test(requestedRole || '')) hash = requestedRole;
    if (hash === 'game') {
      resumeStoredGame();
      return;
    }
    navigate(screens[hash] ? hash : 'home', true);
    if (hash === 'display') connectDisplay();
  }

  function loadStoredProfile() {
    var profile;
    try { profile = JSON.parse(window.sessionStorage.getItem('spring-maze-profile') || 'null'); }
    catch (error) { return null; }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
    var name = clean(profile.name, 24);
    var employeeId = clean(profile.employeeId, 20);
    var character = clean(profile.character, 20);
    if (!name || !employeeId || !CLASS_DEFS[character]) return null;
    return { role: 'participant', clientId: clientId, name: name, employeeId: employeeId, character: character };
  }

  function resumeStoredGame() {
    var profile = loadStoredProfile();
    if (!profile) {
      navigate('participant', true);
      toast('找不到有效的入場資料，請重新填寫姓名、員工編號並選擇職業', 'warning', 4200);
      return false;
    }
    var alreadyConnected = role === 'participant' && joinData && joinData.clientId === clientId && socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
    role = 'participant';
    joinData = profile;
    navigate('game', true);
    if (!game || !game.running) startGame(profile.character);
    if (!alreadyConnected) connectSocket(role, joinData);
    requestLandscape();
    return true;
  }

  function submitParticipant(event) {
    event.preventDefault();
    var name = clean(dom.playerName && dom.playerName.value, 24);
    var employeeId = clean(dom.employeeId && dom.employeeId.value, 20);
    var selected = document.querySelector('[name="character"]:checked');
    var character = clean(selected && selected.value, 20) || 'yong';
    if (!name || !employeeId) {
      toast('請填寫姓名與員工編號', 'warning');
      return;
    }
    joinData = { role: 'participant', clientId: clientId, name: name, employeeId: employeeId, character: character };
    try { window.sessionStorage.setItem('spring-maze-profile', JSON.stringify(joinData)); } catch (error) { /* Ignore. */ }
    role = 'participant';
    selfTicket = null;
    navigate('game');
    startGame(character);
    connectSocket(role, joinData);
    requestLandscape();
  }

  function submitAdmin(event) {
    event.preventDefault();
    adminPin = clean(dom.adminPin && dom.adminPin.value, 80);
    if (!adminPin) {
      toast('請輸入主辦人密碼', 'warning');
      return;
    }
    role = 'admin';
    joinData = { role: role, clientId: clientId + '-admin', pin: adminPin };
    connectSocket(role, joinData);
  }

  function connectDisplay() {
    if (role === 'display' && socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    role = 'display';
    joinData = { role: role, clientId: clientId + '-display' };
    connectSocket(role, joinData);
  }

  function socketUrl() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + window.location.host + '/ws/' + encodeURIComponent(roomId);
  }

  function connectSocket(nextRole, data) {
    role = nextRole || role;
    joinData = data || joinData || { role: role, clientId: clientId };
    intentionalClose = false;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) closeSocket();
    setConnectionState('connecting');
    var generation = ++connectSocket.generation;
    try { socket = new WebSocket(socketUrl()); }
    catch (error) { scheduleReconnect(); return; }
    var activeSocket = socket;
    activeSocket.addEventListener('open', function () {
      if (generation !== connectSocket.generation) return;
      reconnectAttempt = 0;
      setConnectionState('online');
      send(Object.assign({ type: 'join' }, joinData));
    });
    activeSocket.addEventListener('message', function (event) {
      if (generation !== connectSocket.generation) return;
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      handleServerMessage(message);
    });
    activeSocket.addEventListener('close', function () {
      if (generation !== connectSocket.generation) return;
      setConnectionState('offline');
      if (!intentionalClose) scheduleReconnect();
    });
    activeSocket.addEventListener('error', function () {
      if (generation === connectSocket.generation) setConnectionState('offline');
    });
  }
  connectSocket.generation = 0;

  function closeSocket() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
    connectSocket.generation += 1;
    if (socket) {
      socket.onclose = null;
      try { socket.close(1000, 'client navigation'); } catch (error) { /* Closed. */ }
    }
    socket = null;
  }

  function scheduleReconnect() {
    if (intentionalClose || reconnectTimer) return;
    var delay = Math.min(1000 * Math.pow(1.7, reconnectAttempt), 10000) + Math.random() * 500;
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(function () {
      reconnectTimer = 0;
      connectSocket(role, joinData);
    }, delay);
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast('連線尚未恢復，請稍候', 'warning');
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function setConnectionState(state) {
    document.body.setAttribute('data-connection', state);
    var label = state === 'online' ? '已連線' : state === 'connecting' ? '連線中…' : '連線中斷，正在重試';
    updateConnectionIndicator('connection-status', label, state);
    if (role === 'admin') updateConnectionIndicator('admin-connection-status', label, state);
    if (role === 'display') updateConnectionIndicator('display-connection-status', label, state);
    if (state === 'offline') toast('連線中斷，正在自動重連；你的籤號仍由主機保留', 'warning', 4800);
  }

  function updateConnectionIndicator(id, label, state) {
    var indicator = document.getElementById(id);
    if (!indicator) return;
    var text = indicator.querySelector('span:last-child, b');
    if (text) text.textContent = label;
    else indicator.setAttribute('aria-label', label);
    indicator.setAttribute('data-state', state);
  }

  function handleServerMessage(message) {
    if (!message || !message.type) return;
    switch (message.type) {
      case 'hello':
        document.body.setAttribute('data-server-version', message.version || 'unknown');
        break;
      case 'state':
        applyState(message.state || message);
        break;
      case 'positions':
        applyPositions(message.players || message.positions || []);
        break;
      case 'ticket_claimed':
        if (isForSelf(message)) {
          selfTicket = message.ticket || { id: message.ticketId, number: message.ticketNumber };
          celebratePickup();
          updateTicketHud();
        }
        if (Array.isArray(message.stations)) refreshStationTickets(message.stations);
        toast(isForSelf(message) ? '尋籤成功！你的籤號是 ' + ticketNumber(selfTicket) : '有勇者找到一支籤', 'success');
        break;
      case 'ticket_dropped':
        if (isForSelf(message)) {
          selfTicket = null;
          updateTicketHud();
          toast('籤號已放回，10 秒後會重新出現', 'info');
        }
        if (Array.isArray(message.stations)) refreshStationTickets(message.stations);
        break;
      case 'ticket_available':
        if (Array.isArray(message.stations)) refreshStationTickets(message.stations);
        break;
      case 'draw_result':
        lastDraw = message.draw || message.result || message;
        renderDrawResult(lastDraw);
        if (game) game.fireworkBurst = 1;
        break;
      case 'player_finished':
        handlePlayerFinished(message);
        break;
      case 'party_prank':
        handlePartyPrank(message);
        break;
      case 'party_whistle':
        handlePartyWhistle(message);
        break;
      case 'room_reset':
        if (game) resetPlayerSystems(game.character);
        toast('主辦人已重設活動房間', 'info');
        break;
      case 'error':
        toast(message.message || errorText(message.code), 'error', 5200);
        if (game && message.code === 'TICKET_REQUIRED_TO_FINISH') {
          game.finishRequested = false;
          announceGame('必須先取得幸運籤才能通過出口');
        }
        if (game && message.code === 'ITEM_EVENT_RATE_LIMITED') game.pendingItemEvent = null;
        if ((message.code === 'UNAUTHORIZED' || message.code === 'ADMIN_UNAUTHORIZED') && route === 'admin') setAdminAuthenticated(false);
        break;
      default:
        break;
    }
  }

  function isForSelf(message) {
    var id = message.clientId || message.playerId || (message.player && message.player.clientId);
    return !id || id === clientId;
  }

  function applyState(state) {
    serverState = state || {};
    startedAt = finite(state.startedAt, startedAt || 0);
    ticketLocked = Boolean(state.locked || state.ticketLocked || state.phase === 'locked' || state.phase === 'drawing');
    var self = state.self || state.me || state.player || null;
    if (self) selfTicket = self.ticket || (self.ticketNumber ? { number: self.ticketNumber, id: self.ticketId } : null);
    refreshStationTickets(state.stations || state.availableTokenIds || state.tokens);
    updatePlayerProfiles(state.players || []);
    applyPositions(state.players || state.positions || []);
    updateTicketHud();
    renderAdminState(state);
    var latestDraw = state.lastDraw || (Array.isArray(state.draws) && state.draws.length ? state.draws[state.draws.length - 1] : null);
    if (latestDraw) {
      lastDraw = latestDraw;
      renderDrawResult(lastDraw);
    }
    if (game && self && self.finishRank) markSelfFinished(self.finishRank, state.finishers || [], state.participantCount);
    else if (game && self && !self.finishRank && game.finishRequested && Date.now() - game.finishRequestedAt > 3000) game.finishRequested = false;
    updateFinishProgress(state.finishers || [], state.participantCount || normalizePlayers(state.players).length);
    if (role === 'admin') setAdminAuthenticated(true);
  }

  function normalizePlayers(players) {
    if (Array.isArray(players)) return players;
    if (players && typeof players === 'object') return Object.keys(players).map(function (id) {
      return Object.assign({ clientId: id }, players[id]);
    });
    return [];
  }

  function updatePlayerProfiles(players) {
    normalizePlayers(players).forEach(function (player) {
      var id = String(player.clientId || player.id || '');
      if (id) playerProfiles.set(id, player);
    });
  }

  function applyPositions(players) {
    normalizePlayers(players).forEach(function (player) {
      var id = String(player.clientId || player.id || player.playerId || '');
      if (!id || id === clientId || id === clientId + '-admin' || id === clientId + '-display') return;
      var prior = allPlayers.get(id) || null;
      if (!Number.isFinite(Number(player.x)) && (!prior || !Number.isFinite(prior.x))) return;
      if (!Number.isFinite(Number(player.z)) && (!prior || !Number.isFinite(prior.z))) return;
      prior = prior || {};
      allPlayers.set(id, Object.assign({}, playerProfiles.get(id) || {}, prior, player, {
        clientId: id,
        x: finite(player.x, finite(prior.x, 0)),
        z: finite(player.z, finite(prior.z, 0)),
        yaw: finite(player.yaw, finite(prior.yaw, 0)),
        seenAt: performance.now()
      }));
    });
  }

  function finite(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function refreshStationTickets(source) {
    if (source === undefined || source === null) return;
    var ids = [];
    var snapshots = [];
    if (Array.isArray(source)) {
      source.forEach(function (item) {
        if (typeof item === 'string' || typeof item === 'number') ids.push(String(item));
        else if (item) {
          var tokenId = String(item.tokenId || item.id || '');
          snapshots.push({
            tokenId: tokenId,
            x: finite(item.x, NaN),
            z: finite(item.z, NaN),
            available: stationIsAvailable(item)
          });
          if (item.available !== false && tokenId) ids.push(tokenId);
        }
      });
    } else if (typeof source === 'object') {
      Object.keys(source).forEach(function (id) {
        if (source[id] !== false && (!source[id] || source[id].available !== false)) ids.push(String((source[id] && source[id].tokenId) || id));
      });
    }
    stationSnapshot = snapshots;
    availableTicketIds = ids.filter(Boolean);
    if (game) assignTicketStations();
  }

  function stationIsAvailable(item) {
    if (!item || item.available === false) return false;
    if (!item.availableAt) return true;
    var availableAt = Number(item.availableAt);
    if (!Number.isFinite(availableAt)) availableAt = Date.parse(item.availableAt);
    return !Number.isFinite(availableAt) || availableAt <= Date.now();
  }

  function errorText(code) {
    var messages = {
      TICKETS_LOCKED: '主辦人已鎖定尋籤，請留意抽獎大螢幕',
      ALREADY_HAS_TICKET: '每位勇者同時只能持有一支籤',
      ALREADY_HOLDING: '每位勇者同時只能持有一支籤',
      TICKET_UNAVAILABLE: '這支籤剛被其他勇者搶先拿走了',
      NO_TICKET_AVAILABLE: '目前沒有可拾取的籤，請稍後再試',
      EMPLOYEE_IN_USE: '這個員工編號已在房間中',
      DUPLICATE_EMPLOYEE: '這個員工編號已在房間中',
      NO_DRAW_CANDIDATE: '目前沒有可抽出的持籤者',
      NO_CANDIDATES: '目前沒有可抽出的持籤者',
      ADMIN_UNAUTHORIZED: '主辦人密碼不正確',
      TICKET_REQUIRED_TO_FINISH: '必須先取得幸運籤才能通過出口',
      ITEM_EVENT_RATE_LIMITED: '互動道具冷卻中，請稍後再試',
      UNAUTHORIZED: '主辦人密碼不正確'
    };
    return messages[code] || '操作未完成，請再試一次';
  }

  function toast(message, type, duration) {
    if (!dom.toast) return;
    var item = document.createElement('div');
    item.className = 'toast toast--' + (type || 'info');
    item.textContent = message;
    dom.toast.appendChild(item);
    window.setTimeout(function () {
      item.classList.add('is-leaving');
      window.setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 300);
    }, duration || 3000);
  }

  function ticketNumber(ticket) {
    if (!ticket) return '—';
    var value = ticket.number !== undefined ? ticket.number : ticket.ticketNumber;
    return value === undefined || value === null ? '已取得' : String(value).padStart(3, '0');
  }

  function updateTicketHud() {
    var number = document.getElementById('held-ticket');
    var status = document.getElementById('ticket-status');
    if (number) number.textContent = selfTicket ? ticketNumber(selfTicket) : '尚未取得';
    if (status) status.textContent = selfTicket ? '已持籤' : ticketLocked ? '尋籤已鎖定' : '尚未尋籤';
    if (dom.action) {
      var near = game && game.nearStation;
      if (dom.actionLabel) dom.actionLabel.textContent = ticketLocked ? '已鎖定' : near ? '拾取神秘籤' : '尋找籤台';
      dom.action.disabled = Boolean(selfTicket) || ticketLocked || !near || !near.userData.tokenId;
      dom.action.classList.toggle('is-ready', !dom.action.disabled);
    }
    if (dom.drop) {
      dom.drop.disabled = !selfTicket;
      dom.drop.hidden = !selfTicket;
    }
  }

  function useAction() {
    if (selfTicket) { dropTicketWithConfirmation(); return; }
    if (ticketLocked) { toast('主辦人已鎖定尋籤', 'warning'); return; }
    var station = game && game.nearStation;
    if (!station || !station.userData.tokenId) { toast('請靠近發光的尋籤台', 'info'); return; }
    send({ type: 'claim', tokenId: station.userData.tokenId });
  }

  function dropTicketWithConfirmation() {
    if (!selfTicket) return;
    if (window.confirm('確定要放棄目前的籤號嗎？放棄後其他人可以拾取。')) send({ type: 'drop' });
  }

  function sendAdmin(type, extra) {
    send(Object.assign({ type: type, pin: adminPin }, extra || {}));
  }

  function addPrize(event) {
    event.preventDefault();
    var nameField = document.getElementById('prize-name');
    var quantityField = document.getElementById('prize-quantity');
    var name = clean(nameField && nameField.value, 40);
    var quantity = Math.max(1, Math.min(50, Math.floor(Number(quantityField && quantityField.value) || 1)));
    if (!name) { toast('請輸入獎項名稱', 'warning'); return; }
    var prize = { id: 'prize-' + Date.now().toString(36), name: name, quantity: quantity };
    adminPrizeDraft = adminPrizeDraft.concat([prize]);
    renderPrizeDraft();
    sendAdmin('admin_config', { prizes: adminPrizeDraft });
    if (nameField) nameField.value = '';
    if (quantityField) quantityField.value = '1';
  }

  function removePrize(prizeId) {
    var next = adminPrizeDraft.filter(function (prize) { return prize.id !== prizeId; });
    if (!next.length) {
      toast('至少需要保留一個獎項；可重設房間後重新規劃', 'warning');
      return;
    }
    adminPrizeDraft = next;
    renderPrizeDraft();
    sendAdmin('admin_config', { prizes: adminPrizeDraft });
  }

  function renderPrizeDraft() {
    var list = document.getElementById('prize-list');
    var total = document.getElementById('prize-total');
    if (total) total.textContent = '共 ' + adminPrizeDraft.reduce(function (sum, prize) { return sum + Number(prize.quantity || 0); }, 0) + ' 個名額';
    if (!list) return;
    list.textContent = '';
    if (!adminPrizeDraft.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '尚未建立獎項';
      list.appendChild(empty);
      return;
    }
    adminPrizeDraft.forEach(function (prize) {
      var row = document.createElement('div');
      row.className = 'prize-item';
      row.setAttribute('role', 'listitem');
      var medal = document.createElement('span'); medal.className = 'prize-medal'; medal.setAttribute('aria-hidden', 'true');
      var title = document.createElement('strong'); title.textContent = prize.name;
      var quantity = document.createElement('small'); quantity.textContent = prize.quantity + ' 名';
      var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', '移除' + prize.name); remove.setAttribute('data-prize-remove', prize.id);
      row.appendChild(medal); row.appendChild(title); row.appendChild(quantity); row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function drawPrize() {
    var select = document.getElementById('prize-select');
    var prizeId = select && select.value;
    if (!prizeId && serverState.prizes && serverState.prizes.length === 1) prizeId = serverState.prizes[0].id;
    if (!prizeId) { toast('請先選擇要抽出的獎項', 'warning'); return; }
    sendAdmin('admin_draw', { prizeId: prizeId });
  }

  function resetRoom() {
    if (window.confirm('確定要重設整個房間嗎？所有持籤與中獎紀錄都會清除。')) sendAdmin('admin_reset');
  }

  function handleAdminDelegation(event) {
    var remove = event.target.closest('[data-prize-remove]');
    if (remove) { removePrize(remove.getAttribute('data-prize-remove')); return; }
    var button = event.target.closest('[data-draw-status]');
    if (!button) return;
    sendAdmin('admin_mark', { drawId: button.getAttribute('data-draw-id'), status: button.getAttribute('data-draw-status') });
  }

  function setAdminAuthenticated(authenticated) {
    if (dom.adminDashboard) dom.adminDashboard.hidden = !authenticated;
    if (dom.adminForm) dom.adminForm.hidden = authenticated;
  }

  function renderAdminState(state) {
    var count = document.getElementById('admin-player-count');
    var held = document.getElementById('admin-held-count');
    var available = document.getElementById('admin-available-count');
    var phase = document.getElementById('admin-phase');
    var participants = Array.isArray(state.participants) ? state.participants : [];
    if (count) count.textContent = String(state.participantCount || normalizePlayers(state.players).length || 0);
    if (held) held.textContent = String(participants.filter(function (participant) { return participant.ticketId || participant.ticketNumber; }).length);
    if (available) available.textContent = String(Number(state.availableTickets) || 0);
    if (phase) phase.textContent = ticketLocked ? '已鎖定' : '開放中';
    var lockState = document.getElementById('lock-state');
    if (lockState) { lockState.textContent = ticketLocked ? '已鎖定' : '開放尋籤'; lockState.classList.toggle('state-badge--open', !ticketLocked); }
    var lockButton = document.getElementById('lock-tickets');
    var unlockButton = document.getElementById('unlock-tickets');
    if (lockButton) lockButton.disabled = ticketLocked;
    if (unlockButton) unlockButton.disabled = !ticketLocked;
    if (Array.isArray(state.prizes)) {
      adminPrizeDraft = state.prizes.map(function (prize) { return { id: prize.id, name: prize.name, quantity: prize.quantity }; });
      renderPrizeDraft();
    }
    var select = document.getElementById('prize-select');
    if (select && Array.isArray(state.prizes)) {
      var selected = select.value;
      select.textContent = '';
      state.prizes.forEach(function (prize) {
        var option = document.createElement('option');
        option.value = prize.id;
        var used = (state.draws || []).filter(function (draw) { return draw.prizeId === prize.id && draw.status !== 'redraw'; }).length;
        option.textContent = prize.name + '（剩 ' + Math.max(0, prize.quantity - used) + '）';
        select.appendChild(option);
      });
      if (selected) select.value = selected;
      if (!select.value && select.options.length) select.selectedIndex = 0;
    }
    var drawButton = document.getElementById('draw-prize');
    if (drawButton) drawButton.disabled = !ticketLocked || !select || !select.value;
    var gameCount = document.getElementById('room-player-count');
    if (gameCount) gameCount.textContent = String(state.connectedCount || state.participantCount || 1);
    var homeStatus = document.getElementById('home-room-status');
    if (homeStatus) homeStatus.textContent = ticketLocked ? '抽獎進行中' : '開放尋籤';
    renderDrawHistory(state.draws || state.history || []);
  }

  function renderDrawHistory(draws) {
    var container = document.getElementById('draw-records');
    if (!container || !Array.isArray(draws)) return;
    container.textContent = '';
    draws.slice().reverse().slice(0, 30).forEach(function (draw) {
      var row = document.createElement('div');
      row.className = 'record-row draw-history__row';
      var prize = document.createElement('span'); prize.textContent = draw.prizeName || draw.prizeId || '獎項';
      var number = document.createElement('span'); number.textContent = ticketNumber(draw.ticket || draw);
      var winner = document.createElement('span'); winner.textContent = clean(draw.winnerName || draw.name || draw.playerName, 24);
      var controls = document.createElement('span'); controls.className = 'record-actions';
      row.appendChild(prize); row.appendChild(number); row.appendChild(winner); row.appendChild(controls);
      ['claimed', 'absent', 'redraw'].forEach(function (status) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-draw-id', draw.id || draw.drawId || '');
        button.setAttribute('data-draw-status', status);
        button.textContent = status === 'claimed' ? '已領' : status === 'absent' ? '缺席' : '重抽';
        controls.appendChild(button);
      });
      container.appendChild(row);
    });
    var drawCount = document.getElementById('draw-count');
    if (drawCount) drawCount.textContent = '已抽出 ' + draws.filter(function (draw) { return draw.status !== 'redraw'; }).length + ' 人';
  }

  function renderDrawResult(draw) {
    if (!draw) return;
    var number = document.getElementById('display-number');
    var name = document.getElementById('display-winner-name');
    var prize = document.getElementById('display-prize-name');
    if (number) number.textContent = ticketNumber(draw.ticket || draw);
    if (name) name.textContent = clean(draw.winnerName || draw.name || draw.playerName || '幸運勇者', 24);
    if (prize) prize.textContent = clean(draw.prizeName || draw.prize || '幸運獎項', 60);
    if (screens.display) {
      screens.display.classList.remove('is-revealing');
      void screens.display.offsetWidth;
      screens.display.classList.add('is-revealing');
    }
  }

  function requestLandscape() {
    var orientation = window.screen && window.screen.orientation;
    if (orientation && orientation.lock) orientation.lock('landscape').catch(function () { /* User gesture policies differ. */ });
  }

  function updateOrientation() {
    if (!dom.rotate) return;
    var portrait = window.innerHeight > window.innerWidth;
    var shouldShow = portrait && route === 'game';
    dom.rotate.hidden = !shouldShow;
    dom.rotate.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  }

  function leaveWithConfirmation() {
    if (dom.leaveDialog && typeof dom.leaveDialog.showModal === 'function') {
      dom.leaveDialog.showModal();
      return;
    }
    if (!window.confirm('確定要離開遊戲嗎？離開時會放棄目前持有的籤。')) return;
    confirmLeave();
  }

  function confirmLeave(event) {
    if (event) event.preventDefault();
    if (dom.leaveDialog && dom.leaveDialog.open) dom.leaveDialog.close('confirm');
    stopGame();
    var waitForDrop = Boolean(selfTicket && send({ type: 'drop' }));
    selfTicket = null;
    updateTicketHud();
    window.setTimeout(function () {
      intentionalClose = true;
      closeSocket();
      navigate('home');
    }, waitForDrop ? 180 : 0);
  }

  function startGame(character) {
    if (!THREE) {
      toast('3D 引擎載入失敗，請重新整理頁面', 'error');
      return;
    }
    if (game) {
      resetPlayerSystems(character || game.character);
      game.running = true;
      handleResize();
      return;
    }
    game = createGame(character);
    bindGameControls();
    game.running = true;
    game.lastFrame = performance.now();
    window.requestAnimationFrame(animate);
    handleResize();
  }

  function stopGame() {
    if (!game) return;
    game.running = false;
    game.keys.clear();
    game.input.x = 0;
    game.input.y = 0;
  }

  function createGame(character) {
    var renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = false;
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x160713);
    scene.fog = new THREE.FogExp2(0x220812, 0.017);
    var camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.08, 130);
    scene.add(new THREE.HemisphereLight(0xffc36b, 0x250711, 1.7));
    var warm = new THREE.PointLight(0xff8a32, 18, 35, 2);
    warm.position.set(0, 9, 0);
    scene.add(warm);
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_W * CELL_SIZE + 10, GRID_H * CELL_SIZE + 10),
      new THREE.MeshStandardMaterial({ color: 0x280a13, roughness: 0.88, metalness: 0.08 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    scene.add(floor);
    var border = new THREE.GridHelper(Math.max(GRID_W, GRID_H) * CELL_SIZE + 8, 28, 0x8f431b, 0x45131b);
    border.position.y = 0.01;
    scene.add(border);
    var maze = generateMaze(GRID_W, GRID_H, hashSeed(roomId));
    var spawnYaw = initialYawForMaze(maze);
    var mazeBuild = buildMazeMeshes(scene, maze);
    var decor = buildDecor(scene, maze);
    var stations = buildTicketStations(scene, maze);
    var portal = buildExitPortal(scene, maze);
    var pickups = buildWorldPickups(scene, maze);
    var localAvatar = createAvatar(character || 'yong', true);
    scene.add(localAvatar);
    localAvatar.position.set(maze.spawn.x, 0, maze.spawn.z);
    var fireworks = buildFireworks(scene);
    var result = {
      renderer: renderer,
      scene: scene,
      camera: camera,
      maze: maze,
      collisions: mazeBuild.walls,
      wallMesh: mazeBuild.mesh,
      decor: decor,
      stations: stations,
      portal: portal,
      pickups: pickups,
      localAvatar: localAvatar,
      remoteMeshes: new Map(),
      fireworks: fireworks,
      fireworkBurst: 0,
      position: new THREE.Vector3(maze.spawn.x, 0, maze.spawn.z),
      yaw: spawnYaw,
      viewMode: 1,
      input: { x: 0, y: 0 },
      keys: new Set(),
      nearStation: null,
      nearExit: false,
      lastPositionSent: 0,
      lastFrame: 0,
      running: false,
      character: character || 'yong',
      satiety: 100,
      joyScore: 0,
      inventory: {},
      effects: {},
      shovelCount: character === 'robot' ? 1 : 0,
      shovelRestockAt: 0,
      finished: false,
      finishRequested: false,
      finishRequestedAt: 0,
      finishRank: 0,
      lastExitWarningAt: 0,
      wallFactor: 1,
      wallEventNotified: false,
      catRouteTriggered: false,
      routeVisibleUntil: 0,
      routeLine: null,
      nextRouteRefresh: 0
    };
    assignTicketStations(result);
    setInitialCamera(result);
    updatePlayerHud(result);
    return result;
  }

  function hashSeed(text) {
    var value = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function seededRandom(seed) {
    var value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      var t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateMaze(width, height, seed) {
    var random = seededRandom(seed);
    var cells = [];
    for (var z = 0; z < height; z += 1) {
      var row = [];
      for (var x = 0; x < width; x += 1) row.push({ visited: false, walls: [true, true, true, true] });
      cells.push(row);
    }
    var stack = [[0, 0]];
    cells[0][0].visited = true;
    var directions = [[0, -1, 0, 2], [1, 0, 1, 3], [0, 1, 2, 0], [-1, 0, 3, 1]];
    while (stack.length) {
      var current = stack[stack.length - 1];
      var options = directions.filter(function (direction) {
        var nx = current[0] + direction[0];
        var nz = current[1] + direction[1];
        return nx >= 0 && nz >= 0 && nx < width && nz < height && !cells[nz][nx].visited;
      });
      if (!options.length) { stack.pop(); continue; }
      var direction = options[Math.floor(random() * options.length)];
      var nx = current[0] + direction[0];
      var nz = current[1] + direction[1];
      cells[current[1]][current[0]].walls[direction[2]] = false;
      cells[nz][nx].walls[direction[3]] = false;
      cells[nz][nx].visited = true;
      stack.push([nx, nz]);
    }
    var originX = -(width * CELL_SIZE) / 2;
    var originZ = -(height * CELL_SIZE) / 2;
    var points = [];
    for (var pz = 0; pz < height; pz += 1) for (var px = 0; px < width; px += 1) {
      points.push({ x: originX + px * CELL_SIZE + CELL_SIZE / 2, z: originZ + pz * CELL_SIZE + CELL_SIZE / 2, gx: px, gz: pz });
    }
    return { width: width, height: height, cells: cells, originX: originX, originZ: originZ, points: points, spawn: points[0], random: random };
  }

  function initialYawForMaze(maze) {
    var walls = maze.cells[0][0].walls;
    if (!walls[1]) return Math.PI / 2;
    if (!walls[2]) return 0;
    if (!walls[0]) return Math.PI;
    if (!walls[3]) return -Math.PI / 2;
    return 0;
  }

  function pointCollidesWalls(x, z, walls, radius) {
    for (var i = 0; i < walls.length; i += 1) {
      var wall = walls[i];
      if (wall.broken) continue;
      if (x + radius > wall.minX && x - radius < wall.maxX && z + radius > wall.minZ && z - radius < wall.maxZ) return true;
    }
    return false;
  }

  function cameraBackDistance(targetGame, maximum) {
    var safe = 0.65;
    for (var distance = 0.65; distance <= maximum; distance += 0.2) {
      var x = targetGame.position.x - Math.sin(targetGame.yaw) * distance;
      var z = targetGame.position.z - Math.cos(targetGame.yaw) * distance;
      if (pointCollidesWalls(x, z, targetGame.collisions, 0.14)) break;
      safe = distance;
    }
    return safe;
  }

  function setInitialCamera(targetGame) {
    var distance = cameraBackDistance(targetGame, 4.4);
    targetGame.camera.position.set(
      targetGame.position.x - Math.sin(targetGame.yaw) * distance,
      2.7,
      targetGame.position.z - Math.cos(targetGame.yaw) * distance
    );
    targetGame.camera.lookAt(new THREE.Vector3(targetGame.position.x, 1.35, targetGame.position.z));
    targetGame.localAvatar.rotation.y = targetGame.yaw;
  }

  function buildMazeMeshes(scene, maze) {
    var wallData = [];
    var thickness = 0.22;
    for (var z = 0; z < maze.height; z += 1) for (var x = 0; x < maze.width; x += 1) {
      var cell = maze.cells[z][x];
      var cx = maze.originX + x * CELL_SIZE + CELL_SIZE / 2;
      var cz = maze.originZ + z * CELL_SIZE + CELL_SIZE / 2;
      if (cell.walls[0]) wallData.push({ x: cx, z: cz - CELL_SIZE / 2, w: CELL_SIZE + thickness, d: thickness, r: 0 });
      if (cell.walls[3]) wallData.push({ x: cx - CELL_SIZE / 2, z: cz, w: thickness, d: CELL_SIZE + thickness, r: 0 });
      if (z === maze.height - 1 && cell.walls[2]) wallData.push({ x: cx, z: cz + CELL_SIZE / 2, w: CELL_SIZE + thickness, d: thickness, r: 0 });
      if (x === maze.width - 1 && cell.walls[1]) wallData.push({ x: cx + CELL_SIZE / 2, z: cz, w: thickness, d: CELL_SIZE + thickness, r: 0 });
    }
    var geometry = new THREE.BoxGeometry(1, 2.7, 1);
    var material = new THREE.MeshStandardMaterial({ color: 0x8e1826, roughness: 0.48, metalness: 0.16 });
    var mesh = new THREE.InstancedMesh(geometry, material, wallData.length);
    var matrix = new THREE.Matrix4();
    var color = new THREE.Color();
    wallData.forEach(function (wall, index) {
      matrix.compose(new THREE.Vector3(wall.x, 1.35, wall.z), new THREE.Quaternion(), new THREE.Vector3(wall.w, 2.7, wall.d));
      mesh.setMatrixAt(index, matrix);
      color.set(index % 7 === 0 ? 0xb3292e : index % 3 === 0 ? 0x9d1c2a : 0x7d1224);
      mesh.setColorAt(index, color);
      wall.minX = wall.x - wall.w / 2;
      wall.maxX = wall.x + wall.w / 2;
      wall.minZ = wall.z - wall.d / 2;
      wall.maxZ = wall.z + wall.d / 2;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    wallData.forEach(function (wall, index) { wall.index = index; wall.broken = false; });
    return { walls: wallData, mesh: mesh };
  }

  function buildDecor(scene, maze) {
    var root = new THREE.Group();
    scene.add(root);
    var gold = new THREE.MeshStandardMaterial({ color: 0xf6bf42, roughness: 0.28, metalness: 0.72, emissive: 0x6b2c00, emissiveIntensity: 0.3 });
    var red = new THREE.MeshStandardMaterial({ color: 0xc72b32, roughness: 0.52 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x340b16, roughness: 0.7 });
    var lanternGeometry = new THREE.SphereGeometry(0.28, 10, 7);
    var lanternMaterial = new THREE.MeshStandardMaterial({ color: 0xff4b28, emissive: 0xff2500, emissiveIntensity: 1.6, roughness: 0.38 });
    for (var i = 0; i < 34; i += 1) {
      var point = maze.points[(i * 23 + 5) % maze.points.length];
      var lantern = new THREE.Mesh(lanternGeometry, lanternMaterial);
      lantern.scale.y = 1.18;
      lantern.position.set(point.x + ((i % 2) * 2 - 1) * 1.45, 2.75, point.z + (((i >> 1) % 2) * 2 - 1) * 1.45);
      lantern.userData.phase = i * 0.31;
      root.add(lantern);
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 8), gold);
      cap.position.copy(lantern.position).add(new THREE.Vector3(0, 0.34, 0));
      root.add(cap);
    }
    var tableGeometry = new THREE.CylinderGeometry(1.05, 1.05, 0.18, 16);
    var baseGeometry = new THREE.CylinderGeometry(0.2, 0.42, 0.72, 12);
    [19, 61, 103, 145].forEach(function (index) {
      var point = maze.points[index % maze.points.length];
      var table = new THREE.Mesh(tableGeometry, red);
      table.position.set(point.x, 0.82, point.z);
      root.add(table);
      var base = new THREE.Mesh(baseGeometry, gold);
      base.position.set(point.x, 0.38, point.z);
      root.add(base);
    });
    var stagePoint = maze.points[maze.points.length - 1];
    var stage = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.65, 4.8), dark);
    stage.position.set(stagePoint.x, 0.32, stagePoint.z);
    root.add(stage);
    var arch = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.18, 8, 30, Math.PI), gold);
    arch.rotation.z = Math.PI;
    arch.position.set(stagePoint.x, 2.2, stagePoint.z - 1.5);
    root.add(arch);
    var lion = new THREE.Group();
    var lionHead = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 9), red);
    lionHead.scale.set(1.25, 1, 1);
    lionHead.position.y = 1.2;
    lion.add(lionHead);
    [-0.25, 0.25].forEach(function (x) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), gold);
      eye.position.set(x, 1.32, -0.48);
      lion.add(eye);
    });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), gold);
    body.scale.set(1.45, 0.75, 0.8);
    body.position.set(0, 0.72, 0.55);
    lion.add(body);
    lion.position.set(stagePoint.x, 0.65, stagePoint.z);
    root.add(lion);
    root.userData.lanterns = root.children.filter(function (child) { return child.userData.phase !== undefined; });
    root.userData.lion = lion;
    return root;
  }

  function buildExitPortal(scene, maze) {
    var point = maze.points[maze.points.length - 1];
    var portal = new THREE.Group();
    var gold = new THREE.MeshStandardMaterial({ color: 0xffd15a, emissive: 0xc45b00, emissiveIntensity: 1.3, metalness: 0.68, roughness: 0.22 });
    var glow = new THREE.MeshBasicMaterial({ color: 0xff7b31, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    var arch = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.16, 8, 32, Math.PI), gold);
    arch.rotation.z = Math.PI;
    arch.position.y = 1.45;
    portal.add(arch);
    [-1.38, 1.38].forEach(function (x) {
      var pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.8, 8), gold);
      pillar.position.set(x, 0.7, 0);
      portal.add(pillar);
    });
    var veil = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.45), glow);
    veil.position.y = 1.25;
    portal.add(veil);
    var base = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 6, 24), gold);
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.05;
    portal.add(base);
    portal.position.set(point.x, 0.66, point.z);
    portal.userData.exitPoint = new THREE.Vector3(point.x, 0, point.z);
    scene.add(portal);
    return portal;
  }

  function buildWorldPickups(scene, maze) {
    var pickups = [];
    var used = new Set([0, maze.points.length - 1, 19, 61, 103, 145]);
    for (var stationIndex = 0; stationIndex < 24; stationIndex += 1) used.add((stationIndex * 37 + 8) % maze.points.length);
    function takePoint(seed, step) {
      var index = seed % maze.points.length;
      while (used.has(index)) index = (index + step) % maze.points.length;
      used.add(index);
      return maze.points[index];
    }
    var itemKinds = Object.keys(ITEM_DEFS);
    itemKinds.forEach(function (kind, index) {
      var point = takePoint(index * 29 + 12, 17);
      var pickup = createPickupMesh('item', kind, ITEM_DEFS[kind].color);
      pickup.position.set(point.x + (index % 2 ? 0.72 : -0.72), 0, point.z);
      scene.add(pickup);
      pickups.push(pickup);
    });
    var foodKinds = Object.keys(FOOD_DEFS);
    for (var i = 0; i < 14; i += 1) {
      var foodKind = foodKinds[i % foodKinds.length];
      var foodPoint = takePoint(i * 31 + 21, 19);
      var food = createPickupMesh('food', foodKind, FOOD_DEFS[foodKind].color);
      food.position.set(foodPoint.x + (i % 2 ? -0.68 : 0.68), 0, foodPoint.z);
      scene.add(food);
      pickups.push(food);
    }
    return pickups;
  }

  function createPickupMesh(category, kind, color) {
    var root = new THREE.Group();
    var ringMaterial = new THREE.MeshBasicMaterial({ color: category === 'item' ? 0x65edff : 0x7cff8b, transparent: true, opacity: 0.8, depthWrite: false });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.055, 6, 22), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    root.add(ring);
    var beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.58, 1.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beacon.position.y = 0.82;
    root.add(beacon);
    var icon = category === 'item' ? buildItemIcon(kind, color) : buildFoodIcon(kind, color);
    icon.position.y = 0.72;
    icon.userData.floatIcon = true;
    root.add(icon);
    root.userData.pickup = true;
    root.userData.category = category;
    root.userData.kind = kind;
    root.userData.respawnAt = 0;
    root.userData.phase = hashSeed(category + '-' + kind) % 1000 / 100;
    return root;
  }

  function emissiveMaterial(color) {
    return new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.58, metalness: 0.28, roughness: 0.32 });
  }

  function buildItemIcon(kind, color) {
    var root = new THREE.Group();
    var material = emissiveMaterial(color);
    var gold = emissiveMaterial(0xffca55);
    var icon;
    if (kind === 'speed') {
      icon = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), material); root.add(icon);
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 8), gold); neck.position.y = 0.28; root.add(neck);
    } else if (kind === 'superspeed') {
      icon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), material); root.add(icon);
      var halo = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.045, 5, 18), gold); halo.rotation.x = Math.PI / 2; root.add(halo);
    } else if (kind === 'shovel') {
      var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 7), gold); handle.rotation.z = -0.32; root.add(handle);
      var blade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 4), material); blade.rotation.z = -0.32; blade.position.set(-0.13, -0.38, 0); root.add(blade);
    } else if (kind === 'map') {
      icon = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.43, 0.07), material); icon.rotation.y = 0.25; root.add(icon);
      var fold = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.45, 0.09), gold); fold.position.x = 0.02; root.add(fold);
    } else if (kind === 'compass') {
      icon = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.11, 18), material); icon.rotation.x = Math.PI / 2; root.add(icon);
      var needle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.48, 3), gold); needle.rotation.z = -Math.PI / 2; needle.position.z = -0.08; root.add(needle);
    } else if (kind === 'ghost') {
      icon = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.72), material); root.add(icon);
      var skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.48, 7, 1, true), material); skirt.position.y = -0.28; root.add(skirt);
    } else if (kind === 'timegem') {
      icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), material); root.add(icon);
      var orbit = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.04, 5, 20), gold); orbit.rotation.x = 1; root.add(orbit);
    } else if (kind === 'star') {
      var starShape = new THREE.Shape();
      for (var s = 0; s < 10; s += 1) {
        var radius = s % 2 ? 0.18 : 0.4;
        var angle = -Math.PI / 2 + s * Math.PI / 5;
        if (s === 0) starShape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else starShape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      starShape.closePath();
      icon = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.09, bevelEnabled: false }), material); icon.position.z = -0.045; root.add(icon);
    } else if (kind === 'prank') {
      icon = new THREE.Mesh(new THREE.TorusKnotGeometry(0.23, 0.085, 36, 6), material); root.add(icon);
    } else {
      icon = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.48, 3, 7), material); icon.rotation.z = Math.PI / 2; root.add(icon);
      var mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.12, 0.18, 8), gold); mouth.rotation.z = Math.PI / 2; mouth.position.x = 0.36; root.add(mouth);
    }
    return root;
  }

  function buildFoodIcon(kind, color) {
    var root = new THREE.Group();
    var material = emissiveMaterial(color);
    var accent = emissiveMaterial(0xffdc76);
    var icon;
    if (kind === 'candy') {
      icon = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 3, 7), material); icon.rotation.z = Math.PI / 2; root.add(icon);
      [-0.38, 0.38].forEach(function (x) { var wrap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.24, 4), accent); wrap.rotation.z = x < 0 ? -Math.PI / 2 : Math.PI / 2; wrap.position.x = x; root.add(wrap); });
    } else if (kind === 'cookie') {
      icon = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.11, 14), material); icon.rotation.x = Math.PI / 2; root.add(icon);
    } else if (kind === 'apple') {
      icon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), material); root.add(icon);
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), accent); stem.position.y = 0.35; root.add(stem);
    } else if (kind === 'riceball') {
      icon = new THREE.Mesh(new THREE.ConeGeometry(0.39, 0.66, 3), material); root.add(icon);
      var seaweed = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.05), emissiveMaterial(0x173c2a)); seaweed.position.set(0, -0.14, 0.22); root.add(seaweed);
    } else if (kind === 'ramen') {
      icon = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.28, 0.3, 12), material); root.add(icon);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 5, 18), accent); rim.rotation.x = Math.PI / 2; rim.position.y = 0.16; root.add(rim);
    } else if (kind === 'drumstick') {
      icon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 9, 7), material); icon.scale.x = 1.3; root.add(icon);
      var bone = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 7), accent); bone.rotation.z = Math.PI / 2; bone.position.x = 0.38; root.add(bone);
    } else {
      icon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.48), material); root.add(icon);
      var strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.31, 0.51), accent); root.add(strap);
    }
    return root;
  }

  function buildTicketStations(scene, maze) {
    var stations = [];
    var standMaterial = new THREE.MeshStandardMaterial({ color: 0x8b1322, roughness: 0.42, metalness: 0.2 });
    var goldMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf51, roughness: 0.18, metalness: 0.75, emissive: 0x8a3f00, emissiveIntensity: 0.72 });
    for (var i = 0; i < 24; i += 1) {
      var point = maze.points[(i * 37 + 8) % maze.points.length];
      var station = new THREE.Group();
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.6, 0.72, 10), standMaterial);
      base.position.y = 0.36;
      station.add(base);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.08, 6, 18), goldMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.85;
      station.add(ring);
      var mystery = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), goldMaterial);
      mystery.position.y = 1.12;
      mystery.userData.floatPart = true;
      station.add(mystery);
      station.position.set(point.x, 0, point.z);
      station.userData.index = i;
      station.userData.tokenId = null;
      station.userData.available = false;
      scene.add(station);
      stations.push(station);
    }
    return stations;
  }

  function assignTicketStations(targetGame) {
    var current = targetGame || game;
    if (!current || !current.stations) return;
    current.stations.forEach(function (station, index) {
      var snapshot = stationSnapshot[index];
      var tokenId = snapshot ? (snapshot.available ? snapshot.tokenId : null) : (availableTicketIds[index] || null);
      if (snapshot && Number.isFinite(snapshot.x) && Number.isFinite(snapshot.z)) {
        var withinX = Math.abs(snapshot.x) <= GRID_W * CELL_SIZE / 2;
        var withinZ = Math.abs(snapshot.z) <= GRID_H * CELL_SIZE / 2;
        if (withinX && withinZ) station.position.set(snapshot.x, 0, snapshot.z);
      }
      station.userData.tokenId = tokenId;
      station.userData.available = Boolean(tokenId);
      station.visible = Boolean(tokenId);
    });
  }

  function buildFireworks(scene) {
    var count = 240;
    var positions = new Float32Array(count * 3);
    var colors = new Float32Array(count * 3);
    var velocities = [];
    var random = seededRandom(hashSeed(roomId + '-fireworks'));
    var palette = [new THREE.Color(0xffd25a), new THREE.Color(0xff4938), new THREE.Color(0xff8fd8), new THREE.Color(0x76e5ff)];
    for (var i = 0; i < count; i += 1) {
      positions[i * 3] = 999;
      positions[i * 3 + 1] = 999;
      positions[i * 3 + 2] = 999;
      var color = palette[i % palette.length];
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      velocities.push(new THREE.Vector3((random() - 0.5) * 7, random() * 5 + 2, (random() - 0.5) * 7));
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(points);
    return { points: points, velocities: velocities, age: 99, origin: new THREE.Vector3() };
  }

  var avatarGeometryCache = {};
  var avatarMaterialCache = {};

  function avatarAppearance(character) {
    var appearances = {
      yong: { type: 'human', outfit: 'suit', skin: 0xffcc99, hair: 0x4a3220, accent: 0x2196f3 },
      hua: { type: 'girl', outfit: 'dress', skin: 0xffd9b3, hair: 0x8d5524, accent: 0xf06292 },
      dan: { type: 'human', outfit: 'suit', skin: 0x8d5524, hair: 0x1a1a1a, accent: 0x43a047 },
      liya: { type: 'girl', outfit: 'dress', skin: 0xc68642, hair: 0x111111, accent: 0x7e57c2 },
      robot: { type: 'robot', outfit: 'suit', skin: 0xb0bec5, hair: 0x616161, accent: 0x00e5ff },
      cat: { type: 'cat', outfit: 'dress', skin: 0xffa040, hair: 0xef6c00, accent: 0xffb74d }
    };
    return appearances[character] || appearances.yong;
  }

  function avatarGeometry(kind) {
    if (avatarGeometryCache[kind]) return avatarGeometryCache[kind];
    var geometry;
    if (kind === 'torso') geometry = new THREE.BoxGeometry(0.62, 0.62, 0.36);
    else if (kind === 'dress-bodice') geometry = new THREE.BoxGeometry(0.52, 0.48, 0.34);
    else if (kind === 'skirt') geometry = new THREE.CylinderGeometry(0.28, 0.45, 0.5, 8);
    else if (kind === 'sash') geometry = new THREE.CylinderGeometry(0.30, 0.32, 0.09, 8);
    else if (kind === 'head') geometry = new THREE.BoxGeometry(0.52, 0.5, 0.48);
    else if (kind === 'eye') geometry = new THREE.BoxGeometry(0.07, 0.09, 0.04);
    else if (kind === 'hair') geometry = new THREE.BoxGeometry(0.56, 0.16, 0.52);
    else if (kind === 'pigtail') geometry = new THREE.BoxGeometry(0.14, 0.4, 0.14);
    else if (kind === 'arm') geometry = new THREE.BoxGeometry(0.16, 0.5, 0.16);
    else if (kind === 'hand') geometry = new THREE.BoxGeometry(0.13, 0.13, 0.13);
    else if (kind === 'leg') geometry = new THREE.BoxGeometry(0.2, 0.55, 0.2);
    else if (kind === 'shirt') geometry = new THREE.BoxGeometry(0.18, 0.43, 0.025);
    else if (kind === 'collar') geometry = new THREE.BoxGeometry(0.25, 0.08, 0.025);
    else if (kind === 'tie') geometry = new THREE.BoxGeometry(0.055, 0.27, 0.03);
    else if (kind === 'lapel') geometry = new THREE.BoxGeometry(0.13, 0.34, 0.025);
    else if (kind === 'ear') geometry = new THREE.ConeGeometry(0.11, 0.22, 4);
    else if (kind === 'tail') geometry = new THREE.BoxGeometry(0.09, 0.09, 0.5);
    else if (kind === 'nose') geometry = new THREE.BoxGeometry(0.08, 0.06, 0.05);
    else if (kind === 'antenna') geometry = new THREE.BoxGeometry(0.05, 0.3, 0.05);
    else if (kind === 'bulb') geometry = new THREE.SphereGeometry(0.08, 8, 8);
    else geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    avatarGeometryCache[kind] = geometry;
    return geometry;
  }

  function avatarMaterial(color, glow) {
    var key = String(color) + (glow ? '-glow' : '');
    if (!avatarMaterialCache[key]) {
      avatarMaterialCache[key] = new THREE.MeshStandardMaterial({
        color: color,
        emissive: glow ? color : 0x000000,
        emissiveIntensity: glow ? 0.7 : 0,
        roughness: glow ? 0.3 : 0.64,
        metalness: glow ? 0.2 : 0.04
      });
    }
    return avatarMaterialCache[key];
  }

  function addAvatarPart(group, kind, color, x, y, z, rotationZ, glow) {
    var mesh = new THREE.Mesh(avatarGeometry(kind), avatarMaterial(color, glow));
    mesh.position.set(x, y, z);
    if (rotationZ) mesh.rotation.z = rotationZ;
    group.add(mesh);
    return mesh;
  }

  function createAvatar(character, local) {
    var group = new THREE.Group();
    var appearance = avatarAppearance(character);
    var isDress = appearance.outfit === 'dress';
    var suitColor = appearance.type === 'robot' ? 0x526779 : 0x3f5878;
    var white = 0xfffbf0;
    var legColor = isDress ? appearance.skin : 0x101620;

    var legL = addAvatarPart(group, 'leg', legColor, -0.16, 0.31, 0);
    var legR = addAvatarPart(group, 'leg', legColor, 0.16, 0.31, 0);
    var armL;
    var armR;
    var body;

    if (isDress) {
      addAvatarPart(group, 'skirt', white, 0, 0.58, 0);
      addAvatarPart(group, 'sash', appearance.accent, 0, 0.79, 0);
      body = addAvatarPart(group, 'dress-bodice', white, 0, 0.98, 0);
      armL = addAvatarPart(group, 'arm', white, -0.38, 1.0, 0);
      armR = addAvatarPart(group, 'arm', white, 0.38, 1.0, 0);
      addAvatarPart(group, 'hand', appearance.skin, -0.38, 0.73, 0);
      addAvatarPart(group, 'hand', appearance.skin, 0.38, 0.73, 0);
    } else {
      body = addAvatarPart(group, 'torso', suitColor, 0, 0.96, 0);
      addAvatarPart(group, 'shirt', white, 0, 1.0, 0.193);
      addAvatarPart(group, 'collar', white, 0, 1.2, -0.193);
      addAvatarPart(group, 'tie', appearance.accent, 0, 0.97, 0.211);
      addAvatarPart(group, 'lapel', 0x0b101a, -0.12, 1.04, 0.207, -0.18);
      addAvatarPart(group, 'lapel', 0x0b101a, 0.12, 1.04, 0.207, 0.18);
      armL = addAvatarPart(group, 'arm', suitColor, -0.42, 1.04, 0);
      armR = addAvatarPart(group, 'arm', suitColor, 0.42, 1.04, 0);
      addAvatarPart(group, 'hand', appearance.skin, -0.42, 0.76, 0);
      addAvatarPart(group, 'hand', appearance.skin, 0.42, 0.76, 0);
    }

    addAvatarPart(group, 'head', appearance.skin, 0, 1.55, 0);
    if (appearance.type === 'robot') {
      addAvatarPart(group, 'eye', appearance.accent, -0.13, 1.58, 0.26, 0, true);
      addAvatarPart(group, 'eye', appearance.accent, 0.13, 1.58, 0.26, 0, true);
      addAvatarPart(group, 'antenna', appearance.hair, 0, 1.94, 0);
      addAvatarPart(group, 'bulb', appearance.accent, 0, 2.12, 0, 0, true);
    } else {
      addAvatarPart(group, 'eye', 0x222222, -0.13, 1.58, 0.26);
      addAvatarPart(group, 'eye', 0x222222, 0.13, 1.58, 0.26);
      if (appearance.type === 'cat') {
        addAvatarPart(group, 'ear', appearance.hair, -0.17, 1.9, 0);
        addAvatarPart(group, 'ear', appearance.hair, 0.17, 1.9, 0);
        var tail = addAvatarPart(group, 'tail', appearance.hair, 0, 0.82, -0.4);
        tail.rotation.x = 0.6;
        addAvatarPart(group, 'nose', 0xef9a9a, 0, 1.48, 0.26);
      } else {
        addAvatarPart(group, 'hair', appearance.hair, 0, 1.83, 0);
        if (appearance.type === 'girl') {
          addAvatarPart(group, 'pigtail', appearance.hair, -0.33, 1.55, -0.05);
          addAvatarPart(group, 'pigtail', appearance.hair, 0.33, 1.55, -0.05);
        }
      }
    }

    group.userData.isAvatar = true;
    group.userData.local = local;
    group.userData.character = character;
    group.userData.outfit = appearance.outfit;
    group.userData.armL = armL;
    group.userData.armR = armR;
    group.userData.legL = legL;
    group.userData.legR = legR;
    group.userData.body = body;
    return group;
  }

  function resetPlayerSystems(character) {
    if (!game) return;
    game.character = CLASS_DEFS[character] ? character : 'yong';
    if (!game.localAvatar || game.localAvatar.userData.character !== game.character) {
      if (game.localAvatar) game.scene.remove(game.localAvatar);
      game.localAvatar = createAvatar(game.character, true);
      game.scene.add(game.localAvatar);
    }
    game.position.copy(game.maze.spawn);
    game.yaw = initialYawForMaze(game.maze);
    game.satiety = 100;
    game.joyScore = 0;
    game.inventory = {};
    game.effects = {};
    game.shovelCount = game.character === 'robot' ? 1 : 0;
    game.shovelRestockAt = 0;
    game.finished = false;
    game.finishRequested = false;
    game.finishRequestedAt = 0;
    game.finishRank = 0;
    game.pendingItemEvent = null;
    game.wallEventNotified = false;
    game.catRouteTriggered = false;
    game.routeVisibleUntil = 0;
    game.pickups.forEach(function (pickup) { pickup.visible = true; pickup.userData.respawnAt = 0; });
    game.collisions.forEach(function (wall) { wall.broken = false; });
    updateWallMeshHeight(1);
    setInitialCamera(game);
    if (dom.finishOverlay) { dom.finishOverlay.hidden = true; dom.finishOverlay.setAttribute('aria-hidden', 'true'); }
    updatePlayerHud(game);
    renderInventory();
  }

  function showClassAbility() {
    if (!game) return;
    var detail = CLASS_DEFS[game.character] || CLASS_DEFS.yong;
    toast(detail.name + '｜' + detail.ability, 'info', 2600);
  }

  function toggleInventory() {
    if (!dom.inventoryPanel) return;
    dom.inventoryPanel.hidden = !dom.inventoryPanel.hidden;
    if (dom.inventory) dom.inventory.setAttribute('aria-expanded', dom.inventoryPanel.hidden ? 'false' : 'true');
    if (!dom.inventoryPanel.hidden) renderInventory();
  }

  function handleInventoryClick(event) {
    var button = event.target.closest('[data-use-item]');
    if (!button) return;
    useInventoryItem(button.getAttribute('data-use-item'));
  }

  function inventoryTotal() {
    if (!game) return 0;
    return Object.keys(game.inventory).reduce(function (sum, kind) { return sum + game.inventory[kind]; }, 0);
  }

  function addInventoryItem(kind) {
    if (!game || !ITEM_DEFS[kind]) return;
    game.inventory[kind] = Math.min(9, (game.inventory[kind] || 0) + 1);
    toast('獲得「' + ITEM_DEFS[kind].name + '」', 'success', 1900);
    renderInventory();
  }

  function renderInventory() {
    if (dom.inventoryCount) dom.inventoryCount.textContent = String(inventoryTotal());
    if (!dom.inventoryList || !game) return;
    dom.inventoryList.textContent = '';
    var kinds = Object.keys(game.inventory).filter(function (kind) { return game.inventory[kind] > 0; });
    if (!kinds.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '靠近帶有光環的物件即可拾取道具';
      dom.inventoryList.appendChild(empty);
      return;
    }
    kinds.forEach(function (kind) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-item';
      button.setAttribute('data-use-item', kind);
      button.innerHTML = '<span aria-hidden="true" style="--item-color:#' + ITEM_DEFS[kind].color.toString(16).padStart(6, '0') + '"></span><strong></strong><small></small>';
      button.querySelector('strong').textContent = ITEM_DEFS[kind].name;
      button.querySelector('small').textContent = '×' + game.inventory[kind] + '　使用';
      dom.inventoryList.appendChild(button);
    });
  }

  function useInventoryItem(kind) {
    if (!game || !game.inventory[kind] || !ITEM_DEFS[kind]) return;
    if (kind === 'shovel') {
      var shovelLimit = game.character === 'robot' ? 1 : 3;
      if (game.shovelCount >= shovelLimit) { toast('鐵鍬已達攜帶上限', 'warning'); return; }
      game.shovelCount += 1;
    } else if (kind === 'star') {
      game.joyScore += 100;
      toast('幸運星閃耀！歡樂分 +100', 'success');
      game.fireworkBurst = 1;
    } else if (kind === 'prank' || kind === 'whistle') {
      if (game.pendingItemEvent) { toast('上一個互動道具仍在確認中', 'warning'); return; }
      if (!send({ type: 'item_event', kind: kind })) return;
      game.pendingItemEvent = kind;
      toast(kind === 'prank' ? '調皮鬼出動！' : '吹響集合口哨！', 'success');
      return;
    } else {
      activateTimedEffect(kind);
    }
    consumeInventoryItem(kind);
    updatePlayerHud(game);
  }

  function consumeInventoryItem(kind) {
    if (!game || !game.inventory[kind]) return;
    game.inventory[kind] -= 1;
    if (game.inventory[kind] <= 0) delete game.inventory[kind];
    renderInventory();
  }

  function activateTimedEffect(kind) {
    var definition = ITEM_DEFS[kind];
    if (!definition || !definition.duration) return;
    var multiplier = game.character === 'liya' ? 1.5 : 1;
    var duration = definition.duration * multiplier;
    game.effects[kind] = { name: definition.name, duration: duration, endsAt: performance.now() + duration * 1000 };
    if (kind === 'map') game.routeVisibleUntil = game.effects[kind].endsAt;
    toast(definition.name + '生效 ' + Math.round(duration) + ' 秒', 'success');
  }

  function effectActive(kind, now) {
    return Boolean(game && game.effects[kind] && game.effects[kind].endsAt > now);
  }

  function useShovel() {
    if (!game || game.finished) return;
    if (game.shovelCount <= 0) {
      toast(game.character === 'robot' && game.shovelRestockAt ? '鐵鍬補充中' : '目前沒有鐵鍬', 'warning');
      return;
    }
    var nearest = null;
    var nearestDistance = 1.9;
    game.collisions.forEach(function (wall) {
      if (wall.broken) return;
      var px = Math.max(wall.minX, Math.min(game.position.x, wall.maxX));
      var pz = Math.max(wall.minZ, Math.min(game.position.z, wall.maxZ));
      var distance = Math.hypot(game.position.x - px, game.position.z - pz);
      if (distance < nearestDistance) { nearest = wall; nearestDistance = distance; }
    });
    if (!nearest) { toast('請靠近想打通的牆面再使用鐵鍬', 'info'); return; }
    nearest.broken = true;
    game.wallMesh.setMatrixAt(nearest.index, new THREE.Matrix4().makeScale(0, 0, 0));
    game.wallMesh.instanceMatrix.needsUpdate = true;
    game.shovelCount -= 1;
    if (game.character === 'robot' && game.shovelCount === 0) game.shovelRestockAt = Date.now() + 45000;
    toast('牆面已打通！', 'success');
    updatePlayerHud(game);
  }

  function updatePlayerHud(target) {
    if (!target) return;
    if (dom.satietyValue) dom.satietyValue.textContent = Math.round(target.satiety) + '%';
    if (dom.satietyBar) dom.satietyBar.style.width = Math.max(0, target.satiety) + '%';
    if (dom.satietyBar && dom.satietyBar.parentElement) dom.satietyBar.parentElement.setAttribute('aria-valuenow', String(Math.round(target.satiety)));
    if (dom.joyScore) dom.joyScore.textContent = String(target.joyScore);
    if (dom.shovelCount) dom.shovelCount.textContent = String(target.shovelCount);
    if (dom.shovel) dom.shovel.disabled = target.shovelCount <= 0 || target.finished;
    if (dom.skill) {
      var detail = CLASS_DEFS[target.character] || CLASS_DEFS.yong;
      dom.skill.setAttribute('aria-label', detail.name + '：' + detail.ability);
      dom.skill.title = detail.ability;
    }
  }

  function bindGameControls() {
    if (game.controlsBound) return;
    game.controlsBound = true;
    window.addEventListener('keydown', function (event) {
      if (!game || route !== 'game') return;
      game.keys.add(event.code);
      if (event.code === 'KeyE' || event.code === 'Space') { event.preventDefault(); useAction(); }
      if (event.code === 'KeyV') cycleView();
      if (event.code === 'KeyQ') useShovel();
      if (event.code === 'KeyI') toggleInventory();
    });
    window.addEventListener('keyup', function (event) { if (game) game.keys.delete(event.code); });
    bindJoystick();
    bindLookControls();
  }

  function bindJoystick() {
    if (!dom.joystick) return;
    var pointerId = null;
    var knob = dom.joystick.querySelector('.joystick-knob, [data-joystick-knob]');
    function update(event) {
      var rect = dom.joystick.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = event.clientX - cx;
      var dy = event.clientY - cy;
      var radius = Math.max(22, Math.min(rect.width, rect.height) * 0.36);
      var length = Math.hypot(dx, dy) || 1;
      if (length > radius) { dx = dx / length * radius; dy = dy / length * radius; }
      game.input.x = dx / radius;
      game.input.y = dy / radius;
      if (knob) knob.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px),calc(-50% + ' + dy.toFixed(1) + 'px))';
    }
    function reset() {
      pointerId = null;
      if (game) { game.input.x = 0; game.input.y = 0; }
      if (knob) knob.style.transform = 'translate(-50%,-50%)';
    }
    dom.joystick.addEventListener('pointerdown', function (event) {
      pointerId = event.pointerId;
      dom.joystick.setPointerCapture(pointerId);
      update(event);
      event.preventDefault();
    });
    dom.joystick.addEventListener('pointermove', function (event) { if (event.pointerId === pointerId) update(event); });
    dom.joystick.addEventListener('pointerup', reset);
    dom.joystick.addEventListener('pointercancel', reset);
  }

  function bindLookControls() {
    var target = dom.lookZone || dom.canvas;
    if (!target) return;
    var pointerId = null;
    var lastX = 0;
    target.addEventListener('pointerdown', function (event) {
      pointerId = event.pointerId;
      lastX = event.clientX;
      target.setPointerCapture(pointerId);
      event.preventDefault();
    });
    target.addEventListener('pointermove', function (event) {
      if (event.pointerId !== pointerId || !game) return;
      var dx = event.clientX - lastX;
      lastX = event.clientX;
      game.yaw -= dx * 0.008;
    });
    target.addEventListener('pointerup', function () { pointerId = null; });
    target.addEventListener('pointercancel', function () { pointerId = null; });
  }

  function cycleView() {
    if (!game) return;
    game.viewMode = (game.viewMode + 1) % 3;
    var labels = ['第一人稱', '第三人稱', '俯視'];
    if (dom.viewLabel) dom.viewLabel.textContent = labels[game.viewMode];
    toast('切換為' + labels[game.viewMode], 'info', 1600);
  }

  function animate(now) {
    if (!game) return;
    if (game.running) {
      var delta = Math.min((now - game.lastFrame) / 1000, 0.05);
      game.lastFrame = now;
      updateGame(delta, now);
      game.renderer.render(game.scene, game.camera);
    }
    window.requestAnimationFrame(animate);
  }

  function updateGame(delta, now) {
    var forward = -game.input.y + (game.keys.has('KeyW') || game.keys.has('ArrowUp') ? 1 : 0) - (game.keys.has('KeyS') || game.keys.has('ArrowDown') ? 1 : 0);
    var sideways = game.input.x + (game.keys.has('KeyD') || game.keys.has('ArrowRight') ? 1 : 0) - (game.keys.has('KeyA') || game.keys.has('ArrowLeft') ? 1 : 0);
    var magnitude = Math.hypot(forward, sideways);
    if (magnitude > 1) { forward /= magnitude; sideways /= magnitude; }
    var speed = 4.35;
    if (game.character === 'yong') speed *= 1.12;
    if (game.satiety <= 0) speed *= 0.62;
    if (effectActive('speed', now)) speed *= 1.35;
    if (effectActive('superspeed', now)) speed *= 1.7;
    if (effectActive('timegem', now)) speed *= 1.45;
    var sin = Math.sin(game.yaw);
    var cos = Math.cos(game.yaw);
    var dx = (sideways * cos + forward * sin) * speed * delta;
    var dz = (sideways * -sin + forward * cos) * speed * delta;
    if (!game.finished) {
      moveWithCollision(dx, dz);
      if (magnitude > 0.08) {
        var drain = 0.22 * (game.character === 'dan' ? 0.65 : 1);
        game.satiety = Math.max(0, game.satiety - drain * delta);
      }
    }
    game.localAvatar.position.copy(game.position);
    game.localAvatar.rotation.y = game.yaw;
    game.localAvatar.visible = game.viewMode !== 0;
    updateCamera(delta);
    updateStations(now);
    updateWorldPickups(now);
    updateExit(now);
    updateWallEvent(now);
    updateActiveEffects(now);
    updateEngineerRestock();
    updateRemoteAvatars(delta, now);
    updateDecor(now, delta);
    updateMinimap();
    updatePlayerHud(game);
    if (!game.finished && now - game.lastPositionSent >= POSITION_INTERVAL) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'position', x: round2(game.position.x), z: round2(game.position.z), yaw: round3(game.yaw) }));
      game.lastPositionSent = now;
    }
  }

  function moveWithCollision(dx, dz) {
    var nextX = game.position.x + dx;
    if (!collides(nextX, game.position.z)) game.position.x = nextX;
    var nextZ = game.position.z + dz;
    if (!collides(game.position.x, nextZ)) game.position.z = nextZ;
  }

  function collides(x, z) {
    if (effectActive('ghost', performance.now())) return false;
    return pointCollidesWalls(x, z, game.collisions, PLAYER_RADIUS);
  }

  function updateCamera(delta) {
    var target = new THREE.Vector3(game.position.x, 1.35, game.position.z);
    var desired = new THREE.Vector3();
    if (game.viewMode === 0) {
      desired.set(game.position.x, 1.62, game.position.z);
      target.add(new THREE.Vector3(Math.sin(game.yaw) * 6, 0.1, Math.cos(game.yaw) * 6));
    } else if (game.viewMode === 1) {
      var distance = cameraBackDistance(game, 4.4);
      desired.set(game.position.x - Math.sin(game.yaw) * distance, 2.7 + Math.min(0.35, distance * 0.08), game.position.z - Math.cos(game.yaw) * distance);
    } else {
      desired.set(game.position.x, 24, game.position.z + 0.01);
      target.set(game.position.x, 0, game.position.z);
    }
    game.camera.position.lerp(desired, 1 - Math.pow(0.001, delta));
    game.camera.lookAt(target);
  }

  function updateStations(now) {
    var nearest = null;
    var nearestDistance = 2.55;
    game.stations.forEach(function (station) {
      if (!station.visible) return;
      var distance = Math.hypot(game.position.x - station.position.x, game.position.z - station.position.z);
      station.children.forEach(function (child) {
        if (child.userData.floatPart) {
          child.position.y = 1.12 + Math.sin(now * 0.003 + station.userData.index) * 0.13;
          child.rotation.y = now * 0.0015;
        }
      });
      station.scale.setScalar(1 + Math.sin(now * 0.004 + station.userData.index) * 0.025);
      if (distance < nearestDistance) { nearest = station; nearestDistance = distance; }
    });
    if (nearest !== game.nearStation) {
      game.nearStation = nearest;
      updateTicketHud();
    }
  }

  function updateWorldPickups(now) {
    if (!game.pickups) return;
    var epochNow = Date.now();
    game.pickups.forEach(function (pickup) {
      if (!pickup.visible) {
        if (pickup.userData.respawnAt && epochNow >= pickup.userData.respawnAt) {
          pickup.visible = true;
          pickup.userData.respawnAt = 0;
        }
        return;
      }
      var icon = pickup.children.find(function (child) { return child.userData.floatIcon; });
      if (icon) {
        icon.position.y = 0.72 + Math.sin(now * 0.003 + pickup.userData.phase) * 0.14;
        icon.rotation.y += 0.018;
      }
      pickup.rotation.y = Math.sin(now * 0.0007 + pickup.userData.phase) * 0.15;
      if (game.finished) return;
      if (Math.hypot(game.position.x - pickup.position.x, game.position.z - pickup.position.z) < 0.86) collectWorldPickup(pickup, epochNow);
    });
  }

  function collectWorldPickup(pickup, now) {
    pickup.visible = false;
    pickup.userData.respawnAt = now + (pickup.userData.category === 'food' ? FOOD_RESPAWN_MS : ITEM_RESPAWN_MS);
    if (pickup.userData.category === 'food') {
      var food = FOOD_DEFS[pickup.userData.kind];
      var multiplier = game.character === 'hua' ? 1.5 : 1;
      var restored = Math.round(food.restore * multiplier);
      game.satiety = Math.min(100, game.satiety + restored);
      toast('享用' + food.name + '，飽足感 +' + restored + '%', 'success', 1800);
    } else {
      addInventoryItem(pickup.userData.kind);
    }
    game.joyScore += 5;
    updatePlayerHud(game);
  }

  function updateExit(now) {
    if (!game.portal) return;
    game.portal.rotation.y = Math.sin(now * 0.0012) * 0.08;
    game.portal.children.forEach(function (child, index) {
      if (child.material && child.material.transparent) child.material.opacity = 0.26 + Math.sin(now * 0.004 + index) * 0.08;
    });
    var exitPoint = game.portal.userData.exitPoint;
    var distance = Math.hypot(game.position.x - exitPoint.x, game.position.z - exitPoint.z);
    game.nearExit = distance < 2;
    if (game.finished) return;
    if (dom.exitHintLabel && !effectActive('compass', now)) {
      dom.exitHintLabel.textContent = distance < 7 ? '春酒傳送門就在前方' : '找到舞台傳送門並持籤離開';
    }
    if (distance >= 1.48) return;
    if (!selfTicket) {
      if (now - game.lastExitWarningAt > 2800) {
        toast('傳送門需要幸運籤！請先找到發光尋籤台', 'warning', 3000);
        announceGame('先取得幸運籤，才能通過舞台傳送門');
        game.lastExitWarningAt = now;
      }
      return;
    }
    if (!game.finishRequested && send({ type: 'finish' })) {
      game.finishRequested = true;
      game.finishRequestedAt = Date.now();
      announceGame('正在確認你的完賽名次…');
    }
  }

  function announceGame(message) {
    var announcement = document.getElementById('game-announcement');
    if (!announcement) return;
    announcement.textContent = message;
    announcement.classList.add('is-visible');
    window.clearTimeout(announceGame.timer);
    announceGame.timer = window.setTimeout(function () { announcement.classList.remove('is-visible'); }, 2800);
  }

  function handlePlayerFinished(message) {
    var finishers = message.finishers || serverState.finishers || [];
    var count = message.finishCount || finishers.length || message.rank || 0;
    var total = message.total || message.participantCount || serverState.participantCount || count;
    if (isForSelf(message)) markSelfFinished(message.finishRank || message.rank || count, finishers, total);
    else toast((message.name || '一位勇者') + ' 已抵達出口，第 ' + (message.finishRank || message.rank || count) + ' 名！', 'success', 2400);
    updateFinishProgress(finishers.length ? finishers : count, total);
  }

  function markSelfFinished(rank, finishers, total) {
    if (!game) return;
    game.finished = true;
    game.finishRequested = true;
    game.finishRank = Number(rank) || 1;
    game.input.x = 0;
    game.input.y = 0;
    game.keys.clear();
    if (dom.finishOverlay) dom.finishOverlay.hidden = false;
    if (dom.finishOverlay) dom.finishOverlay.setAttribute('aria-hidden', 'false');
    if (dom.finishRank) dom.finishRank.textContent = String(game.finishRank);
    if (dom.finishWait) dom.finishWait.textContent = '籤號已保留，請等待其他勇者完成迷宮';
    updateFinishProgress(finishers, total || serverState.participantCount);
    announceGame('恭喜抵達出口！你是第 ' + game.finishRank + ' 名');
    game.fireworkBurst = 1;
    updatePlayerHud(game);
  }

  function updateFinishProgress(finishers, total) {
    var count = Array.isArray(finishers) ? finishers.length : Number(finishers) || 0;
    total = Math.max(count, Number(total) || 0);
    if (dom.finishCount) dom.finishCount.textContent = String(count);
    if (dom.finishTotal) dom.finishTotal.textContent = String(total);
    if (dom.finishProgress) dom.finishProgress.style.width = (total ? count / total * 100 : 0) + '%';
    if (dom.finishProgress && dom.finishProgress.parentElement) dom.finishProgress.parentElement.setAttribute('aria-valuenow', String(total ? Math.round(count / total * 100) : 0));
  }

  function eventTargetsSelf(message) {
    var targets = message.targetClientIds || message.targets;
    return !Array.isArray(targets) || targets.indexOf(clientId) !== -1;
  }

  function handlePartyPrank(message) {
    acknowledgeItemEvent(message, 'prank');
    if (!game || game.finished || !eventTargetsSelf(message)) return;
    var seed = hashSeed(String(message.at || message.revision || Date.now()) + clientId);
    var random = seededRandom(seed);
    var point = game.maze.points[Math.floor(random() * Math.max(1, game.maze.points.length - 2)) + 1];
    game.position.set(point.x, 0, point.z);
    toast('調皮鬼把你傳送到迷宮另一處！', 'warning', 2600);
    announceGame('調皮鬼出沒！位置已改變');
  }

  function handlePartyWhistle(message) {
    acknowledgeItemEvent(message, 'whistle');
    if (!game || game.finished || !eventTargetsSelf(message)) return;
    var sourceId = message.clientId || message.sourceClientId;
    if (sourceId === clientId) { toast('其他勇者正在向你集合', 'success'); return; }
    var source = allPlayers.get(sourceId) || {};
    var x = finite(message.x, finite(message.sourceX, finite(source.x, game.maze.spawn.x)));
    var z = finite(message.z, finite(message.sourceZ, finite(source.z, game.maze.spawn.z)));
    var candidates = game.maze.points.filter(function (point) { return Math.hypot(point.x - x, point.z - z) <= CELL_SIZE * 1.6; });
    var point = candidates[hashSeed(clientId + String(message.at || '')) % Math.max(1, candidates.length)] || nearestMazePoint(x, z);
    game.position.set(point.x, 0, point.z);
    toast('集合口哨響起，你已前往使用者附近', 'success', 2600);
    announceGame('集合口哨：勇者們集合！');
  }

  function acknowledgeItemEvent(message, kind) {
    var sourceId = message.clientId || message.sourceClientId;
    if (!game || sourceId !== clientId || game.pendingItemEvent !== kind) return;
    game.pendingItemEvent = null;
    consumeInventoryItem(kind);
  }

  function nearestMazePoint(x, z) {
    return game.maze.points.reduce(function (best, point) {
      return Math.hypot(point.x - x, point.z - z) < Math.hypot(best.x - x, best.z - z) ? point : best;
    }, game.maze.points[0]);
  }

  function normalizedStartedAt() {
    if (!startedAt) return 0;
    return startedAt < 100000000000 ? startedAt * 1000 : startedAt;
  }

  function updateWallEvent(now) {
    var start = normalizedStartedAt();
    if (!start) {
      setWallStatus('等待勇者入場');
      if (dom.wallCountdown) dom.wallCountdown.textContent = '--:--';
      return;
    }
    var elapsed = Date.now() - start;
    var lowerElapsed = elapsed - WALL_EVENT_DELAY;
    var progress = Math.max(0, Math.min(1, lowerElapsed / WALL_LOWER_DURATION));
    var factor = 1 - progress * 0.5;
    if (elapsed < WALL_EVENT_DELAY) {
      setWallStatus('迷宮變化倒數');
      if (dom.wallCountdown) dom.wallCountdown.textContent = formatClock((WALL_EVENT_DELAY - elapsed) / 1000);
    } else if (progress < 1) {
      setWallStatus('格柵牆下降中');
      if (dom.wallCountdown) dom.wallCountdown.textContent = Math.round(progress * 100) + '%';
    } else {
      setWallStatus('格柵牆已降低');
      if (dom.wallCountdown) dom.wallCountdown.textContent = '完成';
    }
    if (elapsed >= WALL_EVENT_DELAY && !game.wallEventNotified) {
      game.wallEventNotified = true;
      announceGame('宴會迷宮變化！格柵牆正在下降');
      toast('牆面下降中，碰撞路線仍保持不變', 'info', 3200);
      if (game.character === 'cat' && !game.catRouteTriggered) {
        game.catRouteTriggered = true;
        game.routeVisibleUntil = now + 6000;
        toast('尋路貓能力發動：出口路線顯示 6 秒', 'success');
      }
    }
    if (Math.abs(factor - game.wallFactor) > 0.003) updateWallMeshHeight(factor);
  }

  function updateWallMeshHeight(factor) {
    var matrix = new THREE.Matrix4();
    var quaternion = new THREE.Quaternion();
    game.collisions.forEach(function (wall) {
      if (wall.broken) matrix.makeScale(0, 0, 0);
      else matrix.compose(new THREE.Vector3(wall.x, 1.35 * factor, wall.z), quaternion, new THREE.Vector3(wall.w, 2.7 * factor, wall.d));
      game.wallMesh.setMatrixAt(wall.index, matrix);
    });
    game.wallMesh.instanceMatrix.needsUpdate = true;
    game.wallFactor = factor;
  }

  function updateActiveEffects(now) {
    Object.keys(game.effects).forEach(function (kind) {
      if (game.effects[kind].endsAt <= now) delete game.effects[kind];
    });
    var active = Object.keys(game.effects).map(function (kind) { return game.effects[kind]; }).sort(function (a, b) { return b.endsAt - a.endsAt; })[0];
    if (dom.activeItemName) dom.activeItemName.textContent = active ? active.name : '無';
    if (dom.activeItemTimer) dom.activeItemTimer.textContent = active ? Math.ceil((active.endsAt - now) / 1000) + '秒' : '';
    if (dom.activeItemBar) dom.activeItemBar.style.width = active ? Math.max(0, (active.endsAt - now) / 1000 / active.duration * 100) + '%' : '0%';
    var showRoute = effectActive('map', now) || game.routeVisibleUntil > now;
    if (showRoute && now >= game.nextRouteRefresh) {
      showExitRoute(now);
      game.nextRouteRefresh = now + 750;
    } else if (!showRoute && game.routeLine) {
      game.scene.remove(game.routeLine);
      game.routeLine.geometry.dispose();
      game.routeLine.material.dispose();
      game.routeLine = null;
      game.routePoints = null;
    }
    updateCompassHint(now);
  }

  function updateEngineerRestock() {
    if (game.character !== 'robot') {
      if (dom.skillCooldown) dom.skillCooldown.textContent = game.character === 'cat' ? '待降牆' : '被動';
      return;
    }
    var remaining = Math.max(0, game.shovelRestockAt - Date.now());
    if (game.shovelCount === 0 && game.shovelRestockAt && remaining <= 0) {
      game.shovelCount = 1;
      game.shovelRestockAt = 0;
      toast('工程師鐵鍬已補充', 'success');
    }
    if (dom.skillCooldown) dom.skillCooldown.textContent = game.shovelCount ? '鐵鍬就緒' : '補充 ' + Math.ceil(remaining / 1000) + '秒';
  }

  function formatClock(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function setWallStatus(label) {
    if (!dom.wallStatus) return;
    var text = dom.wallStatus.querySelector('span');
    if (text) text.textContent = label;
  }

  function updateCompassHint(now) {
    if (!dom.exitHintLabel || !game.portal || !effectActive('compass', now)) return;
    var exitPoint = game.portal.userData.exitPoint;
    var dx = exitPoint.x - game.position.x;
    var dz = exitPoint.z - game.position.z;
    var direction = Math.atan2(dx, dz);
    var relative = ((direction - game.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    var arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    var index = Math.round(relative / (Math.PI / 4));
    index = (index % 8 + 8) % 8;
    dom.exitHintLabel.textContent = arrows[index] + ' 出口 ' + Math.round(Math.hypot(dx, dz)) + 'm';
  }

  function showExitRoute() {
    var routePoints = findExitRoute();
    if (!routePoints.length) return;
    if (game.routeLine) {
      game.scene.remove(game.routeLine);
      game.routeLine.geometry.dispose();
      game.routeLine.material.dispose();
    }
    var vectors = [new THREE.Vector3(game.position.x, 0.09, game.position.z)].concat(routePoints.map(function (point) { return new THREE.Vector3(point.x, 0.09, point.z); }));
    var geometry = new THREE.BufferGeometry().setFromPoints(vectors);
    var material = new THREE.LineBasicMaterial({ color: game.character === 'cat' ? 0x7dffb2 : 0x55dcff, transparent: true, opacity: 0.94, depthTest: false });
    game.routeLine = new THREE.Line(geometry, material);
    game.routeLine.renderOrder = 8;
    game.routePoints = routePoints;
    game.scene.add(game.routeLine);
  }

  function findExitRoute() {
    var maze = game.maze;
    var gx = Math.max(0, Math.min(maze.width - 1, Math.floor((game.position.x - maze.originX) / CELL_SIZE)));
    var gz = Math.max(0, Math.min(maze.height - 1, Math.floor((game.position.z - maze.originZ) / CELL_SIZE)));
    var targetX = maze.width - 1;
    var targetZ = maze.height - 1;
    var queue = [[gx, gz]];
    var parent = new Map();
    parent.set(gx + ',' + gz, null);
    var directions = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
    while (queue.length) {
      var current = queue.shift();
      if (current[0] === targetX && current[1] === targetZ) break;
      directions.forEach(function (direction) {
        if (maze.cells[current[1]][current[0]].walls[direction[2]]) return;
        var nx = current[0] + direction[0];
        var nz = current[1] + direction[1];
        var key = nx + ',' + nz;
        if (nx < 0 || nz < 0 || nx >= maze.width || nz >= maze.height || parent.has(key)) return;
        parent.set(key, current);
        queue.push([nx, nz]);
      });
    }
    var key = targetX + ',' + targetZ;
    if (!parent.has(key)) return [];
    var path = [];
    var cursor = [targetX, targetZ];
    while (cursor) {
      path.push({
        x: maze.originX + cursor[0] * CELL_SIZE + CELL_SIZE / 2,
        z: maze.originZ + cursor[1] * CELL_SIZE + CELL_SIZE / 2
      });
      cursor = parent.get(cursor[0] + ',' + cursor[1]);
    }
    return path.reverse();
  }

  function updateRemoteAvatars(delta, now) {
    var nearby = Array.from(allPlayers.values()).filter(function (player) {
      return now - player.seenAt < 15000 && Number.isFinite(player.x) && Number.isFinite(player.z);
    }).sort(function (a, b) {
      return distanceSquared(a, game.position) - distanceSquared(b, game.position);
    }).slice(0, REMOTE_LIMIT);
    var nearbyLabel = document.getElementById('nearby-count');
    if (nearbyLabel) nearbyLabel.textContent = '附近 ' + nearby.length + ' 人';
    var visibleIds = new Set();
    nearby.forEach(function (player) {
      visibleIds.add(player.clientId);
      var mesh = game.remoteMeshes.get(player.clientId);
      if (!mesh) {
        mesh = createAvatar(player.character || 'lion-gold', false);
        mesh.position.set(player.x, 0, player.z);
        game.scene.add(mesh);
        game.remoteMeshes.set(player.clientId, mesh);
      }
      mesh.visible = true;
      mesh.position.lerp(new THREE.Vector3(player.x, 0, player.z), 1 - Math.pow(0.02, delta));
      mesh.rotation.y = interpolateAngle(mesh.rotation.y, player.yaw, 1 - Math.pow(0.03, delta));
    });
    game.remoteMeshes.forEach(function (mesh, id) {
      if (!visibleIds.has(id)) mesh.visible = false;
    });
  }

  function distanceSquared(player, position) {
    var dx = player.x - position.x;
    var dz = player.z - position.z;
    return dx * dx + dz * dz;
  }

  function interpolateAngle(from, to, amount) {
    var difference = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
    return from + difference * amount;
  }

  function updateDecor(now, delta) {
    var lanterns = game.decor.userData.lanterns || [];
    lanterns.forEach(function (lantern) { lantern.scale.y = 1.18 + Math.sin(now * 0.002 + lantern.userData.phase) * 0.05; });
    var lion = game.decor.userData.lion;
    if (lion) lion.position.y = 0.65 + Math.sin(now * 0.003) * 0.08;
    var fireworks = game.fireworks;
    if (game.fireworkBurst > 0) {
      resetFireworks(fireworks);
      game.fireworkBurst = 0;
    }
    if (fireworks.age < 3.2) {
      fireworks.age += delta;
      var array = fireworks.points.geometry.attributes.position.array;
      for (var i = 0; i < fireworks.velocities.length; i += 1) {
        var velocity = fireworks.velocities[i];
        array[i * 3] += velocity.x * delta;
        array[i * 3 + 1] += velocity.y * delta;
        array[i * 3 + 2] += velocity.z * delta;
        velocity.y -= 4.8 * delta;
      }
      fireworks.points.material.opacity = Math.max(0, 1 - fireworks.age / 3.2);
      fireworks.points.geometry.attributes.position.needsUpdate = true;
    }
  }

  function resetFireworks(fireworks) {
    var random = seededRandom((Date.now() ^ hashSeed(roomId)) >>> 0);
    var originX = game.position.x + (random() - 0.5) * 12;
    var originZ = game.position.z + (random() - 0.5) * 12;
    var array = fireworks.points.geometry.attributes.position.array;
    fireworks.velocities.forEach(function (velocity, index) {
      array[index * 3] = originX;
      array[index * 3 + 1] = 8 + random() * 3;
      array[index * 3 + 2] = originZ;
      var angle = random() * Math.PI * 2;
      var lift = random() * Math.PI;
      var speed = 2 + random() * 5;
      velocity.set(Math.cos(angle) * Math.sin(lift) * speed, Math.cos(lift) * speed + 2.5, Math.sin(angle) * Math.sin(lift) * speed);
    });
    fireworks.age = 0;
    fireworks.points.material.opacity = 1;
    fireworks.points.geometry.attributes.position.needsUpdate = true;
  }

  function celebratePickup() {
    if (game) game.fireworkBurst = 1;
  }

  function updateMinimap() {
    if (!dom.minimap || !game) return;
    var rect = dom.minimap.getBoundingClientRect();
    var width = Math.max(120, Math.round(rect.width || 160));
    var height = Math.max(80, Math.round(rect.height || 110));
    var ratio = Math.min(window.devicePixelRatio || 1, 1.35);
    if (dom.minimap.width !== Math.round(width * ratio) || dom.minimap.height !== Math.round(height * ratio)) {
      dom.minimap.width = Math.round(width * ratio);
      dom.minimap.height = Math.round(height * ratio);
    }
    var ctx = dom.minimap.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(24,5,15,.86)';
    ctx.fillRect(0, 0, width, height);
    var scale = Math.min((width - 12) / (GRID_W * CELL_SIZE), (height - 12) / (GRID_H * CELL_SIZE));
    var offsetX = (width - GRID_W * CELL_SIZE * scale) / 2;
    var offsetZ = (height - GRID_H * CELL_SIZE * scale) / 2;
    function mapX(x) { return offsetX + (x - game.maze.originX) * scale; }
    function mapZ(z) { return offsetZ + (z - game.maze.originZ) * scale; }
    ctx.strokeStyle = 'rgba(255,204,105,.5)';
    ctx.lineWidth = 1;
    game.collisions.forEach(function (wall) {
      ctx.strokeRect(mapX(wall.minX), mapZ(wall.minZ), Math.max(1, (wall.maxX - wall.minX) * scale), Math.max(1, (wall.maxZ - wall.minZ) * scale));
    });
    game.stations.forEach(function (station) {
      if (!station.visible) return;
      ctx.fillStyle = '#ffd85e';
      ctx.beginPath(); ctx.arc(mapX(station.position.x), mapZ(station.position.z), 1.8, 0, Math.PI * 2); ctx.fill();
    });
    if (game.portal) {
      ctx.fillStyle = '#ff8a39';
      ctx.fillRect(mapX(game.portal.position.x) - 3, mapZ(game.portal.position.z) - 3, 6, 6);
    }
    if (effectActive('map', performance.now())) {
      game.pickups.forEach(function (pickup) {
        if (!pickup.visible) return;
        ctx.fillStyle = pickup.userData.category === 'food' ? '#78ff8d' : '#64e9ff';
        ctx.beginPath(); ctx.arc(mapX(pickup.position.x), mapZ(pickup.position.z), 1.5, 0, Math.PI * 2); ctx.fill();
      });
    }
    if (game.routePoints && game.routePoints.length) {
      ctx.strokeStyle = '#71ffb1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mapX(game.position.x), mapZ(game.position.z));
      game.routePoints.forEach(function (point) { ctx.lineTo(mapX(point.x), mapZ(point.z)); });
      ctx.stroke();
    }
    allPlayers.forEach(function (player) {
      ctx.fillStyle = '#ff7f8c';
      ctx.beginPath(); ctx.arc(mapX(player.x), mapZ(player.z), 2, 0, Math.PI * 2); ctx.fill();
    });
    ctx.save();
    ctx.translate(mapX(game.position.x), mapZ(game.position.z));
    ctx.rotate(-game.yaw);
    ctx.fillStyle = '#73f4ff';
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-3.5, -3); ctx.lineTo(3.5, -3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function handleResize() {
    updateOrientation();
    if (!game || !dom.canvas) return;
    var rect = dom.canvas.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width || window.innerWidth));
    var height = Math.max(1, Math.round(rect.height || window.innerHeight));
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    game.renderer.setSize(width, height, false);
    game.camera.aspect = width / height;
    game.camera.updateProjectionMatrix();
  }

  function round2(value) { return Math.round(value * 100) / 100; }
  function round3(value) { return Math.round(value * 1000) / 1000; }

  function restoreProfile() {
    var profile = loadStoredProfile();
    if (!profile || !dom.playerName || !dom.employeeId) return;
    dom.playerName.value = profile.name;
    dom.employeeId.value = profile.employeeId;
    var choice = document.querySelector('[name="character"][value="' + profile.character + '"]');
    if (choice) choice.checked = true;
  }

  function init() {
    cacheDom();
    bindInterface();
    restoreProfile();
    initialRoute();
    updateOrientation();
    ['home-room-id', 'game-room-id'].forEach(function (id) {
      var element = document.getElementById(id);
      if (element) element.textContent = roomId;
    });
    document.documentElement.classList.add('app-ready');
    document.body.setAttribute('data-client-version', CLIENT_VERSION);
    document.body.setAttribute('data-room', roomId);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
