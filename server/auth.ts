import bcrypt from "bcryptjs";

// 管理者認証情報は環境変数からのみ取得する。ハードコードされたデフォルト値は持たない。
interface AdminConfig {
  username: string;
  passwordHash: string;
}

let adminConfig: AdminConfig | null = null;

// 推測されやすいユーザー名 / パスワード。設定されていたら起動を中止する。
const WEAK_USERNAMES = ["admin", "root", "test", "user", "administrator", "guest"];
const WEAK_PASSWORDS = [
  "admin", "root", "test", "user", "guest",
  "password", "1234", "12345678", "123456", "qwerty",
];

// bcrypt ハッシュの形式（$2a$ / $2b$ / $2y$ + コストファクター）。
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

/**
 * 環境変数から管理者認証情報を読み込み、検証する。
 * 未設定・不正な場合は Error を throw する（呼び出し側でプロセスを終了させる = fail-fast）。
 */
export function loadAdminConfig(): AdminConfig {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!username || !passwordHash) {
    throw new Error(
      "管理者認証情報が未設定です。環境変数 ADMIN_USERNAME と ADMIN_PASSWORD_HASH を設定してください（.env.example を参照）。",
    );
  }

  if (!BCRYPT_HASH_PATTERN.test(passwordHash)) {
    throw new Error(
      "ADMIN_PASSWORD_HASH は bcrypt ハッシュである必要があります（平文パスワードは設定できません）。",
    );
  }

  if (WEAK_USERNAMES.includes(username.toLowerCase())) {
    throw new Error(
      `ADMIN_USERNAME "${username}" は推測されやすい値です。別のユーザー名に変更してください。`,
    );
  }

  for (const weak of WEAK_PASSWORDS) {
    if (bcrypt.compareSync(weak, passwordHash)) {
      throw new Error(
        "ADMIN_PASSWORD_HASH が既知の弱いパスワードに一致します。8文字以上の強いパスワードのハッシュに変更してください。",
      );
    }
  }

  adminConfig = { username, passwordHash };
  return adminConfig;
}

/**
 * 入力された資格情報が管理者と一致するか検証する。
 * ユーザー名が一致しない場合もダミーの bcrypt 比較を実行し、応答時間の差を抑える。
 */
export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  if (!adminConfig) return false;

  if (username !== adminConfig.username) {
    await bcrypt.compare(password, adminConfig.passwordHash);
    return false;
  }

  return bcrypt.compare(password, adminConfig.passwordHash);
}
