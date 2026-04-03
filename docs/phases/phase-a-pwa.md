# Phase A — PWA 完成

> ステータス: **ほぼ完成**（sw.js + manifest.webmanifest 実装済み）  
> コスト: 低（数時間〜1日）  
> デプロイ: GitHub Pages（現行のまま）

## 現状の評価

| 項目 | 状態 | 備考 |
|------|------|------|
| `manifest.webmanifest` | ✅ 実装済み | name/icons/display/colors 設定済み |
| `sw.js` (Service Worker) | ✅ 実装済み | Cache-First 戦略で基本動作 |
| オフライン動作 | ✅ 動作 | アセットキャッシュ済み |
| ホーム画面インストール | ✅ 可能 | Android/PC Chrome で確認推奨 |
| iOS インストール | ⚠️ 動作するが制限あり | 後述 |
| アイコン (PNG) | ❌ 未対応 | SVGのみ。iOS に PNG 必要 |
| スプラッシュスクリーン | ❌ 未設定 | `screenshots` フィールド追加推奨 |
| Background Sync | ❌ 未実装 | Phase B で実装 |

---

## やること（優先順）

### 1. PNG アイコン追加（iOS 対応に必須）

iOS Safari は SVGアイコンを `manifest.webmanifest` の icons では認識しない。  
`apple-touch-icon` として PNG が必要。

**必要なアイコンサイズ:**
```
assets/icons/
├── icon-180.png    # apple-touch-icon (iOS)
├── icon-192.png    # Android ホーム画面
└── icon-512.png    # スプラッシュ / PWAストア
```

**index.html に追加:**
```html
<link rel="apple-touch-icon" href="./assets/icons/icon-180.png">
```

**manifest.webmanifest を更新:**
```json
{
  "icons": [
    { "src": "./assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" },
    { "src": "./assets/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

### 2. Service Worker の改善

現在の `sw.js` は基本的な Cache-First 戦略。  
以下の改善を推奨:

**キャッシュバスティング:**  
現在 `CACHE_NAME = "koko-task-v1"` は手動更新が必要。  
ビルド時に自動でバージョンを埋め込む仕組みを検討（Phase B/Vite移行時に対応）。

**Stale-While-Revalidate 戦略（フォントなど）:**
```javascript
// Google Fonts は SWR で
if (event.request.url.includes('fonts.googleapis.com')) {
  event.respondWith(staleWhileRevalidate(event.request));
}
```

### 3. `screenshots` メタデータ追加（インストール促進）

Chrome はスクリーンショットがある場合、リッチなインストールダイアログを表示する。

```json
{
  "screenshots": [
    {
      "src": "./assets/screenshots/desktop.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide"
    },
    {
      "src": "./assets/screenshots/mobile.png", 
      "sizes": "390x844",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ]
}
```

### 4. `theme_color` のダイナミック切り替え（ライトテーマ対応時）

```html
<!-- ダークテーマ -->
<meta name="theme-color" content="#0F0E17" media="(prefers-color-scheme: dark)">
<!-- ライトテーマ -->
<meta name="theme-color" content="#FFFFFE" media="(prefers-color-scheme: light)">
```

---

## iOS 制限について

| 機能 | iOS Safari (17+) | Android Chrome |
|------|-----------------|----------------|
| ホーム画面インストール | ✅（手動: 共有 → ホームに追加） | ✅（自動プロンプト） |
| オフライン動作 | ✅ | ✅ |
| プッシュ通知 | ✅（iOS 16.4+ かつ PWAとしてインストール済みのみ） | ✅ |
| Background Sync | ❌ 未対応 | ✅ |
| Badging API | ✅（iOS 16.4+） | ✅ |

**結論:** iOS でもホーム画面インストール + オフライン動作は問題なく動く。  
プッシュ通知は iOS 16.4+ のインストール済み PWA なら可能だが、現フェーズでは不要。

---

## GitHub Actions の現状

`.github/workflows/deploy-pages.yml` で GitHub Pages に自動デプロイ済み。  
Phase A での変更は追加ファイル（PNGアイコン）のみのため、**現行のワークフローで対応可能**。

---

## Phase A 完了の定義

- [ ] PNG アイコン3サイズ追加
- [ ] iOS での「ホームに追加」動作確認
- [ ] Android Chrome でのインストールプロンプト確認
- [ ] Lighthouse PWA スコア 90以上
