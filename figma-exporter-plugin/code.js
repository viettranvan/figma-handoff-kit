let activeRunId = null;
let exportProfile = null;
function sendUI(message) {
  figma.ui.postMessage({ ...message, runId: activeRunId });
}

// Prefer the Figma file key; persist an explicit local identity when unavailable.
let localDocumentId = figma.root.getPluginData("figmaExportDocumentId");
if (!localDocumentId) {
  localDocumentId = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  figma.root.setPluginData("figmaExportDocumentId", localDocumentId);
}
function exportIdentity(node) {
  const path = [];
  for (let item = node; item && item.type !== "DOCUMENT"; item = item.parent) {
    path.unshift({ id: item.id, name: item.name });
  }
  const platform = exportProfile?.platform || "web";
  const suffix = platform === "web" ? "" : `:${platform}`;
  return {
    document: { id: (figma.fileKey || localDocumentId) + suffix, name: figma.root.name + (suffix ? ` (${platform})` : "") },
    node_path: path
  };
}

// Figma to AI Agent Exporter - Pixel-Perfect High-Fidelity & Design System Edition
figma.showUI(__html__, { width: 500, height: 720 });
let language = "vi";
figma.clientStorage.getAsync("exportLanguage").then(value => {
  language = value === "en" ? "en" : "vi";
  sendUI({ type: "LANGUAGE", language });
});
const localized = (vi, en) => language === "en" ? en : vi;

let currentAckResolver = null;

function waitForUploadAck(timeoutMs = 60000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    currentAckResolver = (success) => {
      clearTimeout(timer);
      resolve(success);
    };
  });
}

function getStatusInfo() {
  const selection = figma.currentPage.selection;
  const currentPage = figma.currentPage;
  const pages = figma.root.children.map(p => ({ id: p.id, name: p.name }));

  let pageScreens = 0;
  let pageSections = 0;
  for (const node of currentPage.children) {
    if (node.type === "SECTION") {
      pageSections++;
      for (const ch of node.children) {
        if (ch.type === "FRAME" || ch.type === "COMPONENT" || ch.type === "INSTANCE" || ch.type === "COMPONENT_SET") {
          pageScreens++;
        }
      }
    } else if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET") {
      pageScreens++;
    }
  }

  let selSections = 0;
  let selScreens = 0;
  function countSelection(node) {
    if (node.type === "SECTION") {
      selSections++;
      node.children.forEach(countSelection);
    } else if (["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(node.type) &&
               node.width >= 160 && node.height >= 100) selScreens++;
  }
  selection.forEach(countSelection);

  return {
    currentPageName: currentPage.name,
    pageScreens: pageScreens,
    pageSections: pageSections,
    totalPages: pages.length,
    pagesList: pages,
    hasSelection: selection.length > 0,
    selectionName: selection.length > 0 ? selection[0].name : "Chưa chọn mục nào",
    selectionScreens: selScreens,
    selectionSections: selSections
  };
}

function sendStatus() {
  sendUI({
    type: "STATUS_UPDATE",
    data: getStatusInfo()
  });
}

sendStatus();
figma.on("selectionchange", () => sendStatus());
figma.on("currentpagechange", () => sendStatus());

function sanitizeFilename(name) {
  const value = String(name || "unnamed").replace(/[\\/*?:"<>| ]/g, "_").replace(/_+/g, "_").trim() || "unnamed";
  let prefix = "", bytes = 0, hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  for (const char of value) {
    const point = char.codePointAt(0);
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > 80) return prefix + "--" + hash.toString(16).padStart(8, "0");
    prefix += char;
    bytes += size;
  }
  return value;
}

function bufferToBase64(bytes, profile = null) {
  const start = Date.now();
  try {
  if (typeof figma.base64Encode === 'function') return figma.base64Encode(bytes);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
  } finally { if (profile) profile.assetEncodeMs += Date.now() - start; }
}

async function measured(profile, key, task) {
  if (!profile) return task();
  const start = Date.now();
  try { return await task(); }
  finally { profile[key] += Date.now() - start; }
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return binary;
}

// Convert Figma color (0-1 RGB) to HEX or RGBA
function colorToRgba(color, opacity = 1) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(opacity * 100) / 100;
  if (a >= 1) {
    const toHex = (c) => c.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Prefer numeric font weights; style names are a fallback for older/mixed data.
function fontWeightNumber(font, numericWeight) {
  if (typeof numericWeight === 'number' && Number.isFinite(numericWeight)) return String(numericWeight);
  const style = (font && typeof font === 'object' ? font.style || '' : '').toLowerCase().replace(/[ -]/g, '');
  const weights = [['black', '900'], ['heavy', '900'], ['extrabold', '800'], ['ultrabold', '800'], ['semibold', '600'], ['demibold', '600'], ['bold', '700'], ['medium', '500'], ['extralight', '200'], ['ultralight', '200'], ['light', '300'], ['thin', '100']];
  return (weights.find(([name]) => style.includes(name)) || [null, '400'])[1];
}

// Detect the original file format rather than labeling every source image PNG.
function imageFormat(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { extension: 'png', name: 'PNG' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', name: 'JPEG' };
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 3) === 'GIF') return { extension: 'gif', name: 'GIF' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { extension: 'webp', name: 'WebP' };
  return { extension: 'bin', name: 'Unknown original format' };
}

function inspectStrokes(node) {
  if (!Array.isArray(node.strokes) || !node.strokes.length) return null;
  const paints = node.strokes.filter(paint => paint.visible !== false);
  const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : null;
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side =>
    typeof node[`stroke${side}Weight`] === 'number' ? node[`stroke${side}Weight`] : weight);
  const simple = paints.length === 1 && paints[0].type === 'SOLID' &&
    ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type) &&
    node.strokeAlign === 'INSIDE' && !(node.dashPattern || []).length &&
    sides.every(value => value !== null && value >= 0);
  return {
    paints: node.strokes, alignment: node.strokeAlign, weight,
    sideWeights: { top: sides[0], right: sides[1], bottom: sides[2], left: sides[3] },
    dashPattern: node.dashPattern || [], cap: node.strokeCap, join: node.strokeJoin,
    miterLimit: node.strokeMiterLimit,
    cssFallbackSupported: simple,
    ...(paints.length && !simple ? { warning: 'Stroke requires native CSS or an SVG/rendered asset; full stroke metadata is retained without a guessed border.' } : {})
  };
}

// Semantic HTML tag detector
function detectSemanticTag(node) {
  const name = (node.name || "").toLowerCase();
  
  if (node.type === "TEXT") {
    const size = typeof node.fontSize === "number" ? node.fontSize : 14;
    const style = (node.fontName && typeof node.fontName === "object" && node.fontName.style) ? node.fontName.style.toLowerCase() : "";
    if (size >= 30) return "h1";
    if (size >= 24) return "h2";
    if (size >= 20) return "h3";
    if (size >= 16 && (style.includes("bold") || style.includes("semi"))) return "h4";
    if (name.includes("label") || name.includes("caption")) return "label";
    if (name.includes("link") || name.includes("url")) return "a";
    return "p";
  }

  if (name.includes("button") || name.includes("btn") || name.includes("cta")) return "button";
  if (name.includes("input") || name.includes("search") || name.includes("field") || name.includes("textbox")) return "input";
  if (name.includes("header") || name.includes("navbar") || name.includes("topbar")) return "header";
  if (name.includes("sidebar") || name.includes("drawer") || name.includes("aside")) return "aside";
  if (name.includes("nav") || name.includes("menu") || name.includes("breadcrumb")) return "nav";
  if (name.includes("footer")) return "footer";
  if (name.includes("card") || name.includes("panel") || name.includes("item")) return "article";
  if (name.includes("badge") || name.includes("tag") || name.includes("chip") || name.includes("pill")) return "span";
  if (name.includes("modal") || name.includes("dialog") || name.includes("popup")) return "dialog";
  if (name.includes("table") || name.includes("grid")) return "table";
  if (name.includes("icon") || node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") return "svg";
  
  return "div";
}

// Comprehensive CSS Builder (Merges native getCSSAsync with programmatic extraction for 100% fidelity)
async function computeFullCSS(node, figmaCss = {}, parentNode = null) {
  const css = Object.assign({}, figmaCss);

  // 1. Box Model / Dimensions
  if (node.width !== undefined && node.height !== undefined) {
    if (!css.width) css.width = `${Math.round(node.width * 100) / 100}px`;
    if (!css.height) css.height = `${Math.round(node.height * 100) / 100}px`;
    css["box-sizing"] = "border-box";
  }

  // Fill grows only on the parent's main axis; cross-axis Fill stretches.
  for (const [axis, dimension] of [['Horizontal', 'width'], ['Vertical', 'height']]) {
    const sizing = node[`layoutSizing${axis}`];
    if (sizing === 'HUG') css[dimension] = 'fit-content';
    if (sizing !== 'FILL') continue;
    const flow = node.layoutPositioning !== 'ABSOLUTE' && parentNode && ['HORIZONTAL', 'VERTICAL'].includes(parentNode.layoutMode);
    if (flow) {
      const mainAxis = (parentNode.layoutMode === 'HORIZONTAL') === (axis === 'Horizontal');
      if (mainAxis) {
        css['flex-grow'] = '1';
        css['flex-shrink'] = '1';
        css['flex-basis'] = '0';
        css[dimension] = '0px';
        css[`min-${dimension}`] = figmaCss[`min-${dimension}`] || '0px';
      } else {
        css[dimension] = 'auto';
        css['align-self'] = 'stretch';
      }
    } else {
      css[dimension] = '100%';
    }
  }

  // 3. Positioning (Absolute vs In-Flow)
  if ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") {
    css["position"] = "absolute";
    css["left"] = `${Math.round(node.x * 100) / 100}px`;
    css["top"] = `${Math.round(node.y * 100) / 100}px`;
  }

  // 4. Flexbox / Auto Layout
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    css["display"] = "flex";
    css["flex-direction"] = node.layoutMode === "HORIZONTAL" ? "row" : "column";
    
    if (node.layoutWrap === "WRAP") {
      css["flex-wrap"] = "wrap";
      if (node.counterAxisSpacing) {
        css["row-gap"] = `${node.counterAxisSpacing}px`;
      }
    } else {
      css["flex-wrap"] = "nowrap";
    }

    if (node.itemSpacing !== undefined && node.itemSpacing > 0) {
      css["gap"] = `${node.itemSpacing}px`;
    }

    // Align items & Justify Content
    const alignMap = {
      MIN: "flex-start",
      CENTER: "center",
      MAX: "flex-end",
      SPACE_BETWEEN: "space-between",
      BASELINE: "baseline"
    };
    if (node.primaryAxisAlignItems && alignMap[node.primaryAxisAlignItems]) {
      css["justify-content"] = alignMap[node.primaryAxisAlignItems];
    }
    if (node.counterAxisAlignItems && alignMap[node.counterAxisAlignItems]) {
      css["align-items"] = alignMap[node.counterAxisAlignItems];
    }

    // Padding (4 sides)
    const pt = node.paddingTop || 0;
    const pr = node.paddingRight || 0;
    const pb = node.paddingBottom || 0;
    const pl = node.paddingLeft || 0;
    if (pt !== 0 || pr !== 0 || pb !== 0 || pl !== 0) {
      if (pt === pb && pr === pl) {
        css["padding"] = pt === pr ? `${pt}px` : `${pt}px ${pr}px`;
      } else {
        css["padding"] = `${pt}px ${pr}px ${pb}px ${pl}px`;
      }
    }
  }

  // 5. Fills & Backgrounds
  if (node.type !== "TEXT" && "fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
    const visibleFills = node.fills.filter(f => f.visible !== false);
    for (const fill of visibleFills) {
      if (fill.type === "SOLID") {
        css["background-color"] = colorToRgba(fill.color, fill.opacity !== undefined ? fill.opacity : 1);
      }
      // Gradients retain native CSS geometry; raw paint data is exported below.
    }
  }

  // Keep native stroke geometry. Only a simple inside solid box maps to borders.
  const stroke = inspectStrokes(node);
  const hasNativeBorder = Object.keys(figmaCss).some(key => key.startsWith('border') && !key.includes('radius'));
  if (stroke?.cssFallbackSupported && !hasNativeBorder) {
    const paint = stroke.paints.find(paint => paint.visible !== false);
    const color = colorToRgba(paint.color, paint.opacity ?? 1);
    for (const [side, weight] of Object.entries(stroke.sideWeights)) {
      css[`border-${side}`] = `${weight}px solid ${color}`;
    }
  }

  // 7. Border Radius
  if ("cornerRadius" in node) {
    if (node.cornerRadius !== figma.mixed && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
      css["border-radius"] = `${node.cornerRadius}px`;
    } else if ("topLeftRadius" in node) {
      const tl = node.topLeftRadius || 0;
      const tr = node.topRightRadius || 0;
      const br = node.bottomRightRadius || 0;
      const bl = node.bottomLeftRadius || 0;
      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        css["border-radius"] = `${tl}px ${tr}px ${br}px ${bl}px`;
      }
    }
  }

  // 8. Effects (Drop Shadows, Inner Shadows, Background Blur)
  if ("effects" in node && Array.isArray(node.effects)) {
    const shadows = [];
    for (const eff of node.effects) {
      if (eff.visible === false) continue;
      if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
        const inset = eff.type === "INNER_SHADOW" ? "inset " : "";
        const col = colorToRgba(eff.color, eff.color.a !== undefined ? eff.color.a : 1);
        const x = eff.offset.x;
        const y = eff.offset.y;
        const r = eff.radius;
        const s = eff.spread || 0;
        shadows.push(`${inset}${x}px ${y}px ${r}px ${s}px ${col}`);
      } else if (eff.type === "BACKGROUND_BLUR") {
        css["backdrop-filter"] = `blur(${eff.radius}px)`;
        css["-webkit-backdrop-filter"] = `blur(${eff.radius}px)`;
      } else if (eff.type === "LAYER_BLUR") {
        css["filter"] = `blur(${eff.radius}px)`;
      }
    }
    if (shadows.length > 0) {
      css["box-shadow"] = shadows.join(", ");
    }
  }

  // 9. Typography
  if (node.type === "TEXT") {
    if (node.fontName && typeof node.fontName === "object" && node.fontName !== figma.mixed) {
      css["font-family"] = `"${node.fontName.family}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      css["font-weight"] = typeof node.fontWeight === 'number'
        ? fontWeightNumber(node.fontName, node.fontWeight)
        : figmaCss['font-weight'] || fontWeightNumber(node.fontName);
    }

    if (node.fontSize && typeof node.fontSize === "number") {
      css["font-size"] = `${node.fontSize}px`;
    }

    if (node.lineHeight && typeof node.lineHeight === "object") {
      if (node.lineHeight.unit === "PIXELS") {
        css["line-height"] = `${Math.round(node.lineHeight.value * 100) / 100}px`;
      } else if (node.lineHeight.unit === "PERCENT") {
        css["line-height"] = `${Math.round(node.lineHeight.value) / 100}`;
      }
    }

    if (node.letterSpacing && typeof node.letterSpacing === "object") {
      if (node.letterSpacing.unit === "PIXELS" && node.letterSpacing.value !== 0) {
        css["letter-spacing"] = `${Math.round(node.letterSpacing.value * 100) / 100}px`;
      } else if (node.letterSpacing.unit === "PERCENT" && node.letterSpacing.value !== 0) {
        css["letter-spacing"] = `${Math.round(node.letterSpacing.value) / 100}em`;
      }
    }

    if (node.textAlignHorizontal) {
      css["text-align"] = node.textAlignHorizontal.toLowerCase();
    }

    // Text color
    if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
      const textFill = node.fills.find(f => f.visible !== false && f.type === "SOLID");
      if (textFill) {
        css["color"] = colorToRgba(textFill.color, textFill.opacity !== undefined ? textFill.opacity : 1);
      }
    }
  }

  // 10. Opacity & Overflow
  if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1) {
    css["opacity"] = `${Math.round(node.opacity * 100) / 100}`;
  }
  if ("clipsContent" in node && node.clipsContent === true) {
    css["overflow"] = "hidden";
  }

  return css;
}

function formatCssBlock(cssObj) {
  return Object.entries(cssObj)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
}

// Invalid component sets can throw from Figma's native variant getter.
function readVariantProperties(node, variantNode = node) {
  try {
    return { value: node.variantProperties || null };
  } catch (error) {
    const warning = `Variant metadata unavailable for ${node.name} (${node.id}): ${error.message}`;
    // Only recover actual variants, not arbitrary instance or component-set labels.
    const rawName = variantNode.name;
    const normalized = typeof rawName === "string" ? rawName.trim().replace(/^=+\s*/, "") : "";
    function parseName(name) {
      const properties = {}, unassigned = [];
      for (const part of name.split(",")) {
        const pair = part.trim();
        if (!pair) return null;
        if (!pair.includes("=")) { unassigned.push(pair); continue; }
        const match = pair.match(/^([^=]+)=([^=]+)$/);
        if (!match) return null;
        const key = match[1].trim(), value = match[2].trim();
        if (!key || !value || ["__proto__", "constructor", "prototype"].includes(key) || Object.prototype.hasOwnProperty.call(properties, key)) return null;
        properties[key] = value;
      }
      return { properties, unassigned };
    }
    const parsed = parseName(normalized);
    const value = parsed?.properties || {};
    let valid = variantNode.parent?.type === "COMPONENT_SET" && normalized.length > 0 && !!parsed;
    let source = "normalized-name";
    if (valid && parsed.unassigned.length) {
      // Infer one missing key only from a consistent schema of well-formed siblings.
      const siblings = (variantNode.parent.children || []).filter(child => child.type === "COMPONENT" && child.id !== variantNode.id);
      const schemas = siblings.map(child => parseName(String(child.name || "").trim()));
      const complete = schemas.filter(schema => schema && !schema.unassigned.length);
      const keys = complete.length ? Object.keys(complete[0].properties).sort() : [];
      const consistent = complete.length === siblings.length && complete.length > 0 && complete.every(schema => JSON.stringify(Object.keys(schema.properties).sort()) === JSON.stringify(keys));
      const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
      valid = consistent && parsed.unassigned.length === 1 && missing.length === 1 && Object.keys(value).every(key => keys.includes(key));
      if (valid) {
        value[missing[0]] = parsed.unassigned[0];
        valid = !complete.some(schema => keys.every(key => schema.properties[key] === value[key]));
        if (!valid) delete value[missing[0]];
        source = "sibling-schema";
      }
    }
    if (valid) {
      sendUI({ type: "PROGRESS_UPDATE", message: `⚠ Variant metadata inferred from name for ${node.name} (${node.id}); verify the original component.` });
      return { value, warning, source, rawName, normalizedName: Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join(", ") };
    }
    if (variantNode.parent?.type === "COMPONENT_SET" && parsed && parsed.unassigned.length) {
      const partialWarning = `Variant metadata incomplete for ${node.name} (${node.id}); unassigned labels: ${parsed.unassigned.join(", ")}. Figma: ${error.message}`;
      sendUI({ type: "PROGRESS_UPDATE", message: `⚠ ${partialWarning}` });
      return { value, warning: partialWarning, source: "partial-name", rawName, normalizedName: normalized, unassigned: parsed.unassigned };
    }
    sendUI({ type: "PROGRESS_UPDATE", message: `⚠ ${warning}` });
    return { value: null, warning };
  }
}

// Inspect Component Instance & Generate Reusable Directives
function inspectComponentInstance(node, context = null) {
  const started = Date.now();
  try {
  const mainComp = node.mainComponent;
  if (!mainComp) return null;

  const compSet = (mainComp.parent && mainComp.parent.type === "COMPONENT_SET") ? mainComp.parent : null;
  const componentSetName = compSet ? compSet.name : mainComp.name;
  const variants = readVariantProperties(node, mainComp);
  const masterName = mainComp.name;

  const propertyWarnings = [];
  function readProperties(owner, field) {
    try { return owner?.[field] || {}; }
    catch (error) { propertyWarnings.push(`${field}: ${error.message}`); return null; }
  }
  const componentProperties = readProperties(node, 'componentProperties');
  const owner = compSet || mainComp;
  const cache = context?.componentMetadataCache;
  let shared = cache?.get(owner.id);
  if (shared) {
    if (context.profile) context.profile.componentCacheHits++;
    propertyWarnings.push(...shared.warnings);
  } else {
    if (context?.profile) context.profile.componentMetadataReads++;
    const before = propertyWarnings.length;
    shared = { definitions:readProperties(owner, 'componentPropertyDefinitions'), description:compSet?.description || mainComp.description || '', warnings:propertyWarnings.slice(before) };
    if (cache && shared.definitions !== null) cache.set(owner.id, shared);
  }
  const componentPropertyDefinitions = shared.definitions;
  const inferredTextProps = [];
  function findOverrides(n) {
    if (n.type === 'TEXT' && n.characters) {
      const lower = (n.name || '').toLowerCase();
      const suggestedName = ['label', 'title', 'placeholder', 'value'].find(name => lower.includes(name)) || 'text';
      inferredTextProps.push({ nodeId: n.id, nodeName: n.name, suggestedName, value: n.characters, source: 'layer-name-inference' });
    }
    // Nested instances own their properties; do not treat their text as parent props.
    if (n !== node && n.type === 'INSTANCE') return;
    for (const child of n.children || []) findOverrides(child);
  }
  findOverrides(node);
  const codeSnippet = `Map Figma component ${JSON.stringify(componentSetName)} to your code component. Figma properties: ${JSON.stringify(componentProperties)}. Confirm code prop names/types; layer-name inferences are not an API contract.`;

  return {
    isSharedComponent: true,
    componentSetName: componentSetName,
    masterComponentName: masterName,
    masterComponentId: mainComp.id,
    variantProperties: variants.value,
    ...(variants.warning ? { variantWarning: variants.warning } : {}),
    ...(variants.unassigned ? { unassignedVariantLabels: variants.unassigned } : {}),
    ...(variants.source ? { variantMetadataSource: variants.source, variantRawName: variants.rawName, variantNormalizedName: variants.normalizedName } : {}),
    description: shared.description,
    componentProperties,
    componentPropertyDefinitions,
    propertySource: 'figma-component-properties',
    inferredTextProps,
    ...(propertyWarnings.length ? { propertyWarnings } : {}),
    recommendedUsage: codeSnippet,
    reuseDirective: `Find the code component matching Figma ${JSON.stringify(componentSetName)} and map its official Figma properties to the verified code API. Variant metadata source: ${variants.source || 'figma'}.`
  };
  } finally { if (context?.profile) context.profile.componentMs += Date.now() - started; }
}

// Generate Google Fonts links (unverified candidates only)
function recordFontUsage(fonts, font, weight) {
  if (!font || typeof font !== 'object' || !font.family) return;
  if (!fonts[font.family]) fonts[font.family] = {};
  const usage = fonts[font.family][weight];
  const styles = usage && typeof usage === 'object' ? usage : {};
  styles[/italic|oblique/i.test(font.style || '') ? 'italic' : 'normal'] = true;
  fonts[font.family][weight] = styles;
}

// Font availability/licensing cannot be inferred from a Figma family name.
function generateFontGuides(fontsMap) {
  const details = [];
  const families = [];
  for (const [family, weightsObj] of Object.entries(fontsMap)) {
    const weights = Object.keys(weightsObj).sort((a, b) => Number(a) - Number(b));
    const variants = [];
    for (const weight of weights) {
      const usage = weightsObj[weight];
      if (usage === true || usage.normal) variants.push({ weight, italic: false });
      if (usage && usage.italic) variants.push({ weight, italic: true });
    }
    variants.sort((a, b) => Number(a.italic) - Number(b.italic) || Number(a.weight) - Number(b.weight));
    details.push({ family, weights, variants, availability: 'unverified' });
    const axes = variants.map(v => `${v.italic ? 1 : 0},${v.weight}`).join(';');
    families.push(`family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${axes}`);
  }
  return {
    fonts: details,
    googleFontUrl: null,
    googleFontsCandidateUrl: families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null,
    warning: 'Font availability and licensing are unverified. Load the actual font files or verify every family/variant on Google Fonts before using the candidate URL. No font is downloaded by this exporter.',
    htmlLinkTag: '<!-- Load verified font files or a verified provider stylesheet here. -->',
    cssImportRule: '/* Add @font-face or a verified provider import before using this stack. */',
    cssFontFamilyStack: [...details.map(font => JSON.stringify(font.family)), 'sans-serif'].join(', ')
  };
}

// Preserve Figma identities separately from resolved CSS values (names are not unique).
async function extractTokenReferences(node, nodeItem, context) {
  const catalog = context.designTokens.namedTokens || (context.designTokens.namedTokens = {});
  const references = [];
  const warnings = [];
  const resolvedValues = new Map();
  const cache = context.tokenVariableCache || (context.tokenVariableCache = new Map());
  const expanded = context.tokenAliasesExpanded || (context.tokenAliasesExpanded = new Set());
  async function variableGraph(id, path = new Set()) {
    const tokenId = `variable:${id}`;
    if (path.has(id)) {
      const message = `Variable alias cycle: ${[...path, id].join(' -> ')}`;
      warnings.push(message);
      catalog[tokenId].warnings = [...new Set([...(catalog[tokenId].warnings || []), message])];
      return cache.get(id);
    }
    if (path.size >= 64) { warnings.push(`Variable alias depth limit reached: ${id}`); return null; }
    if (!cache.has(id)) {
      try {
        const value = await figma.variables.getVariableByIdAsync(id);
        if (!value) throw new Error('Variable unavailable');
        cache.set(id, value);
        catalog[tokenId] = { source: 'figma-variable', id: value.id, key: value.key, name: value.name, resolvedType: value.resolvedType, collectionId: value.variableCollectionId, valuesByMode: value.valuesByMode };
        if (figma.variables.getVariableCollectionByIdAsync) {
          const collections = context.designTokens.variableCollections || (context.designTokens.variableCollections = {});
          if (!collections[value.variableCollectionId]) {
            try {
              const collection = await figma.variables.getVariableCollectionByIdAsync(value.variableCollectionId);
              if (!collection) throw new Error('Collection unavailable');
              collections[value.variableCollectionId] = { id: collection.id, name: collection.name, modes: collection.modes, defaultModeId: collection.defaultModeId };
            } catch (error) { collections[value.variableCollectionId] = { id: value.variableCollectionId, warning: error.message }; }
          }
        }
      } catch (error) {
        cache.set(id, null);
        catalog[tokenId] = { source: 'figma-variable', id, unavailable: true, warning: error.message };
      }
    }
    const value = cache.get(id);
    if (!value) { warnings.push(`Variable unavailable: ${id}`); return null; }
    if (!expanded.has(id)) {
      const nextPath = new Set([...path, id]);
      for (const entry of Object.values(value.valuesByMode)) {
        if (entry && entry.type === 'VARIABLE_ALIAS') await variableGraph(entry.id, nextPath);
      }
      expanded.add(id);
    }
    return value;
  }
  async function variable(alias, property, range) {
    if (!alias || alias.type !== 'VARIABLE_ALIAS') return;
    const tokenId = `variable:${alias.id}`;
    const ref = { tokenId, property, ...(range || {}) };
    references.push(ref);
    try {
      const value = await variableGraph(alias.id);
      if (!value) return;
      // Resolve on the actual consumer: two nodes can use different collection modes.
      if (resolvedValues.has(alias.id)) {
        ref.resolvedValue = resolvedValues.get(alias.id);
        if (context.profile) context.profile.resolveCacheHits++;
      } else {
        if (context.profile) context.profile.resolveCalls++;
        ref.resolvedValue = value.resolveForConsumer(node).value;
        resolvedValues.set(alias.id, ref.resolvedValue);
      }
    } catch (error) { warnings.push(`${property}: ${error.message}`); }
  }
  async function bindings(bound, prefix, range) {
    for (const [field, aliases] of Object.entries(bound || {})) {
      for (const [index, alias] of (Array.isArray(aliases) ? aliases : [aliases]).entries()) {
        await variable(alias, `${prefix}${field}${Array.isArray(aliases) ? `[${index}]` : ''}`, range);
      }
    }
  }
  async function paints(values, property, range) {
    if (!Array.isArray(values)) return;
    for (const [index, paint] of values.entries()) {
      if (paint.visible === false) continue;
      await bindings(paint.boundVariables, `${property}[${index}].`, range);
      for (const [stop, value] of (paint.gradientStops || []).entries()) {
        await bindings(value.boundVariables, `${property}[${index}].gradientStops[${stop}].`, range);
      }
    }
  }
  async function style(id, property, range) {
    if (typeof id !== 'string' || !id) return;
    const tokenId = `style:${id}`;
    references.push({ tokenId, property, ...(range || {}) });
    try {
      const styles = context.tokenStyleCache || (context.tokenStyleCache = new Map());
      if (!styles.has(id)) styles.set(id, figma.getStyleByIdAsync(id));
      let value;
      try { value = await styles.get(id); } catch (error) { styles.delete(id); throw error; }
      if (!value) { styles.delete(id); throw new Error('Style unavailable'); }
      const entry = { source: 'figma-style', id: value.id, key: value.key, name: value.name, styleType: value.type, description: value.description };
      if (value.type === 'PAINT') entry.paints = value.paints;
      if (value.type === 'TEXT') {
        for (const field of ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'textCase', 'textDecoration']) entry[field] = value[field];
      }
      catalog[tokenId] = entry;
      await bindings(value.boundVariables, `${property}.`, range);
      if (value.type === 'PAINT') await paints(value.paints, property, range);
    } catch (error) { warnings.push(`${property}: ${error.message}`); }
  }
  await style(node.fillStyleId, 'fillStyle');
  await style(node.strokeStyleId, 'strokeStyle');
  await style(node.textStyleId, 'textStyle');
  await bindings(node.boundVariables, '');
  for (const [name, property] of Object.entries(nodeItem.component?.componentProperties || {})) {
    await bindings(property.boundVariables, `componentProperties.${name}.`);
  }
  for (const [name, definition] of Object.entries(nodeItem.component?.componentPropertyDefinitions || {})) {
    await bindings(definition.boundVariables, `componentPropertyDefinitions.${name}.`);
  }
  await paints(node.fills, 'fills');
  await paints(node.strokes, 'strokes');
  if (node.type === 'TEXT' && node.characters) {
    // Style/fill differences can exist even when font metrics are uniform.
    const segments = node.getStyledTextSegments(['textStyleId', 'fillStyleId', 'fills', 'boundVariables']);
    for (const run of segments) {
      const range = { start: run.start, end: run.end };
      await style(run.textStyleId, 'textStyle', range);
      await style(run.fillStyleId, 'fillStyle', range);
      await bindings(run.boundVariables, '', range);
      await paints(run.fills, 'fills', range);
    }
  }
  if (references.length) nodeItem.tokenReferences = references;
  if (warnings.length) nodeItem.tokenWarnings = [...new Set(warnings)];
}

// Compare repeated instance descendants before considering reuse.
function instanceCssKey(node, instances) {
  try {
    if (node.type === 'INSTANCE' || !node.id.startsWith('I')) return null;
    const placement = ancestor => [
      ancestor.type, ancestor.width, ancestor.height, ancestor.layoutMode,
      ancestor.layoutPositioning, ancestor.layoutSizingHorizontal,
      ancestor.layoutSizingVertical, ancestor.layoutAlign, ancestor.layoutGrow
    ];
    const chain = [];
    let instance = node.parent;
    while (instance && instance.type !== 'INSTANCE') {
      chain.push(placement(instance));
      instance = instance.parent;
    }
    if (!instance) return null;
    if (!instances.has(instance.id)) {
      const master = instance.mainComponent;
      instances.set(instance.id, master ? [
        master.id, instance.variantProperties, instance.componentProperties,
        (instance.overrides || []).map(override => [
          override.id.replace(instance.id, '').replace(/^I[^;]+;/, ''),
          [...override.overriddenFields].sort()
        ]).sort()
      ] : null);
    }
    const identity = instances.get(instance.id);
    if (!identity) return null;
    return JSON.stringify([
      identity, node.id.split(';').at(-1), placement(node), chain,
      placement(instance), instance.parent ? placement(instance.parent) : null,
      node.relativeTransform, Object.entries(node.resolvedVariableModes || {}).sort(),
      node.boundVariables, node.fills, node.strokes, node.opacity,
      node.strokeWeight, node.strokeTopWeight, node.strokeRightWeight,
      node.strokeBottomWeight, node.strokeLeftWeight, node.strokeAlign,
      node.strokeCap, node.strokeJoin, node.strokeMiterLimit, node.dashPattern,
      node.type === 'TEXT' ? [node.characters, node.textStyleId] : null
    ]);
  } catch {
    return null;
  }
}

function generateSimpleNativeCss(node) {
  if (node.type !== "FRAME" && node.type !== "RECTANGLE") return null;
  const parent = node.parent;
  if (!parent || !["HORIZONTAL", "VERTICAL"].includes(parent.layoutMode) ||
      node.layoutPositioning !== "AUTO" || node.layoutSizingVertical !== "FIXED" ||
      node.visible === false || node.isMask || node.opacity !== 1 || node.rotation !== 0 ||
      !["NORMAL", "PASS_THROUGH"].includes(node.blendMode) ||
      node.children?.length || (node.type === "FRAME" && node.layoutMode !== "NONE") ||
      !Array.isArray(node.strokes) || node.strokes.length ||
      !Array.isArray(node.effects) || node.effects.length ||
      node.fillStyleId !== "" || node.strokeStyleId !== "" ||
      Object.keys(node.boundVariables || {}).length ||
      node.topLeftRadius !== 0 || node.topRightRadius !== 0 ||
      node.bottomLeftRadius !== 0 || node.bottomRightRadius !== 0 ||
      [node.minWidth, node.maxWidth, node.minHeight, node.maxHeight].some(value => value != null) ||
      !Array.isArray(node.fills)) return null;
  const px = value => `${Math.round(value * 100) / 100}px`;
  if (node.type === "FRAME" && node.fills.length === 0 &&
      parent.layoutMode === "HORIZONTAL" && node.layoutSizingHorizontal === "FILL" &&
      node.layoutGrow === 1) return { height: px(node.height), flex: "1 0 0" };
  if (node.type !== "RECTANGLE" || node.layoutSizingHorizontal !== "FIXED" ||
      node.layoutGrow !== 0 || node.layoutAlign === "STRETCH" || node.fills.length !== 1) return null;
  const paint = node.fills[0];
  if (paint.type !== "SOLID" || paint.visible === false || paint.opacity !== 1 ||
      paint.blendMode !== "NORMAL" || Object.keys(paint.boundVariables || {}).length) return null;
  const background = "#" + [paint.color.r, paint.color.g, paint.color.b]
    .map(channel => Math.round(channel * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { width: px(node.width), height: px(node.height), background };
}

// Prefetch CSS only; extraction and asset rendering still commit in scene order.
function createNativeCssReader(root, profile = null, screenshot = null, instanceMode = "verify", generatedMode = "off") {
  function* nodes(node) {
    yield node;
    if ('children' in node) for (const child of node.children) {
      if (child.visible !== false) yield* nodes(child);
    }
  }
  const iterator = nodes(root), pending = new Map();
  let disabled = false;
  const instances = new Map(), groups = new Map(), cached = new Map();
  const fetchCss = node => Promise.resolve().then(async () => {
    if (!('getCSSAsync' in node)) return {};
    const generated = !disabled && generatedMode !== "off" ? generateSimpleNativeCss(node) : null;
    if (generated && generatedMode === "use") {
      profile.generatedCssUses = (profile.generatedCssUses || 0) + 1;
      return generated;
    }
    const key = !disabled && profile && instanceMode !== "off" && instanceCssKey(node, instances);
    if (key && instanceMode === "reuse" && cached.has(key)) {
      profile.instanceCssCacheHits = (profile.instanceCssCacheHits || 0) + 1;
      return cached.get(key);
    }
    const start = Date.now();
    if (profile) profile.cssApiCalls = (profile.cssApiCalls || 0) + 1;
    try {
      const css = await node.getCSSAsync();
      if (generated) {
        const counter = JSON.stringify(generated) === JSON.stringify(css)
          ? "generatedCssMatches" : "generatedCssMismatches";
        profile[counter] = (profile[counter] || 0) + 1;
        if (counter === "generatedCssMismatches") {
          const samples = profile.generatedCssSamples ||= [];
          if (samples.length < 5) samples.push({ nodeId: node.id, type: node.type, generated, native: css });
        }
      }
      if (key && instanceMode === "reuse") cached.set(key, css);
      if (key && instanceMode === "verify") {
        const signature = JSON.stringify(Object.entries(css).sort());
        const group = groups.get(key);
        if (!group) {
          groups.set(key, { signature, repeats: 0, consistent: true, nodeId: node.id });
          profile.instanceCssGroups = groups.size;
        } else {
          group.repeats++;
          if (group.consistent && signature !== group.signature) {
            group.consistent = false;
            const previous = Object.fromEntries(JSON.parse(group.signature));
            const differences = [...new Set([...Object.keys(previous), ...Object.keys(css)])]
              .filter(property => previous[property] !== css[property]);
            const conflicts = profile.instanceCssConflictSamples ||= [];
            if (conflicts.length < 20) conflicts.push({
              firstNodeId: group.nodeId, nodeId: node.id, type: node.type, differences
            });
            profile.instanceCssReusable = (profile.instanceCssReusable || 0) - (group.repeats - 1);
            profile.instanceCssConflictingGroups = (profile.instanceCssConflictingGroups || 0) + 1;
          }
          if (group.consistent) profile.instanceCssReusable = (profile.instanceCssReusable || 0) + 1;
          profile.instanceCssRepeated = (profile.instanceCssRepeated || 0) + 1;
        }
      }
      return css;
    }
    catch { if (profile) profile.cssApiFailures = (profile.cssApiFailures || 0) + 1; return {}; }
    finally { if (profile) profile.cssApiElapsedMs = (profile.cssApiElapsedMs || 0) + Date.now() - start; }
  });
  function fill() {
    while (pending.size < 4) {
      const next = iterator.next();
      if (next.done) break;
      pending.set(next.value.id, fetchCss(next.value));
    }
  }
  let warming;
  if (screenshot) {
    let rendering = true;
    const stop = () => { rendering = false; };
    screenshot.then(stop, stop);
    warming = (async () => {
      while (rendering && pending.size < 64) {
        const batch = [];
        for (let index = 0; index < 4; index++) {
          const next = iterator.next();
          if (next.done) break;
          const request = fetchCss(next.value);
          pending.set(next.value.id, request);
          batch.push(request);
        }
        if (!batch.length) break;
        await Promise.all(batch);
      }
    })().catch(() => { disabled = true; });
  }
  return async node => {
    if (warming) { await warming; warming = null; }
    if (disabled) return fetchCss(node);
    fill();
    if (!pending.has(node.id)) {
      // An edit can change traversal while exporting; fall back to sequential reads.
      await Promise.all(pending.values());
      pending.clear();disabled = true;
      return fetchCss(node);
    }
    const css = await pending.get(node.id);
    pending.delete(node.id);
    fill();
    return css;
  };
}

// Only plain, untransformed solid circles qualify; everything else uses native export.
function circleSvgCacheKey(node, nodeItem, reasons = null, legacy = false) {
  const reject = reason => { if (reasons) reasons[reason] = (reasons[reason] || 0) + 1; return null; };
  try {
    if (node.type !== 'ELLIPSE') return reject('not-ellipse');
    if (!(node.width > 0) || node.width !== node.height) return reject('not-circle');
    if (node.opacity !== 1 || node.isMask || !['PASS_THROUGH','NORMAL'].includes(node.blendMode)) return reject('opacity-mask-blend');
    if (node.effects.length || node.strokes.length || node.dashPattern.length) return reject('effects-strokes-dashes');
    const arc = node.arcData;
    // Native angles can be float32; only accept a full circle, never a partial arc.
    const fullTurn = arc && (legacy ? Math.abs(arc.endingAngle - 2 * Math.PI) <= 1e-10 : [2 * Math.PI, Math.fround(2 * Math.PI)].includes(arc.endingAngle));
    if (!arc || arc.startingAngle !== 0 || !fullTurn || arc.innerRadius !== 0) return reject('arc-not-full-circle');
    const t = node.relativeTransform;
    if (t[0][0] !== 1 || t[0][1] !== 0 || t[1][0] !== 0 || t[1][1] !== 1) return reject('transform');
    if (!Array.isArray(node.fills) || node.fills.length !== 1) return reject('fill-count');
    const paint = node.fills[0];
    if (paint.type !== 'SOLID' || paint.visible === false || paint.blendMode !== 'NORMAL') return reject('fill-not-solid-normal');
    if (nodeItem.tokenWarnings?.length) return reject('token-warning');
    const resolved = (nodeItem.tokenReferences || []).filter(ref => ref.property.startsWith('fills[')).map(ref => ({property:ref.property,value:ref.resolvedValue}));
    if (resolved.some(ref => ref.value === undefined)) return reject('unresolved-fill-token');
    return JSON.stringify({width:node.width,arc,fill:paint,resolved});
  } catch { return reject('property-unavailable'); }
}

// Narrow icon class validated against native SVG; context-sensitive output stays uncached.
async function boundIconFingerprint(root, context) {
  const reject = reason => { if (context.profile) { const reasons=context.profile.boundIconRejections;reasons[reason]=(reasons[reason]||0)+1; } return null; };
  if (!['chevron-down','chevron-left','chevron-right','info-circle'].includes(root.name)) return null;
  try {
    if (!(root.width>0 && root.width<=32 && root.height>0 && root.height<=32)) throw new Error('size');
    let count=0;
    async function bindings(value,node) {
      if (Array.isArray(value)) return Promise.all(value.map(x=>bindings(x,node)));
      if (value && typeof value==='object') {
        if(value.type==='VARIABLE_ALIAS') {
          const cache=context.boundIconState.variables;
          if(!cache.has(value.id)) {
            const variable=await figma.variables.getVariableByIdAsync(value.id);
            if(!variable) throw new Error('variable-unavailable');
            cache.set(value.id,variable);
          }
          const resolved=cache.get(value.id).resolveForConsumer(node).value;
          if(resolved===undefined || resolved?.type==='VARIABLE_ALIAS') throw new Error('variable-unresolved');
          return {id:value.id,value:resolved};
        }
        const entries=[];
        for(const key of Object.keys(value).sort())entries.push([key,await bindings(value[key],node)]);
        return Object.fromEntries(entries);
      }
      if(typeof value==='symbol')throw new Error('mixed');
      return value;
    }
    async function shape(node,top) {
      if(++count>24)throw new Error('complexity');
      if(!['INSTANCE','COMPONENT','FRAME','VECTOR','LINE','ELLIPSE','RECTANGLE'].includes(node.type) || !top && ['INSTANCE','COMPONENT'].includes(node.type))throw new Error('type');
      if(node.effects.length || node.isMask || node.opacity!==1 || !['NORMAL','PASS_THROUGH'].includes(node.blendMode))throw new Error('effects-mask-opacity');
      if(Object.keys(node.boundVariables||{}).some(key=>!['fills','strokes'].includes(key)))throw new Error('non-paint-binding');
      for(const paint of [...node.fills,...node.strokes]) {
        if(paint.type!=='SOLID' || paint.blendMode!=='NORMAL')throw new Error('paint');
        if(Object.keys(paint.boundVariables||{}).some(key=>key!=='color'))throw new Error('non-color-binding');
      }
      const result={};
      const fields=['type','name','width','height','fills','strokes','strokeWeight','strokeAlign','strokeCap','strokeJoin','strokeMiterLimit','strokeTopWeight','strokeBottomWeight','strokeLeftWeight','strokeRightWeight','dashPattern','cornerRadius','cornerSmoothing','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','arcData','clipsContent','vectorPaths','vectorNetwork','boundVariables'];
      for(const key of fields) {const value=node[key];if(value!==undefined)result[key]=await bindings(value,node);}
      if(node.type==='VECTOR' && (!Array.isArray(node.vectorPaths)||!node.vectorNetwork))throw new Error('vector-geometry');
      const t=node.relativeTransform;result.transform=top?[[t[0][0],t[0][1],0],[t[1][0],t[1][1],0]]:t;
      if(node.children) {result.children=[];for(const child of node.children)if(child.visible!==false)result.children.push(await shape(child,false));}
      return result;
    }
    return JSON.stringify(await shape(root,true));
  } catch(error) {return reject(error.message||'property');}
}

function observeBoundIcon(key, code, context) {
  if (!key || !context.boundIconState) return;
  const state=context.boundIconState, profile=context.profile;
  profile.boundIconEligible++;
  if (!code.includes('<svg') || /\bid=|url\(|href=/.test(code)) {
    profile.boundIconRejections['context-sensitive-output']=(profile.boundIconRejections['context-sensitive-output']||0)+1;return;
  }
  if(state.outputs.has(key)) {
    profile.boundIconShadowMatches += state.outputs.get(key)===code ? 1 : 0;
    profile.boundIconShadowMismatches += state.outputs.get(key)!==code ? 1 : 0;
  } else if(state.outputs.size<256) {state.outputs.set(key,code);profile.boundIconUnique++;}
}

async function readOriginalImage(imageHash, context) {
  const owner = context.imageContext || context;
  const cache = owner.originalImageCache || (owner.originalImageCache = new Map());
  if (cache.has(imageHash)) {
    if (context.profile) context.profile.imageCacheHits++;
    return cache.get(imageHash);
  }
  if (context.profile) context.profile.imageSourceReads++;
  const image = figma.getImageByHash(imageHash);
  if (!image) throw new Error('Image unavailable');
  const bytes = await measured(context.profile, 'assetRenderMs', () => image.getBytesAsync());
  const size = await measured(context.profile, 'assetRenderMs', () => image.getSizeAsync());
  const result = { format:imageFormat(bytes), size, base64:bufferToBase64(bytes,context.profile) };
  // Bound retained encoded data during large exports. Eviction affects speed only.
  if (result.base64.length <= 16 * 1024 * 1024) {
    while (cache.size && (owner.originalImageCacheChars || 0) + result.base64.length > 16 * 1024 * 1024) {
      const first = cache.keys().next().value;
      owner.originalImageCacheChars -= cache.get(first).base64.length;cache.delete(first);
    }
    cache.set(imageHash,result);owner.originalImageCacheChars = (owner.originalImageCacheChars || 0) + result.base64.length;
  }
  return result;
}

async function exportSvg(node, nodeItem, context) {
  if (context.profile) {
    context.profile.svgLegacyRejections ||= {};context.profile.svgRejections ||= {};
    circleSvgCacheKey(node,nodeItem,context.profile.svgLegacyRejections,true);
  }
  const key = circleSvgCacheKey(node, nodeItem, context.profile?.svgRejections);
  const cache = context.circleSvgCache;
  if (key && cache?.has(key)) {
    if (context.profile) context.profile.svgCacheHits++;
    return cache.get(key);
  }
  const iconKey = context.boundIconState ? await measured(context.profile,'boundIconFingerprintMs',()=>boundIconFingerprint(node,context)) : null;
  if (iconKey && context.boundIconState.reuse && context.boundIconState.outputs.has(iconKey)) {
    context.profile.boundIconCacheHits++;
    context.profile.boundIconEligible++;
    context.profile.svgCacheHits++;
    return context.boundIconState.outputs.get(iconKey);
  }
  if (context.profile) context.profile.svgRenderCalls++;
  const code = decodeUtf8(await measured(context.profile, 'assetRenderMs', () => node.exportAsync({format:'SVG'})));
  observeBoundIcon(iconKey,code,context);
  // Cache only successful self-contained SVGs; IDs/references can be context-sensitive.
  if (key && cache && code.includes('<svg') && !/\bid=|url\(|href=/.test(code)) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, code);
  }
  else if (key && context.profile) context.profile.svgRejections['context-sensitive-output'] = (context.profile.svgRejections['context-sensitive-output'] || 0) + 1;
  return code;
}

// Diagnostic similarity only, never a cache key or a claim of render equivalence.
function recordReuseDiagnostic(node, item, nativeCss, context, parent) {
  if (!context.profile) return;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  const maps = context.reuseDiagnosticMaps || (context.reuseDiagnosticMaps = {css:new Map(),component:new Map()});
  const diagnostics = context.profile.reuseDiagnostic || (context.profile.reuseDiagnostic = {cssNodes:0,componentNodes:0,droppedGroups:0});
  function record(kind, value) {
    const key = JSON.stringify(canonical(value)), groups=maps[kind];
    const previous=groups.get(key);
    if (previous) previous.count++;
    else if (groups.size < 4096) groups.set(key,{count:1,type:node.type,name:node.name});
    else diagnostics.droppedGroups++;
  }
  diagnostics.cssNodes++;
  const consumer={width:node.width,height:node.height,layoutPositioning:node.layoutPositioning,layoutSizingHorizontal:node.layoutSizingHorizontal,layoutSizingVertical:node.layoutSizingVertical,parentType:parent?.type,parentWidth:parent?.width,parentHeight:parent?.height,parentLayout:parent?.layoutMode};
  record('css',{type:node.type,css:nativeCss,consumer});
  if (item.component?.isSharedComponent) {
    diagnostics.componentNodes++;
    record('component',{master:item.component.masterComponentId,variant:item.component.variantProperties,props:item.component.componentProperties,css:nativeCss,consumer,text:item.component.inferredTextProps?.map(x=>({name:x.nodeName,value:x.value})),resolved:item.tokenReferences?.filter(x=>'resolvedValue' in x).map(x=>({property:x.property,value:x.resolvedValue})),childCount:node.children?.length});
  }
}

function finishReuseDiagnostic(context) {
  if (!context.profile || !context.reuseDiagnosticMaps) return;
  const diagnostic=context.profile.reuseDiagnostic;
  for (const [kind,map] of Object.entries(context.reuseDiagnosticMaps)) {
    const entries=[...map.values()];
    diagnostic[kind]={groups:entries.length,repeatedUsages:entries.reduce((sum,x)=>sum+x.count-1,0),topGroups:entries.sort((a,b)=>b.count-a.count).slice(0,10)};
  }
  delete context.reuseDiagnosticMaps;
}

// Deep recursive DOM Tree Extractor
async function extractDetailedNodeTree(node, context, parentNode = null, metadataOnly = false) {
  let nativeCss = {};
  if (!context.mobileOnly) {
    const readCss = context.readNativeCss || (context.readNativeCss = createNativeCssReader(node, context.profile, null, "off", context.generatedCssMode));
    nativeCss = await measured(context.profile, 'cssWaitMs', () => readCss(node));
  }

  const computedCss = await computeFullCSS(node, nativeCss, parentNode);
  const semanticTag = detectSemanticTag(node);

  const nodeItem = {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(!context.mobileOnly ? { semanticTag } : {}),
    visible: node.visible !== false,
    bounds: {
      width: Math.round(node.width * 100) / 100,
      height: Math.round(node.height * 100) / 100,
      x: Math.round(node.x * 100) / 100,
      y: Math.round(node.y * 100) / 100
    },
    layoutFlow: ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") ? "absolute" : "in-flow",
    ...(!context.mobileOnly ? { css: computedCss, cssString: formatCssBlock(computedCss) } : {})
  };

  try {
    if (node.componentPropertyReferences) nodeItem.componentPropertyReferences = node.componentPropertyReferences;
  } catch (error) { nodeItem.componentPropertyWarning = error.message; }

  if (context.platform && context.platform !== "web") {
    nodeItem.native = {
      constraints: node.constraints,
      horizontalSizing: node.layoutSizingHorizontal,
      verticalSizing: node.layoutSizingVertical,
      layoutAlign: node.layoutAlign,
      layoutGrow: node.layoutGrow,
      layoutWrap: node.layoutWrap,
      counterAxisSpacing: node.counterAxisSpacing,
      minWidth: node.minWidth, maxWidth: node.maxWidth,
      minHeight: node.minHeight, maxHeight: node.maxHeight,
      clipsContent: node.clipsContent,
      opacity: node.opacity,
      rotation: node.rotation,
      cornerRadii: [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius],
      fills: Array.isArray(node.fills) ? node.fills : undefined,
      effects: node.effects,
      textAutoResize: node.textAutoResize,
      textAlignVertical: node.textAlignVertical
    };
  }

  const strokeInfo = inspectStrokes(node);
  if (strokeInfo) nodeItem.stroke = strokeInfo;

  const gradients = Array.isArray(node.fills) ? node.fills.filter(fill => fill.visible !== false && fill.type.startsWith('GRADIENT')) : [];
  if (gradients.length) {
    nodeItem.gradientFills = gradients;
    if (!context.mobileOnly && !nativeCss.background && !nativeCss['background-image'] && !(node.type === 'TEXT' && nativeCss.color)) {
      nodeItem.cssWarnings = ['Gradient geometry is preserved in gradientFills; native gradient CSS was unavailable. Use the screenshot or asset rather than guessing a CSS gradient.'];
    }
  }

  // 1. REUSABLE COMPONENT IDENTIFICATION
  if (node.type === "INSTANCE") {
    const compInfo = inspectComponentInstance(node, context);
    if (compInfo) {
      nodeItem.component = compInfo;

      const setName = compInfo.componentSetName;
      if (!context.componentsUsed[setName]) {
        context.componentsUsed[setName] = {
          componentSet: setName,
          description: compInfo.description,
          totalUsageCount: 0,
          variantsEncountered: [],
          sampleUsages: [],
          reuseRules: `Find the code component matching Figma ${JSON.stringify(setName)}. Verify the code API before mapping Figma properties.`
        };
      }
      context.componentsUsed[setName].totalUsageCount++;

      // Track variants
      const varStr = JSON.stringify(compInfo.variantProperties);
      const existingVar = context.componentsUsed[setName].variantsEncountered.find(v => JSON.stringify(v.properties) === varStr && JSON.stringify(v.unassignedVariantLabels) === JSON.stringify(compInfo.unassignedVariantLabels));
      if (existingVar) {
        existingVar.count++;
      } else {
        context.componentsUsed[setName].variantsEncountered.push({
          properties: compInfo.variantProperties,
          ...(compInfo.unassignedVariantLabels ? { unassignedVariantLabels: compInfo.unassignedVariantLabels, variantMetadataSource: compInfo.variantMetadataSource } : {}),
          count: 1
        });
      }

      if (context.componentsUsed[setName].sampleUsages.length < 5) {
        context.componentsUsed[setName].sampleUsages.push({
          nodeId: node.id,
          nodeName: node.name,
          variant: compInfo.variantProperties,
          ...(compInfo.unassignedVariantLabels ? { unassignedVariantLabels: compInfo.unassignedVariantLabels, variantMetadataSource: compInfo.variantMetadataSource } : {}),
          props: compInfo.componentProperties,
          propertySource: compInfo.propertySource,
          inferredTextProps: compInfo.inferredTextProps,
          ...(!context.mobileOnly ? { recommendedSnippet: compInfo.recommendedUsage } : {})
        });
      }
    }
  } else if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const compSet = node.type === "COMPONENT_SET" ? node : (node.parent && node.parent.type === "COMPONENT_SET" ? node.parent : null);
    const variants = readVariantProperties(node);
    nodeItem.component = {
      isMasterDefinition: true,
      componentSetName: compSet ? compSet.name : node.name,
      variantProperties: variants.value,
      ...(variants.warning ? { variantWarning: variants.warning } : {}),
    ...(variants.unassigned ? { unassignedVariantLabels: variants.unassigned } : {}),
    ...(variants.source ? { variantMetadataSource: variants.source, variantRawName: variants.rawName, variantNormalizedName: variants.normalizedName } : {}),
      componentPropertyDefinitions: (() => { try { return (compSet || node).componentPropertyDefinitions || {}; } catch (error) { return { unavailable: error.message }; } })(),
      description: node.description || ""
    };
  }

  // 2. AUTO-LAYOUT DETAILS
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    nodeItem.autoLayout = {
      mode: node.layoutMode,
      itemSpacing: node.itemSpacing,
      padding: {
        top: node.paddingTop || 0,
        right: node.paddingRight || 0,
        bottom: node.paddingBottom || 0,
        left: node.paddingLeft || 0
      },
      primaryAxisAlign: node.primaryAxisAlignItems,
      counterAxisAlign: node.counterAxisAlignItems,
      layoutSizingHorizontal: node.layoutSizingHorizontal,
      layoutSizingVertical: node.layoutSizingVertical
    };
  }

  // 3. TEXT & TYPOGRAPHY & FONT TRACKING
  if (node.type === "TEXT" && node.characters) {
    nodeItem.text = node.characters;
    const font = node.fontName;
    const fontFamily = (font && typeof font === "object") ? font.family : "mixed";
    const fontStyle = (font && typeof font === "object") ? font.style : "mixed";
    
    const weightNum = typeof node.fontWeight === 'number'
      ? fontWeightNumber(font, node.fontWeight)
      : computedCss['font-weight'] || fontWeightNumber(font);

    recordFontUsage(context.fontsUsed, font, weightNum);

    const typo = {
      fontFamily: fontFamily,
      fontWeight: fontStyle,
      fontWeightNum: weightNum,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : "mixed",
      lineHeight: node.lineHeight === figma.mixed ? "mixed" : node.lineHeight || { unit: "AUTO" },
      letterSpacing: node.letterSpacing === figma.mixed ? "mixed" : node.letterSpacing || { unit: "PIXELS", value: 0 },
      textAlign: node.textAlignHorizontal || "LEFT",
      ...(computedCss.color || !context.mobileOnly ? { color: computedCss.color || "#101828" } : {})
    };
    nodeItem.typography = typo;
    // Always segment: color/decoration can differ even with uniform font metrics.
    nodeItem.textRuns = node.getStyledTextSegments(["fontName", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "fills", "textDecoration", "textCase", "textStyleId", "fillStyleId"]);
    for (const run of nodeItem.textRuns) {
      const weight = fontWeightNumber(run.fontName, run.fontWeight);
      recordFontUsage(context.fontsUsed, run.fontName, weight);
      const runTypography = {
        fontFamily: run.fontName.family, fontWeight: run.fontName.style, fontWeightNum: weight,
        fontSize: run.fontSize, lineHeight: run.lineHeight, letterSpacing: run.letterSpacing,
        fills: run.fills, textDecoration: run.textDecoration, textCase: run.textCase,
        textStyleId: run.textStyleId, fillStyleId: run.fillStyleId
      };
      context.designTokens.typography[JSON.stringify(runTypography)] = runTypography;
    }
    context.designTokens.typography[JSON.stringify(typo)] = typo;
  }

  try {
    await measured(context.profile, 'tokenMs', () => extractTokenReferences(node, nodeItem, context));
  } catch (error) {
    nodeItem.tokenWarnings = [...(nodeItem.tokenWarnings || []), `Token metadata incomplete: ${error.message}`];
  }

  if (!context.mobileOnly) recordReuseDiagnostic(node,nodeItem,nativeCss,context,parentNode);

  // 4. COLOR & EFFECT TOKENS
  if (computedCss["background-color"]) context.designTokens.colors[computedCss["background-color"]] = true;
  if (computedCss.color) context.designTokens.colors[computedCss.color] = true;
  if (computedCss["border-color"]) context.designTokens.colors[computedCss["border-color"]] = true;
  if (computedCss["border-radius"]) context.designTokens.radii[computedCss["border-radius"]] = true;
  if (computedCss["box-shadow"]) context.designTokens.shadows[computedCss["box-shadow"]] = true;

  // 5. VECTOR / ICON SVG EXPORT (Small frames, Vectors, Boolean ops)
  const isExplicitIconName = /icon|logo|arrow|chevron|check|close|search|status|dot|avatar|badge|spinner|caret|menu|bell|filter|lock|key|alert|eye|copy|logout|login/i.test(node.name || "");
  const isVectorType = (
    node.type === "VECTOR" ||
    node.type === "BOOLEAN_OPERATION" ||
    node.type === "STAR" ||
    node.type === "LINE" ||
    node.type === "ELLIPSE" ||
    node.type === "POLYGON"
  );
  const isSmallIconContainer = (
    (node.type === "FRAME" || node.type === "INSTANCE" || node.type === "COMPONENT") &&
    node.width > 0 && node.width <= 72 &&
    node.height > 0 && node.height <= 72 &&
    (isExplicitIconName || ("children" in node && node.children.every(ch => ch.type === "VECTOR" || ch.type === "BOOLEAN_OPERATION" || ch.type === "LINE" || ch.type === "ELLIPSE")))
  );

  const shouldExportAsSvg = (isVectorType || isSmallIconContainer || (isExplicitIconName && node.width <= 120 && node.height <= 120)) && node.type !== "TEXT";

  if (!metadataOnly && shouldExportAsSvg && node.width > 0 && node.height > 0) {
    try {
      const svgCode = await exportSvg(node, nodeItem, context);

      if (svgCode && svgCode.includes("<svg")) {
        const assetFileName = `assets/${sanitizeFilename(node.name)}_${sanitizeFilename(node.id.replace(":", "_"))}.svg`;
        context.assets.push({
          name: assetFileName,
          type: "text",
          content: svgCode
        });
        context.assetsManifest.push({
          filename: assetFileName,
          format: "SVG",
          nodeId: node.id,
          nodeName: node.name,
          dimensions: `${node.width}×${node.height}px`,
          purpose: "Icon / Vector graphic"
        });
        nodeItem.assetSvg = assetFileName;
      }
    } catch (e) {
      try {
        const svgCode = await measured(context.profile, 'assetRenderMs', () => node.exportAsync({ format: 'SVG_STRING' }));
        if (typeof svgCode === "string" && svgCode.includes("<svg")) {
          const assetFileName = `assets/${sanitizeFilename(node.name)}_${sanitizeFilename(node.id.replace(":", "_"))}.svg`;
          context.assets.push({
            name: assetFileName,
            type: "text",
            content: svgCode
          });
          context.assetsManifest.push({
            filename: assetFileName,
            format: "SVG",
            nodeId: node.id,
            nodeName: node.name,
            dimensions: `${node.width}×${node.height}px`,
            purpose: "Icon / Vector graphic"
          });
          nodeItem.assetSvg = assetFileName;
        }
      } catch (e2) {}
    }
  }

  // 6. IMAGE EXPORT (PNG)
  // 6a. Preserve original image bytes and Figma crop/transform separately.
  if (!metadataOnly && Array.isArray(node.fills)) {
    nodeItem.imageFills = [];
    for (const [index, fill] of node.fills.entries()) {
      if (fill.type !== 'IMAGE' || fill.visible === false || !fill.imageHash) continue;
      const imageFill = { index, ...fill, nodeSize: { width: node.width, height: node.height } };
      nodeItem.imageFills.push(imageFill);
      try {
        const original = await readOriginalImage(fill.imageHash, context);
        const format = original.format;
        const assetFileName = `assets/img_${sanitizeFilename(node.name)}_${fill.imageHash}.${format.extension}`;
        imageFill.asset = assetFileName;
        imageFill.sourceSize = original.size;
        context.assets.push({ name: assetFileName, type: 'base64', content: original.base64 });
        context.assetsManifest.push({
          filename: assetFileName, format: format.name, nodeId: node.id, nodeName: node.name,
          dimensions: `${imageFill.sourceSize.width}×${imageFill.sourceSize.height}px`,
          nodeDimensions: `${node.width}×${node.height}px`,
          purpose: 'Original image bytes; apply imageFills crop/scale/transform to match the design'
        });
        if (!nodeItem.assetImage) nodeItem.assetImage = assetFileName;
      } catch (error) {
        imageFill.warning = error.message;
      }
    }
    if (!nodeItem.imageFills.length) delete nodeItem.imageFills;
  }

  // 6b. Named raster / illustration / photo / hero / campus image frames (rendered as 2x PNG)
  const isImageNode = /image|photo|campus|hero|banner|illustration|mockup|preview|picture/i.test(node.name || "") &&
                      node.width >= 100 && node.height >= 80 &&
                      !shouldExportAsSvg && node.type !== "TEXT";

  if (!metadataOnly && isImageNode && !nodeItem.assetImage) {
    try {
      const pngBytes = await measured(context.profile, 'assetRenderMs', () => node.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: 2 }
      }));
      const b64 = bufferToBase64(pngBytes, context.profile);
      const assetFileName = `assets/${sanitizeFilename(node.name)}_${sanitizeFilename(node.id.replace(":", "_"))}.png`;
      context.assets.push({
        name: assetFileName,
        type: "base64",
        content: b64
      });
      context.assetsManifest.push({
        filename: assetFileName,
        format: "PNG (2x Retina)",
        nodeId: node.id,
        nodeName: node.name,
        dimensions: `${node.width * 2}×${node.height * 2}px`,
        purpose: "Raster Hero / Photo / Illustration"
      });
      nodeItem.assetImage = assetFileName;
    } catch (e) {}
  }

  // SVG children remain source metadata, not duplicate DOM/assets to render.
  if ('children' in node) {
    const key = nodeItem.assetSvg ? 'sourceChildren' : 'children';
    nodeItem[key] = [];
    for (const child of node.children) {
      if (child.visible !== false) {
        nodeItem[key].push(await extractDetailedNodeTree(child, context, node, metadataOnly || !!nodeItem.assetSvg));
      }
    }
  }

  return nodeItem;
}

// Generate Screen Spec Markdown
function generateMarkdownDoc(tree, componentsUsed, designTokens, fontGuide, assetsManifest) {
  let md = `# Screen Spec: ${tree.name} (\`${tree.id}\`)\n\n`;
  md += `![Screenshot](./screenshot.png)\n\n`;

  // 1. REUSABLE COMPONENTS CATALOG (CRITICAL FOR AGENT REUSE)
  md += `## 🧩 1. Reusable Components (Design System Catalog)\n`;
  md += `> **QUAN TRỌNG:** Các component dùng chung dưới đây đã được định nghĩa trong Design System.\n`;
  md += `> Khi AI Agent tạo giao diện, **PHẢI TÁI SỬ DỤNG** các component này thay vì tạo div/button mới!\n\n`;

  const compList = Object.values(componentsUsed);
  if (compList.length > 0) {
    md += `| Component Name | Lần dùng | Variants sử dụng | Code Snippet Gợi Ý |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const comp of compList) {
      const varSample = comp.variantsEncountered.map(v => JSON.stringify(v.properties)).join("<br>");
      const snippetSample = comp.sampleUsages.length > 0 ? `\`${comp.sampleUsages[0].recommendedSnippet.replace(/`/g, "")}\`` : "-";
      md += `| **\`<${comp.componentSet}>\`** | \`${comp.totalUsageCount}\` | ${varSample} | ${snippetSample} |\n`;
    }
    md += `\n### Chi tiết mẫu sử dụng Component:\n`;
    for (const comp of compList) {
      md += `#### Component \`<${comp.componentSet}>\`:\n`;
      for (const s of comp.sampleUsages) {
        md += `- **Element:** \`${s.nodeName}\` | **Props:** \`${JSON.stringify(s.props)}\`\n`;
        md += `  \`\`\`jsx\n  ${s.recommendedSnippet}\n  \`\`\`\n`;
      }
    }
  } else {
    md += `*Không phát hiện Component thư viện ngoài, các thành phần là Custom Frames.*\n`;
  }
  md += `\n`;

  // 2. FONT & TYPOGRAPHY SETUP
  md += `## 🔤 2. Font & Typography Setup\n`;
  md += `Verify font availability and licensing, then load the actual families and variants listed in fonts_guide.json. Provider URLs are suggestions, not verified downloads:\n\n`;
  md += `### HTML \`<head>\` Embed Code:\n\`\`\`html\n${fontGuide.htmlLinkTag}\n\`\`\`\n\n`;
  md += `### CSS \`@import\` Rule:\n\`\`\`css\n${fontGuide.cssImportRule}\n\nbody {\n  font-family: ${fontGuide.cssFontFamilyStack};\n}\n\`\`\`\n\n`;

  // 3. ASSETS INVENTORY (ICONS & IMAGES)
  md += `## 🖼️ 3. Assets Đã Trích Xuất (Icons SVG & Images PNG)\n`;
  if (assetsManifest && assetsManifest.length > 0) {
    md += `| File Name | Format | Dimensions | Purpose | Code Usage Gợi Ý |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const a of assetsManifest) {
      const usage = a.format === "SVG" ? `\`<img src="./${a.filename}" alt="${a.nodeName}" />\`` : `\`<img src="./${a.filename}" class="w-full object-cover" />\``;
      md += `| **\`${a.filename}\`** | \`${a.format}\` | \`${a.dimensions}\` | ${a.purpose} | ${usage} |\n`;
    }
  } else {
    md += `*Không có icon hoặc ảnh bitmap độc lập trên màn hình này.*\n`;
  }
  md += `\n`;

  // 4. ROOT CONTAINER CSS
  md += `## 📐 4. Bố cục tổng thể & CSS Container Gốc\n`;
  md += `- **Dimensions:** \`${tree.bounds.width}px\` × \`${tree.bounds.height}px\`\n`;
  if (tree.autoLayout) {
    md += `- **Auto Layout Mode:** \`${tree.autoLayout.mode}\`\n`;
    md += `- **Padding:** \`[T: ${tree.autoLayout.padding.top}, R: ${tree.autoLayout.padding.right}, B: ${tree.autoLayout.padding.bottom}, L: ${tree.autoLayout.padding.left}]\`\n`;
    md += `- **Item Spacing (Gap):** \`${tree.autoLayout.itemSpacing}px\`\n`;
  }
  md += `\n\`\`\`css\n/* Exact Computed CSS for Screen Root */\n${tree.cssString}\n\`\`\`\n\n`;

  // 5. DESIGN TOKENS
  md += `## 🎨 5. Design Tokens (Colors & Typography)\n`;
  md += `### Named Figma tokens:\n`;
  for (const [id, token] of Object.entries(designTokens.namedTokens || {})) {
    md += `- ${JSON.stringify(token.name)} — ${token.source}, ID: ${id}\n`;
  }
  md += `See design_tokens.json for source values/modes and spec.json tokenReferences for per-node usage and resolved variable values.\n\n`;
  md += `### Colors:\n`;
  for (const c of Object.keys(designTokens.colors)) {
    md += `- \`${c}\`\n`;
  }
  md += `\n### Typography:\n`;
  md += `| Font Family | Style / Weight | Size | Line Height | Color |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const [k, t] of Object.entries(designTokens.typography)) {
    md += `| ${t.fontFamily} | ${t.fontWeight} | ${t.fontSize}px | ${JSON.stringify(t.lineHeight)} | \`${t.color}\` |\n`;
  }
  md += `\n`;

  // 6. NESTED DOM TREE WITH CSS & TAGS
  md += `## 🌲 6. Cây cấu trúc lồng nhau (DOM Hierarchy Tree)\n`;
  function printBranch(n, depth = 0) {
    const indent = "  ".repeat(depth);
    const tag = n.semanticTag ? `<${n.semanticTag}>` : "<div>";
    const compTag = n.component?.isSharedComponent ? ` 🧩 **[REUSE: ${n.component.componentSetName}]**` : "";
    const sizeTag = ` (${n.bounds.width}×${n.bounds.height}px)`;
    const assetTag = n.assetSvg ? ` 🎨 [SVG: \`${n.assetSvg}\`]` : (n.assetImage ? ` 🖼️ [IMG: \`${n.assetImage}\`]` : "");
    let out = `${indent}- **${n.name}** \`${tag}\`${compTag}${assetTag}${sizeTag}\n`;
    if (n.text) {
      out += `${indent}  > *Text:* "${n.text.replace(/\n/g, " ").slice(0, 60)}"\n`;
    }
    if (n.children && n.children.length > 0) {
      for (const ch of n.children) {
        out += printBranch(ch, depth + 1);
      }
    }
    return out;
  }
  md += printBranch(tree, 0);

  return md;
}

// Generate HTML preview & code snippet cheatsheet for reused components
function generateComponentSnippetsHtml(screenName, componentsUsed, fontGuide) {
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Component Reuse CheatSheet - ${screenName}</title>
  ${fontGuide.htmlLinkTag}
  <style>
    body { font-family: ${fontGuide.cssFontFamilyStack}; padding: 24px; background: #f8fafc; color: #0f172a; line-height: 1.5; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .badge { background: #dbeafe; color: #1e40af; font-size: 12px; padding: 3px 8px; border-radius: 9999px; font-weight: 600; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .code-box { background: #0f172a; color: #f8fafc; padding: 12px; border-radius: 6px; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 13px; overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
  </style>
</head>
<body>
  <h1>🧩 Component Reuse Guide: ${screenName}</h1>
  <p>The following shared components must be reused when implementing this screen:</p>
`;

  for (const comp of Object.values(componentsUsed)) {
    html += `
  <div class="card">
    <h2>&lt;${comp.componentSet}&gt; <span class="badge">${comp.totalUsageCount} usages</span></h2>
    <p><em>${comp.description || "Shared Design System Component"}</em></p>
    <table>
      <thead>
        <tr><th>Node Name</th><th>Variant Props</th><th>Suggested Code</th></tr>
      </thead>
      <tbody>
`;
    for (const sample of comp.sampleUsages) {
      html += `
        <tr>
          <td><strong>${sample.nodeName}</strong></td>
          <td><code>${JSON.stringify(sample.variant)}</code></td>
          <td><code>${escape(sample.recommendedSnippet)}</code></td>
        </tr>
`;
    }
    html += `
      </tbody>
    </table>
    <div class="code-box">${escape(comp.sampleUsages[0]?.recommendedSnippet || "")}</div>
  </div>
`;
  }

  html += `
</body>
</html>
`;
  return html;
}

let checkResolver = null;
let forceExport = false;
function checkScreen(identity, snapshot) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { checkResolver = null; reject(new Error("Change check timed out")); }, 60000);
    checkResolver = result => { clearTimeout(timer); checkResolver = null; result.error ? reject(new Error(result.error)) : resolve(result); };
    sendUI({ type: "CHECK_SCREEN", ...identity, snapshot });
  });
}

// Process individual screen/frame
async function exportScreenNode(node, currentPath, scale) {
  const platform = exportProfile.platform;
  const mobileOnly = platform !== "web" && platform !== "all";
  const screenPath = [...currentPath, node.name];
  const step = value => sendUI({ type: "EXPORT_STEP", screen: node.name, step: value });
  step("checking");
  const identity = exportIdentity(node);
  const profile = { nodeId:node.id, name:node.name, snapshotCheckMs:0, screenshotRenderMs:0, screenshotEncodeMs:0, extractionMs:0, cssWaitMs:0, tokenMs:0, assetRenderMs:0, assetEncodeMs:0, serializeMs:0, uploadAckMs:0, resolveCalls:0, resolveCacheHits:0, componentMs:0, componentMetadataReads:0, componentCacheHits:0, svgRenderCalls:0, svgCacheHits:0, boundIconFingerprintMs:0, boundIconCacheHits:0, boundIconEligible:0, boundIconUnique:0, boundIconShadowMatches:0, boundIconShadowMismatches:0, boundIconRejections:{}, imageSourceReads:0, imageCacheHits:0, svgRejections:{}, svgLegacyRejections:{} };
  exportProfile.screens.push(profile);
  let phaseStart = Date.now();
  // JSON_REST captures the resolved subtree before expensive image rendering.
  const snapshot = await node.exportAsync({ format: "JSON_REST_V1" });
  const check = await checkScreen(identity, JSON.stringify(platform === "web" ? { version: 5, scale, snapshot } : { version: 1, platform, scale, snapshot }));
  profile.snapshotCheckMs = Date.now() - phaseStart;
  if (!forceExport && check.unchanged) {
    sendUI({ type: "PROGRESS_UPDATE", message: `⏭ Không đổi: ${node.name}` });
    return;
  }

  sendUI({
    type: "PROGRESS_UPDATE",
    message: `📸 Export ${scale}× · ${platform} · ${node.name}…`
  });

  const context = {
    profile,
    generatedCssMode: exportProfile.generatedCssMode,
    platform,
    mobileOnly,
    componentMetadataCache: exportProfile.componentMetadataCache,
    circleSvgCache: exportProfile.circleSvgCache,
    imageContext: exportProfile.imageContext,
    boundIconState: exportProfile.boundIconState,
    componentsUsed: {},
    fontsUsed: {},
    designTokens: {
      namedTokens: {},
      colors: {},
      typography: {},
      radii: {},
      shadows: {}
    },
    assets: [],
    assetsManifest: []
  };

  // 1. Export High-Res Screenshot (PNG)
  step("screenshot");
  const screenshot = measured(profile, 'screenshotRenderMs', () => node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale }
  }));
  if (!mobileOnly && exportProfile.cssDuringScreenshot) {
    context.readNativeCss = createNativeCssReader(node, profile, screenshot);
  }
  const screenshotBytes = await screenshot;
  phaseStart = Date.now();
  const screenshotB64 = bufferToBase64(screenshotBytes);
  profile.screenshotEncodeMs = Date.now() - phaseStart;

  // 2. Extract Deep Recursive DOM Tree with Native + Computed CSS, SVGs & Images
  step("extraction");
  const detailedTree = await measured(profile, 'extractionMs', () => extractDetailedNodeTree(node, context));
  finishReuseDiagnostic(context);
  phaseStart = Date.now();

  // 3. Generate Font Guides & Assets Manifest
  const fontGuide = generateFontGuides(context.fontsUsed);
  const markdownSpec = mobileOnly
    ? `# ${node.name} · ${platform} handoff\n\n![Screenshot](./screenshot.png)\n\nUse [spec.json](./spec.json) for layout, paints and text runs. See [mobile_handoff.json](./mobile_handoff.json) for unit conventions and [assets_manifest.json](./assets_manifest.json) for asset references.\n`
    : generateMarkdownDoc(detailedTree, context.componentsUsed, context.designTokens, fontGuide, context.assetsManifest);
  const specJson = JSON.stringify(detailedTree, null, 2);
  const componentsJson = JSON.stringify(context.componentsUsed, null, 2);
  const tokensJson = JSON.stringify(context.designTokens, null, 2);
  const fontGuideJson = JSON.stringify(mobileOnly ? { fonts: fontGuide.fonts, warning: fontGuide.warning } : fontGuide, null, 2);
  const mobileHandoff = platform === "web" ? null : {
    version: 1,
    platform,
    designUnits: "Figma design units",
    screenshotScale: scale,
    targets: {
      ...(platform !== "ios" ? { android: { layoutUnit: "dp", textUnit: "sp" } } : {}),
      ...(platform !== "android" ? { ios: { layoutUnit: "pt", textUnit: "pt" } } : {})
    },
    unitMapping: "Confirm the Figma design baseline before mapping to native units. Screenshot scale only applies to pixel density.",
    assetFormat: "SVG and original or rendered raster files. Convert or import for the target app as needed."
  };
  const assetsManifestJson = JSON.stringify(context.assetsManifest, null, 2);

  // 4. Bundle files to send to Bridge Server
  const filesToUpload = [
    { name: "screenshot.png", type: "base64", content: screenshotB64 },
    { name: "spec.json", type: "text", content: specJson },
    { name: "spec.md", type: "text", content: markdownSpec },
    { name: "components_used.json", type: "text", content: componentsJson },
    { name: "fonts_guide.json", type: "text", content: fontGuideJson },
    { name: "assets_manifest.json", type: "text", content: assetsManifestJson },
    ...(!mobileOnly ? [{ name: "component_snippets.html", type: "text", content: generateComponentSnippetsHtml(node.name, context.componentsUsed, fontGuide) }] : []),
    { name: "design_tokens.json", type: "text", content: tokensJson },
    ...(mobileHandoff ? [{ name: "mobile_handoff.json", type: "text", content: JSON.stringify(mobileHandoff, null, 2) }] : []),
    ...context.assets
  ];

  profile.serializeMs = Date.now() - phaseStart;
  phaseStart = Date.now();
  step("saving");
  sendUI({
    type: "UPLOAD_SCREEN_BATCH",
    folder_path: screenPath,
    ...exportIdentity(node),
    screen_name: node.name,
    content_hash: check.hash,
    files: filesToUpload
  });

  // Await sequential ACK from UI before proceeding to next screen!
  if (!await waitForUploadAck(60000)) throw new Error("Upload failed or timed out; export stopped.");
  profile.uploadAckMs = Date.now() - phaseStart;
}

// Recursive section walker
async function processNode(node, currentPath, scale) {
  if (node.type === "SECTION") {
    const sectionPath = [...currentPath, node.name];

    // Gather UX Notes in Section
    const notes = [];
    for (const child of node.children) {
      if (child.type === "TEXT" && child.characters) {
        notes.push(child.characters);
      }
    }
    if (notes.length > 0) {
      const notesMd = `# Flow & UX Notes: ${node.name}\n\n` + notes.map(n => `- ${n}`).join("\n\n");
      sendUI({
        type: "UPLOAD_NOTES",
        folder_path: sectionPath,
        ...exportIdentity(node),
        content: notesMd
      });
      if (!await waitForUploadAck(30000)) throw new Error("Notes upload failed or timed out; export stopped.");
    }

    for (const child of node.children) {
      if (child.type === "SECTION" || child.type === "FRAME" || child.type === "COMPONENT" || child.type === "INSTANCE" || child.type === "COMPONENT_SET") {
        await processNode(child, sectionPath, scale);
      }
    }
  } else if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET") {
    // Export artboard-level frames or component sets
    if (node.width >= 160 && node.height >= 100) {
      await exportScreenNode(node, currentPath, scale);
    }
  }
}

async function waitForExportTarget(nodeId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      if (!['SECTION','FRAME','COMPONENT','COMPONENT_SET','INSTANCE'].includes(node.type)) throw new Error('Target node is not an exportable section/frame.');
      return node;
    }
    if (Date.now() >= deadline) throw new Error(`Target ${nodeId} is unavailable after waiting for Figma to load. Verify the file and node URL.`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "SET_LANGUAGE") {
    language = msg.language === "en" ? "en" : "vi";
    await figma.clientStorage.setAsync("exportLanguage", language);
  } else if (msg.type === "CHECK_RESULT") {
    if (checkResolver) checkResolver(msg);
  } else if (msg.type === "SCREEN_UPLOAD_ACK") {
    if (currentAckResolver) {
      currentAckResolver(msg.success);
      currentAckResolver = null;
    }
  } else if (msg.type === "SET_CLI_PERMISSION") {
    if (typeof msg.projectId !== 'string' || !msg.projectId) return;
    const key = 'cliProjects:' + localDocumentId;
    const projects = await figma.clientStorage.getAsync(key) || [];
    const next = projects.filter(id => id !== msg.projectId);
    if (msg.enabled) next.push(msg.projectId);
    await figma.clientStorage.setAsync(key, next);
  } else if (msg.type === "GET_DOCUMENT") {
    const projects = await figma.clientStorage.getAsync('cliProjects:' + localDocumentId) || [];
    sendUI({type:'CLI_PERMISSION', projects});
    sendUI({type:"DOCUMENT_ID", engineRevision:"platform-export-v1", documentId:figma.fileKey || localDocumentId, fileKey:figma.fileKey || null});
  } else if (msg.type === "START_EXPORT") {
    if (activeRunId || typeof msg.runId !== "string" || !msg.runId) return;
    activeRunId = msg.runId;
    const startedAt = Date.now();
    exportProfile = { engineRevision:'platform-export-v1', generatedCssMode:msg.generatedCssMode === "use" ? "use" : msg.generatedCssMode === "verify" ? "verify" : "off", screens:[], componentMetadataCache:new Map(), circleSvgCache:new Map(), imageContext:{originalImageCache:new Map()}, boundIconState:{reuse:true,variables:new Map(),outputs:new Map()} };
    try {
    const platform = msg.platform ?? "web";
    if (!["web", "android", "ios", "mobile", "all"].includes(platform)) throw new Error("Invalid export platform.");
    exportProfile.platform = platform;
    forceExport = !!msg.force;
    const scope = msg.scope || "current_page";
    const scale = msg.scale || 2;

    figma.notify(localized(`Bắt đầu export ${platform}…`, `Starting ${platform} export…`));

    if (scope === 'target') {
      if (!msg.target || (figma.fileKey ? msg.target.fileKey !== figma.fileKey : !msg.allowPairedFile)) throw new Error('Target file differs from the paired Figma document.');
      if (!figma.fileKey) sendUI({type:'PROGRESS_UPDATE',message:'File key unavailable: exporting from the explicitly confirmed paired file.'});
      const target = await waitForExportTarget(msg.target.nodeId);
      sendUI({type:'PROGRESS_UPDATE',message:`Target: ${target.name} (${target.id})`});
      await processNode(target, [], scale);
    } else if (scope === "selection") {
      const selection = figma.currentPage.selection;
      if (!selection || selection.length === 0) {
        throw new Error(localized("Vui lòng chọn ít nhất 1 mục trên canvas!","Select at least one item on the canvas."));
      }
      for (const item of selection) {
        await processNode(item, [], scale);
      }
    } else if (scope === "current_page") {
      const page = figma.currentPage;
      sendUI({
        type: "PROGRESS_UPDATE",
        message: `🚀 Đang quét toàn bộ Page '${page.name}'...`
      });
      for (const item of page.children) {
        if (item.type === "SECTION" || item.type === "FRAME" || item.type === "COMPONENT" || item.type === "INSTANCE" || item.type === "COMPONENT_SET") {
          await processNode(item, [page.name], scale);
        }
      }
    } else if (scope === "all_pages") {
      sendUI({
        type: "PROGRESS_UPDATE",
        message: `📥 Đang tải tất cả các pages trong document...`
      });
      await figma.loadAllPagesAsync();

      for (const page of figma.root.children) {
        if (page.name.toUpperCase().includes("TRASH") || page.name === "---" || page.children.length === 0) {
          continue;
        }
        sendUI({
          type: "PROGRESS_UPDATE",
          message: `📁 Đang xử lý Page: ${page.name}...`
        });
        for (const item of page.children) {
          if (item.type === "SECTION" || item.type === "FRAME" || item.type === "COMPONENT" || item.type === "INSTANCE" || item.type === "COMPONENT_SET") {
            await processNode(item, [page.name], scale);
          }
        }
      }
    }

    delete exportProfile.componentMetadataCache;
    delete exportProfile.circleSvgCache;
    delete exportProfile.imageContext;
    delete exportProfile.boundIconState;
    exportProfile.totalMs = Date.now() - startedAt;
    sendUI({ type: "EXPORT_FINISHED", profile:exportProfile });
    figma.notify(localized("🎉 Đã hoàn tất xuất toàn bộ screens, assets (SVG/PNG) và specs chuẩn xác 100%!","\ud83c\udf89 Export completed."));
    } catch (error) {
      sendUI({ type: "EXPORT_ERROR", message: error.message, profile:exportProfile });
      figma.notify(error.message, { error: true });
    } finally {
      activeRunId = null;
    }
  }
};
