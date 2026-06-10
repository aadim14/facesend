import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isValidPhone,
  normalizePhone,
  parseContact,
  validateTag,
} from "@/lib/contacts";

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
  });

  it("rejects strings without a domain dot", () => {
    expect(isValidEmail("ana@example")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("ana@")).toBe(false);
  });
});

describe("phone validation", () => {
  it("normalizes spaces, dashes, dots and parens", () => {
    expect(normalizePhone("(415) 555-0123")).toBe("4155550123");
    expect(normalizePhone("+1 415.555.0123")).toBe("+14155550123");
  });

  it("accepts 10- and 11-digit numbers with formatting", () => {
    expect(isValidPhone("(415) 555-0123")).toBe(true);
    expect(isValidPhone("+1 415-555-0123")).toBe(true);
  });

  it("rejects too-short and too-long numbers", () => {
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("12345678901234567890")).toBe(false);
  });

  it("rejects letters", () => {
    expect(isValidPhone("call me maybe")).toBe(false);
  });
});

describe("parseContact", () => {
  it("detects emails", () => {
    expect(parseContact("ana@example.com")).toEqual({ email: "ana@example.com" });
  });

  it("detects phones and stores them normalized", () => {
    expect(parseContact("(415) 555-0123")).toEqual({ phone: "4155550123" });
  });

  it("returns null for invalid input", () => {
    expect(parseContact("bad@")).toBeNull();
    expect(parseContact("hello")).toBeNull();
    expect(parseContact("   ")).toBeNull();
  });
});

describe("validateTag", () => {
  it("requires a name", () => {
    expect(validateTag("", "ana@example.com").ok).toBe(false);
    expect(validateTag("   ", "ana@example.com").ok).toBe(false);
  });

  it("requires some contact", () => {
    expect(validateTag("Ana", "").ok).toBe(false);
  });

  it("rejects an invalid contact", () => {
    expect(validateTag("Ana", "nope").ok).toBe(false);
  });

  it("passes with name + email", () => {
    expect(validateTag("Ana", "ana@example.com").ok).toBe(true);
  });

  it("passes with name + phone", () => {
    expect(validateTag("Ana", "415 555 0123").ok).toBe(true);
  });
});
