import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../apps/local-api/src/server.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleApiRequest(req, res);
}
