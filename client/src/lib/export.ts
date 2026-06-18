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
  members: Array<{ id: number; name: string }>;
  balances: Record<number, number>;
  transfers: Transfer[];
}

// LINE 等に貼り付けやすいプレーンテキストの精算サマリ。
export function buildSettlementText({ eventName, members, balances, transfers }: SettlementExportData): string {
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
      lines.push(`・${transfer.from} → ${transfer.to}: ${formatYen(transfer.amount)}`);
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

  const rows: string[] = [];
  rows.push("セクション,項目1,項目2,金額");
  for (const member of members) {
    const balance = Math.round(balances[member.id] ?? 0);
    rows.push(["収支", escape(member.name), "", balance].join(","));
  }
  for (const transfer of transfers) {
    rows.push(["送金", escape(transfer.from), escape(transfer.to), Math.round(transfer.amount)].join(","));
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
