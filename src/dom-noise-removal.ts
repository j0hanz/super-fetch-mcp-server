import { parseHTML } from 'linkedom';

import { config } from './config.js';
import { logDebug } from './observability.js';
import { isObject } from './type-guards.js';

// Constants
const NOISE_SCAN_LIMIT = 50_000;
const MIN_BODY_CONTENT_LENGTH = 100;
const DIALOG_MIN_CHARS_FOR_PRESERVATION = 500;

const HTML_DOCUMENT_MARKERS = /<\s*(?:!doctype|html|head|body)\b/i;
const NOISE_TAGS_PATTERN =
  /<\s*(?:script|style|noscript|iframe|nav|footer|header|form|button|input|select|textarea|svg|canvas)\b/i;
const NOISE_ROLES_PATTERN =
  /[\s"']role\s*=\s*['"]?(?:navigation|banner|complementary|contentinfo|tree|menubar|menu)['"]?/i;
const NOISE_OTHER_ATTRS_PATTERN =
  /[\s"'](?:aria-hidden\s*=\s*['"]?true['"]?|hidden)/i;
const NOISE_CLASSES_PATTERN =
  /[\s"'](?:banner|promo|announcement|cta|advert|newsletter|subscribe|cookie|consent|popup|modal|overlay|toast|fixed|sticky|z-50|z-4|isolate|breadcrumb|pagination)\b/i;

const HEADER_NOISE_PATTERN =
  /\b(site-header|masthead|topbar|navbar|nav(?:bar)?|menu|header-nav)\b/i;
const FIXED_PATTERN = /\b(fixed|sticky)\b/;
const HIGH_Z_PATTERN = /\bz-(?:4\d|50)\b/;
const ISOLATE_PATTERN = /\bisolate\b/;

const SKIP_URL_PREFIXES = [
  '#',
  'java' + 'script:',
  'mailto:',
  'tel:',
  'data:',
  'blob:',
] as const;

const BASE_STRUCTURAL_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'button',
  'input',
  'select',
  'textarea',
] as const;

const ALWAYS_NOISE_TAGS: ReadonlySet<string> = new Set(['nav', 'footer']);

const NAVIGATION_ROLES: ReadonlySet<string> = new Set([
  'navigation',
  'banner',
  'complementary',
  'contentinfo',
  'tree',
  'menubar',
  'menu',
  'dialog',
  'alertdialog',
  'search',
]);

const INTERACTIVE_CONTENT_ROLES: ReadonlySet<string> = new Set([
  'tabpanel',
  'tab',
  'tablist',
  'dialog',
  'alertdialog',
  'menu',
  'menuitem',
  'option',
  'listbox',
  'combobox',
  'tooltip',
  'alert',
]);

const NOISE_CATEGORY = {
  cookieBanners: 'cookie-banners',
  navFooter: 'nav-footer',
  newsletters: 'newsletters',
  socialShare: 'social-share',
} as const;

const PROMO_TOKENS_ALWAYS: readonly string[] = [
  'banner',
  'promo',
  'announcement',
  'cta',
  'advert',
  'ads',
  'sponsor',
  'recommend',
  'breadcrumb',
  'pagination',
  'pager',
  'taglist',
];

const PROMO_TOKENS_AGGRESSIVE: readonly string[] = ['ad', 'related', 'comment'];

const PROMO_TOKENS_BY_CATEGORY: Readonly<Record<string, readonly string[]>> = {
  [NOISE_CATEGORY.cookieBanners]: [
    'cookie',
    'consent',
    'popup',
    'modal',
    'overlay',
    'toast',
  ],
  [NOISE_CATEGORY.newsletters]: ['newsletter', 'subscribe'],
  [NOISE_CATEGORY.socialShare]: ['share', 'social'],
};

const BASE_NOISE_SELECTORS = {
  navFooter: [
    'nav',
    'footer',
    'header[class*="site"]',
    'header[class*="nav"]',
    'header[class*="menu"]',
    '[role="banner"]',
    '[role="navigation"]',
  ],
  cookieBanners: ['[role="dialog"]'],
  hidden: [
    '[style*="display: none"]',
    '[style*="display:none"]',
    '[hidden]',
    '[aria-hidden="true"]',
  ],
} as const;
// Types
type NodeListLike<T> =
  | ArrayLike<T>
  | { length: number; item: (index: number) => T | null };

interface ElementMetadata {
  readonly tagName: string;
  readonly className: string;
  readonly id: string;
  readonly role: string | null;
  readonly isHidden: boolean;
  readonly isInteractive: boolean;
}

interface CategoryFlags {
  readonly navFooter: boolean;
  readonly cookieBanners: boolean;
  readonly newsletters: boolean;
  readonly socialShare: boolean;
  readonly enabled: Set<string>;
}

interface PromoMatchResult {
  readonly matched: boolean;
  readonly aggressive: boolean;
}
// Helpers: DOM utilities
function isNodeListLike<T>(value: unknown): value is NodeListLike<T> {
  return (
    isObject(value) &&
    typeof (value as { length?: unknown }).length === 'number'
  );
}

function getAttr(element: Element, name: string): string {
  return element.getAttribute(name) ?? '';
}

function safeQuerySelectorAll(
  document: Document,
  selector: string
): NodeListOf<Element> | null {
  try {
    return document.querySelectorAll(selector);
  } catch {
    return null;
  }
}

function removeMatchingNodes(
  nodes: NodeListOf<Element> | Iterable<Element>,
  shouldRemove: (node: Element) => boolean
): void {
  if (isNodeListLike<Element>(nodes)) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node =
        'item' in nodes && typeof nodes.item === 'function'
          ? nodes.item(i)
          : (nodes as ArrayLike<Element>)[i];
      if (node && shouldRemove(node)) node.remove();
    }
    return;
  }

  for (const node of nodes) {
    if (shouldRemove(node)) node.remove();
  }
}

// Helpers: Config-derived values (computed per-call, not cached)
function getEnabledCategories(): Set<string> {
  return new Set(
    config.noiseRemoval.enabledCategories.map((c) => c.toLowerCase().trim())
  );
}

function isCategoryEnabled(
  category: string,
  enabled: Set<string> = getEnabledCategories()
): boolean {
  return enabled.has(category.toLowerCase());
}

function getCategoryFlags(): CategoryFlags {
  const enabled = getEnabledCategories();
  return {
    navFooter: isCategoryEnabled(NOISE_CATEGORY.navFooter, enabled),
    cookieBanners: isCategoryEnabled(NOISE_CATEGORY.cookieBanners, enabled),
    newsletters: isCategoryEnabled(NOISE_CATEGORY.newsletters, enabled),
    socialShare: isCategoryEnabled(NOISE_CATEGORY.socialShare, enabled),
    enabled,
  };
}

function getStructuralTags(): Set<string> {
  const tags = new Set<string>(BASE_STRUCTURAL_TAGS);
  if (!config.noiseRemoval.preserveSvgCanvas) {
    tags.add('svg');
    tags.add('canvas');
  }
  return tags;
}

// Helpers: Promo token detection
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTokenRegex(tokens: Set<string>): RegExp {
  if (tokens.size === 0) return /a^/i;
  const escaped = [...tokens].map(escapeRegexLiteral);
  return new RegExp(
    `(?:^|[^a-z0-9])(?:${escaped.join('|')})(?:$|[^a-z0-9])`,
    'i'
  );
}

function collectPromoTokens(enabled: Set<string>): {
  base: Set<string>;
  aggressive: Set<string>;
} {
  const base = new Set<string>(PROMO_TOKENS_ALWAYS);
  const aggressive = new Set<string>();

  if (config.noiseRemoval.aggressiveMode) {
    for (const token of PROMO_TOKENS_AGGRESSIVE) {
      aggressive.add(token);
    }
  }

  for (const [category, categoryTokens] of Object.entries(
    PROMO_TOKENS_BY_CATEGORY
  )) {
    if (!isCategoryEnabled(category, enabled)) continue;
    for (const token of categoryTokens) {
      base.add(token);
    }
  }

  for (const token of config.noiseRemoval.extraTokens) {
    const normalized = token.toLowerCase().trim();
    if (normalized) base.add(normalized);
  }

  return { base, aggressive };
}

function matchPromoTokens(
  className: string,
  id: string,
  enabled: Set<string>
): PromoMatchResult {
  const tokens = collectPromoTokens(enabled);
  const baseRegex = buildTokenRegex(tokens.base);
  const aggressiveRegex = buildTokenRegex(tokens.aggressive);

  const aggressiveMatch =
    aggressiveRegex.test(className) || aggressiveRegex.test(id);
  if (aggressiveMatch) return { matched: true, aggressive: true };

  const baseMatch = baseRegex.test(className) || baseRegex.test(id);
  return { matched: baseMatch, aggressive: false };
}

// Helpers: Element classification
function isElementHidden(element: Element): boolean {
  const style = getAttr(element, 'style');
  return (
    element.getAttribute('hidden') !== null ||
    element.getAttribute('aria-hidden') === 'true' ||
    /\bdisplay\s*:\s*none\b/i.test(style) ||
    /\bvisibility\s*:\s*hidden\b/i.test(style)
  );
}

function isInteractiveComponent(
  element: Element,
  role: string | null
): boolean {
  if (role && INTERACTIVE_CONTENT_ROLES.has(role)) return true;

  const dataState = element.getAttribute('data-state');
  if (dataState === 'inactive' || dataState === 'closed') return true;

  const dataOrientation = element.getAttribute('data-orientation');
  if (dataOrientation === 'horizontal' || dataOrientation === 'vertical')
    return true;

  if (element.getAttribute('data-accordion-item') !== null) return true;
  if (element.getAttribute('data-radix-collection-item') !== null) return true;

  return false;
}

function readElementMetadata(element: Element): ElementMetadata {
  const tagName = element.tagName.toLowerCase();
  const className = getAttr(element, 'class');
  const id = getAttr(element, 'id');
  const role = element.getAttribute('role');
  const isInteractive = isInteractiveComponent(element, role);
  const isHidden = isElementHidden(element);

  return { tagName, className, id, role, isHidden, isInteractive };
}

function isWithinPrimaryContent(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    const tagName = current.tagName.toLowerCase();
    if (tagName === 'article' || tagName === 'main') return true;

    const role = current.getAttribute('role');
    if (role === 'main') return true;

    const ancestorNode: ParentNode | null = current.parentNode;
    current =
      current.parentElement ??
      (isObject(ancestorNode) &&
      (ancestorNode as { nodeType?: unknown }).nodeType === 1
        ? (ancestorNode as unknown as Element)
        : null);
  }

  return false;
}

// Noise scoring
function hasNoiseRole(role: string | null): boolean {
  return role !== null && NAVIGATION_ROLES.has(role);
}

function isHeaderBoilerplate(meta: ElementMetadata): boolean {
  if (meta.tagName !== 'header') return false;
  if (hasNoiseRole(meta.role)) return true;

  const combined = `${meta.className} ${meta.id}`.toLowerCase();
  return HEADER_NOISE_PATTERN.test(combined);
}

function matchesFixedOrHighZIsolate(className: string): boolean {
  if (FIXED_PATTERN.test(className)) return true;
  return HIGH_Z_PATTERN.test(className) && ISOLATE_PATTERN.test(className);
}

function isRoleNoise(meta: ElementMetadata): boolean {
  const isComplementaryAside =
    meta.tagName === 'aside' && meta.role === 'complementary';
  return !isComplementaryAside && hasNoiseRole(meta.role);
}

function scoreNavFooter(
  meta: ElementMetadata,
  structuralWeight: number
): number {
  let score = 0;
  if (ALWAYS_NOISE_TAGS.has(meta.tagName)) score += structuralWeight;
  if (isHeaderBoilerplate(meta)) score += structuralWeight;
  if (isRoleNoise(meta)) score += structuralWeight;
  return score;
}

function scorePromo(
  element: Element,
  meta: ElementMetadata,
  enabled: Set<string>,
  promoWeight: number
): number {
  const promoMatch = matchPromoTokens(meta.className, meta.id, enabled);
  if (!promoMatch.matched) return 0;
  if (promoMatch.aggressive && isWithinPrimaryContent(element)) return 0;
  return promoWeight;
}

function calculateNoiseScore(
  element: Element,
  meta: ElementMetadata,
  structuralTags: Set<string>,
  flags: CategoryFlags
): number {
  const { weights } = config.noiseRemoval;
  let score = 0;

  if (structuralTags.has(meta.tagName) && !meta.isInteractive) {
    score += weights.structural;
  }

  if (flags.navFooter) {
    score += scoreNavFooter(meta, weights.structural);
  }

  if (meta.isHidden && !meta.isInteractive) {
    score += weights.hidden;
  }

  if (matchesFixedOrHighZIsolate(meta.className)) {
    score += weights.stickyFixed;
  }

  const promoEnabled =
    flags.cookieBanners || flags.newsletters || flags.socialShare;
  if (promoEnabled) {
    score += scorePromo(element, meta, flags.enabled, weights.promo);
  }

  return score;
}

function isNoiseElement(
  element: Element,
  structuralTags: Set<string>,
  flags: CategoryFlags
): boolean {
  const meta = readElementMetadata(element);
  const score = calculateNoiseScore(element, meta, structuralTags, flags);
  return score >= config.noiseRemoval.weights.threshold;
}

// Preservation logic
function shouldPreserveDialog(element: Element): boolean {
  const role = element.getAttribute('role');
  if (role !== 'dialog' && role !== 'alertdialog') return false;

  const { textContent } = element;
  if (textContent.length > DIALOG_MIN_CHARS_FOR_PRESERVATION) return true;

  return element.querySelector('h1, h2, h3, h4, h5, h6') !== null;
}

function shouldPreserveNavFooter(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName !== 'nav' && tagName !== 'footer') return false;

  return element.querySelector('article, main, section') !== null;
}

function shouldPreserveElement(element: Element): boolean {
  return shouldPreserveDialog(element) || shouldPreserveNavFooter(element);
}

// Selector building
function buildBaseNoiseSelector(flags: CategoryFlags): string {
  const selectors: string[] = [...BASE_NOISE_SELECTORS.hidden];

  if (flags.navFooter) {
    selectors.push(...BASE_NOISE_SELECTORS.navFooter);
  }

  if (flags.cookieBanners) {
    selectors.push(...BASE_NOISE_SELECTORS.cookieBanners);
  }

  return selectors.join(',');
}

function normalizeSelectors(selectors: readonly string[]): string[] {
  return selectors.map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildCandidateNoiseSelector(structuralTags: Set<string>): string {
  return [
    ...structuralTags,
    ...ALWAYS_NOISE_TAGS,
    'aside',
    'header',
    '[class]',
    '[id]',
    '[role]',
    '[style]',
  ].join(',');
}

// Noise stripping
function removeBaseAndExtraNoiseNodes(
  document: Document,
  flags: CategoryFlags
): void {
  const extra = normalizeSelectors(config.noiseRemoval.extraSelectors);
  const baseSelector = buildBaseNoiseSelector(flags);
  const combined =
    extra.length === 0 ? baseSelector : `${baseSelector},${extra.join(',')}`;

  const combinedNodes = safeQuerySelectorAll(document, combined);
  if (combinedNodes) {
    removeMatchingNodes(combinedNodes, (node) => !shouldPreserveElement(node));
    return;
  }

  const baseNodes = safeQuerySelectorAll(document, baseSelector);
  if (baseNodes) {
    removeMatchingNodes(baseNodes, (node) => !shouldPreserveElement(node));
  }

  for (const selector of extra) {
    const nodes = safeQuerySelectorAll(document, selector);
    if (nodes) {
      removeMatchingNodes(nodes, (node) => !shouldPreserveElement(node));
    }
  }
}

function removeCandidateNoiseNodes(
  document: Document,
  structuralTags: Set<string>,
  flags: CategoryFlags
): void {
  const candidateSelector = buildCandidateNoiseSelector(structuralTags);
  const nodes = safeQuerySelectorAll(document, candidateSelector);
  if (!nodes) return;

  removeMatchingNodes(nodes, (node) => {
    if (shouldPreserveElement(node)) return false;
    return isNoiseElement(node, structuralTags, flags);
  });
}

function stripNoise(document: Document): void {
  const flags = getCategoryFlags();
  const structuralTags = getStructuralTags();

  removeBaseAndExtraNoiseNodes(document, flags);
  removeCandidateNoiseNodes(document, structuralTags, flags);
}

// URL resolution
function shouldSkipUrlResolution(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return SKIP_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function tryResolveUrl(relativeUrl: string, baseUrl: URL): string | null {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
}

function resolveUrlAttribute(
  element: Element,
  attr: 'href' | 'src',
  base: URL,
  shouldSkip: boolean
): void {
  const value = element.getAttribute(attr);
  if (!value) return;
  if (shouldSkip && shouldSkipUrlResolution(value)) return;

  const resolved = tryResolveUrl(value, base);
  if (resolved) element.setAttribute(attr, resolved);
}

function resolveSrcset(element: Element, base: URL): void {
  const srcset = element.getAttribute('srcset');
  if (!srcset) return;

  const resolved = srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/);
      const url = parts[0];
      if (!url) return entry.trim();

      const resolvedUrl = tryResolveUrl(url, base);
      if (resolvedUrl) parts[0] = resolvedUrl;

      return parts.join(' ');
    })
    .join(', ');

  element.setAttribute('srcset', resolved);
}

function resolveRelativeUrls(document: Document, baseUrl: string): void {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return;
  }

  for (const element of document.querySelectorAll(
    'a[href], img[src], source[srcset]'
  )) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') resolveUrlAttribute(element, 'href', base, true);
    else if (tag === 'img') resolveUrlAttribute(element, 'src', base, true);
    else if (tag === 'source') resolveSrcset(element, base);
  }
}

// Document serialization
function getBodyInnerHtml(document: unknown): string | undefined {
  if (!isObject(document)) return undefined;
  const { body } = document as { body?: unknown };
  if (
    isObject(body) &&
    typeof (body as { innerHTML?: unknown }).innerHTML === 'string'
  ) {
    return (body as { innerHTML: string }).innerHTML;
  }
  return undefined;
}

function getDocumentToString(document: unknown): (() => string) | undefined {
  if (!isObject(document)) return undefined;
  const fn = (document as { toString?: unknown }).toString;
  if (typeof fn !== 'function') return undefined;
  return fn.bind(document) as () => string;
}

function getDocumentElementOuterHtml(document: unknown): string | undefined {
  if (!isObject(document)) return undefined;
  const docEl = (document as { documentElement?: unknown }).documentElement;
  if (
    isObject(docEl) &&
    typeof (docEl as { outerHTML?: unknown }).outerHTML === 'string'
  ) {
    return (docEl as { outerHTML: string }).outerHTML;
  }
  return undefined;
}

function serializeDocument(document: unknown, fallbackHtml: string): string {
  const bodyInner = getBodyInnerHtml(document);
  if (bodyInner && bodyInner.trim().length > MIN_BODY_CONTENT_LENGTH)
    return bodyInner;

  const toStringFn = getDocumentToString(document);
  if (toStringFn) return toStringFn();

  const outer = getDocumentElementOuterHtml(document);
  if (outer) return outer;

  return fallbackHtml;
}

// Detection heuristics
function isFullDocumentHtml(html: string): boolean {
  return HTML_DOCUMENT_MARKERS.test(html);
}

function mayContainNoise(html: string): boolean {
  const sample =
    html.length > NOISE_SCAN_LIMIT ? html.substring(0, NOISE_SCAN_LIMIT) : html;
  return (
    NOISE_TAGS_PATTERN.test(sample) ||
    NOISE_ROLES_PATTERN.test(sample) ||
    NOISE_OTHER_ATTRS_PATTERN.test(sample) ||
    NOISE_CLASSES_PATTERN.test(sample)
  );
}

// Public API
export function removeNoiseFromHtml(
  html: string,
  document?: Document,
  baseUrl?: string
): string {
  const shouldParse = isFullDocumentHtml(html) || mayContainNoise(html);
  if (!shouldParse) return html;

  try {
    if (config.noiseRemoval.debug) {
      logDebug('Noise removal audit enabled', {
        categories: [...getEnabledCategories()],
      });
    }

    const resolvedDocument = document ?? parseHTML(html).document;

    stripNoise(resolvedDocument);

    if (baseUrl) resolveRelativeUrls(resolvedDocument, baseUrl);

    return serializeDocument(resolvedDocument, html);
  } catch {
    return html;
  }
}
