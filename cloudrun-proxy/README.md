## Cloud Run proxy: record/replay GCS store

Этот сервис проксирует `/decide` в 3 режимах:

- **`PROXY_MODE=replay`**: read-only из GCS, **404 `replay_miss`** на промахе
- **`PROXY_MODE=record`**: write-once запись результата в GCS (канонический JSON), повторные запросы читают winner из GCS
- **`PROXY_MODE=live`**: вычисляет результат (сейчас fallback), rate-limit **никогда не “отравляет”** GCS; есть in-memory TTL cache только для idempotency в рамках одного инстанса

### GCS IAM + ADC (самое важное)

В Cloud Run используется **ADC** (Application Default Credentials) из service account сервиса.

У service account должны быть права на bucket (минимально):

- **`storage.objects.get`**
- **`storage.objects.create`**

Практически: назначь на bucket роли:

- **`roles/storage.objectViewer`** (для `get`)
- **`roles/storage.objectCreator`** (для `create`)

Если прав нет, типичный симптом: локально всё “ок”, а в Cloud Run:

- replay всегда miss
- record падает 500 с `gcs_put_failed` / `gcs_get_failed`

Проверка (рекомендуется сделать один раз на каждый environment):

```bash
# 1) Узнать service account Cloud Run сервиса
gcloud run services describe gemini-proxy --region=YOUR_REGION --format="value(spec.template.spec.serviceAccountName)"

# 2) Посмотреть IAM policy bucket и убедиться что binding есть
gcloud storage buckets get-iam-policy gs://YOUR_BUCKET

# 3) При необходимости — выдать минимальные права на bucket
gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET \
  --member="serviceAccount:YOUR_SA_EMAIL" \
  --role="roles/storage.objectViewer"

gcloud storage buckets add-iam-policy-binding gs://YOUR_BUCKET \
  --member="serviceAccount:YOUR_SA_EMAIL" \
  --role="roles/storage.objectCreator"
```

Локально ADC для GCS проверяется через:

```bash
gcloud auth application-default login
```

### Smoke-проверки (реально ловят прод-фейлы)

Базовый smoke (без GCS):

```bash
cd cloudrun-proxy
npm run test:smoke
```

GCS smoke (требует настроенный bucket и ADC):

```bash
cd cloudrun-proxy
DECISION_STORE_GCS_BUCKET="your-bucket" PROXY_MODE=record npm run test:smoke:gcs
```

Что проверяется в `test:smoke:gcs`:

- **бит‑в‑бит** ответ для одного `requestId` (sha256 совпадает)
- **`Content-Type`** и **`Content-Length`** совпадают между miss→record и hit→replay
- **replay miss громкий**: 404 `replay_miss` + запись в логах (`event:"replay_miss"`)
- **write-once гонка**: два параллельных запроса с одинаковым `requestId` возвращают одинаковое тело (winner)


