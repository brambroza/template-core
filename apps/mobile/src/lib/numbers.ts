/**
 * Pure helpers for typing numbers on a phone (no React Native imports, so they run in plain tests).
 * The formatting itself — grouping, decimals, the company setting — is `typeNumber` / `showNumber` in @erp/ui-schema.
 */

/**
 * Phones set to a European region put "," on the decimal key. Thousands commas are now written by the app, so a comma
 * the person just typed can only mean the decimal point: "12" -> "12," becomes "12.".
 * `before` is the text the field showed, `typed` what the keyboard made of it; anything but one typed comma is left alone.
 */
export function commaAsPoint(typed: string, before: string): string {
  if (typed.length !== before.length + 1) return typed;
  let i = 0;
  while (i < before.length && typed[i] === before[i]) i++;
  if (typed[i] !== ',' || typed.slice(0, i) + typed.slice(i + 1) !== before) return typed;
  return `${typed.slice(0, i)}.${typed.slice(i + 1)}`;
}
