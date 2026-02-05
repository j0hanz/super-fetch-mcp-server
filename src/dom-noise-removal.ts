import { parseHTML } from 'linkedom';

import { config } from './config.js';
import { logDebug } from './observability.js';
import { isObject } from './type-guards.js';

type NodeListLike<T> =
  | ArrayLike<T>
  | { length: number; item: (index: number) => T | null };

function isNodeListLike<T>(value: unknown): value is NodeListLike<T> {
  return (
    isObject(value) &&
    typeof (value as { length?: unknown }).length === 'number'
  );
}

function getNodeListItem<T>(nodes: NodeListLike<T>, index: number): T | null {
  if ('item' in nodes && typeof nodes.item === 'function')
    return nodes.item(index);
  return (nodes as ArrayLike<T>)[index] ?? null;
}

function removeNodes(
  nodes: NodeListOf<Element> | Iterable<Element>,
  shouldRemove: (node: Element) => boolean
): void {
  if (isNodeListLike<Element>(nodes)) {
    // Iterate backwards to be safe for live collections (even though querySelectorAll is typically static).
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = getNodeListItem(nodes, i);
      if (node && shouldRemove(node)) node.remove();
    }
    return;
  }

  for (const node of nodes) {
    if (shouldRemove(node)) node.remove();
  }
}

const HTML_DOCUMENT_MARKERS = /<\s*(?:!doctype|html|head|body)\b/i;

function isFullDocumentHtml(html: string): boolean {
  return HTML_DOCUMENT_MARKERS.test(html);
}

const NOISE_SCAN_LIMIT = 50_000;

const NOISE_TAGS =
  /<\s*(?:script|style|noscript|iframe|nav|footer|header|form|button|input|select|textarea|svg|canvas)\b/i;

const NOISE_ROLES =
  /[\s"']role\s*=\s*['"]?(?:navigation|banner|complementary|contentinfo|tree|menubar|menu)['"]?/i;

const NOISE_OTHER_ATTRS = /[\s"'](?:aria-hidden\s*=\s*['"]?true['"]?|hidden)/i;

const NOISE_CLASSES =
  /[\s"'](?:banner|promo|announcement|cta|advert|newsletter|subscribe|cookie|consent|popup|modal|overlay|toast|fixed|sticky|z-50|z-4|isolate|breadcrumb|pagination)\b/i;

function mayContainNoise(html: string): boolean {
  const sample =
    html.length > NOISE_SCAN_LIMIT ? html.substring(0, NOISE_SCAN_LIMIT) : html;
  return (
    NOISE_TAGS.test(sample) ||
    NOISE_ROLES.test(sample) ||
    NOISE_OTHER_ATTRS.test(sample) ||
    NOISE_CLASSES.test(sample)
  );
}

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

// SVG and canvas tags are excluded from structural noise when preserveSvgCanvas is enabled.
function getStructuralTags(): Set<string> {
  const tags = new Set<string>(BASE_STRUCTURAL_TAGS);
  if (!config.noiseRemoval.preserveSvgCanvas) {
    tags.add('svg');
    tags.add('canvas');
  }
  return tags;
}

const STRUCTURAL_TAGS = getStructuralTags();

const ALWAYS_NOISE_TAGS = new Set(['nav', 'footer']);

const NOISE_CATEGORY = {
  cookieBanners: 'cookie-banners',
  navFooter: 'nav-footer',
  newsletters: 'newsletters',
  socialShare: 'social-share',
} as const;

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

const CANDIDATE_NOISE_SELECTOR = [
  ...STRUCTURAL_TAGS,
  ...ALWAYS_NOISE_TAGS,
  'aside',
  'header',
  '[class]',
  '[id]',
  '[role]',
  '[style]',
].join(',');

function normalizeSelectors(selectors: readonly string[]): string[] {
  return selectors.map((s) => s.trim()).filter((s) => s.length > 0);
}

let cachedEnabledCategories: Set<string> | null = null;
let cachedCategoriesKey: string | null = null;

function getEnabledCategories(): Set<string> {
  const currentKey = config.noiseRemoval.enabledCategories.join(',');
  if (cachedEnabledCategories && cachedCategoriesKey === currentKey) {
    return cachedEnabledCategories;
  }

  cachedEnabledCategories = new Set(
    config.noiseRemoval.enabledCategories.map((c) => c.toLowerCase().trim())
  );
  cachedCategoriesKey = currentKey;
  return cachedEnabledCategories;
}

function isCategoryEnabled(category: string): boolean {
  return getEnabledCategories().has(category.toLowerCase());
}

function buildBaseNoiseSelector(): string {
  const selectors: string[] = [...BASE_NOISE_SELECTORS.hidden];

  if (isCategoryEnabled(NOISE_CATEGORY.navFooter)) {
    selectors.push(...BASE_NOISE_SELECTORS.navFooter);
  }

  if (isCategoryEnabled(NOISE_CATEGORY.cookieBanners)) {
    selectors.push(...BASE_NOISE_SELECTORS.cookieBanners);
  }

  return selectors.join(',');
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

const NAVIGATION_ROLES = new Set([
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

const INTERACTIVE_CONTENT_ROLES = new Set([
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

const PROMO_TOKENS_ALWAYS = [
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
] as const;

// Tokens with high false-positive risk, only used when aggressiveMode is enabled.
const PROMO_TOKENS_AGGRESSIVE = ['ad', 'related', 'comment'] as const;

const PROMO_TOKENS_BY_CATEGORY: Record<string, readonly string[]> = {
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

const HEADER_NOISE_PATTERN =
  /\b(site-header|masthead|topbar|navbar|nav(?:bar)?|menu|header-nav)\b/i;
const FIXED_PATTERN = /\b(fixed|sticky)\b/;
const HIGH_Z_PATTERN = /\bz-(?:4\d|50)\b/;
const ISOLATE_PATTERN = /\bisolate\b/;

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class PromoDetector {
  private tokenCache: { base: Set<string>; aggressive: Set<string> } | null =
    null;
  private regexCache: { base: RegExp; aggressive: RegExp } | null = null;
  private cacheKey: string | null = null;

  matches(
    className: string,
    id: string
  ): { matched: boolean; aggressive: boolean } {
    const regexes = this.getRegexes();
    const aggressiveMatch =
      regexes.aggressive.test(className) || regexes.aggressive.test(id);
    if (aggressiveMatch) return { matched: true, aggressive: true };

    const baseMatch = regexes.base.test(className) || regexes.base.test(id);
    return { matched: baseMatch, aggressive: false };
  }

  private getTokenSets(): {
    base: Set<string>;
    aggressive: Set<string>;
  } {
    const cacheKey = this.buildCacheKey();
    if (this.tokenCache && this.cacheKey === cacheKey) return this.tokenCache;

    const base = new Set<string>(PROMO_TOKENS_ALWAYS);
    const aggressive = new Set<string>();

    // Include high false-positive tokens only when aggressive mode is enabled.
    if (config.noiseRemoval.aggressiveMode) {
      for (const token of PROMO_TOKENS_AGGRESSIVE) aggressive.add(token);
    }

    for (const [category, categoryTokens] of Object.entries(
      PROMO_TOKENS_BY_CATEGORY
    )) {
      if (!isCategoryEnabled(category)) continue;
      for (const token of categoryTokens) base.add(token);
    }
    for (const token of config.noiseRemoval.extraTokens) {
      const normalized = token.toLowerCase().trim();
      if (normalized) base.add(normalized);
    }

    this.cacheKey = cacheKey;
    this.tokenCache = { base, aggressive };
    this.regexCache = null;
    return this.tokenCache;
  }

  private buildCacheKey(): string {
    const extraTokens = config.noiseRemoval.extraTokens
      .map((token) => token.toLowerCase().trim())
      .filter((token) => token.length > 0)
      .join(',');

    return [config.noiseRemoval.aggressiveMode ? '1' : '0', extraTokens].join(
      '|'
    );
  }

  private buildRegex(tokens: Set<string>): RegExp {
    if (tokens.size === 0) return /a^/i;

    const escaped = [...tokens].map(escapeRegexLiteral);
    const pattern = `(?:^|[^a-z0-9])(?:${escaped.join('|')})(?:$|[^a-z0-9])`;

    return new RegExp(pattern, 'i');
  }

  private getRegexes(): { base: RegExp; aggressive: RegExp } {
    if (this.regexCache) return this.regexCache;

    const tokens = this.getTokenSets();
    this.regexCache = {
      base: this.buildRegex(tokens.base),
      aggressive: this.buildRegex(tokens.aggressive),
    };

    return this.regexCache;
  }
}

type ElementMetadata = Readonly<{
  tagName: string;
  className: string;
  id: string;
  role: string | null;
  isHidden: boolean;
  isInteractive: boolean;
}>;

class NoiseClassifier {
  constructor(private readonly promo: PromoDetector) {}

  isNoise(element: Element): boolean {
    return (
      this.calculateNoiseScore(element) >= config.noiseRemoval.weights.threshold
    );
  }

  private calculateNoiseScore(element: Element): number {
    const meta = this.readMetadata(element);
    const { weights } = config.noiseRemoval;
    let score = 0;
    const navFooterEnabled = isCategoryEnabled(NOISE_CATEGORY.navFooter);
    const promoEnabled =
      isCategoryEnabled(NOISE_CATEGORY.cookieBanners) ||
      isCategoryEnabled(NOISE_CATEGORY.newsletters) ||
      isCategoryEnabled(NOISE_CATEGORY.socialShare);

    if (this.isStructuralNoise(meta)) score += weights.structural;
    if (navFooterEnabled && ALWAYS_NOISE_TAGS.has(meta.tagName))
      score += weights.structural;
    if (navFooterEnabled && this.isHeaderBoilerplate(meta))
      score += weights.structural;

    if (this.isHiddenNoise(meta)) score += weights.hidden;
    if (navFooterEnabled && this.isRoleNoise(meta)) score += weights.structural;

    if (this.matchesFixedOrHighZIsolate(meta.className))
      score += weights.stickyFixed;

    if (promoEnabled) {
      const promoMatch = this.promo.matches(meta.className, meta.id);
      if (
        promoMatch.matched &&
        (!promoMatch.aggressive || !this.isWithinPrimaryContent(element))
      ) {
        score += weights.promo;
      }
    }

    return score;
  }

  private readMetadata(element: Element): ElementMetadata {
    const tagName = element.tagName.toLowerCase();
    const className = element.getAttribute('class') ?? '';
    const id = element.getAttribute('id') ?? '';
    const role = element.getAttribute('role');

    const isInteractive = this.isInteractiveComponent(element, role);
    const isHidden = this.isHidden(element);

    return { tagName, className, id, role, isHidden, isInteractive };
  }

  private isStructuralNoise(meta: ElementMetadata): boolean {
    if (!STRUCTURAL_TAGS.has(meta.tagName)) return false;
    return !meta.isInteractive;
  }

  private isHeaderBoilerplate(meta: ElementMetadata): boolean {
    if (meta.tagName !== 'header') return false;
    if (this.hasNoiseRole(meta.role)) return true;

    const combined = `${meta.className} ${meta.id}`.toLowerCase();
    return HEADER_NOISE_PATTERN.test(combined);
  }

  private isHiddenNoise(meta: ElementMetadata): boolean {
    if (!meta.isHidden) return false;
    return !meta.isInteractive;
  }

  private isRoleNoise(meta: ElementMetadata): boolean {
    const isComplementaryAside =
      meta.tagName === 'aside' && meta.role === 'complementary';
    if (isComplementaryAside) return false;

    return this.hasNoiseRole(meta.role);
  }

  private hasNoiseRole(role: string | null): boolean {
    return role !== null && NAVIGATION_ROLES.has(role);
  }

  private matchesFixedOrHighZIsolate(className: string): boolean {
    return (
      FIXED_PATTERN.test(className) ||
      (HIGH_Z_PATTERN.test(className) && ISOLATE_PATTERN.test(className))
    );
  }

  private isHidden(element: Element): boolean {
    const style = element.getAttribute('style') ?? '';
    return (
      element.getAttribute('hidden') !== null ||
      element.getAttribute('aria-hidden') === 'true' ||
      /\bdisplay\s*:\s*none\b/i.test(style) ||
      /\bvisibility\s*:\s*hidden\b/i.test(style)
    );
  }

  private isInteractiveComponent(
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
    if (element.getAttribute('data-radix-collection-item') !== null)
      return true;

    return false;
  }

  private isWithinPrimaryContent(element: Element): boolean {
    let current: Element | null = element;

    while (current) {
      const tagName = current.tagName.toLowerCase();
      if (tagName === 'article' || tagName === 'main') return true;

      const role = current.getAttribute('role');
      if (role === 'main') return true;

      const ancestorNode: ParentNode | null = current.parentNode;
      const next: Element | null =
        current.parentElement ??
        (isObject(ancestorNode) &&
        (ancestorNode as { nodeType?: unknown }).nodeType === 1
          ? (ancestorNode as unknown as Element)
          : null);
      current = next;
    }

    return false;
  }
}

const DIALOG_PRESERVATION_MIN_CHARS = 500;

function shouldPreserveDialog(element: Element): boolean {
  const role = element.getAttribute('role');
  if (role !== 'dialog' && role !== 'alertdialog') return false;

  // Preserve dialogs with substantial text content (>500 chars).
  const textContent = element.textContent || '';
  if (textContent.length > DIALOG_PRESERVATION_MIN_CHARS) return true;

  // Preserve dialogs containing structural content (headings indicate main content).
  const hasHeadings = element.querySelector('h1, h2, h3, h4, h5, h6') !== null;
  return hasHeadings;
}

function shouldPreserveNavFooter(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName !== 'nav' && tagName !== 'footer') return false;

  // Preserve nav/footer elements containing semantic content containers.
  const hasSemanticContent =
    element.querySelector('article, main, section') !== null;
  return hasSemanticContent;
}

class NoiseStripper {
  constructor(private readonly classifier: NoiseClassifier) {}

  strip(document: Document): void {
    this.removeBaseAndExtras(document);
    this.removeCandidates(document);
  }

  private removeBaseAndExtras(document: Document): void {
    const extra = normalizeSelectors(config.noiseRemoval.extraSelectors);
    const baseSelector = buildBaseNoiseSelector();
    const combined =
      extra.length === 0 ? baseSelector : `${baseSelector},${extra.join(',')}`;

    // Fast path: same behavior as before when selectors are valid.
    const combinedNodes = safeQuerySelectorAll(document, combined);
    if (combinedNodes) {
      removeNodes(combinedNodes, (node) => {
        if (shouldPreserveDialog(node)) return false;
        if (shouldPreserveNavFooter(node)) return false;
        return true;
      });
      return;
    }

    // Robust fallback: one invalid extra selector should not disable base stripping.
    const baseNodes = safeQuerySelectorAll(document, baseSelector);
    if (baseNodes) {
      removeNodes(baseNodes, (node) => {
        if (shouldPreserveDialog(node)) return false;
        if (shouldPreserveNavFooter(node)) return false;
        return true;
      });
    }

    for (const selector of extra) {
      const nodes = safeQuerySelectorAll(document, selector);
      if (nodes) {
        removeNodes(nodes, (node) => {
          if (shouldPreserveDialog(node)) return false;
          if (shouldPreserveNavFooter(node)) return false;
          return true;
        });
      }
    }
  }

  private removeCandidates(document: Document): void {
    const nodes = safeQuerySelectorAll(document, CANDIDATE_NOISE_SELECTOR);
    if (!nodes) return;

    removeNodes(nodes, (node) => {
      // Preserve dialogs that meet preservation criteria
      if (shouldPreserveDialog(node)) return false;
      // Preserve nav/footer elements containing semantic content
      if (shouldPreserveNavFooter(node)) return false;
      // Otherwise apply noise classifier
      return this.classifier.isNoise(node);
    });
  }
}

const SKIP_URL_PREFIXES = [
  '#',
  'java' + 'script:',
  'mailto:',
  'tel:',
  'data:',
  'blob:',
] as const;

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

class RelativeUrlResolver {
  resolve(document: Document, baseUrl: string): void {
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
      if (tag === 'a') this.resolveUrlAttr(element, 'href', base, true);
      else if (tag === 'img') this.resolveUrlAttr(element, 'src', base, true);
      else if (tag === 'source') this.resolveSrcset(element, base);
    }
  }

  private resolveUrlAttr(
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

  private resolveSrcset(element: Element, base: URL): void {
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
}

class DocumentSerializer {
  // Prefer substantial body HTML; otherwise fall back to document serialization or original input.
  serialize(document: unknown, fallbackHtml: string): string {
    const bodyInner = this.getBodyInnerHtml(document);
    if (bodyInner && bodyInner.trim().length > 100) return bodyInner;

    const toStringFn = this.getDocumentToString(document);
    if (toStringFn) return toStringFn();

    const outer = this.getDocumentElementOuterHtml(document);
    if (outer) return outer;

    return fallbackHtml;
  }

  private getBodyInnerHtml(document: unknown): string | undefined {
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

  private getDocumentToString(document: unknown): (() => string) | undefined {
    if (!isObject(document)) return undefined;
    const fn = (document as { toString?: unknown }).toString;
    if (typeof fn !== 'function') return undefined;
    return fn.bind(document) as () => string;
  }

  private getDocumentElementOuterHtml(document: unknown): string | undefined {
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
}

class HtmlNoiseRemovalPipeline {
  private readonly promo = new PromoDetector();
  private readonly classifier = new NoiseClassifier(this.promo);
  private readonly stripper = new NoiseStripper(this.classifier);
  private readonly urlResolver = new RelativeUrlResolver();
  private readonly serializer = new DocumentSerializer();

  removeNoise(html: string, document?: Document, baseUrl?: string): string {
    const shouldParse = isFullDocumentHtml(html) || mayContainNoise(html);
    if (!shouldParse) return html;

    // Best-effort: keep the original behavior of never throwing.
    try {
      if (config.noiseRemoval.debug) {
        logDebug('Noise removal audit enabled', {
          categories: [...getEnabledCategories()],
        });
      }

      const resolvedDocument = document ?? parseHTML(html).document;

      this.stripper.strip(resolvedDocument);

      if (baseUrl) this.urlResolver.resolve(resolvedDocument, baseUrl);

      return this.serializer.serialize(resolvedDocument, html);
    } catch {
      return html;
    }
  }
}

const pipeline = new HtmlNoiseRemovalPipeline();

export function removeNoiseFromHtml(
  html: string,
  document?: Document,
  baseUrl?: string
): string {
  return pipeline.removeNoise(html, document, baseUrl);
}
