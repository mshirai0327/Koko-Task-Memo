# Architecture Overview — Koko-Task

> Last updated: 2026-04-04

## 全体像

Koko-Task は「消えること前提」のパーソナル ToDoアプリ。  
設計の根幹は **軽さ・楽しさ・マルチデバイス** の3点。

```
┌─────────────────────────────────────────────────┐
│                  クライアント                      │
│                                                   │
│   ブラウザ (PWA)  ─── Tauri (デスクトップ)        │
│                   \── Capacitor (モバイル)         │
│                                                   │
│   ┌──────────────────────────────────────┐        │
│   │  React + Vite (将来) / Vanilla JS (現在)│      │
│   │  ローカルキャッシュ (localStorage/IndexedDB)│   │
│   └──────────────────────────────────────┘        │
│                    │ HTTPS / WebSocket             │
└────────────────────┼────────────────────────────── ┘
                     │
┌────────────────────┼────────────────────────────── ┐
│              バックエンド (将来)                    │
│                    │                               │
│   Cloudflare Workers (API + WebSocket ハブ)        │
│   Cloudflare Durable Objects (リアルタイム同期)    │
│   Cloudflare KV (タスクストレージ / TTL付き)       │
└─────────────────────────────────────────────────── ┘
```

---

## フェーズ定義

| フェーズ | 名称 | 同期 | クライアント | コスト |
|---------|------|------|-------------|--------|
| **現在** | Static PWA | localStorage のみ（デバイス間なし） | ブラウザ | 無料 |
| **Phase A** | PWA 完成 | localStorage + オフライン対応強化 | ブラウザ（インストール可） | 無料 |
| **Phase B** | マルチデバイス同期 | Cloudflare Workers + DO | ブラウザ / デスクトップ | ほぼ無料 |
| **Phase C** | ネイティブ展開 | Phase B と同じ | デスクトップ + モバイル | 無料〜低 |

---

## 設計上の決断

### 認証戦略: 匿名セッション

ユーザー登録・パスワードは**作らない**。  
代わりに **syncId**（UUID v4）をクライアントが生成・保持する。

```
syncId = UUID v4 (例: 7f3a1b2c-...)
```

- 初回アクセス時に生成、localStorage + Cookie に保存
- バックエンドは syncId をキーにタスクを管理
- 別デバイスへの移行: **6桁の短縮コード** or **QRコード** で syncId を転送
- セキュリティモデル: syncId を知っている = 本人とみなす（シンプルなシークレットトークン）

> **なぜ email/パスワードを使わないか**  
> アプリのコンセプトが「気軽に使う・忘れてもいい」であるため、  
> ログイン画面という摩擦は根本思想に反する。

### ストレージ戦略: オフラインファースト

```
操作 → ローカルストレージ（即時反映）
     → バックグラウンドでサーバー同期（非同期）
```

ネット接続がなくても使える。オンライン復帰時に同期。

### TTL戦略: クライアント + サーバー二重管理

| レイヤー | 実装 |
|---------|------|
| クライアント | `createdAt` から72h経過で表示削除 |
| Cloudflare KV | `expirationTtl: 259200`（72h）で自動削除 |
| Durable Object | DO内のタスクも72h後に自動 evict |

---

## 技術スタック（全フェーズ）

| カテゴリ | 現在 | Phase B以降 |
|---------|------|-------------|
| フロントエンド | Vanilla HTML/CSS/JS | React 18 + Vite |
| スタイリング | CSS変数 + custom animations | 同左（踏襲） |
| ストレージ（ローカル） | localStorage | IndexedDB (idb-keyval) |
| ストレージ（クラウド） | なし | Cloudflare KV |
| リアルタイム同期 | なし | Cloudflare Durable Objects + WebSocket |
| API | なし | Cloudflare Workers (Hono) |
| デスクトップ | なし | Tauri 2.x |
| モバイル | PWA (制限あり) | Capacitor 6.x (React) |
| CI/CD | GitHub Actions → Pages | 同左 + GitHub Releases |

---

## ディレクトリ構成（Phase B以降の想定）

```
koko-task/
├── apps/
│   ├── web/                 # React + Vite (PWA)
│   │   ├── src/
│   │   ├── public/
│   │   └── vite.config.ts
│   └── desktop/             # Tauri wrapper
│       └── src-tauri/
├── packages/
│   └── core/                # 共有ロジック (タスク操作, TTL計算)
├── workers/                 # Cloudflare Workers
│   ├── api/                 # REST API (Hono)
│   └── sync/                # Durable Objects (WebSocket)
└── docs/                    # このドキュメント群
```

---

## 非機能要件

| 要件 | 目標値 |
|------|--------|
| 初期ロード | < 1s（PWAキャッシュヒット時: < 200ms） |
| タスク同期遅延 | < 500ms（WebSocket使用時） |
| オフライン動作 | 完全動作（追加・完了・削除すべて） |
| データ保持 | 72h（TTL経過後は消えることを保証） |
| 対応ブラウザ | モダンブラウザ（Chrome/Firefox/Safari/Edge 最新2世代） |
