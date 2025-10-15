function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function parseCssColorRaw(cssValue: string | null): [number, number, number, number] | null {
  if (!cssValue) return null;
  cssValue = cssValue.trim();
  try {
    // rgb/rgba
    const rgbMatch = cssValue.match(/rgba?\s*\(([^)]+)\)/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map(p => p.trim());
      const r = parseFloat(parts[0]) / 255;
      const g = parseFloat(parts[1]) / 255;
      const b = parseFloat(parts[2]) / 255;
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1.0;
      return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
    }

    // hex #rrggbb or #rgb
    const hexMatch = cssValue.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        return [clamp01(r), clamp01(g), clamp01(b), 1.0];
      } else {
        const r = parseInt(hex.substr(0, 2), 16) / 255;
        const g = parseInt(hex.substr(2, 2), 16) / 255;
        const b = parseInt(hex.substr(4, 2), 16) / 255;
        return [clamp01(r), clamp01(g), clamp01(b), 1.0];
      }
    }
  } catch (e) {
    // fall through
  }
  return null;
}

// Try to resolve arbitrary CSS color expressions by using a temporary element and getComputedStyle.
function resolveCssColor(cssExpression: string | null): [number, number, number, number] | null {
  if (!cssExpression) return null;
  try {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.color = cssExpression;
    document.documentElement.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.documentElement.removeChild(el);
    return parseCssColorRaw(computed);
  } catch (e) {
    return null;
  }
}

export function getClearColorFromCSS(): [number, number, number, number] {
  try {
    const style = getComputedStyle(document.documentElement);
    let surface = (style.getPropertyValue('--md-sys-color-background') || '').trim();

    const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    const fallbackDark: [number, number, number, number] = [0.05, 0.05, 0.05, 1.0];
    const fallbackLight: [number, number, number, number] = [1.0, 1.0, 1.0, 1.0];

  // First try resolving complex CSS expressions (var(), hsl(), keywords)
  const resolved = resolveCssColor(surface);
  const parsed = resolved || parseCssColorRaw(surface) || (isDark ? fallbackDark : fallbackLight);

  return parsed;
  } catch (e) {
    return [0.05, 0.05, 0.05, 1.0];
  }
}
