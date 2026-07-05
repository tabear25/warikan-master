import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppHeader } from "@/components/app-header";
import { Aurora } from "@/components/aurora";
import { HelpCircle } from "lucide-react";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

const faqs: { question: string; answer: React.ReactNode }[] = [
  {
    question: "合言葉とは何ですか？",
    answer: (
      <>
        グループに参加するための共有キーワードです。イベントの作成者は、イベント作成時に決めて、
        参加するメンバーに伝えてください（例：<code className="rounded-md bg-muted px-1.5 py-0.5 font-display text-xs font-semibold">osaka2024</code>）。
      </>
    ),
  },
  {
    question: "合言葉を確認したい／忘れた",
    answer: (
      <>
        イベント画面の上部に合言葉が表示され、タップでコピーできます。
        変更はできないため、変えたい場合は新しいイベントを作成してください。
      </>
    ),
  },
  {
    question: "メンバーを後から追加できますか？",
    answer: (
      <>
        できます。イベント画面のメンバー一覧の横にある「追加」から、
        精算前であればいつでもメンバーを追加できます。
      </>
    ),
  },
  {
    question: "支払い金額を間違えて入力してしまいました",
    answer: (
      <>
        イベント画面の支払い一覧で、各支払いの鉛筆アイコンから編集、
        ゴミ箱アイコンから削除できます（精算前のみ）。
      </>
    ),
  },
  {
    question: "割り勘を均等以外にできますか？",
    answer: (
      <>
        支払い追加・編集の画面で「均等／比率／金額指定」を選べます。
        比率は重み（例：2:1:1）、金額指定は一人ずつの金額を入力します。
        端数は1円単位で自動調整され、合計はぴったり一致します。
      </>
    ),
  },
  {
    question: "精算結果を共有・保存したい",
    answer: (
      <>
        精算結果タブの下部から、テキストのコピー・CSV・画像（PNG）で出力できます。
        画面右上の共有ボタンからは、リンクとQRコードで仲間を招待できます。
      </>
    ),
  },
  {
    question: "旅行のスケジュールも管理できますか？",
    answer: (
      <>
        できます。イベント作成時に種類で「旅行」を選ぶと（あとから合言葉チップ横の設定からも変更可能）、
        イベント画面に「旅程」タブが現れ、宿泊・移動・観光などの予定を日付ごとのタイムラインで管理できます。
        予約ページの URL を貼るとタイトルなどが自動で補完され、住所を入れると地図リンクも表示されます。
      </>
    ),
  },
  {
    question: "旅程に入れた宿代などを割り勘にするには？",
    answer: (
      <>
        予定に「割り勘連携」の金額を入力しておくと、予定カードを開いたときに
        「割り勘に追加」ボタンが表示されます。押すと金額・内容が入力済みの支払い画面が開くので、
        対象メンバーを確認して追加するだけです。追加済みの予定にはチェックマークが付きます。
      </>
    ),
  },
  {
    question: "ダークモードに切り替えたい",
    answer: (
      <>
        画面右上の月／太陽アイコンを押すと、ダークモードとライトモードを切り替えられます。
      </>
    ),
  },
];

export default function Help() {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      <Aurora />

      <AppHeader
        backHref="/"
        title={<span className="text-sm font-bold tracking-tight text-foreground">ヘルプ</span>}
      />

      {/* Main */}
      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-3">
          <motion.div
            className="mb-6 text-center"
            {...fadeUp}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[28%] bg-gradient-brand text-primary-foreground shadow-glow">
              <HelpCircle className="h-8 w-8" />
            </div>
            <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
              FAQ
            </p>
            <h1 className="mb-1 text-xl font-black tracking-tight text-foreground">よくある質問</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              はじめてご利用の方向けのトラブルシューティングです。
            </p>
          </motion.div>

          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              {...fadeUp}
              transition={{ duration: 0.45, ease: EASE, delay: 0.06 + i * 0.05 }}
            >
              <Card data-testid={`card-faq-${i}`} className="hover:shadow-md">
                <CardHeader className="pb-2">
                  <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-primary">
                    Q{i + 1}
                  </p>
                  <CardTitle className="text-sm leading-snug">{faq.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{faq.answer}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
