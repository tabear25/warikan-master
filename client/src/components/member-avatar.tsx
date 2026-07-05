import { cn } from "@/lib/utils";

/** 名前から決定的に選ばれる、ブランドに調和したグラデーションのペア */
const AVATAR_GRADIENTS = [
  "from-emerald-500 to-teal-600",
  "from-teal-500 to-cyan-600",
  "from-sky-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-rose-400 to-pink-600",
  "from-amber-400 to-orange-500",
  "from-lime-500 to-green-600",
  "from-cyan-500 to-sky-600",
] as const;

function hashName(name: string): number {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  }
  return hash;
}

export function avatarGradient(name: string): string {
  return AVATAR_GRADIENTS[hashName(name) % AVATAR_GRADIENTS.length];
}

/**
 * メンバー名の頭文字を載せたグラデーションアバター。
 * 同じ名前には常に同じ色が割り当たるので、一覧の中で人を追いやすい。
 */
export function MemberAvatar({ name, className }: { name: string; className?: string }) {
  const initial = Array.from(name.trim())[0] ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm",
        avatarGradient(name),
        className,
      )}
    >
      {initial}
    </span>
  );
}
