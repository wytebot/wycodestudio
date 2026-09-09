import {google} from 'googleapis';
import admin from 'firebase-admin';

const ADMIN_EMAILS = ['frenemy566@gmail.com'];
const REQUIRED_OAUTH_EMAIL = ADMIN_EMAILS[0];
const SOURCE_FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();

if (!admin.apps.length) admin.initializeApp({ projectId: 'wycoder' });

function json(res,status,payload){res.status(status).setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload));}
function configError(message,status=503,code='DRIVE_CONFIG'){const e=new Error(message);e.status=status;e.publicCode=code;return e;}
function classify(e,folderId=''){
 const status=Number(e?.code||e?.response?.status||0);
 const reason=String(e?.errors?.[0]?.reason||'').toLowerCase();
 const msg=String(e?.errors?.[0]?.message||e?.response?.data?.error?.message||e?.message||'Unknown Google Drive error');
 const text=(reason+' '+msg).toLowerCase();
 if(status===401||/invalid_grant|invalid.*credential|unauthenticated|unauthorized/.test(text)) return configError('Google Drive OAuth credentials are invalid or the refresh token was revoked. Generate a new refresh token for the permitted Studio account and update Vercel.',503,'DRIVE_AUTH_FAILED');
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
  if(driveEmail!==REQUIRED_OAUTH_EMAIL.toLowerCase())throw configError(`The refresh token belongs to ${driveEmail}, but WyCode Studio only permits ${REQUIRED_OAUTH_EMAIL}. Generate the refresh token while signed in to the permitted account.`,403,'DRIVE_ACCOUNT_MISMATCH');
  let folder;
  try{folder=await drive.files.get({fileId:SOURCE_FOLDER_ID,fields:'id,name,mimeType,trashed,driveId',supportsAllDrives:true});}catch(e){throw classify(e,SOURCE_FOLDER_ID);}
  if(folder?.data?.trashed)throw configError(`The configured source folder (${SOURCE_FOLDER_ID}) is in the Drive trash. Restore it and try again.`,503,'DRIVE_FOLDER_TRASHED');
  if(folder?.data?.mimeType!=='application/vnd.google-apps.folder')throw configError(`GOOGLE_DRIVE_FOLDER_ID (${SOURCE_FOLDER_ID}) is not a Google Drive folder.`,503,'DRIVE_FOLDER_INVALID');
  return json(res,200,{ok:true,message:`Google Drive is connected as ${about.data.user.displayName||driveEmail}. Source folder “${folder.data.name||'Unnamed folder'}” is accessible and ready for uploads.`});
 }catch(e){const msg=e?.publicCode?e.message:(e?.errors?.[0]?.message||e.message||'Drive connection check failed');const status=e?.status&&e.status>=400&&e.status<600?e.status:500;return json(res,status,{error:msg,code:e?.publicCode||undefined});}
}
