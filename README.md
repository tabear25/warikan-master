# Warikan Master — 割り勘マスター

グループ旅行・食事の割り勘を簡単に管理できる Web アプリケーション。  
支払った人がその場で自分のスマホから入力し、最後にボタンひとつで「誰が誰にいくら払えばいいか」を自動計算します。

## 主な機能

- **イベント作成** — イベント名・合言葉・メンバー名を設定
- **合言葉で参加** — メンバーは合言葉を入力するだけでアクセス（ユーザー登録不要）
- **支払い記録** — 誰が・いくら・何に支払ったかを随時入力
- **柔軟な割り勘** — 全員で割り勘 or 特定メンバーだけで割り勘をその都度選択
- **自動精算** — 最小回数の送金リストを算出するグリーディアルゴリズム
- **管理者パネル** — ID/PW 認証付き、全イベントの一覧・削除
- **Android アプリ版** — 同じバックエンドに接続するネイティブアプリ（React Native / Expo）。詳細は [モバイルアプリ（Android）](#モバイルアプリandroid) を参照

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| バックエンド | Express 5 (Node.js) |
| データベース | Turso / libSQL (@libsql/client + Drizzle ORM)。ローカルは SQLite ファイルにフォールバック |
| ルーティング | wouter (hash-based) |
| データ取得 | TanStack React Query v5 |
| バリデーション | Zod + drizzle-zod |
| ビルド | Vite 7, esbuild |

## 前提条件

- **Node.js** >= 18
- **npm** >= 9

## セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/tabear25/warikan-master.git
cd warikan-master

# 依存パッケージをインストール
npm install

# データベースを初期化（TURSO_* 未設定ならローカルの data.db が自動生成される）
npm run db:push

# 開発サーバーを起動
npm run dev
```

起動後 `http://localhost:5000` でアクセスできます。

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（Express + Vite HMR） |
| `npm run build` | 本番ビルド（`dist/` に出力） |
| `npm start` | 本番サーバー起動 |
| `npm run check` | TypeScript 型チェック |
| `npm run db:push` | Drizzle でスキーマを DB に反映 |

## 本番デプロイ

```bash
npm run build
npm start
```

`dist/index.cjs` が Express サーバー、`dist/public/` が静的ファイルです。  
ポートはデフォルト `5000`（`PORT` 環境変数で変更可能）。

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `PORT` | `5000` | サーバーのリッスンポート |
| `NODE_ENV` | — | `development` で Vite HMR 有効、`production` で静的ファイル配信 |
| `TURSO_DATABASE_URL` | — | Turso/libSQL の接続 URL（`libsql://...`）。本番でのデータ永続化に使用 |
| `TURSO_AUTH_TOKEN` | — | Turso の認証トークン |
| `DB_PATH` | `data.db` | `TURSO_*` 未設定時に使うローカル SQLite ファイルのパス |

> 本番では **Turso（クラウド SQLite / libSQL）** にデータを保存します（Render 無料プランでも
> 再起動・スリープでデータが消えません）。セットアップ手順は
> [`deploy/README.md`](deploy/README.md) の「データの永続化（Turso）」を参照してください。  
> `TURSO_*` を設定しない場合は、プロジェクトルートに `data.db`（`DB_PATH` で変更可）が
> 自動生成され、ローカル開発に使われます。

## 管理者ログイン

初回起動時にデフォルトの管理者アカウントが自動作成されます。

| 項目 | 値 |
|------|------|
| ユーザー名 | `admin` |
| パスワード | `admin` |

> **本番運用時は必ず変更してください。**  
> 管理者パネルへは、ホーム画面下部の「管理者ログイン」リンクからアクセスできます。

## モバイルアプリ（Android）

`mobile/` ディレクトリに **React Native（Expo）製の Android アプリ**があります。Web 版と同じ Express バックエンドに HTTP で接続するため、サーバー側のコードは変更不要です（React Native の `fetch` は CORS の制約を受けません）。

UI はネイティブで再実装していますが、割り勘の配分ロジック（`splitYen`）や金額表示などのロジックは Web 版と揃えています。バックエンドの URL は **別オリジン**になるため、`EXPO_PUBLIC_API_BASE` 環境変数で接続先を指定します。

### セットアップ

```bash
cd mobile
npm install

# 接続先バックエンドを設定（例：Render のデプロイ URL）
cp .env.example .env
#  .env を編集: EXPO_PUBLIC_API_BASE=https://<service>.onrender.com
```

> Android エミュレータから開発マシン上のローカルサーバー（`npm run dev`）に接続する場合は
> `EXPO_PUBLIC_API_BASE=http://10.0.2.2:5000` を使います。

### 開発（Expo）

```bash
cd mobile
npx expo start            # QR を Expo Go で読み取る、または `a` で Android エミュレータ起動
npm run typecheck         # TypeScript 型チェック
```

`EXPO_PUBLIC_*` はビルド時にインライン化されるため、`.env` を変更したら Expo を再起動してください。

### Android アプリ（APK / AAB）のビルド

この環境ではネイティブビルドは行いません。お手元の環境で以下のいずれかを実行します。

```bash
cd mobile

# A) ローカルビルド（要 Android Studio / SDK）
npx expo prebuild --platform android   # android/ プロジェクトを生成
#  → Android Studio で開く、または ./android/gradlew assembleRelease

# B) EAS Build（クラウドビルド、Expo アカウントが必要）
npm install -g eas-cli
eas build --platform android
```

> アプリアイコン / スプラッシュは未設定（Expo のデフォルト）です。`mobile/app.json` の
> `android.package`（既定 `com.warikan.master`）やアイコンは配信前に調整してください。

### mobile/ の npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm start` | Expo 開発サーバー起動 |
| `npm run android` | Android エミュレータ/実機で起動 |
| `npm run typecheck` | TypeScript 型チェック（`tsc --noEmit`） |

> 配信前の残タスク（アイコン配置・署名 / EAS Build・ストア申請・iOS 対応など）は
> [docs/mobile-todo.md](docs/mobile-todo.md) にまとめています。

## プロジェクト構成

```
warikan-master/
├── client/                  # フロントエンド
│   ├── index.html
│   └── src/
│       ├── App.tsx          # ルーティング定義
│       ├── index.css        # Tailwind + カラーパレット
│       ├── components/      # shadcn/ui コンポーネント
│       ├── pages/
│       │   ├── home.tsx           # ホーム（参加 / 作成）
│       │   ├── create-event.tsx   # イベント作成
│       │   ├── event.tsx          # イベント詳細（支払い / 精算）
│       │   ├── admin.tsx          # 管理者パネル
│       │   └── not-found.tsx      # 404
│       ├── hooks/
│       └── lib/
├── server/                  # バックエンド
│   ├── index.ts             # Express エントリポイント
│   ├── routes.ts            # API ルート + 精算アルゴリズム
│   ├── storage.ts           # DB アクセス（Drizzle ORM）
│   ├── vite.ts              # Vite 開発サーバー統合
│   └── static.ts            # 本番静的ファイル配信
├── shared/
│   └── schema.ts            # DB スキーマ + Zod バリデーション
├── mobile/                  # Android アプリ（React Native / Expo）
│   ├── app.json             # Expo 設定（アプリ名 / package / Android）
│   ├── src/
│   │   ├── App.tsx          # プロバイダ構成 + ナビゲーション
│   │   ├── api/             # HTTP クライアント（EXPO_PUBLIC_API_BASE）
│   │   ├── screens/         # Home / Create / Event / Admin / Help
│   │   ├── components/      # 共通 UI・支払いモーダル・トースト
│   │   ├── lib/             # 型・割り勘ロジック・通貨整形
│   │   └── theme/           # カラートークン + ライト/ダーク
│   └── .env.example         # EXPO_PUBLIC_API_BASE
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── drizzle.config.ts
```

## API エンドポイント

### 認証

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/admin/login` | 管理者ログイン |

### イベント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/events` | イベント作成 |
| POST | `/api/events/join` | 合言葉でイベントに参加 |
| GET | `/api/events/:id` | イベント情報取得 |
| GET | `/api/events/:id/members` | メンバー一覧 |
| GET | `/api/events/:id/payments` | 支払い一覧 |
| POST | `/api/events/:id/payments` | 支払い追加 |
| DELETE | `/api/events/:id/payments/:paymentId` | 支払い削除 |
| GET | `/api/events/:id/settlement` | 精算結果計算 |
| POST | `/api/events/:id/settle` | 精算確定 |

### 管理者専用

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/admin/events` | 全イベント一覧 |
| DELETE | `/api/admin/events/:id` | イベント削除 |

## ライセンス

MIT
