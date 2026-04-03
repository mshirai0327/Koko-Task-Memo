# Koko-Task

`Koko-Task` は、72時間で消える個人用 ToDo アプリです。  
依存なしの静的フロントとして実装し、`nginx` コンテナでそのまま配信できるようにしてあります。

## できること

- タスクの追加 / 完了 / 編集 / 削除
- `localStorage` に保存しつつ、72時間後に自動削除
- 残り時間表示と TTL バー
- PWA 用 `manifest.webmanifest` と `service worker`
- `nginx` で静的ファイルを配信
- `/healthz` を返してコンテナ監視に対応
- `index.html`、`sw.js`、`manifest.webmanifest` はキャッシュしない
- `assets/` や一般的な静的アセットは長期キャッシュ

## ローカル実行

```bash
docker compose up --build
```

起動後に以下へアクセスします。

- `http://localhost:8080`
- `http://localhost:8080/healthz`

## Docker でのビルド

```bash
docker build -t koko-task:local .
```

## デプロイの考え方

この構成は「静的ファイルを含む Docker イメージ」をそのまま配る前提です。  
GitHub Container Registry、Fly.io、Render、Cloud Run、ECS など、コンテナを動かせる環境なら載せ替えやすいです。

本番向けには次を満たします。

- コンテナは `80` 番で待ち受け
- `healthz` が生存確認用のエンドポイントになる
- `index.html` は更新追従しやすいように no-cache
- PWA 関連ファイルは強くキャッシュしない
- `assets/` は immutable キャッシュで配信

## ファイル構成

- `index.html`: アプリ本体
- `assets/styles.css`: UI とアニメーション
- `assets/app.js`: タスク管理ロジック
- `manifest.webmanifest`, `sw.js`: PWA 用ファイル
- `Dockerfile`, `nginx.conf`, `compose.yaml`: コンテナ実行と配信設定

## 補足

Dockerfile にはフォールバックページ生成も残してありますが、現在のリポジトリでは `index.html` と `assets/` を優先してそのまま配信します。  
静的フロントなので、Docker を使わず GitHub Pages や Cloudflare Pages へ置くこともできます。
