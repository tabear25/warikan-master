import * as React from "react";

/**
 * メディアクエリの一致状態を返すフック。
 * 初期値を matchMedia から同期的に取るため、初回描画でのちらつきがない。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** 2カラムレイアウトへ切り替わるデスクトップ幅（Tailwind lg と揃える） */
export const DESKTOP_QUERY = "(min-width: 1024px)";
/** ダイアログがボトムシートからモーダルへ切り替わる幅（Tailwind md と揃える） */
export const SHEET_QUERY = "(min-width: 768px)";
