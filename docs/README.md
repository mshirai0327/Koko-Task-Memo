# Koko-Task ドキュメント

> 「72時間で消える、軽くて楽しいパーソナルToDo」の設計ドキュメント群

---

## ドキュメント一覧

### アーキテクチャ

| ファイル | 内容 |
|---------|------|
| [architecture/00-overview.md](architecture/00-overview.md) | システム全体像・フェーズ定義・技術スタック・ディレクトリ構成 |
| [architecture/01-sync-strategy.md](architecture/01-sync-strategy.md) | *(TODO)* 同期方式の詳細比較（KV polling vs DO WebSocket） |

### データ設計

| ファイル | 内容 |
|---------|------|
| [data-design/01-schema.md](data-design/01-schema.md) | タスク・セッションのスキーマ定義、KVキー設計、競合解決 |
| [data-design/02-sync-protocol.md](data-design/02-sync-protocol.md) | *(TODO)* REST API 仕様・WebSocket メッセージプロトコル |

### フェーズ別実装計画

| ファイル | 内容 | ステータス |
|---------|------|-----------|
| [phases/phase-a-pwa.md](phases/phase-a-pwa.md) | PWA 完成（アイコン・SW改善・スクリーンショット） | ほぼ完成 |
| [phases/phase-b-sync.md](phases/phase-b-sync.md) | マルチデバイス同期（Cloudflare Workers + KV） | 計画中 |
| [phases/phase-c-native.md](phases/phase-c-native.md) | ネイティブアプリ（Tauri desktop + Capacitor mobile） | 将来 |

---

## クイック判断マップ

```
「今すぐ使いたい」
  → index.html をブラウザで開く。PWA として「ホームに追加」可能。

「別デバイスと同期したい」
  → Phase B を実装する（Cloudflare Workers + KV、無料）

「スマホのネイティブアプリにしたい」
  → Phase C-2 (Capacitor) を実装する（React + Vite 移行後推奨）

「デスクトップアプリにしたい」
  → Phase C-1 (Tauri) を実装する（React + Vite 移行後推奨）

「リアルタイム同期（< 1秒）がほしい」
  → Phase B の DO WebSocket 移行（$5/月 Workers 有料プラン必要）
```

---

## 現在の技術スタック

```
フロント:  Vanilla HTML/CSS/JS（単一HTMLファイル）
ストレージ: localStorage
PWA:       manifest.webmanifest + sw.js (実装済み)
デプロイ:  GitHub Actions → GitHub Pages
```

## 優先ロードマップ

```
[今] Phase A   → PNG アイコン追加（1時間）
       ↓
[次] Phase B.0 → React + Vite 移行（1日、任意）
       ↓
[次] Phase B.1 → Cloudflare Workers + KV 同期（1〜2日）
       ↓
[後] Phase C-1 → Tauri デスクトップアプリ（0.5日）
       ↓
[後] Phase C-2 → Capacitor モバイルアプリ（1〜2日）
```
