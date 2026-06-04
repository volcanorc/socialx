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
    return null;
  }

  if (!dataClientPromise) {
    dataClientPromise = (async () => {
      const [core, adapters] = await Promise.all([
        import("https://esm.sh/@neondatabase/neon-js?bundle"),
        import("https://esm.sh/@neondatabase/neon-js/auth/react/adapters?bundle")
      ]);
      const createClient = core.createClient ?? core.default?.createClient ?? null;
      const adapterFactory = adapters.BetterAuthReactAdapter ?? adapters.default?.BetterAuthReactAdapter ?? null;
      if (!createClient || !adapterFactory) {
        throw new Error("Neon data client factory unavailable.");
      }
      return createClient({
        auth: {
          adapter: adapterFactory(),
          url: config.neonAuthUrl
        },
        dataApi: {
          url: config.neonDataApiUrl
        }
      });
    })().catch((error) => {
      dataClientPromise = null;
      logLoadError("Neon Data API client", error);
      return null;
    });
  }

  return dataClientPromise;
}
