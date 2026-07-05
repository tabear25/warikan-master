import { cn } from "@/lib/utils";

/**
 * Warikan Master のロゴマーク。
 * ¥ の縦棒がふたつに分かれていく「割る」モチーフ。色は currentColor を継承する。
 */
export function WaricanLogo({ className = "" }: { className?: string }) {
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

/**
 * ブランドグラデーションのタイルに白抜きロゴを載せたアプリアイコン風の表示。
 * ヒーローやログイン画面のアイキャッチに使う。
 */
export function LogoTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[28%] bg-gradient-brand text-primary-foreground shadow-glow",
        className,
      )}
    >
      <WaricanLogo className="h-[58%] w-[58%]" />
    </div>
  );
}
