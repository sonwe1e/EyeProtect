import { app, nativeImage } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Build-time source only: the PNG is not shipped in the app (it is only
// used to regenerate the .ico). It lives under scripts/assets so it never
// lands in out/ or the installer asar.
const sourcePath = resolve(root, 'scripts/assets/app-icon.png');
const outputPath = resolve(root, 'public/assets/app-icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

void app.whenReady().then(() => {
  const source = nativeImage.createFromPath(sourcePath);
  if (source.isEmpty()) throw new Error(`Unable to load ${sourcePath}`);

  const images = sizes.map((size) => ({
    size,
    data: source.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }));
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });

  writeFileSync(outputPath, Buffer.concat([header, ...images.map((image) => image.data)]));
  console.log(`Wrote ${outputPath} (${images.length} PNG-compressed icon sizes)`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
