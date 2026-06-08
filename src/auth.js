import { config, getAppOrigin } from "./config.js";
import { getNeonAuthClient } from "./neon.js";

let cachedClient = null;

function normalizeSession(response) {
  const data = response?.data ?? response ?? {};
  const session = data.session ?? data?.data?.session ?? null;
  const user = data.user ?? session?.user ?? data?.data?.user ?? null;
  const error = response?.error ?? null;
  return { session, user, error, raw: data };
}

export async function createAuthBridge() {
  if (cachedClient) {
    return cachedClient;
  }

  const client = await getNeonAuthClient();

  async function getSession() {
    if (!client) {
      return { user: null, session: null, error: new Error("Auth client unavailable") };
    }
    try {
      const response = await (client.getSession?.() ?? client.session?.() ?? Promise.resolve(null));
      return normalizeSession(response);
    } catch (error) {
      return { user: null, session: null, error };
    }
  }

  async function signInWithGoogle() {
    if (!client) {
      throw new Error("Auth client unavailable");
    }

    const callbackURL = `${getAppOrigin()}${config.signInCallback}`;
    if (client.signIn?.social) {
      return client.signIn.social({
        provider: "google",
        callbackURL
      });
    }

    if (client.signInWithOAuth) {
      return client.signInWithOAuth({
        provider: "google",
        callbackURL,
        options: {
          redirectTo: callbackURL
        }
      });
    }

    if (client.signInWithSocial) {
      return client.signInWithSocial({
        provider: "google",
        callbackURL
      });
    }

    throw new Error("This Neon Auth client build does not expose a supported Google sign-in method.");
  }

  async function signOut() {
    if (!client) return;
    if (client.signOut) {
      return client.signOut();
    }
    if (client.logout) {
      return client.logout();
    }
  }

  cachedClient = {
    client,
    getSession,
    signInWithGoogle,
    signOut
  };

  return cachedClient;
}
