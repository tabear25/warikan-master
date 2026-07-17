import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { AppHeader } from "@/components/app-header";
import { Aurora } from "@/components/aurora";
import { useTheme } from "@/components/theme-provider";
import {
  ArrowRight,
  CalendarDays,
  Coins,
  HelpCircle,
  KeyRound,
  Moon,
  PlusCircle,
  QrCode,
  Search,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// クイックスタート（3ステップ）
// ---------------------------------------------------------------------------

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: PlusCircle,
    title: "イベントを作る",
    body: "イベント名と合言葉、メンバーを決めるだけ。登録もアプリのインストールも不要です。",
  },
  {
    icon: QrCode,
    title: "合言葉で集まる",
    body: "仲間には合言葉か、リンク・QRコードを共有。同じイベントをみんなで開けます。",
  },
  {
    icon: Wallet,
    title: "記録して精算",
    body: "支払いを記録すると、誰が誰にいくら払えばいいかを最小の回数で自動計算します。",
  },
];

// ---------------------------------------------------------------------------
// FAQ（カテゴリ × アコーディオン × 検索）
// ---------------------------------------------------------------------------

interface FaqItem {
  id: string;
  question: string;
  answer: React.ReactNode;
  /** 検索マッチング用のプレーンテキスト（answer と同内容＋類義語） */
  searchText: string;
}

interface FaqCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  items: FaqItem[];
}

function DarkModeAnswer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <>
      画面右上の月／太陽アイコンを押すと、ダークモードとライトモードを切り替えられます。
      <button
        onClick={toggleTheme}
        className="ml-1 font-semibold text-primary underline-offset-4 hover:underline"
        data-testid="button-faq-toggle-theme"
      >
        今すぐ{theme === "dark" ? "ライト" : "ダーク"}モードを試す
      </button>
    </>
  );
}

const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: "basic",
    label: "合言葉・メンバー",
    icon: KeyRound,
    items: [
      {
        id: "keyword",
        question: "合言葉とは何ですか？",
        answer: (
          <>
            グループに参加するための共有キーワードです。イベントの作成者は、イベント作成時に決めて、
            参加するメンバーに伝えてください（例：<code className="rounded-md bg-muted px-1.5 py-0.5 font-display text-xs font-semibold">osaka2024</code>）。
          </>
        ),
        searchText: "グループに参加するための共有キーワードです パスワード あいことば 参加方法 osaka2024 イベント作成時に決めて",
      },
      {
        id: "keyword-forgot",
        question: "合言葉を確認したい／忘れた",
        answer: (
          <>
            イベント画面の上部に合言葉が表示され、タップでコピーできます。
            変更はできないため、変えたい場合は新しいイベントを作成してください。
          </>
        ),
        searchText: "イベント画面の上部に表示 コピー 変更できない 忘れた",
      },
      {
        id: "add-member",
        question: "メンバーを後から追加できますか？",
        answer: (
          <>
            できます。イベント画面のメンバー一覧の横にある「追加」から、
            精算前であればいつでもメンバーを追加できます。
          </>
        ),
        searchText: "メンバー一覧の横にある追加 あとから 人を増やす 途中参加",
      },
    ],
  },
  {
    id: "payment",
    label: "支払い・精算",
    icon: Coins,
    items: [
      {
        id: "edit-payment",
        question: "支払い金額を間違えて入力してしまいました",
        answer: (
          <>
            イベント画面の支払い一覧で、各支払いの鉛筆アイコンから編集、
            ゴミ箱アイコンから削除できます（精算前のみ）。
          </>
        ),
        searchText: "鉛筆アイコンから編集 ゴミ箱アイコンから削除 修正 まちがえた 訂正",
      },
      {
        id: "split-modes",
        question: "割り勘を均等以外にできますか？",
        answer: (
          <>
            支払い追加・編集の画面で「均等／比率／金額指定」を選べます。
            比率は重み（例：2:1:1）、金額指定は一人ずつの金額を入力します。
            端数は1円単位で自動調整され、合計はぴったり一致します。
          </>
        ),
        searchText: "均等 比率 金額指定 傾斜 端数 割合 おごり 多めに払う",
      },
      {
        id: "share-result",
        question: "精算結果を共有・保存したい",
        answer: (
          <>
            精算結果の下部から、テキストのコピー・CSV・画像（PNG)で出力できます。
            画面右上の共有ボタンからは、リンクとQRコードで仲間を招待できます。
          </>
        ),
        searchText: "テキストのコピー CSV 画像 PNG エクスポート 出力 LINEで送る リンク QRコード qr 招待 共有ボタン",
      },
    ],
  },
  {
    id: "trip",
    label: "旅行・旅程",
    icon: CalendarDays,
    items: [
      {
        id: "schedule",
        question: "旅行のスケジュールも管理できますか？",
        answer: (
          <>
            できます。イベント作成時に種類で「旅行」を選ぶと（あとから合言葉チップ横の設定からも変更可能）、
            イベント画面に「旅程」タブが現れ、宿泊・移動・観光などの予定を日付ごとのタイムラインで管理できます。
            予約ページの URL を貼るとタイトルなどが自動で補完され、住所を入れると地図リンクも表示されます。
          </>
        ),
        searchText: "旅程タブ 宿泊 移動 観光 タイムライン URL 予約 地図 しおり スケジュール",
      },
      {
        id: "schedule-to-payment",
        question: "旅程に入れた宿代などを割り勘にするには？",
        answer: (
          <>
            予定に「割り勘連携」の金額を入力しておくと、予定カードを開いたときに
            「割り勘に追加」ボタンが表示されます。押すと金額・内容が入力済みの支払い画面が開くので、
            対象メンバーを確認して追加するだけです。追加済みの予定にはチェックマークが付きます。
          </>
        ),
        searchText: "割り勘連携 割り勘に追加 宿代 ホテル代 予定から支払い チェックマーク",
      },
    ],
  },
  {
    id: "appearance",
    label: "表示・設定",
    icon: Moon,
    items: [
      {
        id: "dark-mode",
        question: "ダークモードに切り替えたい",
        answer: <DarkModeAnswer />,
        searchText: "月 太陽 アイコン ダークモード ライトモード テーマ 切り替え 黒 白",
      },
    ],
  },
];

export default function Help() {
  const [query, setQuery] = useState("");
  const [openItems, setOpenItems] = useState<string[]>([]);

  const normalized = query.trim().toLowerCase();

  // 検索時は質問文・回答テキストへの部分一致で絞り込む
  const filtered = useMemo(() => {
    if (!normalized) return FAQ_CATEGORIES;
    return FAQ_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.question.toLowerCase().includes(normalized) ||
          item.searchText.toLowerCase().includes(normalized),
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [normalized]);

  const matchedIds = useMemo(
    () => filtered.flatMap((cat) => cat.items.map((item) => item.id)),
    [filtered],
  );

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      <Aurora />

      <AppHeader
        backHref="/"
        title={<span className="text-sm font-bold tracking-tight text-foreground">ヘルプ</span>}
      />

      {/* Main */}
      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-8 lg:max-w-3xl">
          {/* Hero */}
          <motion.div
            className="text-center"
            {...fadeUp}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[28%] bg-gradient-brand text-primary-foreground shadow-glow">
              <HelpCircle className="h-8 w-8" />
            </div>
            <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
              Guide &amp; FAQ
            </p>
            <h1 className="mb-1 text-xl font-black tracking-tight text-foreground">使い方ガイド</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              3ステップの始め方と、よくある質問をまとめました。
            </p>
          </motion.div>

          {/* Quick start */}
          <section aria-labelledby="quick-start-heading">
            <motion.p
              id="quick-start-heading"
              className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary"
              {...fadeUp}
              transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
            >
              Quick start — 3ステップではじめる
            </motion.p>
            <div className="space-y-3 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <motion.div
                  key={title}
                  {...fadeUp}
                  transition={{ duration: 0.5, ease: EASE, delay: 0.1 + i * 0.07 }}
                >
                  <Card data-testid={`card-step-${i + 1}`} className="h-full">
                    <CardContent className="p-5">
                      <div className="mb-3 flex items-center gap-3 lg:flex-col lg:items-start">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
                            Step 0{i + 1}
                          </p>
                          <h2 className="text-sm font-bold text-foreground">{title}</h2>
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
            <motion.div
              className="mt-4 text-center"
              {...fadeUp}
              transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}
            >
              <Link href="/create">
                <Button size="lg" data-testid="button-help-create">
                  イベントを作ってみる
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </motion.div>
          </section>

          {/* FAQ */}
          <section aria-labelledby="faq-heading" className="mx-auto w-full max-w-lg lg:max-w-2xl">
            <motion.div {...fadeUp} transition={{ duration: 0.5, ease: EASE, delay: 0.15 }}>
              <p
                id="faq-heading"
                className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary"
              >
                FAQ — よくある質問
              </p>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="キーワードで探す（例：比率、QR、旅程）"
                  className="rounded-full pl-10"
                  data-testid="input-faq-search"
                  aria-label="よくある質問を検索"
                />
              </div>
            </motion.div>

            {filtered.length === 0 ? (
              <Card data-testid="card-faq-empty">
                <CardContent className="py-10 text-center">
                  <p className="mb-1 text-sm font-semibold text-foreground">見つかりませんでした</p>
                  <p className="text-xs text-muted-foreground">
                    別のことばで検索してみてください（例：「精算」「メンバー」）
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filtered.map((cat, ci) => {
                  const CatIcon = cat.icon;
                  return (
                    <motion.div
                      key={cat.id}
                      {...fadeUp}
                      transition={{ duration: 0.45, ease: EASE, delay: 0.05 + ci * 0.05 }}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5 px-1">
                        <CatIcon className="h-3.5 w-3.5 text-primary" />
                        <h2 className="text-xs font-bold tracking-wide text-muted-foreground">{cat.label}</h2>
                      </div>
                      <Card data-testid={`card-faq-category-${cat.id}`}>
                        <CardContent className="px-5 py-1">
                          <Accordion
                            type="multiple"
                            value={normalized ? matchedIds : openItems}
                            onValueChange={(v) => { if (!normalized) setOpenItems(v); }}
                          >
                            {cat.items.map((item, ii) => (
                              <AccordionItem
                                key={item.id}
                                value={item.id}
                                className={ii === cat.items.length - 1 ? "border-b-0" : ""}
                              >
                                <AccordionTrigger
                                  className="py-3.5 text-left text-sm font-semibold hover:no-underline"
                                  data-testid={`faq-trigger-${item.id}`}
                                >
                                  {item.question}
                                </AccordionTrigger>
                                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                                  {item.answer}
                                </AccordionContent>
                              </AccordionItem>
                            ))}
                          </Accordion>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
