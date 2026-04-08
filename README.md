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

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| バックエンド | Express 5 (Node.js) |
| データベース | SQLite (better-sqlite3 + Drizzle ORM) |
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

# データベースを初期化（SQLite ファイルが自動生成される）
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

> データベースファイルはプロジェクトルートに `data.db` として自動生成されます。  
> 環境変数による DB パス指定は現時点では未対応です。

## 管理者ログイン

初回起動時にデフォルトの管理者アカウントが自動作成されます。

| 項目 | 値 |
|------|------|
| ユーザー名 | `admin` |
| パスワード | `admin` |

> **本番運用時は必ず変更してください。**  
> 管理者パネルへは、ホーム画面下部の「管理者ログイン」リンクからアクセスできます。

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
