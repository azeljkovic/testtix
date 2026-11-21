/**
 * Writes the OpenAPI document to a file: `node dist/openapi/export-openapi.js <file>`.
 * Run through `pnpm openapi` at the repo root, which also regenerates the web client types.
 */
import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createOpenApiDocument, serializeOpenApiDocument } from './openapi-document.js';

const outFile = resolve(process.argv[2] ?? 'openapi.json');
await writeFile(outFile, serializeOpenApiDocument(await createOpenApiDocument()));
process.stdout.write(`Wrote ${outFile}\n`);
