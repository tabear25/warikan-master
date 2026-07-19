import { Link } from "wouter";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { WaricanLogo } from "@/components/logo";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  /** 指定するとロゴの左に戻るボタンを表示する */
  backHref?: string;
  /** ロゴの右に出すタイトル。Skeleton などのノードも渡せる */
  title?: React.ReactNode;
  /** テーマ切替ボタンの左に並べる追加アクション */
  actions?: React.ReactNode;
  /** コンテンツの最大幅。管理画面のみ広い */
  width?: "lg" | "3xl";
}

/**
 * 全ページ共通のガラス質スティッキーヘッダー。
 * 戻る・テーマ切替の data-testid / aria はここで一元管理する。
 */
export function AppHeader({ backHref, title, actions, width = "lg" }: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    // 実線ボーダーではなくスクロールエッジで、コンテンツがガラスの下を
    // 通り抜けていく感覚を保つ
    <header className="glass scroll-edge-b sticky top-0 z-20">
      <div
        className={cn(
          "mx-auto flex items-center justify-between gap-3 px-4 py-3",
          width === "lg" ? "max-w-lg" : "max-w-3xl",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {backHref && (
            <Link href={backHref}>
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-200 hover:bg-accent hover:text-foreground active:scale-95 active:duration-100"
                data-testid="button-back"
                aria-label="戻る"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
          )}
          <WaricanLogo className="h-7 w-7 shrink-0 text-primary" />
          {title}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={toggleTheme}
            data-testid="button-toggle-theme"
            aria-label="テーマ切り替え"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
