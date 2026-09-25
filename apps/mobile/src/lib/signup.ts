// "New customer" sign-up form: values, per-field validation and the full
// name sent to start_new_customer. Pure (no React Native imports), so it's
// unit-tested under node --test (test/signup.test.ts).

export type SignupField = 'firstName' | 'lastName' | 'email' | 'phone';

export interface SignupValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** Per-field messages, plus `form` for a failure that isn't one field's fault. */
export type SignupErrors = Partial<Record<SignupField | 'form', string>>;

export const EMPTY_SIGNUP: SignupValues = { firstName: '', lastName: '', email: '', phone: '' };

/** start_new_customer accepts a trimmed name of 1–80 characters and a phone of up to 30. */
export const MAX_NAME = 80;
export const MAX_PHONE = 30;

export const SIGNUP_MSG = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  nameTooLong: `Use a name of ${MAX_NAME} characters or fewer in total.`,
  email: 'Enter your email.',
  emailFormat: 'Enter an email like name@example.com.',
  phoneChars: 'Use digits, spaces and + ( ) - . only.',
  phoneDigits: 'Enter a phone number with 7 to 20 digits.',
  phoneLength: `Use ${MAX_PHONE} characters or fewer.`,
} as const;

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

/** "Taylor" + "Kim" → "Taylor Kim" (trimmed, single spaces). */
export function signupFullName(v: Pick<SignupValues, 'firstName' | 'lastName'>): string {
  return squash(`${v.firstName} ${v.lastName}`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[^\s@.]{2,}$/;
const PHONE_CHARS_RE = /^[0-9 +().-]+$/;

/** The message for one field, or undefined when it's fine. */
export function validateSignupField(field: SignupField, v: SignupValues): string | undefined {
  switch (field) {
    case 'firstName':
      return squash(v.firstName) ? undefined : SIGNUP_MSG.firstName;
    case 'lastName':
      if (!squash(v.lastName)) return SIGNUP_MSG.lastName;
      return signupFullName(v).length > MAX_NAME ? SIGNUP_MSG.nameTooLong : undefined;
    case 'email': {
      const e = v.email.trim();
      if (!e) return SIGNUP_MSG.email;
      return EMAIL_RE.test(e) ? undefined : SIGNUP_MSG.emailFormat;
    }
    case 'phone': {
      const p = v.phone.trim();
      if (!p) return undefined; // optional
      if (!PHONE_CHARS_RE.test(p)) return SIGNUP_MSG.phoneChars;
      const digits = p.replace(/\D/g, '').length;
      if (digits < 7 || digits > 20) return SIGNUP_MSG.phoneDigits;
      return p.length > MAX_PHONE ? SIGNUP_MSG.phoneLength : undefined;
    }
  }
}

/** Every field's message; empty when the form can be submitted. */
export function validateSignup(v: SignupValues): SignupErrors {
  const out: SignupErrors = {};
  for (const f of ['firstName', 'lastName', 'email', 'phone'] as const) {
    const m = validateSignupField(f, v);
    if (m) out[f] = m;
  }
  return out;
}

/** What startNewCustomer receives: full name, email and phone, trimmed (phone omitted when blank). */
export function signupPayload(v: SignupValues): { fullName: string; email: string; phone?: string } {
  const phone = v.phone.trim();
  return { fullName: signupFullName(v), email: v.email.trim(), ...(phone ? { phone } : {}) };
}
