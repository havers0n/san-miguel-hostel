<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1D9VTrUPJH7p9q_ILrzEGKZCpeYb0f4JU

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## UI replay golden (детерминированный прогон через GCS replay)

Артефакт “Step 1” зафиксирован в `replay_golden.json`.

**Как воспроизвести локально (PowerShell):**

1) Поднять proxy в режиме **replay** (читает из GCS, на промахе отдаёт 404 `replay_miss`):

```powershell
cd cloudrun-proxy
$env:PROXY_MODE="replay"
$env:DECISION_STORE_GCS_BUCKET="san-miguel-decisions-gen-lang-client-0765392891"
$env:DECISION_STORE_PREFIX="records"
npm run dev
```

2) Поднять UI в режиме **live**, но с executor'ом через proxy:

```powershell
cd ..
$env:VITE_ENGINE_MODE="live"
$env:VITE_PROXY_URL="http://localhost:8080"
npm run dev
```

3) Открыть UI с параметрами golden:

`http://localhost:5173/?seed=123&agents=6&ticks=1800`

**Ожидаемое:**
- UI показывает `STOPPED at tick 1800`
- `SIG: da5396ff`
- в логах proxy **нет** `event:"replay_miss"`

## Cloud Run: `gemini-proxy` health check

**Health check endpoint:** `GET /healthz/`

Note the trailing slash — it is required by the Cloud Run frontend behavior for this service (requests to `/healthz` may return a Google Frontend 404 and not reach the container).