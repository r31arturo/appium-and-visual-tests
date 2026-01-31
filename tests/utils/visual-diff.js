const computeDiffBoundingBox = async ({ baselinePath, actualPath, sharp, pixelmatch }) => {
  if (!sharp || !pixelmatch) {
    return null;
  }

  if (!baselinePath || !actualPath) {
    return null;
  }

  const fs = require('node:fs');
  if (!fs.existsSync(baselinePath) || !fs.existsSync(actualPath)) {
    return null;
  }

  try {
    const [baseline, actual] = await Promise.all([
      sharp(baselinePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(actualPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);

    if (
      baseline.info.width !== actual.info.width ||
      baseline.info.height !== actual.info.height ||
      !baseline.info.width ||
      !baseline.info.height
    ) {
      return null;
    }

    const width = baseline.info.width;
    const height = baseline.info.height;
    const diff = Buffer.alloc(width * height * 4);

    const diffPixels = pixelmatch(baseline.data, actual.data, diff, width, height, {
      threshold: 0.1,
      diffMask: true,
    });

    if (!diffPixels) {
      return null;
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        if (diff[idx + 3] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) {
      return null;
    }

    return { minX, minY, maxX, maxY, width, height };
  } catch (error) {
    console.warn(`[Visual] Failed to compute diff bounds: ${error.message}`);
    return null;
  }
};

const applyDiffHighlight = async ({ inputBuffer, bbox, sharp }) => {
  if (!sharp || !bbox || !inputBuffer) {
    return inputBuffer;
  }

  const image = sharp(inputBuffer, { failOnError: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return inputBuffer;
  }

  const stroke = Math.max(2, Math.round(Math.min(metadata.width, metadata.height) * 0.002));
  const rawWidth = bbox.maxX - bbox.minX + 1;
  const rawHeight = bbox.maxY - bbox.minY + 1;
  const minDim = Math.max(6, Math.round(Math.min(metadata.width, metadata.height) * 0.004));
  const isTiny = rawWidth < minDim || rawHeight < minDim;
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;

  if (!isTiny) {
    width = rawWidth;
    height = rawHeight;
    x = Math.max(0, Math.min(bbox.minX, metadata.width - width));
    y = Math.max(0, Math.min(bbox.minY, metadata.height - height));
  } else {
    const indicatorSize = Math.max(12, Math.round(Math.min(metadata.width, metadata.height) * 0.015));
    const gap = Math.max(4, Math.round(indicatorSize * 0.2));
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    const candidates = [
      { x: Math.round(bbox.maxX + gap), y: Math.round(centerY - indicatorSize / 2) },
      { x: Math.round(centerX - indicatorSize / 2), y: Math.round(bbox.minY - gap - indicatorSize) },
      { x: Math.round(bbox.minX - gap - indicatorSize), y: Math.round(centerY - indicatorSize / 2) },
      { x: Math.round(centerX - indicatorSize / 2), y: Math.round(bbox.maxY + gap) },
    ];
    width = indicatorSize;
    height = indicatorSize;
    const picked = candidates.find(
      (pos) =>
        pos.x >= 0 &&
        pos.y >= 0 &&
        pos.x + width <= metadata.width &&
        pos.y + height <= metadata.height
    );
    if (picked) {
      x = picked.x;
      y = picked.y;
    } else {
      x = Math.round(centerX - width / 2);
      y = Math.round(centerY - height / 2);
      x = Math.max(0, Math.min(x, metadata.width - width));
      y = Math.max(0, Math.min(y, metadata.height - height));
    }
  }

  const svg = [
    `<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#ff0000" stroke-width="${stroke}" />`,
    '</svg>',
  ].join('');

  return image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
};

module.exports = {
  applyDiffHighlight,
  computeDiffBoundingBox,
};
