# 春酒尋籤迷宮實作契約

本專案是獨立於「3D 移動迷宮」之外的春酒活動遊戲。不得讀寫或部署原專案。

## 核心體驗

- 手機優先、固定橫式；直式時顯示轉向提示，不改變遊戲狀態。
- 首頁提供三個入口：參加尋籤、主辦控制台、開啟大螢幕。
- 參加者先輸入姓名與員工編號、選擇角色，再進入本機渲染的 3D 迷宮。
- 操作沿用左側虛擬搖桿移動、右側滑動轉向，並提供第一人稱、第三人稱、俯視三種視角。
- 場景是紅金春酒宴會：燈籠、格柵迷宮、圓桌、舞台、舞獅、煙火與金色尋籤台。
- 每人同時只能持有一支籤。接近發光尋籤台後按「拾取」，才揭曉自己的籤號。
- 可放棄籤號；放棄後 10 秒回到全房間，原持有人 30 秒內不可取回同一籤。
- 主辦人可鎖定尋籤、設定獎項、依獎項抽出仍由玩家持有的籤號，並標記已領、缺席或重抽。
- 完整保留原迷宮的六種職業能力與十種通用道具；角色選單只顯示職業名稱，不顯示舊角色姓名。
- 出口是春酒舞台傳送門。參加者必須持有籤號才能出去；未持籤抵達時要明確提示先尋籤。
- 先通過出口者保留籤號並進入等待區，顯示自己名次與其他參加者完成進度，直到其他人走出。
- 房間第一位參加者加入即記錄遊戲開始時間。開始 2 分鐘後，牆面在 30 秒內平滑下降至原高度的一半，碰撞範圍不變。

## 原版職業與道具

- 疾風跑者：移動速度 +12%。
- 美食家：食物回復飽足感 ×1.5。
- 耐力王：飽足感消耗速度減少 35%。
- 小魔法師：所有限時道具效果時間 ×1.5。
- 工程師：開局 1 把鐵鍬，使用後 45 秒自動補充，最多持有 1 把。
- 尋路貓：迷宮狀態改變時顯示出口路線 6 秒；本專案在 2 分鐘降牆開始時觸發。
- 通用道具：加速藥水 8 秒、強力加速 6 秒、鐵鍬、魔法地圖 12 秒、指南針 15 秒、穿牆斗篷 5 秒、時間寶石、幸運星、調皮鬼、集合口哨。
- 食物保留原版七級回復：糖果 10%、餅乾 15%、蘋果 20%、飯糰 30%、拉麵 40%、雞腿 50%、超級便當 80%。飽足感歸零不淘汰，只會降低移動速度。
- 時間寶石在春酒版改為增加個人 15 秒「衝刺時間」；幸運星增加 100 個人歡樂分。
- 調皮鬼會請伺服器廣播，將尚未完賽的玩家隨機傳送；集合口哨會請伺服器廣播，將尚未完賽玩家集合到使用者附近。

## 效能界線

- 迷宮、碰撞、光影與特效在瀏覽器本機執行；伺服器只同步玩家摘要、位置、籤與抽獎事件。
- 位置更新最多每 250ms 一次；前端只渲染最近 10 位玩家，迷你地圖仍可顯示所有人。
- 裝置像素比上限 1.35；不使用即時陰影；牆面使用 InstancedMesh；粒子數量有固定上限。
- 同一個 Cloudflare Durable Object 代表一個房間，支援 50 人短時活動。

## 頁面與 DOM 契約

- `#home-screen`：首頁。
- `#participant-screen`：姓名、員工編號與角色選擇。
- `#game-screen`：3D canvas 與遊戲 HUD。
- `#admin-screen`：主辦控制台。
- `#display-screen`：大螢幕抽獎結果。
- `#rotate-overlay`：直式轉向提示。
- `#toast-region`：狀態訊息，使用 `aria-live="polite"`。
- `#game-canvas`、`#minimap-canvas`、`#joystick-zone`、`#action-button`、`#view-button`、`#leave-button`。
- 首頁按鈕：`#enter-participant`、`#enter-admin`、`#enter-display`。
- 參加者：`#participant-form`、`#player-name`、`#employee-id`、`[name="character"]`、`#join-room`。
- 主辦：`#admin-login-form`、`#admin-pin`、`#admin-dashboard`、`#lock-tickets`、`#unlock-tickets`、`#draw-prize`、`#reset-room`。

## WebSocket 協定

連線端點：`/ws/{roomId}`。房號只允許英數與連字號，預設 `spring-party`。

### Client → Server

- `join`: `{ type, role, clientId, name?, employeeId?, character?, pin? }`
- `position`: `{ type, x, z, yaw }`
- `claim`: `{ type, tokenId }`
- `drop`: `{ type }`
- `finish`: `{ type }`，伺服器須驗證玩家仍持籤，並回傳完賽名次。
- `item_event`: `{ type, kind }`，只接受 `prank` 或 `whistle` 並限制頻率。
- `admin_config`: `{ type, pin, prizes }`
- `admin_lock` / `admin_unlock`: `{ type, pin }`
- `admin_draw`: `{ type, pin, prizeId }`
- `admin_mark`: `{ type, pin, drawId, status }`
- `admin_reset`: `{ type, pin }`

### Server → Client

- `hello`: 伺服器版本與房號。
- `state`: 依角色裁切的完整狀態；一般玩家只收到自己的籤號，絕不收到別人的籤號。
- `positions`: 玩家位置批次。
- `ticket_claimed`、`ticket_dropped`、`ticket_available`、`draw_result`。
- `player_finished`、`party_prank`、`party_whistle`。
- `error`: `{ type, code, message }`。

## 房間資料規則

- 姓名與員工編號去除 HTML、控制字元與多餘空白，長度分別最多 24、20。
- 同一員工編號不可同時由兩個連線加入；相同 `clientId` 可重連並取回自己的狀態。
- 初始建立 80 支籤與 24 個發光尋籤台；每一支籤號唯一。
- 抽獎候選只包含仍持籤、未中獎的參加者；預設每人最多中獎一次。
- `startedAt` 在第一位參加者加入時設定；`finishers` 依伺服器收到合法 `finish` 的時間排序。
- 完賽玩家仍算持籤抽獎候選，離線或離開才會依既有規則釋放籤。
- 所有拾取、放棄、鎖定與抽獎判定以 Durable Object 為準。

## 程式分工

- `src/index.js`、`src/room-core.js`、`tests/room-core.test.mjs`：伺服器與純邏輯。
- `public/index.html`、`public/styles.css`：頁面結構與視覺。
- `public/app.js`：介面流程、WebSocket、3D 遊戲與觸控操作。
- 主工作階段負責設定、素材、整合、驗證與部署。
