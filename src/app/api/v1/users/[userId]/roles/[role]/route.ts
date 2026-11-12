export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { assignRole as PUT, revokeRole as DELETE } from '@/modules/identity/interface/http/handlers';
