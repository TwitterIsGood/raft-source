const LATEST_EDGE_TOLERANCE = 80;

export function shouldAutoScrollAfterSend(offset: number): boolean {
  return Number.isFinite(offset) && offset <= LATEST_EDGE_TOLERANCE;
}
