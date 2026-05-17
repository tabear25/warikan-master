# Render.com デプロイ手順（非エンジニア向け）

このフォルダの設定で、Warikan Master を **Render.com** に無料公開できます。
完了するとアプリが `https://warikan-master.onrender.com` のような URL で誰でも利用できるようになります。

> 想定所要時間：**10〜15分**
> クレジットカード：**不要**（無料プランで開始可能）

> ⚠ **無料プランの重要な制約**
> Render の無料プランでは **永続ディスクが使えません**。
> そのため、本設定では SQLite をコンテナ内のファイルシステムに置いており、
> **再デプロイ・再起動・スリープ復帰のたびに DB がリセットされます**。
> （アプリは正常に動きますが、登録したイベントや支払いは消えます。）
> データを残したい場合は後述の「データを永続化したい場合」を参照してください。

---

## このフォルダにあるもの

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | アプリをコンテナとしてビルドするレシピ。Render はこれを読んでビルドします。 |
| `render.yaml` | Render の設定ファイル（無料プラン版・サービス定義・環境変数）。 |
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
4. 管理者ログイン用の環境変数の入力を求められます（`render.yaml` で `sync: false` のため）。
   - `ADMIN_USERNAME`：管理者のユーザー名。`admin` や `root` などの推測されやすい値は使えません。
   - `ADMIN_PASSWORD`：管理者のパスワード。**8文字以上**で推測されにくい値にしてください。
   - 入力欄が出ない場合は、サービス作成後に **「Environment」** タブから同じ2つを追加します。
5. 「Apply」をクリック。

Render が `deploy/Dockerfile` を使ってビルドを開始します。
**初回ビルドは 5〜10 分**ほどかかります（`better-sqlite3` のネイティブビルドのため）。

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
- **DB の保存先（無料プラン）**: SQLite ファイルはコンテナ内 `/app/data/data.db` に保存されます。
  コンテナ再起動時にファイルシステムが初期化されるため、データは揮発します。
- **環境変数**:
  - `NODE_ENV=production`：本番モードで起動。
  - `DB_PATH=/app/data/data.db`：SQLite の保存先。
  - `PORT=10000`：Render が外部公開するポート。
  - `ADMIN_USERNAME` / `ADMIN_PASSWORD`：管理者ログイン情報（Render dashboard で入力）。未設定だと起動に失敗します。
- **起動コマンド**: `npm run db:push -- --force && node dist/index.cjs`
  - 起動時に DB スキーマを自動適用（空 DB ならテーブル作成、既にあれば何もしない）。
  - その後 Express サーバーを起動。

---

## データを永続化したい場合（有料プランへ切り替え）

無料プランで動作確認したあと、データを保持したくなったら **Starter プラン（月 $7）** に切り替えて永続ディスクを追加します。

### 手順

1. `deploy/render.yaml` を編集して以下のように変更します：

   ```yaml
   services:
     - type: web
       name: warikan-master
       runtime: docker
       plan: starter        # ← free から starter に変更
       region: singapore
       dockerfilePath: ./deploy/Dockerfile
       dockerContext: .
       healthCheckPath: /
       autoDeploy: true
       envVars:
         - key: NODE_ENV
           value: production
         - key: DB_PATH
           value: /data/data.db   # ← /app/data/data.db から /data/data.db に変更
         - key: PORT
           value: 10000
       disk:                # ← この disk ブロックを追加
         name: data
         mountPath: /data
         sizeGB: 1
   ```

2. 変更を GitHub に push すると、Render が自動でディスクを作成して再デプロイします。
3. これ以降、再起動・再デプロイをまたいでもデータが保持されます。

---

## よくある質問

### Q. 無料プランの他の制限は？
- **15 分間アクセスが無いとサービスがスリープ**し、次回アクセスで起動に 30 秒程度かかります（このタイミングで DB もリセットされます）。
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
docker run --rm -p 10000:10000 warikan-master
```

ブラウザで `http://localhost:10000` にアクセス。
ローカルでデータを残したい場合はボリュームをマウント：

```bash
docker run --rm -p 10000:10000 \
  -v warikan_data:/app/data \
  warikan-master
```

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `services[0] disks are not supported for free tier services` | 無料プランでは `disk:` ブロックは使えません。本リポジトリの `render.yaml` は無料プラン用にすでに `disk:` を外してあります。最新を pull してください。 |
| ビルドが `better-sqlite3` で失敗 | Dockerfile の `python3 make g++` が入っているか確認。 |
| 起動直後 500 エラー | Logs を確認。`db:push` が失敗している場合は `DB_PATH` のディレクトリが書き込み可能か確認。 |
| データが消える | 無料プランの仕様です。永続化したい場合は上記「データを永続化したい場合」を参照。 |
| URL が `https://...onrender.com` のまま | 独自ドメインは Settings から後付けで追加可能。 |
