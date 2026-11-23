import { inflateSync } from 'node:zlib';

import jsQR from 'jsqr';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { PNG } from 'pngjs';
import type request from 'supertest';

/** How many pages the PDF has. */
export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount();
}

/** The text a QR code in the PNG encodes. Throws when there is none. */
export function decodeQrPng(png: Uint8Array): string {
  const image = PNG.sync.read(Buffer.from(png));
  return decodeQr(new Uint8ClampedArray(image.data), image.width, image.height);
}

/**
 * The text of the QR code on each page of the PDF, in page order: every page must have exactly
 * one image, and it must be a readable QR. Handles the images pdfkit writes (8-bit RGB or gray,
 * Flate-compressed, no predictor).
 */
export async function qrCodesInPdf(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page, index) => {
    const xObjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const images = (xObjects?.values() ?? [])
      .map((ref) => doc.context.lookup(ref))
      .filter(
        (object): object is PDFRawStream =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      );
    const [image, ...rest] = images;
    if (image === undefined || rest.length > 0) {
      throw new Error(`Page ${String(index + 1)} has ${String(images.length)} images, not one`);
    }
    return decodeQr(...rgbaOf(image));
  });
}

function rgbaOf(image: PDFRawStream): [Uint8ClampedArray, number, number] {
  const number = (key: string) => image.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
  const width = number('Width');
  const height = number('Height');
  if (number('BitsPerComponent') !== 8) throw new Error('Only 8-bit images are supported');
  const filter = image.dict.get(PDFName.of('Filter'));
  const flate =
    filter === PDFName.of('FlateDecode') ||
    (filter instanceof PDFArray &&
      filter.size() === 1 &&
      filter.get(0) === PDFName.of('FlateDecode'));
  if (!flate || image.dict.has(PDFName.of('DecodeParms'))) {
    throw new Error('Only Flate-compressed images without a predictor are supported');
  }
  const pixels = inflateSync(image.contents);
  const colorSpace = image.dict.get(PDFName.of('ColorSpace'));
  const channels =
    colorSpace === PDFName.of('DeviceRGB') ? 3 : colorSpace === PDFName.of('DeviceGray') ? 1 : 0;
  if (channels === 0) throw new Error('Only RGB and gray images are supported');
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < 3; c += 1)
      rgba[i * 4 + c] = pixels[i * channels + (channels === 3 ? c : 0)] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  return [rgba, width, height];
}

function decodeQr(rgba: Uint8ClampedArray, width: number, height: number): string {
  // jsqr is CommonJS with an `exports.default`: under NodeNext the default import is the module.
  const result = jsQR.default(rgba, width, height);
  if (result === null) throw new Error('No readable QR code in the image');
  return result.data;
}

/**
 * A supertest parser that keeps the body as a Buffer (`.buffer(true).parse(binaryBody)`), for
 * responses such as PDFs that superagent would otherwise drop.
 */
export function binaryBody(
  res: request.Response,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  // Superagent passes the raw Node response here, not its own `Response`.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => {
    callback(null, Buffer.concat(chunks));
  });
}
