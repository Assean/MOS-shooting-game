# 零成本 WebRTC 射擊場

這是一個 2–4 人的瀏覽器射擊遊戲原型。靜態網頁可放在 GitHub Pages；Cloudflare Worker 提供房間協商與資料 API。連線完成後，移動與射擊資料由玩家瀏覽器直接傳送。

## 架構與限制

```text
GitHub Pages ── HTTPS ──> Cloudflare Worker ──> D1（玩家資料／戰績）
                              │
                              └───────────────> Durable Object（房間協商）
玩家 A <──────── 加密 WebRTC DataChannel ────────> 玩家 B
```

這是朋友同樂／作品展示架構，不是競技型權威伺服器：房主與用戶端可竄改資料，且沒有 TURN 中繼。若兩位玩家的網路無法建立 P2P 連線，該組合便不能遊玩。請使用相近地區的玩家測試。

## 資料儲存與傳輸服務

| 用途 | 服務 | 傳輸方式 | 是否持久化 |
| --- | --- | --- | --- |
| 玩家識別與暱稱 | Cloudflare D1 | HTTPS JSON API | 是 |
| 未來排行榜與戰績 | Cloudflare D1 | 僅由權威服務更新 | 是 |
| 房間碼、WebRTC offer/answer/ICE | Durable Object | WSS | 否 |
| 移動、瞄準 | WebRTC DataChannel | P2P、低延遲、不保證送達 | 否 |
| 射擊等重要事件 | WebRTC DataChannel | P2P、可靠送達 | 否 |

遊戲不會把每次移動寫進資料庫。這避免 D1 延遲與寫入配額影響遊玩；WebRTC DataChannel 與 WSS 均使用加密連線。

## 部署協商與資料服務（Cloudflare 免費層）

1. 建立免費 Cloudflare 帳號。不要升級為付費方案，也不要設定付款資料。
2. 在本機安裝 Node.js LTS 後，開啟 `worker` 資料夾，執行：

   ```powershell
   npm install
   npx wrangler login
   npx wrangler d1 create mos-shooting-game
   npm run deploy
   ```

3. 將建立資料庫時回傳的 `database_id` 貼到 `worker/wrangler.toml` 的 `database_id`。
4. 套用資料表：

   ```powershell
   npx wrangler d1 migrations apply mos-shooting-game --remote
   npm run deploy
   ```

5. 記下輸出的 `https://...workers.dev` 網址。若你的 GitHub Pages 網址不是 `https://assean.github.io`，請同時在 `ALLOWED_ORIGINS` 加入它。

API 端點：`GET /api/health`、`POST /api/players`、`GET /api/leaderboard`。Worker 只轉送 WebRTC 的 offer、answer 與 ICE candidate，並不承載遊戲封包。Cloudflare 的免費 Workers／Durable Objects 有每日額度；超過時服務會暫停至額度重置，因此請用於小型測試與展示。

目前不提供從瀏覽器寫入勝負／擊殺數的端點。這是刻意的：P2P 射擊遊戲的用戶端資料可以被修改；待改為權威遊戲伺服器後，再由伺服器安全更新 D1 戰績。

## 部署遊戲頁面（GitHub Pages）

1. 建立 GitHub 公開儲存庫，把根目錄的 `index.html`、`style.css`、`game.js` 與 `README.md` 推送上去。
2. 在儲存庫 **Settings → Pages**，選擇從主要分支部署。
3. 開啟產生的 `https://<帳號>.github.io/<儲存庫>/` 網址。
4. 在遊戲頁輸入 Worker 網址、指定房間碼，讓朋友填入相同兩項後按「進入房間」。

同一個房間以 2–4 人為宜。遊戲狀態每 50ms 透過不可靠、非排序的 DataChannel 傳送，以避免舊移動封包造成延遲；射擊、命中與擊殺事件走可靠通道。每位玩家有 100 生命，受到三次命中後會隨機重生並更新房內計分。

擊殺與死亡分數目前只在 P2P 房間內同步，沒有寫入 D1。因為這個版本尚未使用權威遊戲伺服器，來自玩家瀏覽器的分數不可作為可信的永久排行榜資料。

## 兩人連線測試

先完成上方的 Cloudflare 部署，且必須先填入 D1 的 `database_id`、套用 migration，否則遊戲會在保存玩家資料時停止。接著依下列方式測試：

1. 開啟 GitHub Pages 網站。例如：`https://assean.github.io/MOS-shooting-game/`。
2. 在第一位玩家的畫面填入：
   - **協商服務網址**：Cloudflare 部署後顯示的 `https://<你的-worker>.workers.dev`
   - **房間碼**：自訂英文或數字，例如 `taipei-test-01`
   - **玩家名稱**：例如 `Player-A`
3. 按 **進入房間**。狀態應顯示「已連線至房間，正在尋找玩家…」。
4. 用第二台電腦／手機，或同一台電腦的另一個瀏覽器或無痕視窗，開啟同一個 GitHub Pages 網址。
5. 第二位玩家填入**完全相同**的 Worker 網址與房間碼，設定不同玩家名稱後按 **進入房間**。
6. 兩邊狀態顯示「已直連 1 位玩家」，右上角顯示「2 位玩家」即代表 WebRTC P2P 連線成功。

### 測試項目

| 測試 | 預期結果 |
| --- | --- |
| 移動 | 任一玩家按 WASD，另一邊在約 0.05 秒更新內看到位置變化。 |
| 瞄準 | 移動滑鼠，另一位玩家角色的槍口方向會同步。 |
| 射擊 | 左鍵射擊，對方畫面能看到黃色彈道。 |
| 命中與重生 | 近距離朝對方射擊三次，對方生命歸零、死亡數加一並隨機重生；射擊者擊殺數加一。 |
| 分房 | 讓其中一位改用另一個房間碼加入，不會再看到原房間的玩家。 |

### 快速檢查資料服務

將 Worker 網址後面加上 `/api/health` 後在瀏覽器開啟，例如：

```text
https://<你的-worker>.workers.dev/api/health
```

正確設定時會得到含有 `"ok":true` 的 JSON。若遊戲顯示「資料服務尚未完成設定」，請重新確認 `wrangler.toml` 的 D1 `database_id` 已替換、migration 已套用後再執行 `npm run deploy`。

### 常見連線問題

| 現象 | 處理方式 |
| --- | --- |
| 顯示「無法連上協商服務」 | 確認 Worker 網址以 `https://` 開頭，且 Worker 已部署成功。 |
| 只顯示「正在尋找玩家」 | 兩位玩家的房間碼必須完全相同；請先後加入同一個房間。 |
| 一直沒有「已直連」 | 可能是公司、學校或嚴格行動網路封鎖 P2P。改用另一個網路測試；此免費版本沒有 TURN 中繼。 |
| 顯示資料服務錯誤 | 確認 D1 binding、migration 與 `ALLOWED_ORIGINS` 已設定後重新部署 Worker。 |

## 本機測試

直接以瀏覽器開啟 `index.html` 即可看到單人畫面；為讓 WebRTC 在開發環境行為一致，建議使用任一靜態檔案伺服器後，從 `http://localhost` 開啟。兩個瀏覽器視窗使用相同房間碼即可測試。
