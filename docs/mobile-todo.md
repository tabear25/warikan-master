# モバイルアプリ 残タスク（あとでやること）

`mobile/`（React Native / Expo の Android アプリ）の**機能実装は完了**しており、
TypeScript の型チェック（`cd mobile && npm run typecheck`）も通る状態です（最終コミット `1b8fc12`）。
残っているのは主に **配信・デプロイ準備**（アイコン、署名、ストア申請）と **iOS 対応**です。
このドキュメントは、それらの「あとでやらないといけないこと」を一覧化したものです。

## 残タスク一覧

| 優先度 | タスク | 状況 |
|--------|--------|------|
| 高 | アプリアイコン・スプラッシュ配置 | 未着手（Expo デフォルトのまま） |
| 高 | EAS Build / Android 署名設定 | 未着手（`eas.json`・keystore 無し） |
| 高 | Google Play Console 申請準備 | 未着手 |
| 中 | iOS 版対応 | 未着手（`app.json` に `ios` 設定無し） |
| 中 | CI（GitHub Actions）で型チェック | 未着手（`.github/` 無し） |
| 低 | APK/AAB のローカル実機ビルド検証 | 未検証 |

---

### [高] アプリアイコン・スプラッシュ配置

- **内容**: `mobile/assets/` に icon（1024×1024 PNG）とスプラッシュ画像を用意し、
  `mobile/app.json` の `expo.icon` / `expo.splash` / `expo.android.adaptiveIcon` を設定する。
- **状況**: `mobile/assets/` ディレクトリ自体が未作成。現在は Expo のデフォルトアイコン／スプラッシュで起動する。
- **関連ファイル**: `mobile/app.json`
- **デザイン流用元**: Web 版の `WaricanLogo`（¥モチーフの SVG、`client/src/pages/home.tsx` 内に定義）を PNG 化して使うと統一感が出る。

### [高] EAS Build / Android 署名設定

- **内容**: `mobile/eas.json` を作成し、`eas-cli` で Android 署名鍵（keystore）を生成・管理。
  `eas build -p android` で配信用 AAB を生成する。
- **状況**: `eas.json`・署名鍵・`google-services.json` いずれも未作成。
- **着手の起点**:
  ```bash
  cd mobile
  npm install -g eas-cli
  eas build:configure        # eas.json を生成
  eas build -p android       # AAB をクラウドビルド（要 Expo アカウント）
  ```
- **注意**: 署名鍵（keystore）はリポジトリにコミットしない。EAS の credential 管理に任せるか、安全な場所に保管する。

### [高] Google Play Console 申請準備

- **内容**: Play Console にアプリを登録し、ストアメタデータ（アプリ説明・スクリーンショット・
  プライバシーポリシー URL・コンテンツレーティング）を整備、署名鍵をアップロードする。
- **状況**: 未着手。
- **依存**: 上記「アイコン・スプラッシュ」「EAS Build / 署名」が前提。
- **アプリ識別子**: `com.warikan.master`（`mobile/app.json` の `android.package`）。配信前に最終確認すること。

### [中] iOS 版対応

- **内容**: `mobile/app.json` に `ios`（`bundleIdentifier` など）を追加し、iOS 用アイコン／スプラッシュを用意。
  `expo run:ios` または EAS の iOS ビルドで検証し、App Store 申請を行う。
- **状況**: `app.json` に `ios` キーは無し。コードは Expo / React Native で書かれているため、
  iOS 固有 API には依存しておらず、**追加は比較的容易**な見込み。
- **関連ファイル**: `mobile/app.json`、`mobile/assets/`（iOS 用アセット追加）
- **注意**: iOS のビルド・申請には Apple Developer Program（有料）と macOS 環境（または EAS）が必要。

### [中] CI（GitHub Actions）で型チェック

- **内容**: `.github/workflows/` に、`mobile/` の `npm ci && npm run typecheck`
  （必要なら `npx expo export --platform android` での Metro バンドル検証）を回すワークフローを追加する。
- **状況**: リポジトリに `.github/` ディレクトリは存在しない。
- **補足**: ネイティブビルド（APK/AAB）は CI では行わない方針（環境制約のため）。型チェックとバンドル検証までに留める。

### [低] APK/AAB のローカル実機ビルド検証

- **内容**: 実機／エミュレータでの動作確認。
  ```bash
  cd mobile
  npx expo prebuild --platform android   # android/ プロジェクトを生成
  # → Android Studio で開く、または ./android/gradlew assembleRelease
  ```
- **状況**: 未検証。
- **注意**: クラウドサンドボックスでは実行不可。**ユーザーの手元の環境（Android Studio / SDK）で実施**する。

---

## 参考（既存の前提・制約）

- この実行環境（クラウドサンドボックス）では **Android の実機/エミュレータビルドは不可**。検証できるのは
  `npm install` / `npm run typecheck` / `npx expo export` まで。実機ビルドはユーザー環境（Android Studio / EAS Build）で行う。
- Expo の API（`api.expo.dev`）はネットワークポリシーでブロックされているため、`npx expo install` は失敗する。
  Expo パッケージのバージョンは固定し、`npm install` で導入する（詳細は `.claude/CLAUDE.md` 参照）。
- セットアップ・開発・ビルドの手順は [README.md の「モバイルアプリ（Android）」節](../README.md#モバイルアプリandroid) を参照。
