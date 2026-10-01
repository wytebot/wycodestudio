// Single Vercel Function router for WyCode Admin.
// Handles /api/admin, /api/audit and the /api/email-worker cron endpoint.
import adminRoute from '../server/admin.js';
import auditRoute from '../server/audit.js';
import emailWorker from '../server/email-worker.js';

const routes = {admin:adminRoute,audit:auditRoute,'email-worker':emailWorker};

export default async function handler(req,res) {
  const q=req.query?.route;
  const fromQuery=Array.isArray(q)?q.join('/'):String(q||'');
  const fromUrl=String(req.url||'').split('?')[0].replace(/^\/+|\/+$/g,'').split('/').slice(1).join('/');
  const route=(fromQuery||fromUrl).replace(/^api\//,'').replace(/^\/+|\/+$/g,'').split('/')[0];
  const target=routes[route];
  if(!target){res.statusCode=404;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify({error:'API route not found.'}));}
  return target(req,res);
}
