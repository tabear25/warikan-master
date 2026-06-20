import * as SecureStore from "expo-secure-store";

// Admin credentials are sent on every admin request as headers (the API has no
// sessions). We persist them in the device keystore so the admin stays logged
// in across app launches. SecureStore keys must be alphanumeric / ._-.
const KEY = "warikan_admin_creds";

export interface AdminCredentials {
  username: string;
  password: string;
}

export async function loadAdminCredentials(): Promise<AdminCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminCredentials;
    if (parsed?.username && parsed?.password) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveAdminCredentials(creds: AdminCredentials): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
  } catch {
    // Non-fatal: the session still works with in-memory creds.
  }
}

export async function clearAdminCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
