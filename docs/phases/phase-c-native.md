# Phase C — ネイティブアプリ展開

> ステータス: **将来計画**  
> 前提: Phase B（バックエンド同期）完了 + React + Vite 移行済み  
> コスト: 無料〜低（App Store 申請する場合は Apple Developer $99/年）

---

## 結論（先に言う）

| プラットフォーム | 採用技術 | 理由 |
|---|---|---|
| **デスクトップ** (Win/Mac/Linux) | **Tauri 2.x** | 軽量・Rust・公式 GitHub Action あり |
| **モバイル** (iOS/Android) | **Capacitor 6** | 実績豊富・Vanilla JS/React 両対応・プラグイン成熟 |
| **ブラウザ** | PWA (現行) | そのまま継続 |

**Tauri でモバイルをやらない理由:** Tauri 2.0 はモバイル対応が2024年10月に GA になったばかりで、プラグインエコシステムがまだ Capacitor より 1〜2年遅れている。ソロ開発でモバイルは Capacitor が圧倒的に楽。

---

## Phase C-1: Tauri デスクトップアプリ

### セットアップコスト: 約半日

React + Vite がすでにある場合、Tauri の追加は最小限:

```bash
npm create tauri-app@latest  # または既存プロジェクトに追加
npm run tauri dev            # 開発
npm run tauri build          # ビルド
```

### できること

| 機能 | 詳細 |
|------|------|
| ネイティブウィンドウ | OS ネイティブの見た目（タイトルバー、dock/taskbar） |
| ファイルサイズ | ~3〜10MB（Electron は ~150MB） |
| オフライン動作 | 完全動作（同期なしでも使える） |
| システムトレイ常駐 | タスク追加ショートカット設置可能 |
| ネイティブ通知 | OS のプッシュ通知と統合 |
| 自動アップデート | `tauri-plugin-updater` で GitHub Releases から自動更新 |

### `src-tauri/tauri.conf.json` の最小設定

```json
{
  "productName": "Koko-Task",
  "version": "0.1.0",
  "identifier": "com.yourname.koko-task",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Koko-Task",
      "width": 600,
      "height": 800,
      "resizable": true
    }]
  }
}
```

### GitHub Actions でクロスプラットフォームビルド

```yaml
# .github/workflows/tauri-release.yml
name: Tauri Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    permissions:
      contents: write
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Install dependencies (Ubuntu)
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Koko-Task ${{ github.ref_name }}"
          releaseDraft: false
```

`git tag v0.2.0 && git push --tags` だけで Windows (.exe/.msi) / macOS (.dmg) / Linux (.AppImage/.deb) の3種が GitHub Releases に自動アップロードされる。

---

## Phase C-2: Capacitor モバイルアプリ

### セットアップコスト: 1〜2日

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Koko-Task" "com.yourname.kokotask"
npx cap add ios
npx cap add android
```

### 同期コマンド（ビルドのたびに実行）

```bash
npm run build        # Vite で web をビルド
npx cap sync         # web ビルドを iOS/Android プロジェクトにコピー
npx cap open ios     # Xcode を開く
npx cap open android # Android Studio を開く
```

### 有用なプラグイン

```bash
npm install @capacitor/push-notifications  # プッシュ通知
npm install @capacitor/haptics             # 触覚フィードバック（タスク追加時に振動）
npm install @capacitor/app                 # フォアグラウンド/バックグラウンド検知（同期トリガー）
npm install @capacitor/network             # オフライン検知
npm install @capacitor/local-notifications # ローカル通知（将来のリマインダー）
```

### iOS ビルドとアプリ配布

| 配布方法 | 必要なもの | 難易度 |
|---------|-----------|--------|
| TestFlight（おすすめ） | Mac + Apple Developer $99/年 | 低 |
| Ad-hoc（自分のデバイスのみ） | Mac + Apple Developer + UDID登録 | 低 |
| App Store | Mac + Apple Developer + 審査 | 高 |

**個人利用なら TestFlight が最もコスパが良い。** 最大100台まで配布可能で審査も簡易。

### Android ビルドと APK 配布

Apple と違い Android は署名済み APK をそのまま配布できる:

```yaml
# GitHub Actions で APK 自動ビルド
- name: Build Android APK
  run: |
    cd android
    ./gradlew assembleRelease
- uses: actions/upload-artifact@v4
  with:
    name: koko-task-release.apk
    path: android/app/build/outputs/apk/release/
```

GitHub Releases の Assets に APK を添付 → スマホから DL してインストール。  
（設定 → セキュリティ → 提供元不明のアプリ を許可する必要あり）

---

## ライトテーマ対応（全クライアント共通）

音声メモで「白黒・クリーム色・目に優しく」という要望があった。  
CSS 変数を使っているため、テーマ切り替えは低コストで実装可能。

### ライトテーマのカラーパレット案

| 変数 | 現在（ダーク） | ライト案（クリーム） |
|------|-------------|-----------------|
| `--bg` | `#0F0E17` | `#FDF8F0` |
| `--surface` | `#1A1828` | `#FFFEF9` |
| `--surface2` | `#242136` | `#F5EFE6` |
| `--ink` | `#FFFFFE` | `#1A1828` |
| `--ink-dim` | `#A7A5BC` | `#6B6683` |
| `--ink-ghost` | `#4A4862` | `#B8B0CC` |
| `--accent` | `#FF8906` | `#E07400`（少し暗く） |
| `--accent2` | `#E53170` | `#CC1E5F` |
| `--done` | `#2CB67D` | `#1E9B68` |

### 実装方針

```css
/* デフォルト: OS 設定に従う */
@media (prefers-color-scheme: light) {
  :root { /* ライトテーマ変数 */ }
}

/* ユーザーが手動で選択した場合 */
[data-theme="light"] { /* ライトテーマ変数 */ }
[data-theme="dark"]  { /* ダークテーマ変数 */ }
```

---

## Phase C 完了の定義

### C-1 デスクトップ
- [ ] `npm run tauri build` でビルド成功
- [ ] GitHub Actions でクロスプラットフォームリリース自動化
- [ ] 自動アップデート動作確認

### C-2 モバイル
- [ ] `npx cap sync` で iOS/Android プロジェクト同期
- [ ] TestFlight で iOS 動作確認
- [ ] Android APK で動作確認
- [ ] 触覚フィードバック（タスク追加時）動作確認

### 共通
- [ ] ライトテーマ実装・OS設定に自動追従
- [ ] テーマ手動切り替えUI追加
