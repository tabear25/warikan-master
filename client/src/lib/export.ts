// 精算結果のテキスト/CSV 生成とダウンロード・コピーのユーティリティ。
// 依存ゼロ（ブラウザ標準 API のみ）。

import { formatYen, formatSignedYen } from "./currency";

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

interface SettlementExportData {
  eventName: string;
  // payoutLabel は「銀行振込」等の表示済み文字列。ラベルへの変換は呼び出し側の
  // 責務にして、このモジュールが @shared/schema に依存しないようにしている。
  members: Array<{ id: number; name: string; payoutLabel?: string | null }>;
  balances: Record<number, number>;
  transfers: Transfer[];
}

// LINE 等に貼り付けやすいプレーンテキストの精算サマリ。
export function buildSettlementText({ eventName, members, balances, transfers }: SettlementExportData): string {
  // transfers は相手を名前文字列で指す。メンバー名はイベント内で重複禁止なので
  // 名前をキーにして衝突しない。
  const payoutLabelByName = new Map(members.map((member) => [member.name, member.payoutLabel ?? null]));

  const lines: string[] = [];
  lines.push(`【${eventName}】精算結果`);
  lines.push("");
  lines.push("■ 各自の収支");
  for (const member of members) {
    const balance = Math.round(balances[member.id] ?? 0);
    lines.push(`・${member.name}: ${formatSignedYen(balance)}`);
  }
  lines.push("");
  lines.push("■ 送金リスト");
  if (transfers.length === 0) {
    lines.push("・精算は不要です");
  } else {
    for (const transfer of transfers) {
      const payoutLabel = payoutLabelByName.get(transfer.to);
      const suffix = payoutLabel ? `（受け取り方: ${payoutLabel}）` : "";
      lines.push(`・${transfer.from} → ${transfer.to}: ${formatYen(transfer.amount)}${suffix}`);
    }
  }
  return lines.join("\n");
}

// 表計算ソフトで開ける CSV。BOM 付きで Excel の文字化けを防ぐ。
export function buildSettlementCsv({ members, balances, transfers }: SettlementExportData): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const payoutLabelByName = new Map(members.map((member) => [member.name, member.payoutLabel ?? null]));

  const rows: string[] = [];
  rows.push("セクション,項目1,項目2,金額,受け取り方");
  for (const member of members) {
    const balance = Math.round(balances[member.id] ?? 0);
    rows.push(["収支", escape(member.name), "", balance, escape(member.payoutLabel ?? "")].join(","));
  }
  for (const transfer of transfers) {
    // 受け取り方は送金先（受け取る側）のもの。
    const payoutLabel = payoutLabelByName.get(transfer.to) ?? "";
    rows.push(
      ["送金", escape(transfer.from), escape(transfer.to), Math.round(transfer.amount), escape(payoutLabel)].join(","),
    );
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
