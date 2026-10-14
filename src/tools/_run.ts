import { asArray, type Row } from './_format.js';

export function piecesOf(finalOutput: unknown): Row[] {
  const steps = (finalOutput as Row | null | undefined)?.steps;
  if (!steps || typeof steps !== 'object') return [];
  return Object.values(steps as Row).flatMap((step) =>
    asArray<Row>(((step as Row | null)?.output as Row | null | undefined)?.content_pieces)
  );
}

export function pickPiece(
  pieces: readonly Row[],
  hint: { readonly title?: unknown; readonly platform?: unknown }
): Row | undefined {
  if (pieces.length === 1) return pieces[0];
  return (
    pieces.find((piece) => hint.title !== undefined && piece.title === hint.title) ??
    pieces.find((piece) => hint.platform !== undefined && piece.platform === hint.platform)
  );
}
