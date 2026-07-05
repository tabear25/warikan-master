import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

// OGP メタデータ取得サービス（POST /api/ogp から利用）。
// セキュリティ要件（docs/travel-feature-requirements.md N-Sec-1〜4）:
//  - http/https スキームのみ許可
//  - プライベート / リンクローカル IP への到達を DNS 解決時点でブロック（SSRF 対策）
//  - リダイレクトは各ホップで再検証（最大 3 回）
//  - タイムアウト 3 秒・本文は 512KB まで
// 取得失敗は項目登録を妨げない（クライアント側でエラーを握りつぶし URL だけ保存する）。

export interface OgpResult {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export class OgpFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OgpFetchError";
  }
}

const FETCH_TIMEOUT_MS = 3_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const cache = new Map<string, { expires: number; result: OgpResult }>();

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true; // 不正な形式は安全側に倒してブロック
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // リンクローカル（クラウドのメタデータ endpoint 含む）
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24（IETF 予約）・192.0.2.0/24（TEST-NET）
    (a === 198 && (b === 18 || b === 19)) || // ベンチマーク用 198.18.0.0/15
    a >= 224 // マルチキャスト・予約・ブロードキャスト
  );
}

function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::" || normalized === "::1") return true;
    if (/^fe[89ab]/.test(normalized)) return true; // リンクローカル fe80::/10
    if (/^f[cd]/.test(normalized)) return true; // ULA fc00::/7
    const mapped = normalized.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4 射影アドレス
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true; // IP と解釈できない値は呼び出し側の想定外なのでブロック
}

async function assertPublicHost(hostname: string): Promise<void> {
  // URL.hostname は IPv6 をブラケット付きで返す（例: "[::1]"）。
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  if (isIP(bare)) {
    if (isPrivateIp(bare)) throw new OgpFetchError("この URL へのアクセスは許可されていません", 400);
    return;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new OgpFetchError("ホスト名を解決できませんでした", 400);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new OgpFetchError("ホスト名を解決できませんでした", 400);
  }
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new OgpFetchError("この URL へのアクセスは許可されていません", 400);
  }
}

async function readBodyLimited(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  if (total >= MAX_BODY_BYTES) {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.byteLength) break;
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, merged.byteLength - offset));
    merged.set(slice, offset);
    offset += slice.byteLength;
  }
  return merged;
}

function decodeHtmlBytes(bytes: Uint8Array, contentTypeHeader: string): string {
  let charset = contentTypeHeader.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) {
    // 先頭 1KB を ASCII 相当として覗き、<meta charset> を探す（日本の古いサイトは Shift_JIS がある）。
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "·",
  raquo: "»",
  laquo: "«",
};

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function extractMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // property/name 属性が content の前後どちらにあっても拾えるよう両方向で探す。
  const patterns = [
    new RegExp(
      `<meta[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const decoded = decodeEntities(match[1]).trim();
      if (decoded) return decoded;
    }
  }
  return null;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function parseOgp(html: string, finalUrl: URL): OgpResult {
  let title = extractMeta(html, "og:title") ?? extractMeta(html, "twitter:title");
  if (!title) {
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    if (titleTag) title = decodeEntities(titleTag).trim() || null;
  }

  const description =
    extractMeta(html, "og:description") ??
    extractMeta(html, "twitter:description") ??
    extractMeta(html, "description");

  const siteName = extractMeta(html, "og:site_name");

  let image: string | null = null;
  const rawImage =
    extractMeta(html, "og:image") ?? extractMeta(html, "og:image:url") ?? extractMeta(html, "twitter:image");
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, finalUrl);
      if ((resolved.protocol === "http:" || resolved.protocol === "https:") && resolved.href.length <= 2048) {
        image = resolved.href;
      }
    } catch {
      // 相対 URL の解決に失敗したら画像なし扱い
    }
  }

  return {
    title: truncate(title, 200),
    description: truncate(description, 300),
    image,
    siteName: truncate(siteName, 100),
  };
}

async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new OgpFetchError("http(s) の URL のみ対応しています", 400);
      }
      await assertPublicHost(current.hostname);

      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "WarikanMaster/1.0 (+OGP fetcher)",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "ja,en;q=0.8",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location) throw new OgpFetchError("リダイレクト先が不明です", 502);
        current = new URL(location, current); // 次のループ先頭で再検証される
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new OgpFetchError(`ページを取得できませんでした（HTTP ${response.status}）`, 502);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        throw new OgpFetchError("HTML ページではないため情報を取得できません", 400);
      }

      const bytes = await readBodyLimited(response);
      return { html: decodeHtmlBytes(bytes, contentType), finalUrl: current };
    }
    throw new OgpFetchError("リダイレクトが多すぎます", 502);
  } catch (err) {
    if (err instanceof OgpFetchError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OgpFetchError("取得がタイムアウトしました", 504);
    }
    if (err instanceof TypeError && err.message.includes("Invalid URL")) {
      throw new OgpFetchError("URL の形式が不正です", 400);
    }
    throw new OgpFetchError("ページを取得できませんでした", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOgpMetadata(rawUrl: string): Promise<OgpResult> {
  const cached = cache.get(rawUrl);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  const { html, finalUrl } = await fetchHtml(rawUrl);
  const result = parseOgp(html, finalUrl);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(rawUrl, { expires: Date.now() + CACHE_TTL_MS, result });
  return result;
}
