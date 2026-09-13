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
      const queueSnap=await db.collection('notificationState').doc('publishQueue').get();
      const queue=Array.isArray(queueSnap.data()?.products)?queueSnap.data().products:[];
      const pendingSnap=await db.collection('notificationBatches').where('status','in',['pending','failed']).limit(20).get();
      const batches=pendingSnap.docs.map(d=>({id:d.id,status:d.data()?.status||'pending',products:Array.isArray(d.data()?.products)?d.data().products:[],error:String(d.data()?.error||'')}));
      return json(res,200,{enabled:true,subscribers:snap.size,pendingPublishes:queue.length,pendingBatches:pendingSnap.size,batches});
    }
    const b=await body(req);
    const action=String(b.action||'').trim();
    if(action==='test'){
      const base=publicBase();
      if(!base)return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before sending notifications.',code:'MISSING_MARKET_URL'});
      const result=await sendToSubscribers(a,'WyCode Market — test notification','Push notifications are connected and ready.',base+'/','wycode-test');
      return json(res,200,{ok:true,...result});
    }
    if(action==='retry_batch'){
      const batchId=String(b.batchId||'').trim();
      if(!batchId)return json(res,400,{error:'batchId is required.'});
      const batchRef=db.collection('notificationBatches').doc(batchId);
      const batchSnap=await batchRef.get();
      if(!batchSnap.exists)return json(res,404,{error:'Notification batch not found.'});
      const batch=batchSnap.data()||{};
      if(batch.status==='sent')return json(res,200,{ok:true,skipped:true,reason:'already_sent'});
      const items=Array.isArray(batch.products)?batch.products:[];
      if(items.length!==4)return json(res,409,{error:'Only complete 4-product batches can be retried.'});
      const base=publicBase();
      if(!base)return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before sending notifications.',code:'MISSING_MARKET_URL'});
      const last=items[items.length-1]?.name||'Last app';
      const message=`${last} and 3 others have been added, get now before the prices increase.`;
      try{
        const result=await sendToSubscribers(a,'4 new products added to WyCode Market',message,`${base}/`,`wycode-publish-batch-${batchId}`);
        await batchRef.update({status:'sent',sentAt:admin.firestore.FieldValue.serverTimestamp(),result,error:admin.firestore.FieldValue.delete()});
        for(const item of items)if(item.id)await db.collection('notificationDeliveries').doc(item.id).set({status:'sent',batchId,sentAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
        return json(res,200,{ok:true,...result,message});
      }catch(e){
        await batchRef.update({status:'failed',error:String(e?.message||e).slice(0,500),failedAt:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
        return json(res,503,{error:e?.message||'Retry failed.',code:'BATCH_SEND_FAILED'});
      }
    }
    if(action==='custom'){
      const title=String(b.title||'').trim();
      const message=String(b.body||'').trim();
      const rawUrl=String(b.url||'/').trim()||'/';
      if(!title)return json(res,400,{error:'Notification title is required.'});
      if(!message)return json(res,400,{error:'Notification message is required.'});
      if(title.length>100||message.length>300)return json(res,400,{error:'Title must be 100 characters or fewer and message must be 300 characters or fewer.'});
      const base=publicBase();
      if(!base)return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before sending notifications.',code:'MISSING_MARKET_URL'});
      let url=rawUrl;
      try{
        const parsed=new URL(rawUrl,base);
        if(parsed.origin!==new URL(base).origin)return json(res,400,{error:'Notification links must point to the configured Market domain.'});
        url=parsed.href;
      }catch{return json(res,400,{error:'Notification link is not a valid Market URL.'});}
      const result=await sendToSubscribers(a,title,message,url,`wycode-custom-${Date.now()}`);
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
    const queueRef=db.collection('notificationState').doc('publishQueue');
    const batchRef=db.collection('notificationBatches').doc();
    const name=String(p.name||'New product').trim()||'New product';
    const category=String(p.category||'Source code').trim();

    const result=await db.runTransaction(async tx=>{
      const deliverySnap=await tx.get(deliveryRef);
      const queueSnap=await tx.get(queueRef);
      if(deliverySnap.exists)return {duplicate:true};
      tx.create(deliveryRef,{
        productId,
        status:'queued',
        createdAt:admin.firestore.FieldValue.serverTimestamp()
      });
      const current=Array.isArray(queueSnap.data()?.products)?queueSnap.data().products:[];
      const item={id:productId,name,category};
      const next=[...current,item].slice(-4);
      if(next.length>=4){
        tx.create(batchRef,{
          products:next,
          status:'pending',
          createdAt:admin.firestore.FieldValue.serverTimestamp()
        });
        tx.set(queueRef,{products:[],updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
        return {duplicate:false,batchId:batchRef.id,batchProducts:next};
      }
      tx.set(queueRef,{products:next,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      return {duplicate:false,queued:next.length};
    });

    if(result.duplicate)return json(res,200,{ok:true,skipped:true,reason:'already_queued_or_sent'});
    if(!result.batchId){
      return json(res,200,{ok:true,queued:true,pendingCount:result.queued||0,message:`Publish notification queued. ${result.queued||0} of 4 new publishes collected.`});
    }

    const base=publicBase();
    if(!base)return json(res,503,{error:'MARKET_URL is not configured. Add the deployed Market URL before sending notifications.',code:'MISSING_MARKET_URL'});
    const items=result.batchProducts||[];
    const last=items[items.length-1]?.name||name;
    const bodyText=`${last} and ${items.length-1} others have been added, get now before the prices increase.`;
    try{
      const sentResult=await sendToSubscribers(a,'4 new products added to WyCode Market',bodyText,`${base}/` ,`wycode-publish-batch-${result.batchId}`);
      await db.collection('notificationBatches').doc(result.batchId).update({
        status:'sent',
        sentAt:admin.firestore.FieldValue.serverTimestamp(),
        result:sentResult
      });
      for(const item of items)await db.collection('notificationDeliveries').doc(item.id).set({status:'sent',batchId:result.batchId,sentAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      return json(res,200,{ok:true,batch:true,batchId:result.batchId,...sentResult,message:bodyText});
    }catch(sendError){
      await db.collection('notificationBatches').doc(result.batchId).update({status:'failed',error:String(sendError?.message||sendError).slice(0,500),failedAt:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
      return json(res,503,{error:sendError?.message||'The 4-product notification could not be delivered. The batch remains queued for retry.',code:'BATCH_SEND_FAILED',batchId:result.batchId});
    }
  }catch(e){
    const status=Number(e?.status||e?.code||0)>=400&&Number(e?.status||e?.code||0)<600?Number(e.status||e.code):500;
    return json(res,status,{error:e?.message||'Notification operation failed.',code:e?.publicCode||undefined});
  }
}
