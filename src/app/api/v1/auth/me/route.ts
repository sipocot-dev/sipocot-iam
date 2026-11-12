export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { me as GET, updateMe as PATCH } from '@/modules/identity/interface/http/handlers';
