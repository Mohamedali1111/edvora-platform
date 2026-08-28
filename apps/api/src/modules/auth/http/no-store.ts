import type { Response } from 'express';

export function setNoStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}
