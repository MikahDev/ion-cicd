/**
 * Markdown Utilities
 * HTML <-> Markdown conversion for script documentation
 */

import TurndownService from 'turndown';
import { marked } from 'marked';

// Configure Turndown for HTML -> Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*', // Use * for italic instead of _ for consistency
});

// Note: Style stripping is done via regex pre-processing since we're in Node.js
// (Turndown's filter runs in Node which doesn't have DOM APIs)

/**
 * Converts HTML documentation to clean Markdown
 * Strips inline styles and converts to readable Markdown format
 *
 * @param html - HTML string from ION script documentation
 * @returns Clean Markdown string
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === '') {
    return '';
  }

  // Pre-process: remove style attributes before conversion
  const cleanHtml = html.replace(/\s*style="[^"]*"/gi, '');

  // Convert to Markdown
  let markdown = turndownService.turndown(cleanHtml);

  // Post-process: clean up extra whitespace
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .trim();

  return markdown;
}

/**
 * Converts Markdown documentation to HTML for ION API
 *
 * @param markdown - Markdown string from .md file
 * @returns HTML string for ION API
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '';
  }

  // Use marked to convert Markdown to HTML
  const html = marked.parse(markdown, { async: false }) as string;

  return html.trim();
}
