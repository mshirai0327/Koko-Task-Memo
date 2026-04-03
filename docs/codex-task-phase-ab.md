# Codex Task: Koko-Task Phase A + B 実装

## プロジェクト概要

「Koko-Task」は 72時間でタスクが自動削除される個人用 ToDoアプリ。  
現在 Vanilla HTML/CSS/JS + localStorage で動作するプロトタイプが完成している。

このタスクでは以下の2つのフェーズを実装する:
- **Phase A**: PWA としての完成（PNG アイコン追加・manifest 更新）
- **Phase B**: Cloudflare Workers + KV によるマルチデバイス同期

---

## 現在のファイル構成

```
koko-task/
├── index.html                  # メインHTML（変更あり）
├── manifest.webmanifest        # 更新が必要
├── sw.js                       # Service Worker（そのまま）
├── assets/
│   ├── app.js                  # メインJS（同期ロジック追加）
│   ├── styles.css              # CSS（変更なし）
│   └── icon.svg                # SVGアイコン（存在する）
└── .github/workflows/
    └── deploy-pages.yml        # GitHub Pages デプロイ（存在する）
```

---

## Phase A: PWA 完成

### A-1. PNG アイコン生成

`assets/icon.svg` を元に以下の PNG を生成する:

```
assets/icons/
├── icon-192.png   # 192×192px
├── icon-512.png   # 512×512px
└── icon-180.png   # 180×180px（apple-touch-icon用）
```

SVG の変換は sharp や canvas を使って構わない。  
CI（GitHub Actions）での自動生成でも良い。

### A-2. `manifest.webmanifest` 更新

```json
{
  "name": "Koko-Task",
  "short_name": "Koko-Task",
  "description": "72時間で消える、軽くて楽しいパーソナルToDoアプリ",
  "lang": "ja",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#0F0E17",
  "theme_color": "#0F0E17",
  "icons": [
    { "src": "./assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" },
    { "src": "./assets/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

### A-3. `index.html` に apple-touch-icon 追加

`<head>` 内に追加:

```html
<link rel="apple-touch-icon" href="./assets/icons/icon-180.png">
```

---

## Phase B: マルチデバイス同期

### B-0. 全体構成

```
[ブラウザ / PWA]
  localStorage に syncId (UUID) を保持
  30秒ごと + 操作時に同期
      ↕ HTTPS REST
[Cloudflare Worker]  (workers/ ディレクトリに新規作成)
      ↕
[Cloudflare KV]
  キー: tasks:{syncId}
  値:   JSON (Task[])
  TTL:  expirationTtl: 259200 (72h)
```

### B-1. Worker の新規作成

以下のディレクトリ構成でWorkerを作成する:

```
workers/
├── package.json
├── wrangler.toml
├── tsconfig.json
└── src/
    └── index.ts
```

**`wrangler.toml`:**

```toml
name = "koko-task-api"
main = "src/index.ts"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "TASKS_KV"
id = "REPLACE_WITH_ACTUAL_KV_ID"
preview_id = "REPLACE_WITH_PREVIEW_KV_ID"
```

**`package.json`:**

```json
{
  "name": "koko-task-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**`src/index.ts`（完全実装）:**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  TASKS_KV: KVNamespace;
};

interface Task {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  done: boolean;
}

const TTL_SECONDS = 259200; // 72時間

const app = new Hono<{ Bindings: Bindings }>();

// CORS: GitHub Pages と localhost を許可
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'https://YOUR_GITHUB_USERNAME.github.io',  // 実際のドメインに置き換え
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
    ];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Sync-Id'],
}));

// ヘルスチェック
app.get('/', (c) => c.json({ ok: true, service: 'koko-task-api' }));

// タスク取得
app.get('/tasks/:syncId', async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: 'invalid syncId' }, 400);
  }

  const raw = await c.env.TASKS_KV.get(`tasks:${syncId}`);
  if (!raw) {
    return c.json({ tasks: [], serverTime: Date.now() });
  }

  const data = JSON.parse(raw) as { tasks: Task[]; updatedAt: number };
  
  // サーバー側でもTTL済みタスクを除外
  const now = Date.now();
  const TTL_MS = TTL_SECONDS * 1000;
  const validTasks = data.tasks.filter(t => now - t.createdAt < TTL_MS);
  
  return c.json({ tasks: validTasks, serverTime: now, updatedAt: data.updatedAt });
});

// タスク保存
app.put('/tasks/:syncId', async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: 'invalid syncId' }, 400);
  }

  const body = await c.req.json<{ tasks: Task[]; clientTime: number }>();
  if (!Array.isArray(body.tasks)) {
    return c.json({ error: 'tasks must be an array' }, 400);
  }

  // 不正なデータを除外
  const now = Date.now();
  const TTL_MS = TTL_SECONDS * 1000;
  const sanitized = body.tasks
    .filter(t => t && typeof t.id === 'string' && typeof t.text === 'string')
    .filter(t => now - t.createdAt < TTL_MS)
    .slice(0, 200); // 上限200件

  const payload = JSON.stringify({ tasks: sanitized, updatedAt: now });

  await c.env.TASKS_KV.put(`tasks:${syncId}`, payload, {
    expirationTtl: TTL_SECONDS,
  });

  return c.json({ ok: true, serverTime: now });
});

// セッション削除（オプション）
app.delete('/tasks/:syncId', async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: 'invalid syncId' }, 400);
  }

  await c.env.TASKS_KV.delete(`tasks:${syncId}`);
  return c.json({ ok: true });
});

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export default app;
```

### B-2. `assets/app.js` への同期ロジック追加

既存の `app.js` を改変する。変更箇所のみ記述する。

**定数に追加:**

```javascript
const SYNC_KEY = 'koko_sync_id';
const WORKER_URL = 'https://koko-task-api.YOUR_SUBDOMAIN.workers.dev'; // 実際のURLに置き換え
const SYNC_INTERVAL_MS = 30000; // 30秒
```

**`init()` 関数に追加:**

```javascript
function init() {
  state.tasks = loadTasks();
  state.syncId = loadOrCreateSyncId();  // 追加
  render();
  bindEvents();
  startClock();
  startSync();           // 追加
  registerServiceWorker();
}
```

**syncId の管理（新規追加）:**

```javascript
function loadOrCreateSyncId() {
  let syncId = window.localStorage.getItem(SYNC_KEY);
  if (!syncId) {
    syncId = crypto.randomUUID();
    window.localStorage.setItem(SYNC_KEY, syncId);
  }
  return syncId;
}
```

**同期ロジック（新規追加）:**

```javascript
function startSync() {
  if (!WORKER_URL || WORKER_URL.includes('YOUR_SUBDOMAIN')) return; // 未設定時はスキップ

  // 定期ポーリング
  setInterval(() => syncFromServer(), SYNC_INTERVAL_MS);

  // タブがフォーカスされた時に同期
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncFromServer();
  });

  // 初回同期
  syncFromServer();
}

async function syncFromServer() {
  try {
    const res = await fetch(`${WORKER_URL}/tasks/${state.syncId}`);
    if (!res.ok) return;
    const { tasks: remoteTasks, serverTime } = await res.json();
    mergeTasks(remoteTasks);
  } catch (e) {
    // オフライン時は無視
  }
}

async function pushToServer() {
  if (!WORKER_URL || WORKER_URL.includes('YOUR_SUBDOMAIN')) return;
  try {
    await fetch(`${WORKER_URL}/tasks/${state.syncId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: state.tasks, clientTime: Date.now() }),
    });
  } catch (e) {
    // オフライン時は無視（次回フォーカス時に同期される）
  }
}

function mergeTasks(remoteTasks) {
  if (!Array.isArray(remoteTasks) || remoteTasks.length === 0) return;

  const localMap = new Map(state.tasks.map(t => [t.id, t]));
  const remoteMap = new Map(remoteTasks.map(t => [t.id, t]));

  // マージ: updatedAt が新しい方を採用
  const merged = new Map();
  for (const [id, task] of localMap) merged.set(id, task);
  for (const [id, task] of remoteMap) {
    const existing = merged.get(id);
    if (!existing || (task.updatedAt ?? task.createdAt) >= (existing.updatedAt ?? existing.createdAt)) {
      merged.set(id, task);
    }
  }

  const now = Date.now();
  const TTL_MS = 72 * 60 * 60 * 1000;
  const next = Array.from(merged.values())
    .filter(t => now - t.createdAt < TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt);

  // 変化があった場合のみ更新
  if (JSON.stringify(next) !== JSON.stringify(state.tasks)) {
    state.tasks = next;
    persistTasks();
    render();
  }
}
```

**既存の `persistTasks()` を変更（サーバー同期を追加）:**

```javascript
function persistTasks() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  pushToServer(); // 追加
}
```

**タスクオブジェクトに `updatedAt` を追加（`handleAddTask` を変更）:**

```javascript
const task = {
  id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
  text,
  createdAt: Date.now(),
  updatedAt: Date.now(),  // 追加
  done: false,
};
```

**`updateTaskText` と `toggleTaskDone` で `updatedAt` を更新:**

```javascript
// updateTaskText 内
task.text = trimmed;
task.updatedAt = Date.now();  // 追加

// toggleTaskDone 内
task.done = !task.done;
task.updatedAt = Date.now();  // 追加
```

### B-3. 同期コード表示 UI の追加

ユーザーが別デバイスに syncId を転送するための UI。

**`index.html` に追加（`<footer>` の前）:**

```html
<!-- 同期モーダル -->
<div class="sync-modal" id="sync-modal" aria-modal="true" role="dialog" hidden>
  <div class="sync-modal__backdrop"></div>
  <div class="sync-modal__panel">
    <button class="sync-modal__close" id="sync-close" aria-label="閉じる">×</button>
    <h2 class="sync-modal__title">別のデバイスで使う</h2>
    <p class="sync-modal__desc">このコードを別のデバイスで入力すると、タスクが同期されます。</p>
    <div class="sync-code" id="sync-code-display">------</div>
    <div class="sync-modal__input-row">
      <input
        id="sync-code-input"
        class="sync-code-input"
        type="text"
        maxlength="8"
        placeholder="コードを入力"
        autocomplete="off"
        autocapitalize="characters"
      />
      <button class="sync-code-submit" id="sync-code-submit">同期する</button>
    </div>
    <p class="sync-modal__note">コードは大切に保管してください。</p>
  </div>
</div>

<!-- ヘッダーに同期ボタン追加 -->
<!-- hero セクション内の `.hero-pills` の後に追加 -->
<button class="sync-button" id="sync-open" aria-label="デバイス同期の設定">
  <span aria-hidden="true">⇄</span> 同期
</button>
```

**`assets/app.js` に同期UI のロジックを追加:**

```javascript
// syncId ↔ 表示コード の変換
function syncIdToCode(syncId) {
  // UUID から8文字の英数字コードを生成
  return syncId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// 同期モーダルの開閉
function bindSyncModal() {
  const openBtn = document.querySelector('#sync-open');
  const closeBtn = document.querySelector('#sync-close');
  const modal = document.querySelector('#sync-modal');
  const codeDisplay = document.querySelector('#sync-code-display');
  const codeInput = document.querySelector('#sync-code-input');
  const submitBtn = document.querySelector('#sync-code-submit');

  if (!openBtn || !modal) return;

  // 現在のコードを表示
  codeDisplay.textContent = syncIdToCode(state.syncId);

  openBtn.addEventListener('click', () => {
    modal.hidden = false;
  });

  closeBtn.addEventListener('click', () => {
    modal.hidden = true;
  });

  modal.querySelector('.sync-modal__backdrop').addEventListener('click', () => {
    modal.hidden = true;
  });

  submitBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 8) return;
    // コードから完全な syncId を復元するために Worker に問い合わせ
    // 簡略版: コードが一致する syncId を localStorage に保存
    applySyncCode(code);
    modal.hidden = true;
  });
}

async function applySyncCode(code) {
  // code から syncId を検索する Worker エンドポイントが必要な場合はここで呼ぶ
  // 簡略実装: 入力コードを新しい syncId プレフィックスとして扱う
  // ※ 本実装では Worker 側に GET /pair/:code エンドポイントを追加推奨
  alert('この機能は Worker 側の /pair エンドポイント実装後に有効になります');
}
```

---

## GitHub Actions への Worker デプロイ追加

`.github/workflows/deploy-pages.yml` と**別ファイル**として作成:

```yaml
# .github/workflows/deploy-worker.yml
name: Deploy Worker

on:
  push:
    branches: [main]
    paths:
      - 'workers/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: workers
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: workers/package-lock.json
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: workers
```

GitHub Secrets に `CLOUDFLARE_API_TOKEN` を設定すること。

---

## 実装後に手動で行うこと（Codexでは実行不可）

1. `wrangler kv:namespace create TASKS_KV` を実行して KV namespace ID を取得
2. `wrangler.toml` の `id` を取得した ID で更新
3. `wrangler deploy` で Worker をデプロイ
4. `app.js` の `WORKER_URL` を実際の Worker URL に更新
5. `manifest.webmanifest` の CORS オリジンを GitHub Pages の URL に更新

---

## 完了条件

### Phase A
- [ ] `assets/icons/icon-192.png`, `icon-512.png`, `icon-180.png` が存在する
- [ ] `manifest.webmanifest` に PNG アイコンが追加されている
- [ ] `index.html` に `<link rel="apple-touch-icon">` が追加されている

### Phase B
- [ ] `workers/src/index.ts` が存在し、GET/PUT/DELETE の3エンドポイントがある
- [ ] `workers/wrangler.toml` が存在する
- [ ] `assets/app.js` に `syncId` 管理・同期ロジック（`syncFromServer`, `pushToServer`, `mergeTasks`）が追加されている
- [ ] `assets/app.js` の `persistTasks()` が `pushToServer()` を呼ぶ
- [ ] タスクオブジェクトに `updatedAt` フィールドが追加されている
- [ ] `.github/workflows/deploy-worker.yml` が存在する
- [ ] 同期モーダル UI が `index.html` に追加されている（`#sync-modal`）

---

## 変更してはいけないもの

- `assets/styles.css` のカラーパレット・アニメーション定義
- `sw.js` の基本構造
- 既存のタスク機能（追加・完了・編集・削除・TTL）のロジック
- `STORAGE_KEY = 'kiemono_tasks_v1'`（localStorage のキー）
