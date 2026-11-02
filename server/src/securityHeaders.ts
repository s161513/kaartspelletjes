import type { NextFunction, Request, Response } from "express";

/**
 * Defense-in-depth on top of the client rendering everything with textContent:
 * no inline or remote scripts, no objects, no framing. Notes:
 * - style-src keeps 'unsafe-inline' because the pages use inline style attributes.
 * - img-src allows data: for the pixel icons (canvas.toDataURL) and Vite-inlined sprites.
 * - connect-src allows ws:/wss: for the game and counter sockets (same host in prod).
 * In dev the client is served by Vite without these headers; they apply to the
 * production server that serves client/dist.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}
