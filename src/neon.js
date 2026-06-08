import { config } from "./config.js";

let clientPromise = null;

export async function getNeonClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@neondatabase/neon-js@0.6.1-beta/+esm"
    );
    return createClient({
      auth: { url: config.neonAuthUrl },
      dataApi: { url: config.neonDataApiUrl }
    });
  })().catch((err) => {
    clientPromise = null;
    console.error("[Neon] bootstrap failed:", err);
    return null;
  });

  return clientPromise;
}

export const getNeonAuthClient = getNeonClient;
export const getNeonDataClient = getNeonClient;
