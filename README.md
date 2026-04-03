# Koko-Task

`Koko-Task` は、72時間で消える個人用 ToDo アプリの静的フロントです。  
このリポジトリでは Docker / nginx の配信基盤だけを整えています。アプリ本体が入ると、そのまま静的ホスティングできます。

## できること

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

## 補足

今の時点ではアプリ本体の静的ファイルがまだ揃っていないため、Dockerfile はフォールバックページでも起動できるようにしてあります。  
`index.html` や `assets/` などが追加されると、自動的にそれらを配信します。
