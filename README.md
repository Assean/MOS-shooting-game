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

## 本機測試

直接以瀏覽器開啟 `index.html` 即可看到單人畫面；為讓 WebRTC 在開發環境行為一致，建議使用任一靜態檔案伺服器後，從 `http://localhost` 開啟。兩個瀏覽器視窗使用相同房間碼即可測試。
