export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { listFiles as GET, requestUpload as POST } from '@/modules/storage/interface/http/handlers';
