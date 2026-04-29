# Render.com デプロイ手順（非エンジニア向け）

このフォルダの設定で、Warikan Master を **Render.com** に無料公開できます。
完了するとアプリが `https://warikan-master.onrender.com` のような URL で誰でも利用できるようになります。

> 想定所要時間：**10〜15分**
> クレジットカード：**不要**（無料プランで開始可能）

---

## このフォルダにあるもの

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | アプリをコンテナとしてビルドするレシピ。Render はこれを読んでビルドします。 |
| `render.yaml` | Render の設定ファイル（サービス定義・永続ディスク・環境変数）。 |
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
4. 「Apply」をクリック。

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
- **永続ディスク**: `render.yaml` の `disk` 設定により、`/data` に **1 GB の永続ボリューム**がマウントされます。
  SQLite の DB ファイル (`/data/data.db`) はここに保存されるため、デプロイをやり直してもデータは消えません。
- **環境変数**:
  - `NODE_ENV=production`：本番モードで起動。
  - `DB_PATH=/data/data.db`：SQLite の保存先。
  - `PORT=10000`：Render が外部公開するポート。
- **起動コマンド**: `npm run db:push -- --force && node dist/index.cjs`
  - 起動時に DB スキーマを適用（テーブルが無ければ作成、既にあれば何もしない）。
  - その後 Express サーバーを起動。

---

## よくある質問

### Q. データのバックアップは？
Render の **Disks → Snapshots** から手動スナップショットが取れます（有料プランでは自動定期取得）。
重要なデータは定期的にバックアップしてください。

### Q. 独自ドメインを使いたい
Render ダッシュボードの **Settings → Custom Domains** から追加できます。SSL は自動発行されます。

### Q. 無料プランの制限は？
- 15 分間アクセスが無いとサービスがスリープし、次回アクセスで起動に 30 秒程度かかります。
- 月 750 時間の稼働枠（1サービスなら常時稼働可能）。
- 永続ディスクは無料プランでは使えない場合があります。**有料プラン（月 $7〜）への切り替えが必要なケースがあります** — その場合は `render.yaml` の `plan: free` を `plan: starter` に変更してください。

### Q. 管理者ログインのパスワードを変更したい
現状、初期管理者は `admin / admin` です（`server/storage.ts` の `ensureDefaultAdmin`）。
本番で運用する場合は、サーバーコードでパスワードを変更してから再デプロイしてください。

### Q. ローカルでも Docker で動かしたい
リポジトリのルートで以下を実行：

```bash
docker build -f deploy/Dockerfile -t warikan-master .
docker run --rm -p 10000:10000 -v warikan_data:/data warikan-master
```

ブラウザで `http://localhost:10000` にアクセス。

---

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| ビルドが `better-sqlite3` で失敗 | Dockerfile の `python3 make g++` が入っているか確認。 |
| 起動直後 500 エラー | Logs を確認。`db:push` が失敗している場合は `/data` の権限・マウントを確認。 |
| データが消える | `render.yaml` の `disk` セクションが反映されているか確認。`/data` がマウントされていないと再起動でデータが揮発します。 |
| URL が `https://...onrender.com` のまま | 独自ドメインは Settings から後付けで追加可能。 |
