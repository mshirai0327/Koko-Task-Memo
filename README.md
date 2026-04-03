# Koko-Task

`Koko-Task` は、72時間で消える個人用 ToDo アプリです。  
依存なしの静的フロントとして実装してあり、バックエンドなしでそのまま使えます。

## できること

- タスクの追加 / 完了 / 編集 / 削除
- `localStorage` に保存しつつ、72時間後に自動削除
- 残り時間表示と TTL バー
- PWA 用 `manifest.webmanifest` と `service worker`

## バックエンドが不要な理由

今回の仕様は、次の条件に収まっているのでフロントだけで成立します。

- 個人利用で、他ユーザーとの共有がない
- タスク保存先が `localStorage`
- デバイス間同期が不要
- 通知や認証が不要

逆に、次の要件が入るならバックエンドが必要です。

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

## ファイル構成

- `index.html`: アプリ本体
- `assets/styles.css`: UI とアニメーション
- `assets/app.js`: タスク管理ロジック
- `manifest.webmanifest`, `sw.js`: PWA 用ファイル

## 補足

PWA の `service worker` は HTTPS か `localhost` で動かしてください。  
つまり本番公開は静的ホスティングに置くだけで十分です。
