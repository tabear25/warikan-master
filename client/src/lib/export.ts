// 精算結果のテキスト/CSV 生成とダウンロード・コピーのユーティリティ。
// 依存ゼロ（ブラウザ標準 API のみ）。

import { formatYen, formatSignedYen } from "./currency";

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

// payoutLabel は「銀行振込」等の表示済み文字列。ラベルへの変換は呼び出し側の
// 責務にして、このモジュールが @shared/schema に依存しないようにしている。
interface ExportMember {
  id: number;
  name: string;
  payoutLabel?: string | null;
}

// 先に精算した区切り（部分精算）1つぶん。label は「9/26（土）14:05」のような表示済みの日時
// （同じ日に2回精算しても区切りを見分けられるよう、時刻まで入れる）。
export interface PartialSettlementExport {
  label: string;
  payments: Array<{ description: string; amount: number }>;
  total: number;
  transfers: Transfer[];
}

interface SettlementExportData {
  eventName: string;
  members: ExportMember[];
  balances: Record<number, number>;
  transfers: Transfer[];
  // 先に精算した分。1件でもあれば、balances / transfers は残り（未精算分）を指す。
  partials?: PartialSettlementExport[];
}

// transfers は相手を名前文字列で指す。メンバー名はイベント内で重複禁止なので
// 名前をキーにして衝突しない。
function payoutLabelsByName(members: ExportMember[]): Map<string, string | null> {
  return new Map(members.map((member) => [member.name, member.payoutLabel ?? null]));
}

// 受け取り方は送金先（受け取る側）のものを添える。
function transferLine(transfer: Transfer, payoutLabelByName: Map<string, string | null>): string {
  const payoutLabel = payoutLabelByName.get(transfer.to);
  const suffix = payoutLabel ? `（受け取り方: ${payoutLabel}）` : "";
  return `・${transfer.from} → ${transfer.to}: ${formatYen(transfer.amount)}${suffix}`;
}

// LINE 等に貼り付けやすいプレーンテキストの精算サマリ。
export function buildSettlementText({ eventName, members, balances, transfers, partials = [] }: SettlementExportData): string {
  const payoutLabelByName = payoutLabelsByName(members);
  const hasPartials = partials.length > 0;

  const lines: string[] = [];
  lines.push(`【${eventName}】精算結果`);
  lines.push("");
  lines.push(hasPartials ? "■ 各自の収支（先に精算した分を除く）" : "■ 各自の収支");
  for (const member of members) {
    const balance = Math.round(balances[member.id] ?? 0);
    lines.push(`・${member.name}: ${formatSignedYen(balance)}`);
  }
  lines.push("");
  lines.push(hasPartials ? "■ 送金リスト（残り）" : "■ 送金リスト");
  if (transfers.length === 0) {
    lines.push(hasPartials ? "・残りの精算は不要です" : "・精算は不要です");
  } else {
    for (const transfer of transfers) {
      lines.push(transferLine(transfer, payoutLabelByName));
    }
  }
  if (hasPartials) {
    lines.push("");
    lines.push("■ 先に精算した分（上の送金リストには含みません）");
    for (const partial of partials) {
      const descriptions = partial.payments.map((payment) => payment.description).join("、");
      lines.push(`・${partial.label}に精算: ${descriptions}（計 ${formatYen(partial.total)}）`);
    }
  }
  return lines.join("\n");
}

// 先に精算した分だけを、LINE 等で「この分を送ってください」と共有するためのテキスト。
export function buildPartialSettlementText(
  eventName: string,
  members: ExportMember[],
  partial: PartialSettlementExport,
): string {
  const payoutLabelByName = payoutLabelsByName(members);

  const lines: string[] = [];
  lines.push(`【${eventName}】先に精算する分`);
  lines.push("");
  lines.push("■ 対象の支払い");
  for (const payment of partial.payments) {
    lines.push(`・${payment.description}: ${formatYen(payment.amount)}`);
  }
  lines.push(`・合計: ${formatYen(partial.total)}`);
  lines.push("");
  lines.push("■ 送金リスト");
  if (partial.transfers.length === 0) {
    lines.push("・送金は不要です");
  } else {
    for (const transfer of partial.transfers) {
      lines.push(transferLine(transfer, payoutLabelByName));
    }
  }
  return lines.join("\n");
}

// 表計算ソフトで開ける CSV。BOM 付きで Excel の文字化けを防ぐ。
export function buildSettlementCsv({ members, balances, transfers, partials = [] }: SettlementExportData): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const payoutLabelByName = payoutLabelsByName(members);
  const hasPartials = partials.length > 0;
  const transferRow = (section: string, transfer: Transfer) =>
    [
      escape(section),
      escape(transfer.from),
      escape(transfer.to),
      Math.round(transfer.amount),
      // 受け取り方は送金先（受け取る側）のもの。
      escape(payoutLabelByName.get(transfer.to) ?? ""),
    ].join(",");

  const rows: string[] = [];
  rows.push("セクション,項目1,項目2,金額,受け取り方");
  for (const member of members) {
    const balance = Math.round(balances[member.id] ?? 0);
    rows.push(
      [hasPartials ? "収支（残り）" : "収支", escape(member.name), "", balance, escape(member.payoutLabel ?? "")].join(","),
    );
  }
  for (const transfer of transfers) {
    rows.push(transferRow(hasPartials ? "送金（残り）" : "送金", transfer));
  }
  for (const partial of partials) {
    for (const transfer of partial.transfers) {
      rows.push(transferRow(`先に精算 ${partial.label}`, transfer));
    }
  }
  return "﻿" + rows.join("\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  triggerDownload(filename, URL.createObjectURL(blob));
}

export function triggerDownload(filename: string, url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// クリップボードコピー。Clipboard API が使えない環境では execCommand にフォールバック。
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// ファイル名に使えない文字を除去する。
export function safeFileName(base: string): string {
  return base.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50) || "warikan";
}
