// Shared, client-safe helpers for account identity display.
//
// Phone-registered users have a hidden synthetic email
// (`<phone>@phone.starzeco.com`) as their internal account key. We never show
// that synthetic email — phone users see their (masked) phone number instead.

const PHONE_DOMAIN =
  process.env.NEXT_PUBLIC_PHONE_EMAIL_DOMAIN || "phone.starzeco.com";

/** True when the account's email is the internal synthetic phone email. */
export function isPhoneAccount(email: string | undefined | null): boolean {
  return !!email && email.endsWith(`@${PHONE_DOMAIN}`);
}

/** Mask an 11-digit mainland phone: 138****8888. */
export function maskPhone(p: string): string {
  return /^\d{11}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : p;
}

/**
 * The email to SHOW for an account, or "" when it should be hidden (phone
 * accounts, whose email is synthetic/internal).
 */
export function displayEmail(email: string | undefined | null): string {
  return !email || isPhoneAccount(email) ? "" : email;
}
