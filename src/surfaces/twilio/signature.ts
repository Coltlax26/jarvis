import { createHmac } from "node:crypto";

/**
 * Validate an inbound Twilio webhook request.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string | undefined,
  fullUrl: string,
  params: Record<string, string>
): boolean {
  if (!signature) return false;
  let data = fullUrl;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
