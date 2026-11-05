// Signing and request plumbing shared by every SenseCore helper. Each skill's scripts/ links here,
// so a skill must be installed by symlink (or copied with `cp -RL`) to keep the link resolvable.
import crypto from "node:crypto";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function buildAuthorization({
  accessKeyId,
  secretAccessKey,
  method,
  path: requestPath,
  date = new Date().toUTCString(),
}) {
  const upperMethod = method.toUpperCase();
  const stringToSign = `x-date: ${date}\n${upperMethod} ${requestPath} HTTP/1.1`;
  const signature = crypto
    .createHmac("sha256", secretAccessKey)
    .update(stringToSign)
    .digest("base64");
  const authorization = `hmac accesskey="${accessKeyId}", algorithm="hmac-sha256", `
    + `headers="x-date request-line", signature="${signature}"`;
  return { authorization, date, signature, stringToSign };
}

export function requireMutationConfirmation(method, args) {
  const upperMethod = method.toUpperCase();
  if (MUTATING_METHODS.has(upperMethod) && !args.includes("--yes")) {
    throw new Error(`Refusing ${upperMethod} without --yes`);
  }
}

function credentialsFromEnv(env = process.env) {
  const accessKeyId = env.SENSECORE_ACCESS_KEY_ID;
  const secretAccessKey = env.SENSECORE_ACCESS_KEY_SECRET;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Set SENSECORE_ACCESS_KEY_ID and SENSECORE_ACCESS_KEY_SECRET in the current process",
    );
  }
  return { accessKeyId, secretAccessKey };
}

async function parseResponse(response, label) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${label} HTTP ${response.status}: ${detail}`);
  }
  return data;
}

export async function signedFetch({
  host,
  method,
  path: requestPath,
  body,
  args = [],
  headers: extraHeaders = {},
  label = "SenseCore",
  env = process.env,
  fetchImpl = fetch,
}) {
  const upperMethod = method.toUpperCase();
  requireMutationConfirmation(upperMethod, args);
  if (!requestPath.startsWith("/")) throw new Error("Request path must start with /");

  const credentials = credentialsFromEnv(env);
  const signed = buildAuthorization({ ...credentials, method: upperMethod, path: requestPath });
  const headers = {
    ...extraHeaders,
    Authorization: signed.authorization,
    "X-Date": signed.date,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetchImpl(`${host}${requestPath}`, {
    method: upperMethod,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse(response, label);
}
