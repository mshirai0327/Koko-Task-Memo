# データ設計 — スキーマ定義

> Last updated: 2026-04-04

## タスクオブジェクト

### 現在 (v1) — localStorage

```typescript
interface Task {
  id: string;          // Date.now().toString(36) + random5chars
  text: string;        // タスクテキスト（最大120文字）
  createdAt: number;   // Unix ms タイムスタンプ
  done: boolean;       // 完了フラグ
}

// 例
{
  id: "lxyz12abc",
  text: "明日の会議の資料を確認する",
  createdAt: 1712160000000,
  done: false
}
```

ストレージキー: `kiemono_tasks_v1`  
形式: `JSON.stringify(Task[])`

---

### Phase B以降 (v2) — クラウド同期あり

```typescript
interface Task {
  id: string;          // ULID (時系列ソート可能, 衝突しない)
  text: string;        // タスクテキスト（最大120文字）
  createdAt: number;   // Unix ms タイムスタンプ
  updatedAt: number;   // 最終更新 Unix ms（同期競合解決に使用）
  done: boolean;       // 完了フラグ
  deletedAt?: number;  // ソフトデリート用（同期後に完全削除）
}
```

> **なぜ ULID か**  
> `Date.now() + random` の現行IDは衝突リスクが低いが、  
> ULID は時系列ソート可能・URL-safe・衝突なしの標準仕様。  
> マルチデバイス環境でのID衝突を完全に防ぐ。

---

## セッション（同期ID）

```typescript
interface SyncSession {
  syncId: string;      // UUID v4 — デバイスグループの識別子
  shortCode: string;   // 6桁英数字（syncIdから生成） — デバイス間転送用
  createdAt: number;   // セッション作成日時
  devices: string[];   // 登録デバイスのフィンガープリント（オプション）
}
```

### shortCode の生成

```javascript
// syncId (UUID) → 6桁コード
function generateShortCode(syncId) {
  const hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(syncId));
  return btoa(hash.slice(0, 4)).replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
}
// 例: "A3K9F2"
```

---

## Cloudflare KV ストレージ設計

### キー設計

```
tasks:{syncId}          → Task[]  (JSON)  TTL: 72h (259200s)
session:{syncId}        → SyncSession     TTL: 90日
shortcode:{shortCode}   → syncId (string) TTL: 90日
```

### 値の設計

```json
// tasks:{syncId} の値
{
  "tasks": [
    {
      "id": "01HV3K...",
      "text": "タスクテキスト",
      "createdAt": 1712160000000,
      "updatedAt": 1712160000000,
      "done": false
    }
  ],
  "updatedAt": 1712163600000
}
```

### TTL戦略

| キー | KV expirationTtl | 理由 |
|------|-----------------|------|
| `tasks:{syncId}` | 259200s (72h) | タスク自体が72hで消える |
| `session:{syncId}` | 7776000s (90日) | セッションは長期保持 |
| `shortcode:{shortCode}` | 7776000s (90日) | デバイス追加は90日以内に |

> **注意**: KV の TTL は「最後のwrite時点から」ではなく「set時点から」。  
> タスク更新のたびに TTL をリセット（上書き）する。

---

## Durable Objects スキーマ

リアルタイム同期用の DO は `syncId` ごとに1インスタンス。

```typescript
// DO の in-memory state
interface SyncState {
  tasks: Map<string, Task>;
  connectedClients: Set<WebSocket>;
  lastModified: number;
}

// クライアント → DO の操作メッセージ
type ClientMessage =
  | { type: 'sync_request'; lastSyncAt: number }
  | { type: 'task_add'; task: Task }
  | { type: 'task_update'; id: string; patch: Partial<Task> }
  | { type: 'task_delete'; id: string };

// DO → クライアントのブロードキャスト
type ServerMessage =
  | { type: 'sync_response'; tasks: Task[]; serverTime: number }
  | { type: 'task_added'; task: Task }
  | { type: 'task_updated'; id: string; patch: Partial<Task> }
  | { type: 'task_deleted'; id: string };
```

---

## 競合解決（Conflict Resolution）

Koko-Task は Last-Write-Wins (LWW) 戦略を採用。

```
競合ケース: デバイスAとデバイスBが同じタスクをオフライン中に編集した

解決策:
  updatedAt が新しい方を採用する。

理由:
  - タスクは短命（72h）
  - 「大事なデータを守る」より「シンプルに動く」を優先
  - CRDTのような複雑な実装は不要
```

### マージアルゴリズム

```typescript
function mergeTasks(local: Task[], remote: Task[]): Task[] {
  const merged = new Map<string, Task>();
  
  // ローカルを先に入れる
  for (const task of local) merged.set(task.id, task);
  
  // リモートで上書き（updatedAt が新しい場合のみ）
  for (const task of remote) {
    const existing = merged.get(task.id);
    if (!existing || task.updatedAt >= existing.updatedAt) {
      merged.set(task.id, task);
    }
  }
  
  // deletedAt があるものを除外してTTLでフィルタ
  const now = Date.now();
  return Array.from(merged.values())
    .filter(t => !t.deletedAt)
    .filter(t => now - t.createdAt < TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt);
}
```

---

## ストレージマイグレーション

```typescript
const MIGRATIONS: Record<string, (tasks: any[]) => Task[]> = {
  'kiemono_tasks_v1': (tasks) => tasks.map(t => ({
    ...t,
    updatedAt: t.createdAt,  // v1には updatedAt がないので createdAt で埋める
  })),
};

function migrateStorage() {
  for (const [oldKey, migrateFn] of Object.entries(MIGRATIONS)) {
    const raw = localStorage.getItem(oldKey);
    if (raw) {
      const migrated = migrateFn(JSON.parse(raw));
      localStorage.setItem('koko_tasks_v2', JSON.stringify(migrated));
      localStorage.removeItem(oldKey);
    }
  }
}
```
