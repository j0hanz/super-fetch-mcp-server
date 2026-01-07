import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { htmlToMarkdown } from '../dist/transformers/markdown.transformer.js';

describe('htmlToMarkdown noise filtering', () => {
  it('removes common noise nodes while keeping content', () => {
    const html = `
      <html>
        <body>
          <p>Keep me</p>
          <nav><p>NAVTEXT</p></nav>
          <footer><p>FOOTER</p></footer>
          <div hidden><p>HIDDEN</p></div>
          <div aria-hidden="true"><p>ARIAHIDDEN</p></div>
          <div role="navigation"><p>ROLETEXT</p></div>
          <div class="newsletter"><p>PROMO</p></div>
          <div class="fixed"><p>FIXED</p></div>
          <div class="z-50 isolate"><p>ZISO</p></div>
        </body>
      </html>
    `;

    const markdown = htmlToMarkdown(html);

    assert.ok(markdown.includes('Keep me'));
    assert.ok(!markdown.includes('NAVTEXT'));
    assert.ok(!markdown.includes('FOOTER'));
    assert.ok(!markdown.includes('HIDDEN'));
    assert.ok(!markdown.includes('ARIAHIDDEN'));
    assert.ok(!markdown.includes('ROLETEXT'));
    assert.ok(!markdown.includes('PROMO'));
    assert.ok(!markdown.includes('FIXED'));
    assert.ok(!markdown.includes('ZISO'));
  });
});
