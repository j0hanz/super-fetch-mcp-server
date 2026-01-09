import { CODE_DETECTORS } from './code-language-detectors.js';
import {
  extractLanguageFromClassName,
  resolveLanguageFromDataAttribute,
} from './code-language-parsing.js';

export function detectLanguageFromCode(code: string): string | undefined {
  for (const { language, detect } of CODE_DETECTORS) {
    if (detect(code)) return language;
  }
  return undefined;
}

export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  const classMatch = extractLanguageFromClassName(className);
  return classMatch ?? resolveLanguageFromDataAttribute(dataLang);
}
