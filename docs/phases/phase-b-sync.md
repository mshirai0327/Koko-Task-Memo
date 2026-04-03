# Phase B — マルチデバイス同期

> ステータス: **計画中**  
> コスト: **$0/月**（Cloudflare Workers + KV 無料枠）  
> 前提: Phase A 完了 / React + Vite への移行推奨（必須ではない）

---

## 設計方針

### 認証なし、匿名セッションで同期する

ログイン画面を作らない。メールアドレスも不要。  
代わりに **syncId**（UUID v4）を使う。

```
syncId を知っている = そのユーザー本人
```

このモデルで成立する理由:
- データは72hで消える。漏洩しても被害は軽微
- SNS/チーム機能がないため、他人のデータを見る動機がない
- 複雑な認証はアプリのコンセプト（気軽に使う）に反する

---

## アーキテクチャ

### B.1 — Workers + KV + ポーリング（推奨・無料）

```
[クライアント]
  localStorage に syncId を保持
  20〜30秒ごと、または操作時に同期
        ↕ HTTPS REST
[Cloudflare Worker]
  GET /tasks/:syncId   → KVからタスク一覧取得
  PUT /tasks/:syncId   → KVへタスク一覧保存
        ↕
[Cloudflare KV]
  キー: tasks:{syncId}
  値:   JSON (Task[])
  TTL:  259200s (72h)、書き込みのたびにリセット
```

**メリット:**
- 無料枠で十分（KV 書き込み 1,000回/日、個人利用なら絶対余る）
- 実装がシンプル
- 最大60秒の同期遅延（個人利用では問題なし）

**注意点:**
- KV は結果整合性（Eventual Consistency）— 書き込みから最大60秒で全リージョンに伝播
- 同じタスクを2デバイスで同時編集した場合は Last-Write-Wins で解決

### B.2 — Workers + Durable Objects + WebSocket（将来・$5/月〜）

```
[クライアント]
  WebSocket で常時接続
        ↕ wss://
[Cloudflare Worker + Durable Object]
  DO: syncIdごとに1インスタンス
  WebSocket でブロードキャスト
  SQLite ストレージ（DO 内蔵）
  アラームAPIでTTL管理
```

**メリット:** リアルタイム（< 100ms）  
**デメリット:** Workers 有料プラン必要（$5/月〜）、実装複雑  
**推奨:** B.1 の遅延が気になった時に移行を検討

---

## デバイス間ペアリング方法

### 推奨: 短縮コード + QR コード（組み合わせ）

1. **初回アクセス時**: `crypto.randomUUID()` で syncId を生成
2. **設定画面**（シンプルなモーダル）に以下を表示:
   - 6文字英数字の「同期コード」（例: `A3K9F2`）
   - QR コード（syncId をURLエンコード）
3. **別デバイスでコード入力** → 同じ syncId を参照 → 同期開始

```javascript
// syncId → 表示用6文字コード
function toSyncCode(syncId) {
  // syncId を base36 でエンコードして6文字に切り取り
  const num = BigInt('0x' + syncId.replace(/-/g, ''));
  return num.toString(36).toUpperCase().padStart(12, '0').slice(-6);
}
// 例: "7f3a1b2c-..." → "KM4P9X"
```

**UX フロー（イメージ）:**
```
[このデバイスの同期コード]
   ┌─────────────┐
   │  K M 4 P 9 X │  ← でかく表示
   └─────────────┘
   [QRコードを表示]

他のデバイスで入力:
   [______] [同期する]
```

---

## Cloudflare Workers 実装

### API 設計

```
GET    /tasks/:syncId        タスク一覧取得
PUT    /tasks/:syncId        タスク一覧保存（全量上書き）
DELETE /tasks/:syncId        セッション削除
GET    /pair/:shortCode      shortCode → syncId の解決
POST   /pair                 shortCode の登録
```

### `wrangler.toml`

```toml
name = "koko-task-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "TASKS_KV"
id = "your-kv-namespace-id"
```

### Worker コード（概要）

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono<{ Bindings: { TASKS_KV: KVNamespace } }>();

app.use('*', cors({ origin: 'https://your-github-pages-url' }));

// タスク取得
app.get('/tasks/:syncId', async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) return c.json({ error: 'invalid syncId' }, 400);
  
  const raw = await c.env.TASKS_KV.get(`tasks:${syncId}`);
  const tasks = raw ? JSON.parse(raw) : [];
  return c.json({ tasks });
});

// タスク保存
app.put('/tasks/:syncId', async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) return c.json({ error: 'invalid syncId' }, 400);
  
  const { tasks } = await c.req.json();
  // 72h TTL をリセット
  await c.env.TASKS_KV.put(
    `tasks:${syncId}`,
    JSON.stringify(tasks),
    { expirationTtl: 259200 }
  );
  return c.json({ ok: true });
});

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export default app;
```

---

## クライアント側の同期ロジック

### 同期戦略

```
[操作が発生したとき]
  → ローカルに即時反映（楽観的更新）
  → バックグラウンドで PUT /tasks/:syncId

[タイマー or フォーカス復帰時]
  → GET /tasks/:syncId で最新を取得
  → ローカルとマージ（Last-Write-Wins by updatedAt）
```

### オフライン対応

```javascript
// sync queue: オフライン時の操作を溜める
// Service Worker の Background Sync API で送信（Android/Desktop Chrome のみ）
// iOS は非対応なので、フォーカス復帰時のポーリングでカバー
```

---

## Cloudflare KV 無料枠の試算

| 操作 | 個人利用での推定 | 無料枠 |
|------|----------------|--------|
| 読み取り（ポーリング 30秒×2デバイス） | ~5,760回/日 | 100,000回/日 |
| 書き込み（タスク追加/更新/削除） | ~20〜50回/日 | 1,000回/日 |
| ストレージ | < 1MB | 1GB |

**結論: 無料枠の 5% も使わない。費用 $0/月。**

---

## 移行タイムライン

```
現在 (localStorage のみ)
  ↓
[Phase B.0] React + Vite 移行（任意、推奨）
  - 既存デザイン・CSS を全踏襲
  - 移行コスト: 1日
  ↓
[Phase B.1] Cloudflare Workers + KV 構築
  - Worker API 実装: 0.5日
  - クライアント同期ロジック追加: 0.5日
  - 同期コード UI（モーダル）: 0.5日
  ↓
[Phase B.2] WebSocket リアルタイム同期（オプション）
  - DO への移行: 2〜3日
  - Workers 有料プラン ($5/月) に加入
```

---

## Phase B 完了の定義

- [ ] `GET/PUT /tasks/:syncId` Worker が動作する
- [ ] syncId の生成・localStorage 保持
- [ ] 同期コード表示 UI（6文字 + QRコード）
- [ ] 別デバイスでコード入力 → 同期確認
- [ ] オフライン時にローカル操作 → オンライン復帰後に自動同期
- [ ] Lighthouse Performance スコア 90以上維持
