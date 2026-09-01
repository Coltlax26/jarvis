import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { TwilioClient } from "./client.js";

const token = "test-auth-token";
const client = new TwilioClient({
  accountSid: "AC123",
  authToken: token,
  fromNumber: "+15550001111",
});

function sign(url: string, params: Record<string, string>): string {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

describe("TwilioClient.verifySignature", () => {
  const url = "https://jarvis.example.com/twilio/sms";
  const params = { From: "+15551234567", Body: "hey jarvis", To: "+15550001111" };

  it("accepts a correctly signed request", () => {
    expect(client.verifySignature(sign(url, params), url, params)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const good = sign(url, params);
    expect(client.verifySignature(good, url, { ...params, Body: "different" })).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(client.verifySignature(undefined, url, params)).toBe(false);
  });

  it("rejects a signature for a different URL", () => {
    const other = sign("https://evil.example.com/twilio/sms", params);
    expect(client.verifySignature(other, url, params)).toBe(false);
  });
});
