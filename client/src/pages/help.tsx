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
    question: "「イベントが見つかりません」と表示されます",
    answer: (
      <>
        合言葉のスペル、大文字／小文字、全角／半角の違いをご確認ください。
        正しく入力しても表示される場合は、イベント作成者に合言葉を再確認してください。
      </>
    ),
  },
  {
    question: "合言葉とは何ですか？",
    answer: (
      <>
        グループに参加するための共有キーワードです。イベント作成時に決めて、
        参加するメンバーに伝えてください（例：<code className="px-1 py-0.5 rounded bg-muted text-xs">osaka2024</code>）。
      </>
    ),
  },
  {
    question: "合言葉を忘れた／変更したい",
    answer: (
      <>
        現在、合言葉の確認・変更機能はありません。新しいイベントを作成し直して、
        メンバーに新しい合言葉を共有してください。
      </>
    ),
  },
  {
    question: "メンバーを後から追加できますか？",
    answer: (
      <>
        イベント作成時にはメンバーを2人以上入力する必要があります。
        作成後の追加可否はイベント画面でご確認ください。
      </>
    ),
  },
  {
    question: "支払い金額を間違えて入力してしまいました",
    answer: (
      <>
        イベント画面の支払い一覧から、該当する支払いを編集または削除できます。
        操作できない場合はイベント作成者にご相談ください。
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
      <header className="border-b border-border bg-card">
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
            <span className="font-bold text-sm text-foreground">ヘルプ</span>
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
            <HelpCircle className="w-10 h-10 text-primary mx-auto mb-3" />
            <h1 className="text-lg font-bold text-foreground mb-1">よくある質問</h1>
            <p className="text-sm text-muted-foreground">
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
