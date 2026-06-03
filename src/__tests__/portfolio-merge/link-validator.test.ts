/**
 * Unit tests for `src/lib/profile/link-validator.ts`.
 *
 * Covers Issue #3 of the portfolio audit (link validation) and a chunk of
 * Issue #4 (private-net rejection at the link layer). Network-touching code
 * paths are tested via `vi.spyOn(globalThis, "fetch")` mocks; the
 * structural gate runs without any network.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSafePublicUrl,
  validateExternalLink,
  validateLinksInProjects,
} from "@/lib/profile/link-validator";

// ── isSafePublicUrl ────────────────────────────────────────────────────────

describe("isSafePublicUrl", () => {
  it("accepts ordinary https URLs", () => {
    expect(isSafePublicUrl("https://github.com/me/repo")).toBe(true);
    expect(isSafePublicUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isSafePublicUrl("http://example.com")).toBe(true);
  });

  it("rejects empty / non-string / malformed input", () => {
    expect(isSafePublicUrl("")).toBe(false);
    expect(isSafePublicUrl("   ")).toBe(false);
    expect(isSafePublicUrl(null)).toBe(false);
    expect(isSafePublicUrl(undefined)).toBe(false);
    expect(isSafePublicUrl(123 as unknown)).toBe(false);
    expect(isSafePublicUrl("not a url")).toBe(false);
    expect(isSafePublicUrl("/relative/path")).toBe(false);
  });

  it("rejects dangerous protocols", () => {
    expect(isSafePublicUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePublicUrl("data:text/html,<script>")).toBe(false);
    expect(isSafePublicUrl("file:///etc/passwd")).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/x")).toBe(false);
    expect(isSafePublicUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects loopback + private network hosts", () => {
    expect(isSafePublicUrl("http://localhost/x")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1/x")).toBe(false);
    expect(isSafePublicUrl("http://10.0.0.1/x")).toBe(false);
    expect(isSafePublicUrl("http://172.16.0.1/x")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.1/x")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/x")).toBe(false); // AWS IMDS
    expect(isSafePublicUrl("http://0.0.0.0/x")).toBe(false);
  });
});

// ── validateExternalLink ───────────────────────────────────────────────────

describe("validateExternalLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns blocked for unsafe URLs without making a network request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const out = await validateExternalLink("javascript:alert(1)");
    expect(out).toEqual({ ok: false, url: "javascript:alert(1)", reason: "blocked" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok when HEAD returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const out = await validateExternalLink("https://example.com");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.status).toBe(200);
  });

  it("retries with GET when HEAD returns 405", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 206 }));
    const out = await validateExternalLink("https://example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
  });

  it("returns http_error on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    const out = await validateExternalLink("https://example.com/missing");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("http_error");
      expect(out.status).toBe(404);
    }
  });

  it("returns network reason on fetch throw", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const out = await validateExternalLink("https://example.com");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("network");
  });
});

// ── validateLinksInProjects ────────────────────────────────────────────────

describe("validateLinksInProjects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("nullifies invalid `link` and reports per-project results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("good")) return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    });

    const projects = [
      { link: "https://good.example.com", github: "me/good-repo" },
      { link: "https://broken.example.com/missing", github: null },
      { link: "javascript:alert(1)", github: null }, // structurally blocked
    ];

    const { projects: cleaned, report } = await validateLinksInProjects(projects);
    expect(cleaned[0].link).toBe("https://good.example.com");
    expect(cleaned[1].link).toBeNull();
    expect(cleaned[2].link).toBeNull();
    expect(report[2]?.link?.ok).toBe(false);
    if (report[2]?.link && !report[2].link.ok) {
      expect(report[2].link.reason).toBe("blocked");
    }
  });

  it("never blanks a valid GitHub slug on transient network failure", async () => {
    // Simulate every probe returning a network error.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENETUNREACH"));
    const projects = [{ link: null, github: "me/my-repo" }];
    const { projects: cleaned, report } = await validateLinksInProjects(projects);
    // We only blank github when the URL is structurally blocked.
    expect(cleaned[0].github).toBe("me/my-repo");
    expect(report[0]?.github?.ok).toBe(false);
  });
});
