export type LoginFieldErrors = { email?: 'required' | 'invalid'; password?: 'required' };

export function validateLoginInput(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = 'required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = 'invalid';
  }

  if (!password) {
    errors.password = 'required';
  }

  return errors;
}

export type ActivationFieldErrors = {
  activationToken?: 'required';
  newPassword?: 'required' | 'tooShort';
  confirmPassword?: 'mismatch';
};

const MIN_PASSWORD_LENGTH = 12;

export function validateActivationInput(input: {
  activationToken: string;
  newPassword: string;
  confirmPassword: string;
}): ActivationFieldErrors {
  const errors: ActivationFieldErrors = {};

  if (!input.activationToken.trim()) {
    errors.activationToken = 'required';
  }

  if (!input.newPassword) {
    errors.newPassword = 'required';
  } else if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = 'tooShort';
  }

  if (!errors.newPassword && input.newPassword !== input.confirmPassword) {
    errors.confirmPassword = 'mismatch';
  }

  return errors;
}
