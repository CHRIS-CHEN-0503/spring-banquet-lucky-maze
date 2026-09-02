import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const required = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/lib/three.min.js",
  "public/assets/春酒尋籤迷宮首頁-v1.webp",
  "src/index.js",
  "src/room-core.js",
  "wrangler.toml"
];

for (const relative of required) {
  await access(new URL(relative, root));
}

const html = await readFile(new URL("public/index.html", root), "utf8");
const css = await readFile(new URL("public/styles.css", root), "utf8");
const app = await readFile(new URL("public/app.js", root), "utf8");
const worker = await readFile(new URL("src/index.js", root), "utf8");
const ids = [
  "home-screen", "participant-screen", "game-screen", "admin-screen", "display-screen",
  "rotate-overlay", "toast-region", "game-canvas", "minimap-canvas", "joystick-zone",
  "action-button", "view-button", "leave-button", "participant-form", "player-name", "employee-id"
];

for (const id of ids) {
  if (!html.includes(`id="${id}"`)) throw new Error(`缺少必要 DOM id: ${id}`);
}

const referencedIds = [...app.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]);
for (const id of new Set(referencedIds)) {
  if (!html.includes(`id="${id}"`)) throw new Error(`app.js 引用了不存在的 DOM id: ${id}`);
}
if (!css.includes("@media (orientation: portrait)")) throw new Error("缺少直式轉向處理");
if (!app.includes("THREE.InstancedMesh")) throw new Error("迷宮牆面必須使用 InstancedMesh");
if (!app.includes("Math.min(window.devicePixelRatio || 1, 1.35)")) throw new Error("像素比上限未設定為 1.35");
if (!worker.includes("class SpringRoom") && !worker.includes("SpringRoom")) throw new Error("缺少 SpringRoom 匯出");

const hero = await stat(new URL("public/assets/春酒尋籤迷宮首頁-v1.webp", root));
if (hero.size > 900_000) throw new Error(`首頁圖片過大：${hero.size} bytes`);

console.log(`靜態驗證通過：${required.length} 個必要檔案、${ids.length} 個核心 DOM、${new Set(referencedIds).size} 個 JS DOM 引用，首頁圖 ${hero.size} bytes`);
