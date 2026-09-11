import { api } from "~/lib/api";

export interface User {
  id: string;
  avatar: string;
  email: string;
  name: string;
  workspaces: {
    id: string;
  }[];
}

/** Current Railway user, or null when the session cookie is missing/expired
 * or the API is unreachable. */
export async function getMe(): Promise<User | null> {
  try {
    const res = await api.get("auth/me", { throwHttpErrors: false });
    if (!res.ok) return null;
    return res.json<User>();
  } catch {
    return null;
  }
}

/** True when the Go API answers /api/health. */
export async function getApiHealth(): Promise<boolean> {
  try {
    const res = await api.get("health", { throwHttpErrors: false });
    return res.ok;
  } catch {
    return false;
  }
}
