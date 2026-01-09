import type TurndownService from 'turndown';

import { CODE_BLOCK } from '../../config/formatting.js';

import {
  detectLanguageFromCode,
  resolveLanguageFromAttributes,
} from '../../utils/code-language.js';
import { isRecord } from '../../utils/guards.js';

function isElement(node: unknown): node is HTMLElement {
  return (
    isRecord(node) &&
    'getAttribute' in node &&
    typeof node.getAttribute === 'function'
  );
}

function isFencedCodeBlock(
  node: TurndownService.Node,
  options: TurndownService.Options
): boolean {
  return (
    options.codeBlockStyle === 'fenced' &&
    node.nodeName === 'PRE' &&
    node.firstChild?.nodeName === 'CODE'
  );
}

function formatFencedCodeBlock(node: TurndownService.Node): string {
  const codeNode = node.firstChild;
  if (!isElement(codeNode)) return '';

  const code = codeNode.textContent || '';
  const language = resolveCodeLanguage(codeNode, code);
  return CODE_BLOCK.format(code, language);
}

function resolveCodeLanguage(codeNode: HTMLElement, code: string): string {
  const { className, dataLanguage } = readCodeAttributes(codeNode);
  const attributeLanguage = resolveLanguageFromAttributes(
    className,
    dataLanguage
  );
  return attributeLanguage ?? detectLanguageFromCode(code) ?? '';
}

function readCodeAttributes(codeNode: HTMLElement): {
  className: string;
  dataLanguage: string;
} {
  return {
    className: codeNode.getAttribute('class') ?? '',
    dataLanguage: codeNode.getAttribute('data-language') ?? '',
  };
}

export function addFencedCodeRule(instance: TurndownService): void {
  instance.addRule('fencedCodeBlockWithLanguage', {
    filter: (node, options) => isFencedCodeBlock(node, options),
    replacement: (_content, node) => formatFencedCodeBlock(node),
  });
}
