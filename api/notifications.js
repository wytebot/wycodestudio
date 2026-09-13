import admin from 'firebase-admin';

const ADMIN_EMAILS=['frenemy566@gmail.com'];

function json(res,status,payload){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
function parseServiceAccount(raw){
  if(!raw)throw Object.assign(new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON'),{status:503,publicCode:'MISSING_FIREBASE_SERVICE_ACCOUNT'});
  const text=String(raw).trim();
  try{return JSON.parse(text)}catch{}
  try{return JSON.parse(text.replace(/\\n/g,'\n'))}catch{
    throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'),{status:503,publicCode:'INVALID_FIREBASE_SERVICE_ACCOUNT'});
  }
}
function getAdmin(){
  if(admin.apps.length)return admin;
  const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({credential:admin.credential.cert(sa)});
  return admin;
}
async function verifyAdmin(req){
  const h=String(req.headers.authorization||'');
  const token=h.startsWith('Bearer ')?h.slice(7).trim():'';
  if(!token)throw Object.assign(new Error('Missing Studio sign-in token.'),{status:401});
  const a=getAdmin();
  const decoded=await a.auth().verifyIdToken(token);
  if(!ADMIN_EMAILS.includes(String(decoded.email||'').toLowerCase()))throw Object.assign(new Error('Not authorized.'),{status:403});
  return a;
}
async function body(req){
  if(req.body&&typeof req.body==='object')return req.body;
  const chunks=[];for await(const c of req)chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c));
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('Invalid JSON body.'),{status:400})}
}
function publicBase(){
  return String(process.env.MARKET_URL||process.env.APP_URL||'').trim().replace(/\/+$/,'');
}
function chunks(a,n=500){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
async function sendToSubscribers(a,title,body,url,tag){
  const db=a.firestore();
  const snap=await db.collection('notificationSubscribers').where('enabled','==',true).get();
  const docs=snap.docs;
  const tokens=docs.map(d=>({ref:d.ref,token:String(d.data()?.token||'').trim()})).filter(x=>x.token);
  if(!tokens.length)return {sent:0,failed:0,subscribers:0};
  let sent=0,failed=0;
  for(const batch of chunks(tokens)){
    const result=await a.messaging().sendEachForMulticast({
      tokens:batch.map(x=>x.token),
      data:{
        title:String(title).slice(0,100),
        body:String(body).slice(0,300),
        url:String(url||'/'),
        tag:String(tag||'wycode-market').slice(0,80)
      },
      webpush:{fcmOptions:{link:String(url||'/')}}
    });
    sent+=result.successCount;failed+=result.failureCount;
    const invalid=[];
    result.responses.forEach((r,i)=>{
      const code=String(r?.error?.code||'');
      if(['messaging/registration-token-not-registered','messaging/invalid-registration-token','messaging/invalid-argument'].includes(code))invalid.push(batch[i].ref);
    });
    if(invalid.length){
      const bw=db.batch();invalid.forEach(ref=>bw.delete(ref));await bw.commit();
    }
  }
  return {sent,failed,subscribers:tokens.length};
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return json(res,405,{error:'Method not allowed'});}
  try{
    const a=await verifyAdmin(req);
    const db=a.firestore();
    if(req.method==='GET'){
      const snap=await db.collection('notificationSubscribers').where('enabled','==',true).get();
      return json(res,200,{enabled:true,subscribers:snap.size});
    }
    const b=await body(req);
    const action=String(b.action||'').trim();
    if(action==='test'){
      const base=publicBase();
      if(!base)return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before sending notifications.',code:'MISSING_MARKET_URL'});
      const result=await sendToSubscribers(a,'WyCode Market — test notification','Push notifications are connected and ready.',base+'/','wycode-test');
      return json(res,200,{ok:true,...result});
    }
    if(action!=='new_product')return json(res,400,{error:'Unsupported notification action.'});
    const productId=String(b.productId||'').trim();
    if(!productId)return json(res,400,{error:'productId is required.'});
    const productSnap=await db.collection('products').doc(productId).get();
    if(!productSnap.exists)return json(res,404,{error:'Product not found.'});
    const p=productSnap.data()||{};
    if(String(p.status||'')!=='published')return json(res,409,{error:'Only published products can trigger buyer notifications.'});
    const deliveryRef=db.collection('notificationDeliveries').doc(productId);
    const claimed=await db.runTransaction(async tx=>{
      const snap=await tx.get(deliveryRef);
      if(snap.exists)return false;
      tx.create(deliveryRef,{productId,createdAt:admin.firestore.FieldValue.serverTimestamp()});
      return true;
    });
    if(!claimed)return json(res,200,{ok:true,skipped:true,reason:'already_sent'});
    const base=publicBase();
    if(!base){
      await deliveryRef.delete().catch(()=>{});
      return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before publishing notifications.',code:'MISSING_MARKET_URL'});
    }
    const name=String(p.name||'New product').trim()||'New product';
    const category=String(p.category||'Source code').trim();
    try{
      const result=await sendToSubscribers(a,'New product on WyCode Market',`${name} is now available in ${category}. Tap to view it.`,`${base}/?product=${encodeURIComponent(productId)}`,`wycode-product-${productId}`);
      return json(res,200,{ok:true,productId,...result});
    }catch(sendError){
      // Do not permanently consume the idempotency marker when FCM could not
      // complete the send at all. A later publish retry can then try again.
      await deliveryRef.delete().catch(()=>{});
      throw sendError;
    }
  }catch(e){
    const status=Number(e?.status||e?.code||0)>=400&&Number(e?.status||e?.code||0)<600?Number(e.status||e.code):500;
    return json(res,status,{error:e?.message||'Notification operation failed.',code:e?.publicCode||undefined});
  }
}
