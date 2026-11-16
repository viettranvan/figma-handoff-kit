let activeRunId = null;
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
  return {
    document: { id: figma.fileKey || localDocumentId, name: figma.root.name },
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
  for (const node of selection) {
    if (node.type === "SECTION") {
      selSections++;
      for (const ch of node.children) {
        if (ch.type === "FRAME" || ch.type === "COMPONENT" || ch.type === "INSTANCE" || ch.type === "COMPONENT_SET") {
          selScreens++;
        }
      }
    } else if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "COMPONENT_SET") {
      selScreens++;
    }
  }

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

function bufferToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

// Convert gradient paint to CSS gradient string
function gradientToCss(fill) {
  if (!fill.gradientStops || fill.gradientStops.length === 0) return null;
  const stops = fill.gradientStops.map(s => {
    const col = colorToRgba(s.color, s.color.a !== undefined ? s.color.a : 1);
    const pos = Math.round(s.position * 100);
    return `${col} ${pos}%`;
  }).join(", ");

  if (fill.type === "GRADIENT_LINEAR") {
    return `linear-gradient(180deg, ${stops})`;
  } else if (fill.type === "GRADIENT_RADIAL") {
    return `radial-gradient(circle, ${stops})`;
  }
  return null;
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

  // 2. Sizing Constraints (Auto Layout Child)
  if ("layoutSizingHorizontal" in node) {
    if (node.layoutSizingHorizontal === "FILL") {
      css["width"] = "100%";
      css["flex-grow"] = "1";
    } else if (node.layoutSizingHorizontal === "HUG") {
      css["width"] = "fit-content";
    }
  }
  if ("layoutSizingVertical" in node) {
    if (node.layoutSizingVertical === "FILL") {
      css["height"] = "100%";
      css["align-self"] = "stretch";
    } else if (node.layoutSizingVertical === "HUG") {
      css["height"] = "fit-content";
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
  if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
    const visibleFills = node.fills.filter(f => f.visible !== false);
    for (const fill of visibleFills) {
      if (fill.type === "SOLID") {
        css["background-color"] = colorToRgba(fill.color, fill.opacity !== undefined ? fill.opacity : 1);
      } else if (fill.type.startsWith("GRADIENT")) {
        const grad = gradientToCss(fill);
        if (grad) css["background"] = grad;
      }
    }
  }

  // 6. Strokes & Borders
  if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
    const visibleStrokes = node.strokes.filter(s => s.visible !== false);
    if (visibleStrokes.length > 0) {
      const stroke = visibleStrokes[0];
      const strokeColor = stroke.type === "SOLID" ? colorToRgba(stroke.color, stroke.opacity !== undefined ? stroke.opacity : 1) : "#000000";
      const weight = node.strokeWeight || 1;
      const style = (node.dashPattern && node.dashPattern.length > 0) ? "dashed" : "solid";

      // Individual borders
      const st = node.strokeTopWeight !== undefined ? node.strokeTopWeight : weight;
      const sr = node.strokeRightWeight !== undefined ? node.strokeRightWeight : weight;
      const sb = node.strokeBottomWeight !== undefined ? node.strokeBottomWeight : weight;
      const sl = node.strokeLeftWeight !== undefined ? node.strokeLeftWeight : weight;

      if (st === sr && sr === sb && sb === sl) {
        if (weight > 0) css["border"] = `${weight}px ${style} ${strokeColor}`;
      } else {
        if (st > 0) css["border-top"] = `${st}px ${style} ${strokeColor}`;
        if (sr > 0) css["border-right"] = `${sr}px ${style} ${strokeColor}`;
        if (sb > 0) css["border-bottom"] = `${sb}px ${style} ${strokeColor}`;
        if (sl > 0) css["border-left"] = `${sl}px ${style} ${strokeColor}`;
      }
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
      const style = (node.fontName.style || "").toLowerCase();
      if (style.includes("black")) css["font-weight"] = "900";
      else if (style.includes("extra bold")) css["font-weight"] = "800";
      else if (style.includes("bold")) css["font-weight"] = "700";
      else if (style.includes("semi")) css["font-weight"] = "600";
      else if (style.includes("medium")) css["font-weight"] = "500";
      else if (style.includes("light")) css["font-weight"] = "300";
      else css["font-weight"] = "400";
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
function inspectComponentInstance(node) {
  const mainComp = node.mainComponent;
  if (!mainComp) return null;

  const compSet = (mainComp.parent && mainComp.parent.type === "COMPONENT_SET") ? mainComp.parent : null;
  const componentSetName = compSet ? compSet.name : mainComp.name;
  const variants = readVariantProperties(node, mainComp);
  const variantProps = variants.value || {};
  const masterName = mainComp.name;

  // Extract props by scanning instance children
  const extractedProps = {};
  function findOverrides(n) {
    if (n.type === "TEXT" && n.characters) {
      const lower = (n.name || "").toLowerCase();
      const propKey = lower.includes("label") ? "label"
                    : lower.includes("title") ? "title"
                    : lower.includes("placeholder") ? "placeholder"
                    : lower.includes("value") ? "value"
                    : "text";
      if (!extractedProps[propKey]) {
        extractedProps[propKey] = n.characters;
      }
    }
    if (n.children) {
      for (const ch of n.children) findOverrides(ch);
    }
  }
  findOverrides(node);

  // Generate clean JSX / HTML snippet
  const propPairs = Object.entries(variantProps)
    .map(([k, v]) => `${k.toLowerCase()}="${v}"`)
    .join(" ");
  const attrStr = propPairs ? ` ${propPairs}` : "";
  const innerText = extractedProps.label || extractedProps.text || "";
  const codeSnippet = innerText
    ? `<${componentSetName}${attrStr}>${innerText}</${componentSetName}>`
    : `<${componentSetName}${attrStr} />`;

  return {
    isSharedComponent: true,
    componentSetName: componentSetName,
    masterComponentName: masterName,
    masterComponentId: mainComp.id,
    variantProperties: variants.value,
    ...(variants.warning ? { variantWarning: variants.warning } : {}),
    ...(variants.unassigned ? { unassignedVariantLabels: variants.unassigned } : {}),
    ...(variants.source ? { variantMetadataSource: variants.source, variantRawName: variants.rawName, variantNormalizedName: variants.normalizedName } : {}),
    description: compSet?.description || mainComp.description || "",
    extractedProps: extractedProps,
    recommendedUsage: codeSnippet,
    reuseDirective: `REUSE DIRECTIVE: Use shared component <${componentSetName}> with variant ${JSON.stringify(variantProps)}. Do NOT create a custom ad-hoc component.`
  };
}

// Generate Google Fonts links from font families and weights
function generateFontGuides(fontsMap) {
  const families = [];
  const details = [];

  for (const [family, weightsObj] of Object.entries(fontsMap)) {
    const weights = Object.keys(weightsObj).sort();
    details.push({
      family: family,
      weights: weights
    });
    const formattedFamily = family.replace(/ /g, "+");
    const weightStr = weights.length > 0 ? `:wght@${weights.join(";")}` : "";
    families.push(`family=${formattedFamily}${weightStr}`);
  }

  if (families.length === 0) {
    families.push("family=IBM+Plex+Sans:wght@400;500;600;700");
  }

  const googleFontUrl = `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
  return {
    fonts: details,
    googleFontUrl: googleFontUrl,
    htmlLinkTag: `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${googleFontUrl}" rel="stylesheet">`,
    cssImportRule: `@import url('${googleFontUrl}');`,
    cssFontFamilyStack: `"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  };
}

// Deep recursive DOM Tree Extractor
async function extractDetailedNodeTree(node, context, parentNode = null) {
  let nativeCss = {};
  if ("getCSSAsync" in node) {
    try {
      nativeCss = await node.getCSSAsync();
    } catch (e) {}
  }

  const computedCss = await computeFullCSS(node, nativeCss, parentNode);
  const semanticTag = detectSemanticTag(node);

  const nodeItem = {
    id: node.id,
    name: node.name,
    type: node.type,
    semanticTag: semanticTag,
    visible: node.visible !== false,
    bounds: {
      width: Math.round(node.width * 100) / 100,
      height: Math.round(node.height * 100) / 100,
      x: Math.round(node.x * 100) / 100,
      y: Math.round(node.y * 100) / 100
    },
    layoutFlow: ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") ? "absolute" : "in-flow",
    css: computedCss,
    cssString: formatCssBlock(computedCss)
  };

  // 1. REUSABLE COMPONENT IDENTIFICATION
  if (node.type === "INSTANCE") {
    const compInfo = inspectComponentInstance(node);
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
          reuseRules: `Always reuse <${setName}>. Do not write duplicate CSS or markup.`
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
          props: compInfo.extractedProps,
          recommendedSnippet: compInfo.recommendedUsage
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
    
    // Numeric weight mapping
    let weightNum = "400";
    const s = fontStyle.toLowerCase();
    if (s.includes("black")) weightNum = "900";
    else if (s.includes("extra bold")) weightNum = "800";
    else if (s.includes("bold")) weightNum = "700";
    else if (s.includes("semi")) weightNum = "600";
    else if (s.includes("medium")) weightNum = "500";
    else if (s.includes("light")) weightNum = "300";

    if (fontFamily !== "mixed" && !context.fontsUsed[fontFamily]) {
      context.fontsUsed[fontFamily] = {};
    }
    if (fontFamily !== "mixed") context.fontsUsed[fontFamily][weightNum] = true;

    const typo = {
      fontFamily: fontFamily,
      fontWeight: fontStyle,
      fontWeightNum: weightNum,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : "mixed",
      lineHeight: node.lineHeight === figma.mixed ? "mixed" : node.lineHeight ? (node.lineHeight.value ?? "AUTO") : "AUTO",
      letterSpacing: node.letterSpacing === figma.mixed ? "mixed" : node.letterSpacing ? (node.letterSpacing.value ?? 0) : 0,
      textAlign: node.textAlignHorizontal || "LEFT",
      color: computedCss.color || "#101828"
    };
    nodeItem.typography = typo;
    // Figma uses a Symbol for mixed text properties; retain the actual per-range styles.
    if ([node.fontName, node.fontSize, node.lineHeight, node.letterSpacing].includes(figma.mixed)) {
      nodeItem.textRuns = node.getStyledTextSegments(["fontName", "fontSize", "lineHeight", "letterSpacing"]);
      for (const run of nodeItem.textRuns) {
        const style = run.fontName.style.toLowerCase();
        const weights = [["black", "900"], ["extra bold", "800"], ["semi", "600"], ["bold", "700"], ["medium", "500"], ["light", "300"]];
        const weight = (weights.find(([name]) => style.includes(name)) || [null, "400"])[1];
        if (!context.fontsUsed[run.fontName.family]) context.fontsUsed[run.fontName.family] = {};
        context.fontsUsed[run.fontName.family][weight] = true;
      }
    }
    const typoKey = `${typo.fontFamily} ${typo.fontWeight} ${typo.fontSize}px`;
    context.designTokens.typography[typoKey] = typo;
  }

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

  if (shouldExportAsSvg && node.width > 0 && node.height > 0) {
    try {
      const svgBytes = await node.exportAsync({ format: "SVG" });
      const svgCode = decodeUtf8(svgBytes);

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
        const svgCode = await node.exportAsync({ format: "SVG_STRING" });
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
  // 6a. Fill type == IMAGE (Figma native image hashes)
  if ("fills" in node && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === "IMAGE" && fill.imageHash) {
        try {
          const img = figma.getImageByHash(fill.imageHash);
          if (img) {
            const bytes = await img.getBytesAsync();
            const b64 = bufferToBase64(bytes);
            const assetFileName = `assets/img_${sanitizeFilename(node.name)}_${fill.imageHash.substring(0, 10)}.png`;
            context.assets.push({
              name: assetFileName,
              type: "base64",
              content: b64
            });
            context.assetsManifest.push({
              filename: assetFileName,
              format: "PNG",
              nodeId: node.id,
              nodeName: node.name,
              dimensions: `${node.width}×${node.height}px`,
              purpose: "Image fill (Photo / Illustration)"
            });
            nodeItem.assetImage = assetFileName;
          }
        } catch (e) {}
      }
    }
  }

  // 6b. Named raster / illustration / photo / hero / campus image frames (rendered as 2x PNG)
  const isImageNode = /image|photo|campus|hero|banner|illustration|mockup|preview|picture/i.test(node.name || "") &&
                      node.width >= 100 && node.height >= 80 &&
                      !shouldExportAsSvg && node.type !== "TEXT";

  if (isImageNode && !nodeItem.assetImage) {
    try {
      const pngBytes = await node.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: 2 }
      });
      const b64 = bufferToBase64(pngBytes);
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

  // 7. RECURSIVE CHILDREN
  // If this container is already exported as a coherent atomic SVG icon, avoid bloating the tree with internal vector paths!
  const shouldSkipChildren = !!nodeItem.assetSvg;
  if ("children" in node && !shouldSkipChildren) {
    nodeItem.children = [];
    for (const child of node.children) {
      if (child.visible !== false) {
        nodeItem.children.push(await extractDetailedNodeTree(child, context, node));
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
  md += `## 🔤 2. Font & Typography Setup (Google Fonts Auto-Resolver)\n`;
  md += `Màn hình này sử dụng các font sau đây. Agent chỉ cần nhúng mã dưới đây vào HTML/CSS để load đúng 100% font:\n\n`;
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
  md += `### Colors:\n`;
  for (const c of Object.keys(designTokens.colors)) {
    md += `- \`${c}\`\n`;
  }
  md += `\n### Typography:\n`;
  md += `| Font Family | Style / Weight | Size | Line Height | Color |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const [k, t] of Object.entries(designTokens.typography)) {
    md += `| ${t.fontFamily} | ${t.fontWeight} | ${t.fontSize}px | ${t.lineHeight} | \`${t.color}\` |\n`;
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
          <td><code>${sample.recommendedSnippet}</code></td>
        </tr>
`;
    }
    html += `
      </tbody>
    </table>
    <div class="code-box">${comp.sampleUsages[0]?.recommendedSnippet || ""}</div>
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
  const screenPath = [...currentPath, node.name];
  const identity = exportIdentity(node);
  // JSON_REST captures the resolved subtree before expensive image rendering.
  const snapshot = await node.exportAsync({ format: "JSON_REST_V1" });
  const check = await checkScreen(identity, JSON.stringify({ version: 1, scale, snapshot }));
  if (!forceExport && check.unchanged) {
    sendUI({ type: "PROGRESS_UPDATE", message: `⏭ Không đổi: ${node.name}` });
    return;
  }

  sendUI({
    type: "PROGRESS_UPDATE",
    message: `📸 Render ảnh 2x Retina & trích xuất SVGs, Images, CSS 100%: ${node.name}...`
  });

  const context = {
    componentsUsed: {},
    fontsUsed: {},
    designTokens: {
      colors: {},
      typography: {},
      radii: {},
      shadows: {}
    },
    assets: [],
    assetsManifest: []
  };

  // 1. Export High-Res Screenshot (PNG)
  const screenshotBytes = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale }
  });
  const screenshotB64 = bufferToBase64(screenshotBytes);

  // 2. Extract Deep Recursive DOM Tree with Native + Computed CSS, SVGs & Images
  const detailedTree = await extractDetailedNodeTree(node, context);

  // 3. Generate Font Guides & Assets Manifest
  const fontGuide = generateFontGuides(context.fontsUsed);
  const markdownSpec = generateMarkdownDoc(detailedTree, context.componentsUsed, context.designTokens, fontGuide, context.assetsManifest);
  const specJson = JSON.stringify(detailedTree, null, 2);
  const componentsJson = JSON.stringify(context.componentsUsed, null, 2);
  const tokensJson = JSON.stringify(context.designTokens, null, 2);
  const fontGuideJson = JSON.stringify(fontGuide, null, 2);
  const assetsManifestJson = JSON.stringify(context.assetsManifest, null, 2);
  const snippetsHtml = generateComponentSnippetsHtml(node.name, context.componentsUsed, fontGuide);

  // 4. Bundle files to send to Bridge Server
  const filesToUpload = [
    { name: "screenshot.png", type: "base64", content: screenshotB64 },
    { name: "spec.json", type: "text", content: specJson },
    { name: "spec.md", type: "text", content: markdownSpec },
    { name: "components_used.json", type: "text", content: componentsJson },
    { name: "fonts_guide.json", type: "text", content: fontGuideJson },
    { name: "assets_manifest.json", type: "text", content: assetsManifestJson },
    { name: "component_snippets.html", type: "text", content: snippetsHtml },
    { name: "design_tokens.json", type: "text", content: tokensJson },
    ...context.assets
  ];

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
  } else if (msg.type === "GET_DOCUMENT") {
    sendUI({type:"DOCUMENT_ID", documentId:figma.fileKey || localDocumentId});
  } else if (msg.type === "START_EXPORT") {
    if (activeRunId || typeof msg.runId !== "string" || !msg.runId) return;
    activeRunId = msg.runId;
    try {
    forceExport = !!msg.force;
    const scope = msg.scope || "current_page";
    const scale = msg.scale || 2;

    figma.notify(localized("Bắt đầu xuất dữ liệu Pixel-Perfect (SVGs, Images, Fonts, CSS 100%)...","Starting export (assets, fonts and CSS)\u2026"));

    if (scope === "selection") {
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

    sendUI({
      type: "EXPORT_FINISHED"
    });
    figma.notify(localized("🎉 Đã hoàn tất xuất toàn bộ screens, assets (SVG/PNG) và specs chuẩn xác 100%!","\ud83c\udf89 Export completed."));
    } catch (error) {
      sendUI({ type: "EXPORT_ERROR", message: error.message });
      figma.notify(error.message, { error: true });
    } finally {
      activeRunId = null;
    }
  }
};
