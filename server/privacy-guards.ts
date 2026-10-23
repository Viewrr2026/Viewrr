import type { Request, Response, NextFunction } from 'express';
import { getBlockedUserIds } from './services/trust-service';

/** Private collections are addressed by the session, never a supplied user ID. */
export function requireOwnUserParam(param: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) { res.status(401).json({ error: 'Authentication required.' }); return; }
    if (Number(req.params[param]) !== req.auth.userId) {
      res.status(403).json({ error: 'Forbidden.' }); return;
    }
    res.set('Cache-Control', 'private, no-store');
    next();
  };
}

/** A failed safety lookup must never turn into an unfiltered response. */
export async function filterBlockedAuthors<T>(
  viewerUserId: number,
  rows: T[],
  getAuthorId: (row: T) => number | null | undefined,
  lookup: (id: number) => Promise<number[]> = getBlockedUserIds,
): Promise<T[]> {
  if (!rows.length) return rows;
  const blocked = new Set(await lookup(viewerUserId));
  return rows.filter(row => !blocked.has(getAuthorId(row) as number));
}
