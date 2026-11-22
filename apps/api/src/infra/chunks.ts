/** Rows per INSERT: well below Postgres' 65,535 bind parameters for the widest table. */
export const INSERT_CHUNK_SIZE = 2_000;

/** Splits rows into `createMany` batches of at most `INSERT_CHUNK_SIZE`. */
export function* chunks<T>(rows: readonly T[]): Generator<T[]> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    yield rows.slice(start, start + INSERT_CHUNK_SIZE);
  }
}
