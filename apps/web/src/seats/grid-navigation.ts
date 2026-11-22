/** A cell of a seat grid: row index (front row first) and seat index within the row. */
export interface GridPosition {
  row: number;
  col: number;
}

/**
 * Where a key press moves the focus in a grid whose rows have `rowLengths` cells, following the ARIA
 * grid pattern: arrows move one cell (without wrapping), Home / End go to the first / last cell of
 * the row, and Ctrl+Home / Ctrl+End to the first / last cell of the grid. Moving up or down into a
 * shorter row lands on its last cell. Returns `undefined` for keys the grid doesn't handle.
 */
export function nextPosition(
  rowLengths: readonly number[],
  from: GridPosition,
  key: string,
  ctrlKey = false,
): GridPosition | undefined {
  const lastRow = rowLengths.length - 1;
  const lastCol = (row: number) => (rowLengths[row] ?? 1) - 1;
  const inRow = (row: number, col: number) => ({ row, col: Math.min(col, lastCol(row)) });

  switch (key) {
    case 'ArrowLeft':
      return { row: from.row, col: Math.max(from.col - 1, 0) };
    case 'ArrowRight':
      return { row: from.row, col: Math.min(from.col + 1, lastCol(from.row)) };
    case 'ArrowUp':
      return inRow(Math.max(from.row - 1, 0), from.col);
    case 'ArrowDown':
      return inRow(Math.min(from.row + 1, lastRow), from.col);
    case 'Home':
      return ctrlKey ? { row: 0, col: 0 } : { row: from.row, col: 0 };
    case 'End':
      return ctrlKey
        ? { row: lastRow, col: lastCol(lastRow) }
        : { row: from.row, col: lastCol(from.row) };
    default:
      return undefined;
  }
}
