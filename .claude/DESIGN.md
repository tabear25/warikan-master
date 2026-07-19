# DESIGN.md — Warikan Master「SEISAN」デザインシステム v2

> 割り勘アプリ Warikan Master のデザイン仕様書。
> コンセプトは **OS ネイティブ・モダン**。iOS / Material のニュートラルな面構成
> （薄グレー地 + 白カード / ほぼ黒地 + ダークグレーカード）に、iOS systemBlue 系の
> 単色アクセントを合わせる。装飾（グラデーション・グロー・オーロラ背景）は持たない。
> すべての値は `client/src/index.css` の CSS カスタムプロパティ（セマンティックトークン）として定義され、
> Tailwind（`tailwind.config.ts`）から `hsl(var(--token) / <alpha-value>)` で参照される。

---

## 1. Visual Theme & Atmosphere

- **デザイン方針**: 金額が主役のフィンテック UI。OS の標準アプリと並べて違和感のないニュートラルさを最優先する
- **密度**: モバイルファースト（max-w-lg 中央寄せ）。カード単位の余白、本文 line-height 1.65
- **キーワード**: OS ネイティブ、システムフォント、フラット単色アクセント、ガラスヘッダー、ピル形状、1円単位の精密さ
- **特徴**:
  - ページ背景は iOS の grouped background — ライトは **薄いニュートラルグレー**、ダークは **ほぼ黒**。カードが白 / ダークグレーで浮く
  - 装飾背景は置かない（旧 `Aurora` は撤去済み。`components/aurora.tsx` は未使用）
  - ヘッダーは `.glass`（backdrop-blur + 半透明背景）のスティッキー、下端はスクロールエッジ
  - ボタンは全て **ピル（rounded-full）**。プライマリは **フラットな bg-primary 単色**（グラデーション・グローは使わない）
  - プライマリはライト・ダークとも **白文字 on ブルー**（旧テーマの反転仕様は廃止）
  - メンバーは名前から決定的に選ばれるグラデーションアバター（`MemberAvatar`）で常に同じ色
  - 入場アニメーションは framer-motion の fade-up **スプリング**（`client/src/lib/motion.ts` の `SPRING` / `SPRING_SLOW`）。`MotionConfig reducedMotion="user"` で OS 設定を尊重

---

## 2. Color Palette & Roles

### Brand

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--primary` | `211 100% 45%`（iOS systemBlue 系。白文字とのコントラスト確保のためやや深め） | `211 100% 55%`（ダーク用の明るいブルー） | CTA・アクティブ状態・リンク的テキスト |
| `--primary-foreground` | `0 0% 100%`（白） | `0 0% 100%`（白） | プライマリ面上の文字。両モードとも白 |
| `--gradient-brand` | フラット（`--primary` と同色の単色 gradient） | 同左 | 旧トークン互換のため残置。新規では `bg-primary` を使う |
| `--ring` | `211 100% 45%` | `211 100% 55%` | フォーカスリング |

### Surfaces

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--background` | `240 9% 96%`（iOS grouped bg 相当） | `240 4% 5%`（ほぼ黒） | ページ背景 |
| `--foreground` | `240 6% 10%` | `240 5% 94%` | 本文（純黒・純白は使わない） |
| `--card` / `--card-border` | `0 0% 100%` / `240 6% 91%` | `240 3% 11%`（#1C1C1E 相当） / `240 3% 15%` | カード面とヘアラインボーダー |
| `--muted` / `--muted-foreground` | `240 5% 93%` / `240 3% 42%` | `240 3% 14%` / `240 4% 64%` | 抑えた面・補助テキスト |
| `--accent` | `240 5% 92%` | `240 3% 16%` | ホバー面・薄い強調面（送金行など） |
| `--secondary` | `240 5% 94%` | `240 3% 15%` | チップ・バッジ面 |
| `--input` | `240 5% 82%` | `240 4% 24%` | 入力欄のボーダー |

### Money Semantics（重要）

金額の増減は primary / destructive を流用せず、専用トークンを使う（iOS systemGreen / systemRed 系統）。

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--positive` | `136 60% 32%` | `135 63% 52%` | 受け取り（+）、送金額、精算完了 |
| `--negative` | `3 84% 48%` | `4 100% 64%` | 支払い（−）、内訳の不一致 |
| `--destructive` | `3 84% 50%` | `4 100% 61%` | 削除などの破壊的操作専用 |

### Charts

`--chart-1〜5`: ブルー → ティール → パープル → オレンジ → ピンク（iOS システムカラーパレット）。

---

## 3. Typography Rules

### 3.1 フォントファミリ

```css
--font-sans:    system-ui, -apple-system, 'Segoe UI', Roboto, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif;
--font-display: 同上（用途エイリアス。金額・見出し英字・ステップ番号用）;
```

- **OS のシステムフォントに委ねる**（iOS = SF Pro / Android = Roboto / Windows = Yu Gothic UI 等）。apple_design §15 の原則
- Web フォントは読み込まない（`client/index.html` に Google Fonts の link を置かない）。初期表示が軽く、各 OS のネイティブアプリと同じ見た目になる
- 金額の桁揃えはフォントではなく `tabular-nums` で担保する

### 3.2 グローバル設定（body）

```css
line-height: 1.65;
letter-spacing: 0;   /* var(--tracking-normal) — OS 既定に委ねる */
font-feature-settings: "palt" 1;   /* 対応フォントのみ効く progressive enhancement */
```

- 見出し（h1–h6）: `line-height: 1.35` / `letter-spacing: -0.01em` / `font-weight: 700`
- ヒーローの見出しは `font-black`（900）+ `tracking-tight`
- トラッキングはサイズ別に設定する（Apple の optical sizing の考え方）。大きな文字ほど詰め（見出し・ヒーローはマイナス）、本文は `--tracking-normal`（0.015em）のまま。固定値を全サイズに使い回さない

### 3.3 金額の組み方

```html
<span class="money text-base font-bold tabular-nums">¥12,800</span>
```

- `.money` ユーティリティ = `font-family: var(--font-display)` + `"palt" 0, "tnum" 1` + `letter-spacing: -0.01em`
- 金額は **必ず tabular-nums で桁を揃える**。palt は数字では切る
- 受け取りは `text-positive`、支払いは `text-negative`

### 3.4 マイクロラベル

セクションの頭に英字の小ラベルを置く（例: `SPLIT BILLS, BEAUTIFULLY` / `STEP 01` / `Q1`）。

```html
<p class="font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">…</p>
```

---

## 4. Component Stylings

> 実装は `client/src/components/ui/*`（shadcn/ui ベース）と `client/src/components/*`（アプリ固有）。

### Buttons（`ui/button.tsx`）

- 形状: **rounded-full**、`font-semibold`、`active:scale-[0.97]`、フォーカスは ring-2 + offset
- `default`: `bg-primary text-primary-foreground shadow-sm`（フラット単色。グラデ・グローは使わない）
- `outline`: 半透明カード面 + `--button-outline` ヘアライン + backdrop-blur
- `ghost` / `secondary` / `destructive`: 従来どおり（hover-elevate 系ユーティリティで押下感）
- サイズ: default `min-h-10 px-5` / sm `min-h-8` / lg `min-h-12 px-8 text-base` / icon `h-9 w-9`

### Cards（`ui/card.tsx`）

- `rounded-2xl`（24px）、`border-card-border`、`shadow-sm`、padding は `p-5` 基準
- ヒーロー級のカード（参加・作成・ログイン）はページ側で `rounded-3xl` に格上げ
- 強調統計カード: `border-transparent bg-primary text-primary-foreground shadow-md`（旧 `bg-gradient-brand`/`shadow-glow` クラスもトークン側でフラットに解決される）

### Inputs / Select

- 高さ **h-11（44px）**、`rounded-xl`、面は `bg-card`
- フォーカス: `border-ring` + `ring-4 ring-ring/15`（柔らかいハロー）
- 合言葉入力は `font-display font-semibold tracking-wide`（ホームでは中央寄せ）

### Tabs（セグメンテッドコントロール）

- List: `h-12 rounded-full bg-muted/80 p-1.5`
- Trigger: `rounded-full font-semibold`、アクティブは `bg-card shadow-md`

### Badges / Chips

- `rounded-full`。メンバーチップは `variant="secondary"` + 先頭に `MemberAvatar`（h-5 w-5）
- 追加ボタン系チップは `border-dashed border-primary/40 text-primary`

### Dialog / AlertDialog / Toast

- 面: `rounded-3xl border-card-border bg-card shadow-2xl`
- オーバーレイ: `bg-black/50 backdrop-blur-sm`
- トースト: `rounded-2xl bg-card/90 backdrop-blur-lg shadow-xl`

### アプリ固有コンポーネント

| コンポーネント | 役割 |
|----------------|------|
| `AppHeader` | ガラス質スティッキーヘッダー。下端は 1px の実線ではなく **スクロールエッジ**（`.scroll-edge-b` のグラデーション）で沈める。戻る・タイトル・アクション・テーマ切替を一元管理（testid もここで固定） |
| `ResponsiveDialog` | 入力・共有系ダイアログの共通シェル。**モバイル（md 未満）はボトムシート（vaul）**、md 以上はセンターモーダル。新しいダイアログは必ずこれを使う |
| `CountUp` | 金額・件数の変化をカウントアップ表示（`render` に formatYen 等を渡す）。reduced-motion では即時表示 |
| `fireConfetti()` | `lib/confetti.ts`。依存なしの canvas 紙吹雪。**精算完了など「祝う」瞬間限定**で乱用しない |
| `WaricanLogo` / `LogoTile` | ¥ 分割モチーフのロゴ。タイルはフラットな `bg-primary` + `shadow-md` + rounded-[28%] |
| `MemberAvatar` | 名前ハッシュで 8 種のグラデーション（iOS システムカラー系統）から決定的に配色されるイニシャルアバター |
| ~~`Aurora`~~ | **v2 で撤去**。ページには置かない（`components/aurora.tsx` は未使用のまま残置） |
| `ScheduleTab` | 旅行イベントの旅程タイムライン。`DAY 01` マイクロラベル + 日付見出し、左レールは `bg-primary/10` のアイコンドット + `w-px bg-border` の縦線。カードはタップで詳細を展開 |
| `ScheduleItemDialog` | 予定の追加・編集。カテゴリ 3 択は割り勘モードと同じラジオカード、URL 貼付で OGP を自動補完（取得中はスピナー、失敗しても入力は止めない） |

---

## 5. Layout Principles

- **モバイルファースト + lg（1024px）でワイド適応**。ブレークポイントの JS 判定は `useMediaQuery`（`DESKTOP_QUERY` / `SHEET_QUERY`）で行う
- コンテンツ幅: モバイル `max-w-lg`。lg 以上ではページごとに拡張 — ホーム/作成 `lg:max-w-3xl`（カード2列）、イベント `lg:max-w-5xl`、管理画面 `max-w-3xl`。左右 padding は `px-4`
- **イベント画面は lg 以上で2カラム**: 左=支払い/旅程タブ（`minmax(0,1fr)`）、右=精算パネル 400px（`sticky top-[84px]` 常時表示、精算タブは非表示）
- モバイルの支払い一覧が4件以上のとき、右下に追加 FAB（`fixed` + safe-area offset）を出す
- ページルート: `relative isolate flex min-h-screen flex-col bg-background`（装飾背景は置かない）
- 縦リズム: セクション間 `space-y-4`、カード内 `space-y-3〜4`
- 角丸スケール: sm 8 / md 12 / lg 16 / xl 20 / 2xl 24 / 3xl 32px（Tailwind `borderRadius` を再定義）

---

## 6. Depth & Elevation

| Level | Token | 用途 |
|-------|-------|------|
| 0 | `shadow-xs` | チップ・入力欄 |
| 1 | `shadow-sm` | カード標準 |
| 2 | `shadow-md` | ホバー時のカード・アクティブタブ |
| 3 | `shadow-lg` | ヒーローカード |
| 4 | `shadow-2xl` | ダイアログ |

- 影はライト・ダークともニュートラル（無彩色）。**発光影（glow）は v2 で廃止** — `--shadow-glow` / `--shadow-glow-lg` は互換のため `--shadow-md` / `--shadow-lg` にエイリアスされている。新規では使わない
- すべて CSS 変数経由（`--shadow-*`）なのでテーマで自動的に切り替わる

---

## 7. Motion

> Apple *Designing Fluid Interfaces* の原則を基盤にする。JS アニメーションの定義は
> すべて `client/src/lib/motion.ts` に集約（`SPRING` / `SPRING_SLOW` / `SPRING_BOUNCE` / `fadeUp` / `stagger`）。

- **標準はスプリング**: `SPRING = { type: "spring", bounce: 0, duration: 0.4 }`（クリティカルダンピング＝Apple の damping 1.0 / response 0.4 相当）。ヒーロー級は `SPRING_SLOW`（0.55）。スプリングは現在値から再ターゲットされるため中断・逆転してもモーションが途切れない
- **バウンスは運動量の後だけ**: `SPRING_BOUNCE`（bounce 0.2 ＝ damping 0.8 相当）はドラッグ・フリックの解放後に限る。ただフェードインした要素を揺らさない
- 入場: `fadeUp`（`opacity 0→1, y 12→0`）+ `SPRING`。リストは `stagger(index)`（0.04–0.07s、index 上限 8）
- **退場は入場と同じパスを戻る**（空間的一貫性）: `fadeUp.exit` は `y: +8` へ加速して消える（0.18s ease-in、入場の減速の鏡像）。上方向に退場させない
- 押下: フィードバックは pointer-down の瞬間に出す。ボタンは `active:scale-[0.97]` + `active:duration-100`（押下 100ms、解放 200ms ease-out-expo）
- 数値: 金額・件数の変化は `CountUp`（0.6s, ease-out-expo）。収支バーは幅を 0→pct% にスプリングでアニメーション
- リスト増減: 支払いリストは `AnimatePresence` + `layout`（layout もスプリングを継承）
- 祝祭: 精算完了時のみ `fireConfetti()`。reduced-motion では発火しない
- **体感速度は楽観更新で作る**: 支払い・メンバーの追加/編集/削除は onMutate でキャッシュへ即時反映し、失敗時のみ巻き戻して destructive トーストで知らせる
- スケルトン: シマー（`animate-shimmer`、muted→accent の流れるグラデ）
- CSS 側のイージング: `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`（transition 用）

### アクセシビリティ（OS 設定への応答）

- `prefers-reduced-motion: reduce`: CSS アニメーション・トランジションをほぼ無効化 + `MotionConfig reducedMotion="user"` で framer の transform を止める（opacity フェードは残る）
- `prefers-reduced-transparency: reduce`: `.glass` を曇らせてほぼ不透明（blur なし）にする
- `prefers-contrast: more`: `.glass` を不透明面 + 実線ボーダーに切り替え、スクロールエッジは消す

---

## 8. Do's and Don'ts

### Do（推奨）

- 金額には `.money` + `tabular-nums` + `text-positive` / `text-negative` を使う
- プライマリ CTA は 1 画面 1 つ。`bg-primary` のフラット単色で示す
- 新しい色が必要になったら、まず `index.css` にセマンティックトークンを足してから使う
- メンバーの表示には必ず `MemberAvatar` を添える（色の一貫性が人物の識別子になる）
- 面はニュートラルに保つ。彩りはアクセント（primary）と money 色、アバターだけに限定する
- 見出しはトラッキング詰め（-0.01em）、和文本文は line-height 1.65 を守る

### Don't（禁止）

- 純黒 `#000` / 純白 `#fff` をテキスト・ページ背景に直接使わない（トークンを使う）
- 金額の色に `text-primary` / `text-destructive` を流用しない（positive / negative を使う）
- **新規にグラデーション・グロー影・装飾背景を足さない**（v2 はフラット。旧 `bg-gradient-brand` / `shadow-glow` はトークン互換で残っているだけ）
- プライマリ面に `text-white` を直書きしない（`text-primary-foreground` を使う）
- `palt` を数字に効かせたまま金額を組まない（`.money` か `tabular-nums` で切る）
- ボタン・チップに中途半端な角丸を混ぜない（インタラクティブ要素はピルで統一）
- hex 直書きでスタイルしない（テーマ切替が壊れる）
- Web フォントを追加しない（システムフォントに委ねる）

---

## 9. Agent Prompt Guide

### クイックリファレンス

```
Brand: iOS systemBlue 系 — light hsl(211 100% 45%) / dark hsl(211 100% 55%)、面はフラット単色
Text: hsl(240 6% 10%) light / hsl(240 5% 94%) dark（純黒・純白禁止）
Background: hsl(240 9% 96%) light / hsl(240 4% 5%) dark（iOS grouped bg 相当）
Money: .money + tabular-nums、+は --positive（systemGreen 系）、−は --negative（systemRed 系）
Font: system-ui スタック（SF Pro / Roboto / Yu Gothic UI 等）。Web フォント不使用
Body: line-height 1.65 / letter-spacing 0
Radius: ボタン=pill、入力=xl(20px)、カード=2xl(24px)、ダイアログ=3xl(32px)
Shadow: var(--shadow-*) ニュートラル。glow は廃止（互換エイリアスのみ）
Motion: lib/motion.ts の SPRING（spring, bounce 0, duration 0.4）+ fadeUp、active:scale-[0.97] active:duration-100
```

### プロンプト例

```
Warikan Master の「SEISAN v2」デザインシステム（OSネイティブ・モダン）に従って新しい画面を作成してください。
- ページルートは relative isolate + bg-background（装飾背景・オーロラは置かない）
- ヘッダーは <AppHeader backHref="/" title={...} />
- カードは rounded-2xl / border-card-border / shadow-sm、主役カードのみ rounded-3xl
- CTA は <Button size="lg">（フラットな bg-primary）を1画面1つまで
- 金額は .money tabular-nums、受け取り text-positive / 支払い text-negative
- メンバー表示には <MemberAvatar name={...} /> を添える
- 入場は @/lib/motion の fadeUp + SPRING（スタガーは stagger(index)）。EASE/fadeUp をページ内に再定義しない
- グラデーション・グロー・Webフォントを新規に足さない
```