export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

const usernameCharactersPattern = /^[A-Za-z0-9_]+$/;

export function normalizeUsername(username: string): string {
  return username.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    usernameCharactersPattern.test(username)
  );
}

export function internalUsernameEmail(username: string): string {
  return `${normalizeUsername(username)}@login.invalid`;
}
