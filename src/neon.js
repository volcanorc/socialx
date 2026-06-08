import { config } from "./config.js";

let authClientPromise = null;
let dataClientPromise = null;

function logLoadError(label, error) {
  console.warn(`Failed to load ${label}.`, error);
}

export async function getNeonAuthClient() {
  if (!config.neonAuthUrl) {
    return null;
  }

  if (!authClientPromise) {
    authClientPromise = (async () => {
      const module = await import("https://esm.sh/@neondatabase/neon-js/auth?bundle");
      const createAuthClient = module.createAuthClient ?? module.default?.createAuthClient ?? null;
      if (!createAuthClient) {
        throw new Error("Neon auth client factory unavailable.");
      }
      return createAuthClient(config.neonAuthUrl);
    })().catch((error) => {
      authClientPromise = null;
      logLoadError("Neon Auth client", error);
      return null;
    });
  }

  return authClientPromise;
}

export async function getNeonDataClient() {
  if (!config.neonDataApiUrl) {
    throw new Error("Neon Data API URL is missing.");
  }

  if (!dataClientPromise) {
    dataClientPromise = (async () => {
      try {
        const { createClient } = await import("https://esm.sh/@neondatabase/neon-js@0.6.1-beta");
        if (typeof createClient !== "function") {
          throw new Error("Neon Data API createClient export unavailable.");
        }

        const client = createClient({
          auth: {
            url: config.neonAuthUrl
          },
          dataApi: {
            url: config.neonDataApiUrl
          }
        });

        if (!client || typeof client.from !== "function" || typeof client.rpc !== "function") {
          throw new Error("Neon Data API client missing required methods.");
        }

        return client;
      } catch (error) {
        dataClientPromise = null;
        console.error("NEON BOOTSTRAP FAILURE:", error);
        throw error;
      }
    })();
  }

  return dataClientPromise;
}
