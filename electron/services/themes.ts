import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Built-in themes (bundled with the app)
export const BUILTIN_THEMES = ['lapis-dark', 'lapis', 'vercel', 'newsprint'] as const;
export type BuiltinTheme = typeof BUILTIN_THEMES[number];

export interface ThemeInfo {
  id: string;
  name: string;
  isBuiltIn: boolean;
  filePath?: string;
}

/**
 * Get the user's custom themes directory path
 */
export function getThemesDirectory(): string {
  return path.join(app.getPath('userData'), 'themes');
}

/**
 * Ensure the themes directory exists, create if not
 */
export function ensureThemesDirectory(): void {
  const themesDir = getThemesDirectory();
  if (!fs.existsSync(themesDir)) {
    fs.mkdirSync(themesDir, { recursive: true });
  }
}

/**
 * Scan for custom theme CSS files in the themes directory
 */
export function scanCustomThemes(): ThemeInfo[] {
  const themesDir = getThemesDirectory();

  if (!fs.existsSync(themesDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(themesDir);
    const themes: ThemeInfo[] = [];

    for (const file of files) {
      if (file.endsWith('.css')) {
        const themeName = file.replace('.css', '');
        // Skip if it conflicts with a built-in theme name
        if (BUILTIN_THEMES.includes(themeName as BuiltinTheme)) {
          console.warn(`Custom theme "${themeName}" conflicts with built-in theme, skipping`);
          continue;
        }

        themes.push({
          id: themeName,
          name: formatThemeName(themeName),
          isBuiltIn: false,
          filePath: path.join(themesDir, file)
        });
      }
    }

    return themes;
  } catch (error) {
    console.error('Error scanning custom themes:', error);
    return [];
  }
}

/**
 * Get all available themes (built-in + custom)
 */
export function getAvailableThemes(): ThemeInfo[] {
  // Built-in themes first
  const builtInThemes: ThemeInfo[] = BUILTIN_THEMES.map(id => ({
    id,
    name: formatThemeName(id),
    isBuiltIn: true
  }));

  // Then custom themes
  const customThemes = scanCustomThemes();

  return [...builtInThemes, ...customThemes];
}

/**
 * Transform Typora CSS to use .theme-{name} wrapper
 */
export function transformTyporaCSS(css: string, themeName: string): string {
  const wrapper = `.theme-${themeName}`;

  let transformed = css
    // #write → .theme-{name}
    .replace(/#write\b/g, wrapper)
    // :root { ... } → .theme-{name} { ... }
    .replace(/:root\s*\{/g, `${wrapper} {`)
    // Remove html, body selectors (we handle background separately)
    .replace(/^html\s*,?\s*/gm, '')
    .replace(/^body\s*,?\s*/gm, '')
    .replace(/^html\s*\{[^}]*\}/gm, '')
    .replace(/^body\s*\{[^}]*\}/gm, '')
    // .cm-s-inner (CodeMirror) → .theme-{name} pre
    .replace(/\.cm-s-inner/g, `${wrapper} pre`)
    // Clean up empty selectors
    .replace(/^\s*,\s*\{/gm, '{');

  return transformed;
}

/**
 * Extract background color from CSS for the viewer container
 */
export function extractBackgroundColor(css: string): string | null {
  // Try to find background-color in :root or body
  const bgMatch = css.match(/(?:--bg-color|--background|background-color)\s*:\s*([^;}\n]+)/i);
  if (bgMatch) {
    const value = bgMatch[1].trim();
    // If it's a variable reference, try to find the actual value
    if (value.startsWith('var(')) {
      const varName = value.match(/var\(([^)]+)\)/)?.[1];
      if (varName) {
        const varMatch = css.match(new RegExp(`${varName}\\s*:\\s*([^;}\n]+)`, 'i'));
        if (varMatch) {
          return varMatch[1].trim();
        }
      }
    }
    return value;
  }
  return null;
}

/**
 * Load and transform a custom theme's CSS
 */
export function loadCustomThemeCSS(themeId: string): { css: string; backgroundColor: string | null } | null {
  const themesDir = getThemesDirectory();
  const filePath = path.join(themesDir, `${themeId}.css`);

  if (!fs.existsSync(filePath)) {
    console.error(`Theme file not found: ${filePath}`);
    return null;
  }

  try {
    const rawCSS = fs.readFileSync(filePath, 'utf8');
    const backgroundColor = extractBackgroundColor(rawCSS);
    const transformedCSS = transformTyporaCSS(rawCSS, themeId);

    return {
      css: transformedCSS,
      backgroundColor
    };
  } catch (error) {
    console.error(`Error loading theme ${themeId}:`, error);
    return null;
  }
}

/**
 * Check if a theme is built-in
 */
export function isBuiltInTheme(themeId: string): boolean {
  return BUILTIN_THEMES.includes(themeId as BuiltinTheme);
}

/**
 * Format theme name for display (kebab-case to Title Case)
 */
function formatThemeName(id: string): string {
  return id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
