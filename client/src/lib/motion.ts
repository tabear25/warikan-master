import type { Transition } from "framer-motion";

/**
 * SEISAN モーション定義 — Apple "Designing Fluid Interfaces" の原則に基づく。
 *
 * - 標準はクリティカルダンピングのスプリング（bounce 0 = damping 1.0 相当）。
 *   duration は Apple の "response" に相当し、固定の再生時間ではなく
 *   「目標値へ向かう速さ」を表す。スプリングは常に現在値から再ターゲット
 *   されるため、途中で中断・逆転しても motion が途切れない
 * - バウンス（bounce 0.2 = damping 0.8 相当）は、フリックやドラッグ解放など
 *   ジェスチャ自体が運動量を持っていた場合にだけ使う。ただフェードインした
 *   だけの要素を揺らさない
 */

/** 標準スプリング — damping 1.0 / response 0.4 相当。UI 全般の既定 */
export const SPRING: Transition = { type: "spring", bounce: 0, duration: 0.4 };

/** ゆったりした入場用 — ヒーローや大きな面の登場（response 0.55 相当） */
export const SPRING_SLOW: Transition = { type: "spring", bounce: 0, duration: 0.55 };

/** 運動量スプリング — ドラッグ・フリックの後にだけ使う（damping 0.8 相当） */
export const SPRING_BOUNCE: Transition = { type: "spring", bounce: 0.2, duration: 0.4 };

/** CSS 側（transition-timing-function）に合わせる旧イージング。JS 側の新規実装はスプリングを使う */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** 入場の基本形 — 下 12px から浮かび上がる。退場は同じパスを戻る（fadeUp.exit） */
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  /** 空間的一貫性: 下から現れたものは下へ消える。加速して去る（入場の減速の鏡像） */
  exit: { opacity: 0, y: 8, transition: { duration: 0.18, ease: "easeIn" as const } },
};

/** リストのスタガー遅延（秒）。index 上限つきで後半の待ち時間を抑える */
export const stagger = (index: number, step = 0.05, max = 8) =>
  Math.min(index, max) * step;
