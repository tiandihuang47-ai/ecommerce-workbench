declare module "fontkit" {
  export interface TTFGlyph {
    id: number;
    advanceWidth: number;
  }
  export interface TTFLayoutResult {
    advanceWidth: number;
    glyphs: TTFGlyph[];
  }
  export interface TTFFont {
    familyName: string;
    subfamilyName: string;
    fullName: string;
    postscriptName: string;
    unitsPerEm: number;
    numGlyphs: number;
    ascent: number;
    descent: number;
    lineGap: number;
    layout(text: string): TTFLayoutResult;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): TTFGlyph | null;
    getGlyph(glyphId: number): unknown;
  }
  export interface TTFCollection {
    fonts: TTFFont[];
    getFont(index: number): TTFFont | null;
  }
  export type FontkitFont = TTFFont | TTFCollection;
  export function openSync(path: string): FontkitFont;
  export function open(path: string): Promise<FontkitFont>;
  export function registerFormat(format: string, handler: unknown): void;
  export function create(buffer: Buffer): FontkitFont;
  export const defaultLanguage: string;
  export const logErrors: boolean;
  export function setDefaultLanguage(lang: string): void;
}
