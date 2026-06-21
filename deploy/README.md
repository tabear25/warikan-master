# Render.com デプロイ手順（非エンジニア向け）

このフォルダの設定で、Warikan Master を **Render.com** に無料公開できます。
完了するとアプリが `https://warikan-master.onrender.com` のような URL で誰でも利用できるようになります。

> 想定所要時間：**10〜15分**
> クレジットカード：**不要**（Render も Turso も無料枠で開始可能）

> ✅ **データは永続化されます（Turso を利用）**
> Render の無料プランでは永続ディスクが使えず、コンテナ内のファイルは
> 再デプロイ・再起動・スリープ復帰のたびに消えてしまいます。
> そこで本設定では、データを **Turso（無料のクラウド SQLite）** に保存します。
> データはコンテナの外にあるため、**再起動やスリープをまたいでも消えません**。
> セットアップは後述の「データの永続化（Turso）」を必ず行ってください
> （`TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN` を設定するまで本番は起動しません）。

---

## このフォルダにあるもの

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | アプリをコンテナとしてビルドするレシピ。Render はこれを読んでビルドします。 |
| `render.yaml` | Render の設定ファイル（無料プラン＋Turso 永続化・サービス定義・環境変数）。 |
| `README.md` | 本書。 |

リポジトリのルートに `.dockerignore` も追加してあります（不要ファイルをビルドから除外するため）。

---

## デプロイ手順

### 1. GitHub にコードを Push しておく

すでにこのリポジトリ（`tabear25/warikan-master`）が GitHub にあるので OK です。
このブランチ（または main）に変更が反映されていることを確認してください。

### 2. Render アカウントを作成

1. <https://render.com> にアクセスし、「Get Started」から **GitHub アカウントでサインアップ** します。
2. メール認証を済ませます。

### 3. Blueprint からサービスを作成

1. Render ダッシュボード右上の **「New +」→「Blueprint」** をクリック。
2. 「Connect a repository」で `warikan-master` リポジトリを選択。
   - 初回は GitHub の連携許可ダイアログが出るので、`tabear25/warikan-master` へのアクセスを許可してください。
3. Blueprint ファイルのパスを聞かれたら **`deploy/render.yaml`** を指定（自動検出されることもあります）。
4. 環境変数の入力を求められます（`render.yaml` で `sync: false` のため）。
   - `ADMIN_USERNAME`：管理者のユーザー名。`admin` や `root` などの推測されやすい値は使えません。
   - `ADMIN_PASSWORD`：管理者のパスワード。**8文字以上**で推測されにくい値にしてください。
   - `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`：データ保存先（後述の「データの永続化（Turso）」で取得した値）。
   - 入力欄が出ない場合は、サービス作成後に **「Environment」** タブから追加します。
5. 「Apply」をクリック。

> 先に下の「**データの永続化（Turso）**」を済ませて URL とトークンを用意しておくとスムーズです。
> これらが未設定のままだと、起動時の DB 接続に失敗してデプロイが立ち上がりません。

Render が `deploy/Dockerfile` を使ってビルドを開始します。
**初回ビルドは数分**ほどかかります（ネイティブビルドが不要になったため、以前より高速です）。

### 4. デプロイ完了を待つ

ダッシュボードの **「Logs」** タブでビルド・起動ログを確認できます。
`serving on port 10000` のようなログが出れば起動成功です。

サービスのトップに表示されている URL（例：`https://warikan-master.onrender.com`）をクリックすると、アプリにアクセスできます。

### 5. 動作確認

- トップページ（`/`）でロゴと「割り勘マスター」が表示される
- 右上の「？」アイコンから `/help` ページに遷移できる
- 「イベントを作る」から新しいイベントを作成できる
- 同じ合言葉で別ブラウザから参加できる

---

## 仕組み（簡単な解説）

- **コンテナ**: `deploy/Dockerfile` が Node.js 20 ベースの本番用イメージを作成します。
- **DB の保存先**: データは **Turso（libSQL）** のクラウドデータベースに保存されます。
  コンテナの外にあるため、再起動・再デプロイ・スリープ復帰をまたいでも消えません。
  （`TURSO_*` を設定しない場合のみ、ローカル用にコンテナ内のファイル DB へフォールバックします。）
- **環境変数**:
  - `NODE_ENV=production`：本番モードで起動。
  - `PORT=10000`：Render が外部公開するポート。
  - `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`：Turso 接続情報（Render dashboard で入力）。未設定だと DB 接続に失敗します。
  - `ADMIN_USERNAME` / `ADMIN_PASSWORD`：管理者ログイン情報（Render dashboard で入力）。未設定だと起動に失敗します。
- **起動コマンド**: `npm run db:push -- --force && node dist/index.cjs`
  - 起動時に Turso DB へスキーマを自動適用（テーブルが無ければ作成、既にあれば何もしない）。
  - その後 Express サーバーを起動。

---

## データの永続化（Turso）

データは **Turso**（無料のクラウド SQLite / libSQL）に保存します。Render の無料プランは
永続ディスクを持てずファイルが消えてしまうため、データだけをコンテナの外に置く構成です。
**月額 0 円**・クレジットカード不要で始められます。

### 手順

1. <https://turso.tech> にアクセスし、**GitHub アカウントなどで無料サインアップ**します。
2. ダッシュボードでデータベースを 1 つ作成します（名前は `warikan` など任意）。
3. 作成したデータベースの接続情報を取得します：
   - **Database URL**：`libsql://<データベース名>-<組織名>.turso.io` の形式。
   - **Auth Token**：データベースの「Tokens」などから新規発行します
     （Turso CLI を使う場合は `turso db tokens create <データベース名>`）。
4. Render ダッシュボードの **「Environment」** タブで次の 2 つを設定します：
   - `TURSO_DATABASE_URL`：手順 3 の Database URL。
   - `TURSO_AUTH_TOKEN`：手順 3 の Auth Token。
5. 保存すると Render が自動で再デプロイします。起動時に `npm run db:push` が
   Turso 上へテーブルを作成し、以降はデータが保持されます。

> これ以降、再起動・再デプロイ・スリープ復帰をまたいでも、登録したイベントや支払いは消えません。

### ローカル開発について

`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を設定しない場合は、自動的にローカルの
ファイル DB（既定 `data.db`、`DB_PATH` で変更可）にフォールバックします。
そのため Turso アカウントが無くても `npm run dev` は動きます。
本番と同じ Turso に向けたいときは、`.env` に上記 2 つを設定してください。

---

## よくある質問

### Q. 無料プランの他の制限は？
- **15 分間アクセスが無いとサービスがスリープ**し、次回アクセスで起動に 30 秒程度かかります（データは Turso にあるので消えません）。
- 月 750 時間の稼働枠。
- 帯域幅 100 GB/月。

### Q. 独自ドメインを使いたい
Render ダッシュボードの **Settings → Custom Domains** から追加できます。SSL は自動発行されます。

### Q. 管理者ログインのパスワードを変更したい
管理者の資格情報は環境変数から読み込まれます（コードにデフォルト値はありません）。
Render ダッシュボードの **「Environment」** タブで `ADMIN_USERNAME` と `ADMIN_PASSWORD`
（8文字以上・推測されにくい値）を編集し、再デプロイすると反映されます。
平文を環境変数に置きたくない場合は、代わりに `ADMIN_PASSWORD_HASH`（bcrypt ハッシュ）を設定できます。

### Q. デプロイのログに `[起動中止]` と出て起動しない
管理者の環境変数（`ADMIN_USERNAME` / `ADMIN_PASSWORD`）が未設定か、値が不正です。
ログに表示される日本語メッセージに従って、Render の **「Environment」** タブで設定し直してください。
`ADMIN_PASSWORD` は8文字以上で、`password` などの弱いパスワードは拒否されます。

### Q. ローカルでも Docker で動かしたい
リポジトリのルートで以下を実行：

```bash
docker build -f deploy/Dockerfile -t warikan-master .
# 本番と同じ Turso に接続する場合（推奨）
docker run --rm -p 10000:10000 \
  -e TURSO_DATABASE_URL=libsql://... \
  -e TURSO_AUTH_TOKEN=... \
  -e ADMIN_USERNAME=... -e ADMIN_PASSWORD=... \
  warikan-master
```

ブラウザで `http://localhost:10000` にアクセス。
`TURSO_*` を渡さない場合はコンテナ内のファイル DB（既定 `data.db`）を使います。
その場合にデータを残したいときは `DB_PATH` を別ディレクトリに向けてボリュームをマウントします：

```bash
docker run --rm -p 10000:10000 \
  -e ADMIN_USERNAME=... -e ADMIN_PASSWORD=... \
  -e DB_PATH=/data/data.db \
  -v warikan_data:/data \
  warikan-master
```

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| 起動時に DB 接続エラーで立ち上がらない | `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` が正しく設定されているか確認（URL は `libsql://...`、トークンは失効していないか）。 |
| 起動直後 500 エラー | Logs を確認。`db:push` が失敗している場合は Turso の URL・トークン・到達性（ネットワーク）を確認。 |
| データが消える | `TURSO_*` が未設定だとローカルのファイル DB にフォールバックし、Render では揮発します。Render の Environment に Turso の 2 変数が入っているか確認。 |
| ローカルで Turso に向けたい | `.env` に `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` を設定。未設定なら `data.db` を使用。 |
| URL が `https://...onrender.com` のまま | 独自ドメインは Settings から後付けで追加可能。 |
