# DESIGN.md — Warikan Master「SEISAN」デザインシステム

> 割り勘アプリ Warikan Master のデザイン仕様書。
> コンセプトは **Electric Emerald × 和モダン・フィンテック**。
> 信頼感のあるエメラルドを電気的に強化し、ダークモードでは「ミント on 墨黒」に反転して発光させる。
> すべての値は `client/src/index.css` の CSS カスタムプロパティ（セマンティックトークン）として定義され、
> Tailwind（`tailwind.config.ts`）から `hsl(var(--token) / <alpha-value>)` で参照される。

---

## 1. Visual Theme & Atmosphere

- **デザイン方針**: 金額が主役のフィンテック UI。数字は Space Grotesk のタブラー数字で大きく、面はガラスとオーロラでやわらかく
- **密度**: モバイルファースト（max-w-lg 中央寄せ）。カード単位で余白をたっぷり取り、本文 line-height 1.75
- **キーワード**: Electric Emerald、ミント on 墨黒、ガラスヘッダー、オーロラ背景、ピル形状、1円単位の精密さ
- **特徴**:
  - ページ背景は純白ではなく **ミントがかった near-white**（ライト）／**緑がかった墨黒**（ダーク）
  - 画面奥で `Aurora` コンポーネントのブランドカラーの光球がゆっくり漂う（`animate-aurora`）
  - ヘッダーは `.glass`（backdrop-blur + 半透明背景）のスティッキー
  - ボタンは全て **ピル（rounded-full）**。プライマリはブランドグラデーション + グロー影
  - **ダークモードはプライマリが反転**する：ライトは「深緑面に白文字」、ダークは「明るいミント面に墨色文字」
  - メンバーは名前から決定的に選ばれるグラデーションアバター（`MemberAvatar`）で常に同じ色
  - 入場アニメーションは framer-motion の fade-up（`ease: [0.16, 1, 0.3, 1]`）。`MotionConfig reducedMotion="user"` で OS 設定を尊重

---

## 2. Color Palette & Roles

> HSL トリプレット（`H S% L%`）。Tailwind からは `hsl(var(--token) / <alpha-value>)` で参照。

### Brand

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--primary` | `162 88% 27%`（深いエメラルド） | `157 68% 52%`（発光するミント） | CTA・アクティブ状態・リンク的テキスト |
| `--primary-foreground` | `150 40% 98%`（白） | `172 50% 6%`（墨） | プライマリ面上の文字。**ダークでは墨色** |
| `--gradient-brand` | `linear-gradient(135deg, hsl(166 92% 24%), hsl(160 84% 33%), hsl(174 78% 37%))` | `linear-gradient(135deg, hsl(160 80% 40%), hsl(165 72% 48%), hsl(178 68% 50%))` | プライマリボタン・ロゴタイル・強調統計カード |
| `--ring` | `162 88% 30%` | `157 68% 52%` | フォーカスリング |

### Surfaces

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--background` | `160 33% 98%` | `172 36% 5%` | ページ背景 |
| `--foreground` | `168 32% 10%` | `152 20% 93%` | 本文（純黒は使わない） |
| `--card` / `--card-border` | `0 0% 100%` / `160 20% 92%` | `168 26% 8%` / `166 16% 13%` | カード面とヘアラインボーダー |
| `--muted` / `--muted-foreground` | `156 24% 94%` / `162 10% 40%` | `164 12% 14%` / `158 9% 62%` | 抑えた面・補助テキスト |
| `--accent` | `156 36% 92%` | `163 16% 15%` | ホバー面・薄い強調面（送金行など） |
| `--secondary` | `158 28% 94%` | `165 14% 14%` | チップ・バッジ面 |
| `--input` | `160 16% 82%` | `164 12% 24%` | 入力欄のボーダー |

### Money Semantics（重要）

金額の増減は primary / destructive を流用せず、専用トークンを使う。

| Token | Light | Dark | 役割 |
|-------|-------|------|------|
| `--positive` | `161 88% 29%` | `157 68% 52%` | 受け取り（+）、送金額、精算完了 |
| `--negative` | `4 78% 46%` | `4 92% 68%` | 支払い（−）、内訳の不一致 |
| `--destructive` | `4 74% 47%` | `3 74% 55%` | 削除などの破壊的操作専用 |

### Charts

`--chart-1〜5`: エメラルド → ティール → シアン → アンバー → コーラルの5色。

---

## 3. Typography Rules

### 3.1 フォントファミリ

```css
--font-sans:    'Space Grotesk', 'Zen Kaku Gothic New', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
--font-display: 同上（用途エイリアス。金額・見出し英字・ステップ番号用）;
```

- **欧文・数字**: Space Grotesk（300–700 可変）。金額・英字ラベル・404 などの主役
- **和文**: Zen Kaku Gothic New（400 / 500 / 700 / 900）。幾何学的でモダンな角ゴシック
- 読み込みは `client/index.html` の Google Fonts（`display=swap`）

### 3.2 グローバル設定（body）

```css
line-height: 1.75;
letter-spacing: 0.015em;   /* var(--tracking-normal) */
font-feature-settings: "palt" 1;   /* プロポーショナル字詰めを全域適用 */
```

- 見出し（h1–h6）: `line-height: 1.35` / `letter-spacing: 0.01em` / `font-weight: 700`
- ヒーローの見出しは `font-black`（900）+ `tracking-tight`

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
- `default`: `bg-gradient-brand text-primary-foreground shadow-glow hover:shadow-glow-lg`
- `outline`: 半透明カード面 + `--button-outline` ヘアライン + backdrop-blur
- `ghost` / `secondary` / `destructive`: 従来どおり（hover-elevate 系ユーティリティで押下感）
- サイズ: default `min-h-10 px-5` / sm `min-h-8` / lg `min-h-12 px-8 text-base` / icon `h-9 w-9`

### Cards（`ui/card.tsx`）

- `rounded-2xl`（24px）、`border-card-border`、`shadow-sm`、padding は `p-5` 基準
- ヒーロー級のカード（参加・作成・ログイン）はページ側で `rounded-3xl` に格上げ
- 強調統計カード: `border-transparent bg-gradient-brand text-primary-foreground shadow-glow`

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
| `AppHeader` | ガラス質スティッキーヘッダー。戻る・タイトル・アクション・テーマ切替を一元管理（testid もここで固定） |
| `WaricanLogo` / `LogoTile` | ¥ 分割モチーフのロゴ。タイルはグラデ + グロー + rounded-[28%] |
| `MemberAvatar` | 名前ハッシュで 8 種のグラデーションから決定的に配色されるイニシャルアバター |
| `Aurora` | `fixed inset-0 -z-10` のオーロラ光球（親に `relative isolate` が必要） |
| `ScheduleTab` | 旅行イベントの旅程タイムライン。`DAY 01` マイクロラベル + 日付見出し、左レールは `bg-primary/10` のアイコンドット + `w-px bg-border` の縦線。カードはタップで詳細を展開 |
| `ScheduleItemDialog` | 予定の追加・編集。カテゴリ 3 択は割り勘モードと同じラジオカード、URL 貼付で OGP を自動補完（取得中はスピナー、失敗しても入力は止めない） |

---

## 5. Layout Principles

- コンテンツ幅: 通常 `max-w-lg`、管理画面のみ `max-w-3xl`。左右 padding は `px-4`
- ページルート: `relative isolate flex min-h-screen flex-col bg-background` + 最初の子に `<Aurora />`
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
| 発光 | `shadow-glow` / `shadow-glow-lg` | プライマリ CTA・ロゴタイル・強調統計 |

- 影はライトで **緑がかったアンビエント**（`hsl(166 40% 12% / …)`）、ダークで黒 + ミントのグロー
- すべて CSS 変数経由（`--shadow-*`）なのでテーマで自動的に切り替わる

---

## 7. Motion

- イージング: `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`（標準）/ `--ease-spring`（遊び）
- 入場: framer-motion で `opacity 0→1, y 16→0`、`duration 0.45–0.6s`、リストは 0.05s 前後のスタガー
- 押下: ボタン `active:scale-[0.97]`（200ms）
- スケルトン: シマー（`animate-shimmer`、muted→accent の流れるグラデ）
- 背景: `animate-aurora`（18s）/ `animate-aurora-slow`（26s 逆再生）
- `prefers-reduced-motion: reduce` で全アニメーションをほぼ無効化（CSS + MotionConfig の両方）

---

## 8. Do's and Don'ts

### Do（推奨）

- 金額には `.money` + `tabular-nums` + `text-positive` / `text-negative` を使う
- プライマリ CTA は 1 画面 1 つ。`bg-gradient-brand + shadow-glow` はここぞという場所だけ
- 新しい色が必要になったら、まず `index.css` にセマンティックトークンを足してから使う
- メンバーの表示には必ず `MemberAvatar` を添える（色の一貫性が人物の識別子になる）
- ページ背景の彩りは `Aurora` に任せ、面自体は静かに保つ
- 見出し・英字ラベルは `font-display` + トラッキング広め、和文本文は line-height 1.75 を守る

### Don't（禁止）

- 純黒 `#000` / 純白 `#fff` をテキスト・ページ背景に直接使わない（トークンを使う）
- 金額の色に `text-primary` / `text-destructive` を流用しない（positive / negative を使う）
- グラデーション面に `text-white` を直書きしない（ダークで破綻する。`text-primary-foreground` を使う）
- `palt` を数字に効かせたまま金額を組まない（`.money` か `tabular-nums` で切る）
- ボタン・チップに中途半端な角丸を混ぜない（インタラクティブ要素はピルで統一）
- hex 直書きでスタイルしない（テーマ切替が壊れる）

---

## 9. Agent Prompt Guide

### クイックリファレンス

```
Brand: emerald — light #0a8250 相当 (hsl 162 88% 27%) / dark mint (hsl 157 68% 52%)
Gradient: var(--gradient-brand) 135deg emerald→teal
Text: hsl(168 32% 10%) light / hsl(152 20% 93%) dark（純黒・純白禁止）
Background: hsl(160 33% 98%) light / hsl(172 36% 5%) dark
Money: .money + tabular-nums、+は --positive、−は --negative
Font: Space Grotesk（欧文・数字）+ Zen Kaku Gothic New（和文）、palt 全域
Body: line-height 1.75 / letter-spacing 0.015em
Radius: ボタン=pill、入力=xl(20px)、カード=2xl(24px)、ダイアログ=3xl(32px)
Shadow: var(--shadow-*)、CTA は shadow-glow
Motion: fade-up 0.5s cubic-bezier(0.16,1,0.3,1)、active:scale-[0.97]
```

### プロンプト例

```
Warikan Master の「SEISAN」デザインシステムに従って新しい画面を作成してください。
- ページルートは relative isolate + bg-background、最初の子に <Aurora />
- ヘッダーは <AppHeader backHref="/" title={...} />
- カードは rounded-2xl / border-card-border / shadow-sm、主役カードのみ rounded-3xl
- CTA は <Button size="lg">（グラデ+グロー）を1画面1つまで
- 金額は .money tabular-nums、受け取り text-positive / 支払い text-negative
- メンバー表示には <MemberAvatar name={...} /> を添える
- 入場は framer-motion fade-up（duration 0.5, ease [0.16,1,0.3,1]、stagger 0.05s）
```
