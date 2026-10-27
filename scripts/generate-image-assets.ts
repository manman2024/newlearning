import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const DEFAULT_INPUT_PATH = 'public/logo.png';
const DEFAULT_OUTPUT_DIR = 'public';
const ICO_SIZES = [16, 32, 48] as const;

const PNG_OUTPUTS = [
  { filename: 'favicon-16x16.png', size: 16 },
  { filename: 'favicon-32x32.png', size: 32 },
  { filename: 'apple-touch-icon.png', size: 180 },
  { filename: 'android-chrome-192x192.png', size: 192 },
  { filename: 'android-chrome-512x512.png', size: 512 },
] as const;

interface CliOptions {
  inputPath: string;
  outputDir: string;
}

function printUsage() {
  console.log(`Usage:
  pnpm assets:generate [input] [--output-dir <directory>]

Defaults:
  input:      ${DEFAULT_INPUT_PATH}
  output-dir: ${DEFAULT_OUTPUT_DIR}

Examples:
  pnpm assets:generate
  pnpm assets:generate -- assets/logo.png
  pnpm assets:generate -- public/logo.png --output-dir /tmp/site-icons`);
}

function parseCliOptions(args: string[]): CliOptions | null {
  let inputPath = DEFAULT_INPUT_PATH;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let hasInput = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--') {
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      printUsage();
      return null;
    }

    if (argument === '--output-dir' || argument === '-o') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a directory path`);
      }
      outputDir = value;
      index += 1;
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (hasInput) {
      throw new Error(`Unexpected argument: ${argument}`);
    }

    inputPath = argument;
    hasInput = true;
  }

  return {
    inputPath: resolve(inputPath),
    outputDir: resolve(outputDir),
  };
}

async function renderSquarePng(inputPath: string, size: number) {
  return sharp(inputPath)
    .rotate()
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toColourspace('srgb')
    .png({ adaptiveFiltering: true, compressionLevel: 9 })
    .toBuffer();
}

async function pngToDib(png: Buffer, size: number) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(`Could not create ${size}x${size} ICO layer`);
  }

  const bitmapHeaderSize = 40;
  const pixelDataSize = size * size * 4;
  const maskRowSize = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(
    bitmapHeaderSize + pixelDataSize + maskRowSize * size
  );

  dib.writeUInt32LE(bitmapHeaderSize, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(0, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);

  const maskOffset = bitmapHeaderSize + pixelDataSize;
  let pixelOffset = bitmapHeaderSize;
  for (let row = 0; row < size; row += 1) {
    const sourceY = size - row - 1;
    for (let x = 0; x < size; x += 1) {
      const sourceOffset = (sourceY * size + x) * 4;
      const alpha = data[sourceOffset + 3];
      dib[pixelOffset++] = data[sourceOffset + 2];
      dib[pixelOffset++] = data[sourceOffset + 1];
      dib[pixelOffset++] = data[sourceOffset];
      dib[pixelOffset++] = alpha;

      if (alpha === 0) {
        const byteOffset = maskOffset + row * maskRowSize + Math.floor(x / 8);
        dib[byteOffset] |= 1 << (7 - (x % 8));
      }
    }
  }

  return dib;
}

async function createIco(images: Array<{ buffer: Buffer; size: number }>) {
  const dibs = await Promise.all(
    images.map(async (image) => ({
      buffer: await pngToDib(image.buffer, image.size),
      size: image.size,
    }))
  );
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = dibs.length * directoryEntrySize;
  const header = Buffer.alloc(headerSize + directorySize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(dibs.length, 4);

  let imageOffset = header.length;
  for (const [index, image] of dibs.entries()) {
    const entryOffset = headerSize + index * directoryEntrySize;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.buffer.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.buffer.length;
  }

  return Buffer.concat([header, ...dibs.map((image) => image.buffer)]);
}

async function generateImageAssets(options: CliOptions) {
  const metadata = await sharp(options.inputPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions: ${options.inputPath}`);
  }

  const sizes = [
    ...new Set([...PNG_OUTPUTS.map((output) => output.size), ...ICO_SIZES]),
  ];
  const renderedImages = await Promise.all(
    sizes.map(
      async (size) =>
        [size, await renderSquarePng(options.inputPath, size)] as const
    )
  );
  const imagesBySize = new Map(renderedImages);

  const outputs = PNG_OUTPUTS.map((output) => ({
    buffer: imagesBySize.get(output.size)!,
    filename: output.filename,
  }));
  const ico = await createIco(
    ICO_SIZES.map((size) => ({
      buffer: imagesBySize.get(size)!,
      size,
    }))
  );

  await mkdir(options.outputDir, { recursive: true });
  await Promise.all([
    ...outputs.map((output) =>
      writeFile(resolve(options.outputDir, output.filename), output.buffer)
    ),
    writeFile(resolve(options.outputDir, 'favicon.ico'), ico),
  ]);

  const displayPath = (path: string) => {
    const relativePath = relative(process.cwd(), path);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      return path;
    }
    return relativePath || '.';
  };
  console.log(
    `Generated ${outputs.length + 1} assets from ${displayPath(
      options.inputPath
    )}:`
  );
  for (const output of [...outputs, { filename: 'favicon.ico' }]) {
    console.log(
      `- ${displayPath(resolve(options.outputDir, output.filename))}`
    );
  }
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  if (options) {
    await generateImageAssets(options);
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';

if (import.meta.url === entryPoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Asset generation failed: ${message}`);
    process.exitCode = 1;
  });
}
