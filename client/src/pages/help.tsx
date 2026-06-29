import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun, ArrowLeft, HelpCircle } from "lucide-react";

function WaricanLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Warikan Master ロゴ"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
      <path d="M14 10 L24 24 L34 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 24 L24 38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 28 L30 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 33 L30 33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="12" r="2" fill="currentColor" opacity="0.5" />
      <circle cx="32" cy="12" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

const faqs: { question: string; answer: React.ReactNode }[] = [
  {
    question: "合言葉とは何ですか？",
    answer: (
      <>
        グループに参加するための共有キーワードです。イベントの作成者は、イベント作成時に決めて、
        参加するメンバーに伝えてください（例：<code className="px-1 py-0.5 rounded bg-muted text-xs">osaka2024</code>）。
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
    question: "ダークモードに切り替えたい",
    answer: (
      <>
        画面右上の月／太陽アイコンを押すと、ダークモードとライトモードを切り替えられます。
      </>
    ),
  },
];

export default function Help() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/">
              <button
                className="p-1 rounded-md hover:bg-accent transition-colors"
                data-testid="button-back"
                aria-label="戻る"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
            <WaricanLogo className="w-7 h-7 text-primary" />
            <span className="font-bold text-sm text-foreground tracking-tight">ヘルプ</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            data-testid="button-toggle-theme"
            aria-label="テーマ切り替え"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-6">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="text-center mb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/10 shadow-sm">
              <HelpCircle className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1 tracking-tight">よくある質問</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              はじめてご利用の方向けのトラブルシューティングです。
            </p>
          </div>

          {faqs.map((faq, i) => (
            <Card key={i} data-testid={`card-faq-${i}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{faq.question}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
