import {google} from 'googleapis';
import admin from 'firebase-admin';

const ADMIN_EMAILS = ['frenemy566@gmail.com'];
const SOURCE_FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();

if (!admin.apps.length) admin.initializeApp({ projectId: 'wycoder' });

function json(res,status,payload){res.status(status).setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload));}
function configError(message,status=503,code='DRIVE_CONFIG'){const e=new Error(message);e.status=status;e.publicCode=code;return e;}
function classify(e,folderId=''){
 const status=Number(e?.code||e?.response?.status||0);
 const reason=String(e?.errors?.[0]?.reason||'').toLowerCase();
 const msg=String(e?.errors?.[0]?.message||e?.response?.data?.error?.message||e?.message||'Unknown Google Drive error');
 const text=(reason+' '+msg).toLowerCase();
 if(status===401||/invalid_grant|invalid_client|invalid client|invalid.*credential|unauthenticated|unauthorized/.test(text)){
  if(/invalid_grant/.test(text)) return configError('Google OAuth rejected the refresh token (invalid_grant). It may be revoked, expired, generated for a different OAuth client, or missing Drive authorization. Generate a new refresh token with the same OAuth client ID/secret for the Google account you want to use, update Vercel Production, and redeploy.',503,'DRIVE_REFRESH_TOKEN_INVALID');
  if(/invalid_client|invalid client/.test(text)) return configError('Google OAuth rejected the client credentials (invalid_client). Make sure GOOGLE_DRIVE_OAUTH_CLIENT_ID and GOOGLE_DRIVE_OAUTH_CLIENT_SECRET belong to the same Google Cloud OAuth client and are set exactly in Vercel Production, then redeploy.',503,'DRIVE_CLIENT_INVALID');
  return configError(`Google Drive authentication failed. Google returned: ${msg}. Verify the server-side OAuth credentials in Vercel Production.`,503,'DRIVE_AUTH_FAILED');
 }
 if(/accessnotconfigured|access not configured|api.*not.*enabled/.test(text)) return configError('Google Drive API is not enabled for the Google Cloud project used by this OAuth client.',503,'DRIVE_API_NOT_ENABLED');
 if(status===403||/forbidden|permission|insufficientpermissions/.test(text)) return configError(`Google Drive denied access. Confirm the connected account can access the source folder${folderId?` (${folderId})`:''}.`,503,'DRIVE_FOLDER_PERMISSION');
 if(status===404||/not.?found/.test(text)) return configError(`Google Drive could not find the configured source folder (${folderId||'not configured'}). Check GOOGLE_DRIVE_FOLDER_ID.`,503,'DRIVE_FOLDER_NOT_FOUND');
 if(/storagequota|storage quota|quota exceeded|dailylimit|daily limit/.test(text)) return configError('The connected Google Drive account has a storage or quota limitation. Free space in Drive and try again.',503,'DRIVE_QUOTA');
 return configError(`Google Drive connection check failed: ${msg}`,502,'DRIVE_CHECK_FAILED');
}

export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return json(res,405,{error:'Method not allowed'});}
 try{
  const authHeader=String(req.headers.authorization||'');
  const idToken=authHeader.startsWith('Bearer ')?authHeader.slice(7):'';
  if(!idToken)return json(res,401,{error:'Missing sign-in token'});
  const decoded=await admin.auth().verifyIdToken(idToken);
  const email=String(decoded.email||'').toLowerCase();
  if(!ADMIN_EMAILS.includes(email))return json(res,403,{error:'Not authorized'});
  const clientId=String(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID||'').trim();
  const clientSecret=String(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET||'').trim();
  const refreshToken=String(process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN||'').trim();
  if(!clientId||!clientSecret||!refreshToken)throw configError('Google Drive OAuth is not configured. Add GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, and GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN to Vercel Production, then redeploy.',503,'MISSING_GOOGLE_OAUTH');
  if(!SOURCE_FOLDER_ID)throw configError('GOOGLE_DRIVE_FOLDER_ID is missing. Add the source ZIP destination folder ID to Vercel Production, then redeploy.',503,'MISSING_DRIVE_FOLDER');
  const oauth2=new google.auth.OAuth2(clientId,clientSecret);oauth2.setCredentials({refresh_token:refreshToken});
  const drive=google.drive({version:'v3',auth:oauth2});
  let about;
  try{about=await drive.about.get({fields:'user(emailAddress,displayName,permissionId)'});}catch(e){throw classify(e);}
  const driveEmail=String(about?.data?.user?.emailAddress||'').toLowerCase();
  if(!driveEmail)throw configError('Google Drive OAuth connected, but Google did not return the account email.',503,'DRIVE_ACCOUNT_UNKNOWN');
  // Any Google account may authorize Drive. Access is determined by the OAuth
  // credentials and the configured destination folder permissions.
  let folder;
  try{folder=await drive.files.get({fileId:SOURCE_FOLDER_ID,fields:'id,name,mimeType,trashed,driveId,capabilities(canAddChildren,canEdit,canShare)',supportsAllDrives:true});}catch(e){throw classify(e,SOURCE_FOLDER_ID);}
  if(folder?.data?.trashed)throw configError(`The configured source folder (${SOURCE_FOLDER_ID}) is in the Drive trash. Restore it and try again.`,503,'DRIVE_FOLDER_TRASHED');
  if(folder?.data?.mimeType!=='application/vnd.google-apps.folder')throw configError(`GOOGLE_DRIVE_FOLDER_ID (${SOURCE_FOLDER_ID}) is not a Google Drive folder.`,503,'DRIVE_FOLDER_INVALID');
  if(folder?.data?.capabilities?.canAddChildren===false)throw configError(`The connected Google account can see the source folder but cannot add files to it. Give the account upload/edit access to that folder.`,503,'DRIVE_FOLDER_PERMISSION');
  const quota=about?.data?.storageQuota||{};
  const limit=Number(quota.limit||0),usage=Number(quota.usage||0),free=limit>0?Math.max(0,limit-usage):null;
  const gb=n=>(n/(1024**3)).toFixed(2);
  let storageMessage='Storage quota information is unavailable.';
  if(folder?.data?.driveId) storageMessage='Destination is in a Shared Drive; personal My Drive storage quota does not apply to this folder.';
  else if(limit>0) storageMessage=`My Drive storage: ${gb(usage)} GB used of ${gb(limit)} GB (${gb(free)} GB available).`;
  return json(res,200,{ok:true,message:`Google Drive is connected as ${about.data.user.displayName||driveEmail}. Source folder “${folder.data.name||'Unnamed folder'}” is accessible and ready for uploads. ${storageMessage}`,account:driveEmail,folder:{id:folder.data.id,name:folder.data.name,mimeType:folder.data.mimeType,sharedDrive:Boolean(folder.data.driveId),canAddChildren:folder.data.capabilities?.canAddChildren!==false},storage:{limit,usage,free,sharedDrive:Boolean(folder.data.driveId)},diagnostics:{oauthClientConfigured:Boolean(clientId&&clientSecret),refreshTokenConfigured:Boolean(refreshToken),accountVerified:true,folderAccessible:true,uploadPermission:folder.data.capabilities?.canAddChildren!==false}});
 }catch(e){const msg=e?.publicCode?e.message:(e?.errors?.[0]?.message||e.message||'Drive connection check failed');const status=e?.status&&e.status>=400&&e.status<600?e.status:500;return json(res,status,{error:msg,code:e?.publicCode||undefined});}
}
