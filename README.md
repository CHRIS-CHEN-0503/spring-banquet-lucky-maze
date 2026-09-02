# 春酒尋籤迷宮

專為公司春酒抽獎活動設計的手機橫式 3D 多人尋籤遊戲。這是一個完全獨立的新專案，不共用原「3D 移動迷宮」的部署與房間資料。

## 玩法

1. 參加者輸入姓名與員工編號、選擇角色後進入紅金宴會迷宮。
2. 尋找發光金色尋籤台；每人同時只能持有一支籤。
3. 不喜歡可放棄，10 秒後籤號回到公共籤池。
4. 途中可取得原版十種道具與食物，六種職業各自保留原本能力。
5. 必須持籤才能穿過出口；先完成的人進入等待區觀看其他人抵達。
6. 遊戲開始兩分鐘後，圍牆會在 30 秒內逐步降到一半，讓後段更容易完成。
7. 主辦鎖定尋籤後，依獎項抽出仍被持有的籤號。
8. 大螢幕即時顯示中獎籤號、姓名與獎項。

## 本機開發

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

主辦 PIN 僅能放在 `.dev.vars` 或 Cloudflare Secret，不得提交到 Git。

## 驗證與部署

```bash
npm run check
npx wrangler secret put ADMIN_PIN
npm run deploy
```

## 架構

- Cloudflare Worker：靜態內容、健康檢查、WebSocket 路由。
- SQLite Durable Object：每個房間的權威狀態、籤池與抽獎紀錄。
- Three.js：本機 3D 迷宮與特效，僅同步必要多人資料。

詳細規格見 [SPEC.md](./SPEC.md)。
