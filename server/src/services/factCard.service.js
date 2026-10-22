import sharp from 'sharp';

// A designed "info card" graphic (own look — not copying any specific
// existing brand's template): eyebrow label, bold headline, a couple of
// pulled facts, and a colored callout band at the bottom. Content comes
// from the AI (see buildFactCardContent in studio.service.js); this file
// only handles precisely drawing that content onto an image. AI image
// models are unreliable at rendering accurate text (misspellings, garbled
// numbers), so actual facts are drawn with real SVG text instead of asked
// for inside an image-generation prompt.

const WIDTH = 1080;
const HEIGHT = 1350; // 4:5 — a standard modern social "card" ratio

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// SVG has no built-in text wrapping — this splits a string into lines that
// fit roughly within maxChars, breaking on word boundaries.
function wrapText(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function tspanLines(lines, x, startY, lineHeight) {
  return lines
    .map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
}

// content: { eyebrow, headline, subheadline, facts: string[], callout }
function buildOverlaySvg(content) {
  const eyebrow = escapeXml((content.eyebrow || 'FIELD DISPATCH').toUpperCase().slice(0, 28));
  const headlineLines = wrapText(content.headline, 20).slice(0, 3);
  const subheadlineLines = wrapText(content.subheadline, 42).slice(0, 2);
  const facts = (content.facts || []).slice(0, 3).map((f) => wrapText(f, 46).slice(0, 2));
  const callout = escapeXml((content.callout || '').slice(0, 90));

  const headlineY = 210;
  const headlineLineHeight = 78;
  const subheadY = headlineY + headlineLines.length * headlineLineHeight + 50;
  const subheadLineHeight = 40;

  let factsY = subheadY + subheadlineLines.length * subheadLineHeight + 70;
  const factBlocks = facts.map((lines) => {
    const block = `
      <circle cx="70" cy="${factsY - 12}" r="7" fill="url(#accent)" />
      <text x="102" y="${factsY}" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#e6f3f5">${tspanLines(lines, 102, factsY, 38)}</text>
    `;
    factsY += lines.length * 38 + 26;
    return block;
  }).join('');

  const calloutLines = wrapText(callout, 44).slice(0, 2);
  const calloutBandHeight = 130 + (calloutLines.length - 1) * 44;
  const calloutBandY = HEIGHT - calloutBandHeight;

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#2dd4bf"/>
    </linearGradient>
    <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020617" stop-opacity="0.55"/>
      <stop offset="35%" stop-color="#020617" stop-opacity="0.25"/>
      <stop offset="65%" stop-color="#020617" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0.85"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#darken)" />

  <!-- Eyebrow pill -->
  <rect x="60" y="90" width="${Math.max(160, eyebrow.length * 16 + 60)}" height="52" rx="26" fill="url(#accent)" />
  <text x="${60 + Math.max(160, eyebrow.length * 16 + 60) / 2}" y="124" font-family="Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="1.5" fill="#04222b" text-anchor="middle">${eyebrow}</text>

  <!-- Headline -->
  <text x="60" y="${headlineY}" font-family="Arial, sans-serif" font-size="66" font-weight="800" fill="#ffffff">${tspanLines(headlineLines, 60, headlineY, headlineLineHeight)}</text>

  <!-- Subheadline -->
  <text x="60" y="${subheadY}" font-family="Arial, sans-serif" font-size="32" font-weight="500" fill="#b7d3d8">${tspanLines(subheadlineLines, 60, subheadY, subheadLineHeight)}</text>

  <!-- Facts -->
  ${factBlocks}

  <!-- Callout band -->
  <rect x="0" y="${calloutBandY}" width="${WIDTH}" height="${calloutBandHeight}" fill="url(#accent)" />
  <text x="60" y="${calloutBandY + 64}" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#04222b">${tspanLines(calloutLines, 60, calloutBandY + 64, 44)}</text>
  <text x="${WIDTH - 40}" y="${HEIGHT - 28}" font-family="Arial, sans-serif" font-size="22" font-weight="800" letter-spacing="2" fill="#04222b" text-anchor="end" opacity="0.75">NCPOR</text>
</svg>`;
}

// backgroundBuffer: raw bytes of the photo (uploaded or AI-generated) to
// use as the card's backdrop. content: see buildOverlaySvg above.
// Returns a JPEG buffer of the finished card.
export async function composeFactCard(backgroundBuffer, content) {
  const resizedBackground = await sharp(backgroundBuffer)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const overlaySvg = buildOverlaySvg(content);

  return sharp(resizedBackground)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
