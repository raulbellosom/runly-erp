import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  resolveAppBaseUrl,
  renderRunlyEmailLayout,
  buildCallInviteEmail,
} from "../email-templates.js";

describe("escapeHtml", () => {
  it("escapes the dangerous five", () => {
    assert.equal(escapeHtml(`<b>"a"&'x'`), "&lt;b&gt;&quot;a&quot;&amp;&#39;x&#39;");
  });
});

describe("resolveAppBaseUrl", () => {
  it("honours PUBLIC_APP_URL first, then APP_URL / RUNLY_APP_URL / WEB_APP_URL", () => {
    assert.equal(resolveAppBaseUrl({ PUBLIC_APP_URL: "https://a.test/" }), "https://a.test");
    assert.equal(resolveAppBaseUrl({ RUNLY_APP_URL: "https://b.test" }), "https://b.test");
    assert.equal(resolveAppBaseUrl({ WEB_APP_URL: "https://c.test/app" }), "https://c.test");
  });
  it("rejects non-http junk and falls back only outside production", () => {
    assert.equal(resolveAppBaseUrl({ PUBLIC_APP_URL: "not a url", NODE_ENV: "production" }), null);
    assert.equal(resolveAppBaseUrl({ NODE_ENV: "development" }), "http://localhost:5173");
  });
});

describe("renderRunlyEmailLayout", () => {
  it("escapes the heading and renders the CTA with the raw url", () => {
    const html = renderRunlyEmailLayout({
      heading: "Hola <script>",
      cta: { label: "Ir", url: "https://x.test/p/call/abc?i=1" },
      env: {},
    });
    assert.match(html, /Hola &lt;script&gt;/);
    assert.match(html, /href="https:\/\/x\.test\/p\/call\/abc\?i=1"/);
    assert.doesNotMatch(html, /<script>/);
  });
  it("omits the logo img when no api base url resolves", () => {
    const html = renderRunlyEmailLayout({ heading: "x", env: { NODE_ENV: "production" } });
    assert.doesNotMatch(html, /runly-logo-horizontal/);
  });
  it("always links the footer credit to runly.mx", () => {
    const html = renderRunlyEmailLayout({ heading: "x", env: {} });
    assert.match(html, /href="https:\/\/runly\.mx"[^>]*>Runly ERP<\/a>/);
  });
});

describe("buildCallInviteEmail", () => {
  it("puts the join url in both html and text, and names the inviter", () => {
    const out = buildCallInviteEmail({
      joinUrl: "https://x.test/p/call/tok?i=inv",
      inviterName: "Raul",
      conversationTitle: "#general",
      env: {},
    });
    assert.equal(out.subject, "Te invitaron a una llamada");
    assert.match(out.text, /Raul te invitó/);
    assert.match(out.text, /https:\/\/x\.test\/p\/call\/tok\?i=inv/);
    assert.match(out.html, /Raul te invitó/);
    assert.match(out.html, /href="https:\/\/x\.test\/p\/call\/tok\?i=inv"/);
    assert.match(out.html, /#general/);
    assert.match(out.text, /Runly ERP/);
    assert.match(out.html, /en Runly ERP/);
  });
  it("falls back to generic wording without an inviter", () => {
    const out = buildCallInviteEmail({ joinUrl: "https://x.test/p/call/tok", env: {} });
    assert.match(out.text, /Te invitaron a una videollamada\./);
  });
  it("escapes a malicious inviter name in the html", () => {
    const out = buildCallInviteEmail({
      joinUrl: "https://x.test/p/call/tok",
      inviterName: '<img src=x onerror=alert(1)>',
      env: {},
    });
    assert.doesNotMatch(out.html, /<img src=x/);
    assert.match(out.html, /&lt;img src=x/);
  });
});
