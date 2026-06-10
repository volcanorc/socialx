import { config, getAppOrigin } from "./config.js";
import { getNeonClient } from "./neon.js";

let cachedBridge = null;

export async function createAuthBridge() {
  if (cachedBridge) return cachedBridge;

  const client = await getNeonClient();

  if (!client) {
    return {
      client: null,
      getSession: async () => ({ session: null, user: null, error: new Error("Neon client unavailable") }),
      signInWithGoogle: async () => { throw new Error("Neon client unavailable"); },
      signOut: async () => {},
    };
  }

  async function getSession() {
    try {
      const { data, error } = await client.auth.getSession();
      const session = data?.session ?? null;
      const user =
        data?.user ??
        session?.user ??
        data?.currentUser ??
        session?.currentUser ??
        data?.session?.currentUser ??
        null;
      return {
        session,
        user,
        raw: data ?? null,
        error: error ?? null,
      };
    } catch (error) {
      return { session: null, user: null, raw: null, error };
    }
  }

  async function signInWithGoogle() {
    const callbackURL = `${getAppOrigin()}${config.signInCallback}`;
    const response = await client.auth.signIn.social({ provider: "google", callbackURL });
    const redirectURL =
      response?.data?.url ??
      response?.data?.redirectURL ??
      response?.url ??
      response?.redirectURL ??
      null;

    if (redirectURL && typeof location !== "undefined" && redirectURL !== location.href) {
      location.assign(redirectURL);
    }

    return response;
  }

  async function signOut() {
    return client.auth.signOut();
  }

  cachedBridge = { client, getSession, signInWithGoogle, signOut };
  return cachedBridge;
}
