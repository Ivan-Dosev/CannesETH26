import { NextRequest, NextResponse } from "next/server";
import { UsersApi, Configuration } from "@dynamic-labs/sdk-api";

const ENV_ID   = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID!;
const DYNAMIC_API_KEY = process.env.DYNAMIC_API_KEY ?? "";
const JWKS_URL = `https://app.dynamic.xyz/api/v0/sdk/${ENV_ID}/.well-known/jwks`;

// Dynamic JS SDK client — used to fetch full user profile after JWT verification
const dynamicUsersApi = new UsersApi(new Configuration({
  basePath: "https://app.dynamic.xyz/api/v0",
  apiKey:   DYNAMIC_API_KEY,
}));

// Cache the JWKS so we don't fetch on every request
let jwksCache: { keys: any[] } | null = null;
let jwksCacheTime = 0;
const JWKS_TTL = 5 * 60 * 1000; // 5 minutes

async function getJwks() {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_TTL) return jwksCache;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  jwksCache = await res.json();
  jwksCacheTime = now;
  return jwksCache!;
}

// Decode a base64url string
function base64urlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Import a JWK public key for RS256 verification
async function importRsaKey(jwk: any): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

// Minimal JWT verifier (RS256 only) — no external dependencies
async function verifyDynamicJwt(token: string): Promise<{ sub: string; email?: string; alias?: string; verified_credentials?: any[] }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));

  if (header.alg !== "RS256") throw new Error(`Unsupported algorithm: ${header.alg}`);

  const jwks = await getJwks();
  const key  = jwks.keys.find((k: any) => k.kid === header.kid) ?? jwks.keys[0];
  if (!key) throw new Error("No matching JWK found");

  const cryptoKey = await importRsaKey(key);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`).buffer as ArrayBuffer;
  const signature    = base64urlDecode(sigB64).buffer as ArrayBuffer;

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signingInput);
  if (!valid) throw new Error("JWT signature verification failed");

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("JWT has expired");
  }

  return payload;
}

// GET /api/verify-user — verifies Dynamic JWT then fetches full user via Dynamic JS SDK
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  try {
    // Step 1: verify JWT signature using Dynamic JWKS (cryptographic proof)
    const payload = await verifyDynamicJwt(token);

    // Step 2: fetch full user profile via Dynamic JS SDK (sdk-api)
    let sdkUser = null;
    if (DYNAMIC_API_KEY && payload.sub) {
      try {
        sdkUser = await dynamicUsersApi.getUser({
          environmentId: ENV_ID,
          userId:        payload.sub,
        });
      } catch {
        // Non-fatal — JWT is still verified, SDK fetch is best-effort
      }
    }

    return NextResponse.json({
      verified:    true,
      userId:      payload.sub,
      email:       (sdkUser as any)?.email ?? payload.email ?? null,
      alias:       (sdkUser as any)?.alias ?? payload.alias ?? null,
      wallets:     (sdkUser as any)?.wallets ?? payload.verified_credentials ?? [],
      environment: ENV_ID,
      sdkEnriched: !!sdkUser,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, verified: false }, { status: 401 });
  }
}
