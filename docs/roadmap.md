# Warikan Master ロードマップ

「アプリを最強にする」ための整備計画。Phase 1(品質・基盤の徹底強化)は
2026-07 に実装済み。以降のフェーズは優先度順の候補であり、着手時に要件を
詰め直すこと。

## Phase 1: 品質・基盤の徹底強化 — ✅ 実装済み

- vitest による単体テスト(`shared/split.ts` / `server/settlement.ts`)と
  supertest の API インテグレーションテスト(実マイグレーション適用の
  使い捨て DB。`tests/`)
- GitHub Actions CI(web: typecheck / test / build、mobile: typecheck)
- DB インデックス(各テーブルの `event_id`)+ `events.keyword` の UNIQUE 制約
- `db:push --force` の起動時実行を廃止し、生成マイグレーション
  (`migrations/`)+ 起動時 `migrate()` に移行。Dockerfile から devDeps を排除
- 管理画面イベント一覧の N+1 解消
- helmet(本番 CSP)、join 専用レートリミッタ(15回/分)、GET 一括
  リミッタ、管理 API リミッタ、join の Zod バリデーション
- エラー応答 `{ error }` への統一、本番ログからレスポンスボディを除去
- React ErrorBoundary、API エラーメッセージのパース、ルート単位の
  コード分割(初回バンドル 269KB / gzip 89KB に削減)
- favicon / OG 画像 / OGP メタタグ、ピンチズーム禁止の解除
- 未使用依存の削除(passport / express-session / ws / next-themes など)

## Phase 2: UX・機能の強化(候補)

優先度順:

1. **PWA 化** — manifest.json + サービスワーカー。ホーム画面追加と
   精算結果のオフライン閲覧。旅行先の電波が弱い場面で効く
2. **支払いの検索・フィルタ・カテゴリ** — 支払い件数が多い旅行イベントでの
   一覧性向上。`payments` にカテゴリ列(または JSON タグ)を追加
3. **レシート写真の添付** — 撮影した領収書を支払いに添付。ストレージが
   必要(Render は永続ディスクがないため Cloudflare R2 / S3 等の外部
   オブジェクトストレージ前提)
4. **iCal エクスポート** — スケジュール項目をカレンダーに取り込む
   (travel-feature-requirements.md Phase 4 より)
5. **アプリ URL 共有の改善** — 招待リンク(keyword 埋め込みの署名付き URL)
   で合言葉入力を省略

## Phase 3: モバイルアプリの完成(候補)

`docs/mobile-todo.md` と統合して進める:

1. スケジュール(旅行)機能のモバイル対応 — `EventScreen` にスケジュール
   タブ、`CreateEventScreen` にイベントタイプ・日程の選択を追加
2. アプリアイコン / スプラッシュ画面
3. EAS ビルド + 署名設定、Play Console 提出
4. iOS 対応
5. モバイル CI の拡充(expo export での Metro 検証)

## Phase 4: 多通貨・国際化(候補・規模大)

1. 通貨選択(イベント単位)と小数通貨対応 — `splitYen` の整数円前提を
   最小通貨単位(cent 等)ベースに一般化。`shared/split.ts` と
   `mobile/src/lib/split.ts` を同期して変更すること
2. タイムゾーン対応(現状 JST 固定)
3. 文言の i18n 化(現状ハードコードの日本語)

## 継続的な整備(随時)

- ESLint / Prettier(または Biome)の導入と CI への組み込み
- 管理者認証のセッション/トークン化(現状は毎リクエスト bcrypt 比較の
  ヘッダ認証。adminApiLimiter で緩和済みだが、トークン化が本筋)
- 未使用の shadcn/ui コンポーネント(recharts / embla / vaul / cmdk 等)の
  棚卸しと削除
- Zod v4 / React 19 / Express 5.x 追随などの依存更新
