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
 * パスワードは ADMIN_PASSWORD（平文・起動時にハッシュ化）または
 * ADMIN_PASSWORD_HASH（bcrypt ハッシュ）のいずれかで設定できる。
 * 未設定・不正な場合は Error を throw する（呼び出し側でプロセスを終了させる = fail-fast）。
 */
export function loadAdminConfig(): AdminConfig {
  // ユーザー名とハッシュは前後の空白・改行を除去する（貼り付け時の混入対策）。
  // 平文パスワードは空白も有効な文字になりうるため trim しない。
  const username = process.env.ADMIN_USERNAME?.trim();
  const plaintext = process.env.ADMIN_PASSWORD;
  const hashEnv = process.env.ADMIN_PASSWORD_HASH?.trim();

  if (!username) {
    throw new Error(
      "管理者認証情報が未設定です。環境変数 ADMIN_USERNAME を設定してください（.env.example を参照）。",
    );
  }

  if (WEAK_USERNAMES.includes(username.toLowerCase())) {
    throw new Error(
      `ADMIN_USERNAME "${username}" は推測されやすい値です。別のユーザー名に変更してください。`,
    );
  }

  let passwordHash: string;

  if (plaintext) {
    // 平文パスワード: 起動時にメモリ上でハッシュ化する（ディスクには保存しない）。
    if (hashEnv) {
      console.warn(
        "[管理者認証] ADMIN_PASSWORD と ADMIN_PASSWORD_HASH の両方が設定されています。ADMIN_PASSWORD を使用します。",
      );
    }
    if (plaintext.length < 8) {
      throw new Error("ADMIN_PASSWORD は8文字以上にしてください。");
    }
    if (WEAK_PASSWORDS.includes(plaintext.toLowerCase())) {
      throw new Error(
        "ADMIN_PASSWORD が既知の弱いパスワードです。推測されにくいパスワードに変更してください。",
      );
    }
    passwordHash = bcrypt.hashSync(plaintext, 12);
  } else if (hashEnv) {
    // 事前に生成された bcrypt ハッシュ。
    if (!BCRYPT_HASH_PATTERN.test(hashEnv)) {
      throw new Error(
        "ADMIN_PASSWORD_HASH が bcrypt ハッシュの形式ではありません。値の前後に引用符や空白・改行が" +
          "混入していないか確認してください。平文を ADMIN_PASSWORD に設定する方法も使えます。",
      );
    }
    for (const weak of WEAK_PASSWORDS) {
      if (bcrypt.compareSync(weak, hashEnv)) {
        throw new Error(
          "ADMIN_PASSWORD_HASH が既知の弱いパスワードに一致します。8文字以上の強いパスワードのハッシュに変更してください。",
        );
      }
    }
    passwordHash = hashEnv;
  } else {
    throw new Error(
      "管理者パスワードが未設定です。環境変数 ADMIN_PASSWORD（平文・8文字以上）または " +
        "ADMIN_PASSWORD_HASH（bcrypt ハッシュ）のいずれかを設定してください（.env.example を参照）。",
    );
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
