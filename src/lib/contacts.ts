import type { ContactInfo } from "@/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Strip common phone formatting; keep a leading +. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[\s().-]/g, "").replace(/^\+/, "");
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  return /^\+?\d{7,15}$/.test(normalized);
}

/**
 * Interpret a free-form contact field as an email or a phone number.
 * Returns null when it is neither.
 */
export function parseContact(value: string): ContactInfo | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("@")) {
    return isValidEmail(trimmed) ? { email: trimmed } : null;
  }
  return isValidPhone(trimmed) ? { phone: normalizePhone(trimmed) } : null;
}

export interface TagValidation {
  ok: boolean;
  error?: string;
}

/** A person tag needs a non-empty name and a valid email or phone. */
export function validateTag(name: string, contactValue: string): TagValidation {
  if (name.trim().length === 0) {
    return { ok: false, error: "Name is required" };
  }
  if (contactValue.trim().length === 0) {
    return { ok: false, error: "Add a phone number or email" };
  }
  if (parseContact(contactValue) === null) {
    return { ok: false, error: "Enter a valid phone number or email" };
  }
  return { ok: true };
}
