import { parseHTML } from 'linkedom';
import {
  NodeHtmlMarkdown,
  type TranslatorCollection,
  type TranslatorConfigObject,
} from 'node-html-markdown';

import {
  CODE_BLOCK,
  FRONTMATTER_DELIMITER,
  joinLines,
} from '../config/formatting.js';
import type { MetadataBlock } from '../config/types/content.js';

import { FetchError } from '../errors/app-error.js';

import {
  endTransformStage,
  startTransformStage,
} from '../services/telemetry.js';

import { throwIfAborted } from '../utils/cancellation.js';
import {
  detectLanguageFromCode,
  resolveLanguageFromAttributes,
} from '../utils/code-language.js';
import { isRecord } from '../utils/guards.js';

const YAML_SPECIAL_CHARS = /[:[\]{}"\r\t'|>&*!?,#]|\n/;
const YAML_NUMERIC = /^[\d.]+$/;
const YAML_RESERVED_WORDS = /^(true|false|null|yes|no|on|off)$/i;

const ESCAPE_PATTERNS = {
  backslash: /\\/g,
  quote: /"/g,
  newline: /\n/g,
  tab: /\t/g,
};

const YAML_QUOTE_CHECKS: readonly ((input: string) => boolean)[] = [
  (input) => YAML_SPECIAL_CHARS.test(input),
  (input) => input.startsWith(' ') || input.endsWith(' '),
  (input) => input === '',
  (input) => YAML_NUMERIC.test(input),
  (input) => YAML_RESERVED_WORDS.test(input),
];

function needsYamlQuotes(value: string): boolean {
  return YAML_QUOTE_CHECKS.some((check) => check(value));
}

function escapeYamlValue(value: string): string {
  if (!needsYamlQuotes(value)) {
    return value;
  }

  const escaped = value
    .replace(ESCAPE_PATTERNS.backslash, '\\\\')
    .replace(ESCAPE_PATTERNS.quote, '\\"')
    .replace(ESCAPE_PATTERNS.newline, '\\n')
    .replace(ESCAPE_PATTERNS.tab, '\\t');

  return `"${escaped}"`;
}

function appendFrontmatterField(
  lines: string[],
  key: string,
  value: string | undefined
): void {
  if (!value) return;
  lines.push(`${key}: ${escapeYamlValue(value)}`);
}

function buildFrontmatter(metadata?: MetadataBlock): string {
  if (!metadata) return '';
  const lines: string[] = [FRONTMATTER_DELIMITER];

  appendFrontmatterField(lines, 'title', metadata.title);
  appendFrontmatterField(lines, 'source', metadata.url);
  appendFrontmatterField(lines, 'author', metadata.author);
  appendFrontmatterField(lines, 'description', metadata.description);
  appendFrontmatterField(lines, 'fetchedAt', metadata.fetchedAt);

  lines.push(FRONTMATTER_DELIMITER);
  return joinLines(lines);
}

function isElement(node: unknown): node is HTMLElement {
  return (
    isRecord(node) &&
    'getAttribute' in node &&
    typeof node.getAttribute === 'function'
  );
}

const STRUCTURAL_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'nav',
  'footer',
  'aside',
  'header',
  'form',
  'button',
  'input',
  'select',
  'textarea',
]);
const NAVIGATION_ROLES = new Set([
  'navigation',
  'banner',
  'complementary',
  'contentinfo',
  'tree',
  'menubar',
  'menu',
]);
const PROMO_PATTERN =
  /banner|promo|announcement|cta|callout|advert|newsletter|subscribe|cookie|consent|popup|modal|overlay|toast/;
const FIXED_PATTERN = /\b(fixed|sticky)\b/;
const HIGH_Z_PATTERN = /\bz-(?:4\d|50)\b/;
const ISOLATE_PATTERN = /\bisolate\b/;

const HTML_DOCUMENT_MARKERS = /<\s*(?:!doctype|html|head|body)\b/i;
const NOISE_MARKERS = [
  '<script',
  '<style',
  '<noscript',
  '<iframe',
  '<nav',
  '<footer',
  '<aside',
  '<header',
  '<form',
  '<button',
  '<input',
  '<select',
  '<textarea',
  '<svg',
  '<canvas',
  ' aria-hidden="true"',
  " aria-hidden='true'",
  ' hidden',
  ' role="navigation"',
  " role='navigation'",
  ' role="banner"',
  " role='banner'",
  ' role="complementary"',
  " role='complementary'",
  ' role="contentinfo"',
  " role='contentinfo'",
  ' role="tree"',
  " role='tree'",
  ' role="menubar"',
  " role='menubar'",
  ' role="menu"',
  " role='menu'",
  ' banner',
  ' promo',
  ' announcement',
  ' cta',
  ' callout',
  ' advert',
  ' newsletter',
  ' subscribe',
  ' cookie',
  ' consent',
  ' popup',
  ' modal',
  ' overlay',
  ' toast',
  ' fixed',
  ' sticky',
  ' z-50',
  ' z-4',
  ' isolate',
];

function mayContainNoise(html: string): boolean {
  const haystack = html.toLowerCase();
  return NOISE_MARKERS.some((marker) => haystack.includes(marker));
}

function isFullDocumentHtml(html: string): boolean {
  return HTML_DOCUMENT_MARKERS.test(html);
}

function isStructuralNoiseTag(tagName: string): boolean {
  return (
    STRUCTURAL_TAGS.has(tagName) || tagName === 'svg' || tagName === 'canvas'
  );
}

function isElementHidden(element: HTMLElement): boolean {
  return (
    element.getAttribute('hidden') !== null ||
    element.getAttribute('aria-hidden') === 'true'
  );
}

function hasNoiseRole(role: string | null): boolean {
  return role !== null && NAVIGATION_ROLES.has(role);
}

function matchesPromoIdOrClass(className: string, id: string): boolean {
  const combined = `${className} ${id}`.toLowerCase();
  return PROMO_PATTERN.test(combined);
}

function matchesHighZIsolate(className: string): boolean {
  return HIGH_Z_PATTERN.test(className) && ISOLATE_PATTERN.test(className);
}

function matchesFixedOrHighZIsolate(className: string): boolean {
  return FIXED_PATTERN.test(className) || matchesHighZIsolate(className);
}

interface ElementMetadata {
  tagName: string;
  className: string;
  id: string;
  role: string | null;
  isHidden: boolean;
}

function readElementMetadata(element: HTMLElement): ElementMetadata {
  return {
    tagName: element.tagName.toLowerCase(),
    className: element.getAttribute('class') ?? '',
    id: element.getAttribute('id') ?? '',
    role: element.getAttribute('role'),
    isHidden: isElementHidden(element),
  };
}

function isNoiseElement(node: HTMLElement): boolean {
  const metadata = readElementMetadata(node);
  return (
    isStructuralNoiseTag(metadata.tagName) ||
    metadata.isHidden ||
    hasNoiseRole(metadata.role) ||
    matchesFixedOrHighZIsolate(metadata.className) ||
    matchesPromoIdOrClass(metadata.className, metadata.id)
  );
}

function removeNoiseFromHtml(html: string): string {
  const shouldParse = isFullDocumentHtml(html) || mayContainNoise(html);
  if (!shouldParse) return html;

  const shouldRemove = mayContainNoise(html);

  try {
    const { document } = parseHTML(html);

    if (shouldRemove) {
      const nodes = Array.from(document.querySelectorAll('*'));

      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (!node) continue;
        if (isElement(node) && isNoiseElement(node)) {
          node.remove();
        }
      }
    }

    const { body } = document as unknown as { body?: { innerHTML?: string } };
    if (body?.innerHTML) return body.innerHTML;

    if (
      typeof (document as unknown as { toString?: () => string }).toString ===
      'function'
    ) {
      return (document as unknown as { toString: () => string }).toString();
    }

    const { documentElement } = document as unknown as {
      documentElement?: { outerHTML?: string };
    };
    if (documentElement?.outerHTML) return documentElement.outerHTML;

    return html;
  } catch {
    return html;
  }
}

function buildInlineCode(content: string): string {
  const runs = content.match(/`+/g);
  const longest = runs?.sort((a, b) => b.length - a.length)[0] ?? '';
  const delimiter = `\`${longest}`;
  const padding = delimiter.length > 1 ? ' ' : '';
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function isCodeBlock(
  parent: unknown
): parent is { tagName?: string; childNodes?: unknown[] } {
  if (!isRecord(parent)) return false;
  const tagName =
    typeof parent.tagName === 'string' ? parent.tagName.toUpperCase() : '';
  return ['PRE', 'WRAPPED-PRE'].includes(tagName);
}

function createCodeTranslator(): TranslatorConfigObject {
  return {
    code: (ctx: unknown) => {
      if (!isRecord(ctx)) {
        return {
          spaceIfRepeatingChar: true,
          noEscape: true,
          postprocess: ({ content }: { content: string }) =>
            buildInlineCode(content),
        };
      }

      const { node, parent, visitor } = ctx;
      const getAttribute =
        isRecord(node) && typeof node.getAttribute === 'function'
          ? (node.getAttribute as (name: string) => string | null).bind(node)
          : undefined;

      if (!isCodeBlock(parent)) {
        return {
          spaceIfRepeatingChar: true,
          noEscape: true,
          postprocess: ({ content }: { content: string }) =>
            buildInlineCode(content),
        };
      }

      const className = getAttribute?.('class') ?? '';
      const dataLanguage = getAttribute?.('data-language') ?? '';
      const attributeLanguage = resolveLanguageFromAttributes(
        className,
        dataLanguage
      );

      const childTranslators = isRecord(visitor) ? visitor.instance : null;

      const codeBlockTranslators =
        isRecord(childTranslators) &&
        isRecord(
          (childTranslators as { codeBlockTranslators?: unknown })
            .codeBlockTranslators
        )
          ? (
              childTranslators as {
                codeBlockTranslators: TranslatorCollection;
              }
            ).codeBlockTranslators
          : null;

      return {
        noEscape: true,
        preserveWhitespace: true,
        ...(codeBlockTranslators
          ? { childTranslators: codeBlockTranslators }
          : null),
        postprocess: ({ content }: { content: string }) => {
          const language =
            attributeLanguage ?? detectLanguageFromCode(content) ?? '';
          return CODE_BLOCK.format(content, language);
        },
      };
    },
  };
}

let markdownInstance: NodeHtmlMarkdown | null = null;

function createMarkdownInstance(): NodeHtmlMarkdown {
  return new NodeHtmlMarkdown(
    {
      codeFence: CODE_BLOCK.fence,
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      bulletMarker: '-',
    },
    createCodeTranslator()
  );
}

function getMarkdownConverter(): NodeHtmlMarkdown {
  markdownInstance ??= createMarkdownInstance();
  return markdownInstance;
}

export function htmlToMarkdown(
  html: string,
  metadata?: MetadataBlock,
  options?: { url?: string; signal?: AbortSignal }
): string {
  const url = options?.url ?? metadata?.url ?? '';
  const frontmatter = buildFrontmatter(metadata);
  if (!html) return frontmatter;

  try {
    throwIfAborted(options?.signal, url, 'markdown:begin');

    const noiseStage = startTransformStage(url, 'markdown:noise');
    const cleanedHtml = removeNoiseFromHtml(html);
    endTransformStage(noiseStage);

    throwIfAborted(options?.signal, url, 'markdown:cleaned');

    const translateStage = startTransformStage(url, 'markdown:translate');
    const content = getMarkdownConverter().translate(cleanedHtml).trim();
    endTransformStage(translateStage);

    throwIfAborted(options?.signal, url, 'markdown:translated');
    return frontmatter ? `${frontmatter}\n${content}` : content;
  } catch (error) {
    if (error instanceof FetchError) {
      throw error;
    }
    return frontmatter;
  }
}
