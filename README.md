# Koko-Task

`Koko-Task` は、72時間で消える個人用 ToDo アプリです。  
依存なしの静的フロントとしてそのまま使えます。必要になったら、Cloudflare Workers + KV を設定してデバイス同期も有効にできます。

## できること

- タスクの追加 / 完了 / 編集 / 削除
- `localStorage` に保存しつつ、72時間後に自動削除
- 残り時間表示と TTL バー
- PWA 用 `manifest.webmanifest` と `service worker`
- Cloudflare Workers + KV を使った任意のデバイス同期

## バックエンドは任意

初期状態では、同期なしのローカル専用アプリとして動きます。  
そのため、まずはバックエンドなしで成立します。

- 個人利用で、他ユーザーとの共有がない
- タスク保存先が `localStorage`
- `WORKER_URL` を未設定のままでも使える
- 通知や認証が不要

一方で、次の要件を使いたい場合は Workers + KV を設定してください。

- 別のスマホや PC と同期したい
- ログインしたい
- 他人と共有したい
- 通知やリマインダーを送りたい

## ローカル実行

`index.html` をブラウザで開くだけでも動きます。  
PWA の確認まで含めるなら、簡単な静的サーバーで配信してください。

例:

```bash
python3 -m http.server 8080
```

その後 `http://localhost:8080` を開きます。

## デプロイ先

静的ファイルだけで動くので、次のような静的ホスティングにそのまま置けます。

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel

## GitHub Pages CI

GitHub Pages へ自動デプロイする workflow を [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) に追加しています。

動き:

- `main` に push すると GitHub Actions が起動
- `index.html`, `assets/`, `manifest.webmanifest`, `sw.js` だけを Pages 用 artifact にまとめる
- その artifact を GitHub Pages へデプロイ

最初の 1 回だけ、GitHub のリポジトリ設定で次を確認してください。

1. `Settings` → `Pages` を開く
2. `Build and deployment` の `Source` を `GitHub Actions` にする

このアプリは相対パスで組んでいるので、`https://<user>.github.io/<repo>/` のような project site 配下でもそのまま動きます。

## Cloudflare Workers + KV の設定

マルチデバイス同期を有効にするには、`workers/` 配下の Worker を Cloudflare にデプロイし、KV namespace をひも付けます。

### 1. Worker の依存を入れる

```bash
cd workers
npm ci
```

### 2. Cloudflare にログインする

ローカルから設定する場合:

```bash
npx wrangler login
```

CI からデプロイする場合は、後述の `CLOUDFLARE_API_TOKEN` を使います。

### 3. KV namespace を作る

`wrangler` の新しい CLI では `kv namespace create` 構文を使います。

```bash
npx wrangler kv namespace create TASKS_KV
npx wrangler kv namespace create TASKS_KV --preview
```

実行すると `id` と `preview_id` が表示されるので控えてください。

### 4. `wrangler.toml` に KV の ID を入れる

[`workers/wrangler.toml`](./workers/wrangler.toml) のプレースホルダを置き換えます。

```toml
[[kv_namespaces]]
binding = "TASKS_KV"
id = "YOUR_PRODUCTION_KV_ID"
preview_id = "YOUR_PREVIEW_KV_ID"
```

### 5. CORS の許可ドメインを自分の Pages URL に変える

[`workers/src/index.ts`](./workers/src/index.ts) の `allowed` にある GitHub Pages のプレースホルダを、自分の公開 URL に置き換えます。

例:

```ts
"https://YOUR_GITHUB_USERNAME.github.io"
```

を

```ts
"https://mizuho.github.io"
```

のように変更します。  
project site なら `https://<user>.github.io` の origin だけを入れれば大丈夫です。

### 6. Worker をデプロイする

```bash
npm run deploy
```

デプロイ後に `https://...workers.dev` の URL が出るので控えます。

### 7. フロント側の `WORKER_URL` を更新する

[`assets/app.js`](./assets/app.js) の `WORKER_URL` を、実際にデプロイされた Worker URL に置き換えます。

```js
const WORKER_URL = "https://koko-task-api.YOUR_SUBDOMAIN.workers.dev";
```

同期を使わない場合は、このままプレースホルダのままで構いません。  
その場合、同期処理は自動で無効化されます。

### 8. 静的サイトを再デプロイする

`WORKER_URL` を書き換えたあとは、GitHub Pages 側も再デプロイしてください。

```bash
git push
```

### 9. GitHub Actions で Worker を自動デプロイしたい場合

[`workers/`](./workers/) を更新したときに Cloudflare へ自動デプロイする workflow を [`.github/workflows/deploy-worker.yml`](./.github/workflows/deploy-worker.yml) に追加しています。

GitHub のリポジトリ Secrets に次を設定してください。

- `CLOUDFLARE_API_TOKEN`

この token には、少なくとも Worker デプロイと KV を扱える権限が必要です。

### 10. 動作確認

ローカル開発時は次で Worker を起動できます。

```bash
cd workers
npx wrangler dev
```

そのうえで静的側を別ポートで開き、タスクの追加後に Worker へ `PUT /tasks/:syncId` が飛ぶこと、別タブや別端末で同じ同期コードを入れるとタスクが見えることを確認してください。

## ファイル構成

- `index.html`: アプリ本体
- `assets/styles.css`: UI とアニメーション
- `assets/app.js`: タスク管理ロジック
- `manifest.webmanifest`, `sw.js`: PWA 用ファイル
- `workers/`: Cloudflare Workers + KV 用の同期 API

## 補足

PWA の `service worker` は HTTPS か `localhost` で動かしてください。  
同期なしで使うなら、本番公開は静的ホスティングに置くだけで十分です。  
同期を有効にする場合だけ、Cloudflare Workers + KV の設定が追加で必要です。
