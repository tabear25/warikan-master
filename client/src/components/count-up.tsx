import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

interface CountUpProps {
  value: number;
  /** 表示フォーマット（例: formatYen）。省略時はそのまま数値 */
  render?: (n: number) => string;
  className?: string;
}

/**
 * 数値の変化をカウントアップ／ダウンで表示する。
 * 金額が「動いた」ことを視覚で伝えるためのマイクロインタラクション。
 * prefers-reduced-motion では即座に最終値を表示する。
 */
export function CountUp({ value, render = (n) => String(n), className }: CountUpProps) {
  const reduced = useReducedMotion();
  const prevRef = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return <span className={className}>{render(display)}</span>;
}
