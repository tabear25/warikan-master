import { cn } from "@/lib/utils";

/**
 * 画面背景にゆっくり漂うブランドカラーのオーロラ。純粋な装飾要素。
 * 親要素に `relative isolate` を付けて、その最初の子として置くこと。
 */
export function Aurora({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
    >
      <div className="absolute -left-24 -top-32 h-[420px] w-[420px] rounded-full bg-[hsl(160_84%_39%/0.15)] blur-3xl animate-aurora dark:bg-[hsl(160_80%_42%/0.10)]" />
      <div className="absolute -right-32 top-1/4 h-[380px] w-[380px] rounded-full bg-[hsl(182_72%_44%/0.12)] blur-3xl animate-aurora-slow dark:bg-[hsl(180_70%_46%/0.08)]" />
      <div className="absolute -bottom-36 left-1/3 h-[360px] w-[360px] rounded-full bg-[hsl(140_70%_48%/0.10)] blur-3xl animate-aurora [animation-delay:-8s] dark:bg-[hsl(150_70%_45%/0.07)]" />
    </div>
  );
}
