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
      return {
        session: data?.session ?? null,
        user:    data?.session?.user ?? null,
        error:   error ?? null,
      };
    } catch (error) {
      return { session: null, user: null, error };
    }
  }

  async function signInWithGoogle() {
    const callbackURL = `${getAppOrigin()}${config.signInCallback}`;
    return client.auth.signIn.social({ provider: "google", callbackURL });
  }

  async function signOut() {
    return client.auth.signOut();
  }

  cachedBridge = { client, getSession, signInWithGoogle, signOut };
  return cachedBridge;
}
