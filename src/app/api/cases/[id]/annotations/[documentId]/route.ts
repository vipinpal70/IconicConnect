import { NextRequest } from 'next/server';
import { handleSave } from '../route';

/**
 * PUT /api/cases/:id/annotations/:documentId
 * Explicit Save endpoint matching Document 2.0 specification.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const { id } = await params;
  return handleSave(req, { id });
}
