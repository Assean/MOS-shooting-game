# 零成本 WebRTC 射擊場

這是一個 2–4 人的瀏覽器射擊遊戲原型。靜態網頁可放在 GitHub Pages；Cloudflare Worker 只負責交換 WebRTC 連線資訊。連線完成後，移動與射擊資料由玩家瀏覽器直接傳送。

## 架構與限制

```text
GitHub Pages ──> Cloudflare Durable Object（房間協商）
玩家 A <──────── WebRTC DataChannel ────────> 玩家 B
```

這是朋友同樂／作品展示架構，不是競技型權威伺服器：房主與用戶端可竄改資料，且沒有 TURN 中繼。若兩位玩家的網路無法建立 P2P 連線，該組合便不能遊玩。請使用相近地區的玩家測試。

## 部署協商服務（Cloudflare 免費層）

1. 建立免費 Cloudflare 帳號。不要升級為付費方案，也不要設定付款資料。
2. 在本機安裝 Node.js LTS 後，開啟 `worker` 資料夾，執行：

   ```powershell
   npm install
   npx wrangler login
   npm run deploy
   ```

3. 記下輸出的 `https://...workers.dev` 網址。

Worker 只轉送 WebRTC 的 offer、answer 與 ICE candidate，並不承載遊戲封包。Cloudflare 的免費 Workers／Durable Objects 有每日額度；超過時服務會暫停至額度重置，因此請用於小型測試與展示。

## 部署遊戲頁面（GitHub Pages）

1. 建立 GitHub 公開儲存庫，把根目錄的 `index.html`、`style.css`、`game.js` 與 `README.md` 推送上去。
2. 在儲存庫 **Settings → Pages**，選擇從主要分支部署。
3. 開啟產生的 `https://<帳號>.github.io/<儲存庫>/` 網址。
4. 在遊戲頁輸入 Worker 網址、指定房間碼，讓朋友填入相同兩項後按「進入房間」。

同一個房間以 2–4 人為宜。遊戲狀態每 50ms 透過不可靠、非排序的 DataChannel 傳送，以避免舊移動封包造成延遲；射擊事件走可靠通道。

## 本機測試

直接以瀏覽器開啟 `index.html` 即可看到單人畫面；為讓 WebRTC 在開發環境行為一致，建議使用任一靜態檔案伺服器後，從 `http://localhost` 開啟。兩個瀏覽器視窗使用相同房間碼即可測試。
