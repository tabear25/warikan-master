// 割り当ての本体は @shared/split、精算の本体は @shared/settlement にある
// （クライアントの送金リスト詳細と部分精算のプレビューも同じものを使う）。
// 既存の import 先を変えずに済むよう、ここからも再エクスポートする。
export { computeShares } from "@shared/split";
export {
  calculateSettlement,
  calculateSettlementWithPartials,
  summarizePartialSettlement,
  type Transfer,
  type SettlementResult,
  type PartialSettlementSummary,
  type SettlementWithPartials,
} from "@shared/settlement";
