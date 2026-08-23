import { describe, it, expect } from "vitest";
import { splitYen } from "./split";

function sum(map: Map<number, number>): number {
  let total = 0;
  map.forEach((v) => (total += v));
  return total;
}

describe("splitYen", () => {
  it("端数なしの均等割り", () => {
    const result = splitYen(3000, [1, 2, 3]);
    expect(result.get(1)).toBe(1000);
    expect(result.get(2)).toBe(1000);
    expect(result.get(3)).toBe(1000);
    expect(sum(result)).toBe(3000);
  });

  it("余りは小数部の大きい順（同点は先頭優先）に1円ずつ配る", () => {
    const result = splitYen(1000, [1, 2, 3]);
    // 1000/3 = 333.33... 全員同じ小数部なので order の先頭が +1 円
    expect(result.get(1)).toBe(334);
    expect(result.get(2)).toBe(333);
    expect(result.get(3)).toBe(333);
    expect(sum(result)).toBe(1000);
  });

  it("比率指定の配分（floor + 最大剰余）", () => {
    const result = splitYen(1000, [1, 2], { 1: 2, 2: 1 });
    expect(result.get(1)).toBe(667);
    expect(result.get(2)).toBe(333);
    expect(sum(result)).toBe(1000);
  });

  it("全ウェイトが0以下なら均等割りにフォールバック", () => {
    const result = splitYen(900, [1, 2, 3], { 1: 0, 2: 0, 3: 0 });
    expect(result.get(1)).toBe(300);
    expect(result.get(2)).toBe(300);
    expect(result.get(3)).toBe(300);
  });

  it("weights にキーが無いメンバーはウェイト0（0円）", () => {
    const result = splitYen(1000, [1, 2], { 1: 1 });
    expect(result.get(1)).toBe(1000);
    expect(result.get(2)).toBe(0);
  });

  it("空の参加者リストは空の Map", () => {
    expect(splitYen(1000, []).size).toBe(0);
  });

  it("非整数の total は丸めてから配分する", () => {
    const result = splitYen(1000.4, [1, 2]);
    expect(sum(result)).toBe(1000);
    const result2 = splitYen(1000.5, [1, 2]);
    expect(sum(result2)).toBe(1001);
  });

  it("プロパティ: 配分合計は常に round(total) に一致し、各取り分は整数", () => {
    // 疑似乱数（再現性のため seed 固定の線形合同法）
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };

    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rand() * 10);
      const order = Array.from({ length: n }, (_, k) => k + 1);
      const total = Math.floor(rand() * 1_000_000);
      const useWeights = rand() < 0.5;
      const weights = useWeights
        ? Object.fromEntries(order.map((id) => [id, Math.floor(rand() * 10)]))
        : undefined;

      const result = splitYen(total, order, weights);
      expect(sum(result)).toBe(Math.round(total));
      result.forEach((share) => expect(Number.isInteger(share)).toBe(true));
    }
  });
});

// 極端な重みは splitYen の (total * wi) / weightSum を Infinity にし、
// 余り配分の while ループが停止しなくなる（サーバのイベントループを占有する）。
// 入口の検証（paymentInputSchema の weightRecord）で弾いているが、この関数は
// クライアントのプレビューからも直接呼ばれるため、関数側の防御も固定しておく。
describe("splitYen — 非有限な重みでも停止する", () => {
  // タイムアウトを短めにして、回帰したときにハングではなく失敗として出す。
  it("重みが 1e308 でも停止し、均等割りにフォールバックする", { timeout: 2000 }, () => {
    const result = splitYen(3000, [1, 2], { 1: 1e308, 2: 1 });
    expect(sum(result)).toBe(3000);
    expect(result.get(1)).toBe(1500);
    expect(result.get(2)).toBe(1500);
  });

  it("重みが Infinity でも停止する", { timeout: 2000 }, () => {
    const result = splitYen(3000, [1, 2], { 1: Infinity, 2: 1 });
    expect(sum(result)).toBe(3000);
    result.forEach((share) => expect(Number.isFinite(share)).toBe(true));
  });

  it("全員の重みが Infinity でも停止する", { timeout: 2000 }, () => {
    const result = splitYen(1000, [1, 2, 3], { 1: Infinity, 2: Infinity, 3: Infinity });
    expect(sum(result)).toBe(1000);
    result.forEach((share) => expect(Number.isInteger(share)).toBe(true));
  });

  it("金額が巨大でも重みが正常なら通常どおり配分する", { timeout: 2000 }, () => {
    const result = splitYen(100_000_000, [1, 2], { 1: 1, 2: 3 });
    expect(result.get(1)).toBe(25_000_000);
    expect(result.get(2)).toBe(75_000_000);
    expect(sum(result)).toBe(100_000_000);
  });

  it("上限 1000 までの重みは正しく効く", { timeout: 2000 }, () => {
    const result = splitYen(1001, [1, 2], { 1: 1000, 2: 1 });
    expect(sum(result)).toBe(1001);
    expect(result.get(1)).toBe(1000);
    expect(result.get(2)).toBe(1);
  });
});
