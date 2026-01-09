import type TurndownService from 'turndown';

import { isRecord } from '../../utils/guards.js';

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

function isElement(node: unknown): node is HTMLElement {
  return (
    isRecord(node) &&
    'getAttribute' in node &&
    typeof node.getAttribute === 'function'
  );
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

function isNoiseNode(node: TurndownService.Node): boolean {
  return isElement(node) && isNoiseElement(node);
}

export function addNoiseRule(instance: TurndownService): void {
  instance.addRule('removeNoise', {
    filter: (node) => isNoiseNode(node),
    replacement: () => '',
  });
}
