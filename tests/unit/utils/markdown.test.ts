/**
 * Markdown Utility Unit Tests
 */

import { describe, it, expect } from '@jest/globals';
import { htmlToMarkdown, markdownToHtml } from '../../../src/utils/markdown.js';

describe('Markdown Utilities', () => {
  describe('htmlToMarkdown', () => {
    it('should convert simple HTML to Markdown', () => {
      const html = '<p>Hello World</p>';
      const result = htmlToMarkdown(html);
      expect(result).toBe('Hello World');
    });

    it('should convert headings', () => {
      const html = '<h1>Title</h1><h2>Subtitle</h2>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('# Title');
      expect(result).toContain('## Subtitle');
    });

    it('should convert bold and italic', () => {
      const html = '<p><strong>bold</strong> and <em>italic</em></p>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
    });

    it('should convert lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = htmlToMarkdown(html);
      // Turndown may add extra whitespace in list items
      expect(result).toMatch(/-\s+Item 1/);
      expect(result).toMatch(/-\s+Item 2/);
    });

    it('should convert links', () => {
      const html = '<a href="https://example.com">Example</a>';
      const result = htmlToMarkdown(html);
      expect(result).toBe('[Example](https://example.com)');
    });

    it('should strip inline styles', () => {
      const html = '<p style="color: red; font-size: 12px;">Styled text</p>';
      const result = htmlToMarkdown(html);
      expect(result).toBe('Styled text');
      expect(result).not.toContain('style');
    });

    it('should handle empty string', () => {
      expect(htmlToMarkdown('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
      expect(htmlToMarkdown('   ')).toBe('');
    });

    it('should handle null-like values', () => {
      expect(htmlToMarkdown(null as unknown as string)).toBe('');
      expect(htmlToMarkdown(undefined as unknown as string)).toBe('');
    });

    it('should convert code blocks', () => {
      const html = '<pre><code>const x = 1;</code></pre>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('const x = 1;');
    });

    it('should clean up excessive newlines', () => {
      const html = '<p>First</p>\n\n\n\n<p>Second</p>';
      const result = htmlToMarkdown(html);
      // Should have at most 2 consecutive newlines
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should handle complex ION documentation HTML', () => {
      const html = `
        <div style="margin: 10px;">
          <h3 style="color: blue;">Script Purpose</h3>
          <p style="font-family: Arial;">This script processes incoming BODs.</p>
          <ul style="list-style: square;">
            <li>Validates input</li>
            <li>Transforms data</li>
          </ul>
        </div>
      `;
      const result = htmlToMarkdown(html);
      expect(result).toContain('### Script Purpose');
      expect(result).toContain('This script processes incoming BODs.');
      // Turndown may add extra whitespace in list items
      expect(result).toMatch(/-\s+Validates input/);
      expect(result).toMatch(/-\s+Transforms data/);
      expect(result).not.toContain('style=');
    });
  });

  describe('markdownToHtml', () => {
    it('should convert simple Markdown to HTML', () => {
      const markdown = 'Hello World';
      const result = markdownToHtml(markdown);
      expect(result).toContain('Hello World');
    });

    it('should convert headings', () => {
      const markdown = '# Title\n## Subtitle';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<h2>Subtitle</h2>');
    });

    it('should convert bold and italic', () => {
      const markdown = '**bold** and *italic*';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<em>italic</em>');
    });

    it('should convert lists', () => {
      const markdown = '- Item 1\n- Item 2';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
    });

    it('should convert links', () => {
      const markdown = '[Example](https://example.com)';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<a href="https://example.com">Example</a>');
    });

    it('should handle empty string', () => {
      expect(markdownToHtml('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
      expect(markdownToHtml('   ')).toBe('');
    });

    it('should handle null-like values', () => {
      expect(markdownToHtml(null as unknown as string)).toBe('');
      expect(markdownToHtml(undefined as unknown as string)).toBe('');
    });

    it('should convert code blocks', () => {
      const markdown = '```\nconst x = 1;\n```';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<code>');
      expect(result).toContain('const x = 1;');
    });

    it('should convert inline code', () => {
      const markdown = 'Use `console.log()` for debugging';
      const result = markdownToHtml(markdown);
      expect(result).toContain('<code>console.log()</code>');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve basic content through round-trip', () => {
      const originalMarkdown = `# Documentation

This is a test script.

## Features

- Feature 1
- Feature 2

[Link](https://example.com)`;

      const html = markdownToHtml(originalMarkdown);
      const backToMarkdown = htmlToMarkdown(html);

      // Content should be preserved (formatting may differ slightly)
      expect(backToMarkdown).toContain('# Documentation');
      expect(backToMarkdown).toContain('This is a test script.');
      expect(backToMarkdown).toContain('## Features');
      expect(backToMarkdown).toContain('Feature 1');
      expect(backToMarkdown).toContain('Feature 2');
      expect(backToMarkdown).toContain('[Link](https://example.com)');
    });
  });
});
