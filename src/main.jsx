import React,{useEffect,useState}from"react";
import{createRoot}from"react-dom/client";
import{getAuth,onAuthStateChanged,signInWithPopup,signOut,GoogleAuthProvider}from"firebase/auth";
import{getFirestore,addDoc,collection,doc,onSnapshot,serverTimestamp,updateDoc}from"firebase/firestore";
import{initializeApp}from"firebase/app";
import{LayoutDashboard,Package,ShoppingBag,Users,Settings as SettingsIcon,Plus,Search,LogOut,Pencil,Trash2,X,LockKeyhole,Image as ImageIcon,FileArchive,DollarSign,Tag,Sparkles,Upload}from"lucide-react";
import"./styles.css";

const firebaseConfig={
 apiKey:"AIzaSyC9_g7DblKRamrFdM2xBKK03Q-MUJM6tt4",
 authDomain:"wycoder.firebaseapp.com",
 projectId:"wycoder",
 storageBucket:"wycoder.firebasestorage.app",
 messagingSenderId:"610749661041",
 appId:"1:610749661041:web:37daf5af5946838914c0d0",
 measurementId:"G-RT3WRQPBL3"
};
const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const ADMIN_EMAILS=["frenemy566@gmail.com"];
const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:"select_account"});
const blank={name:"",slug:"",description:"",category:"Developer Tools",price:9.99,currency:"USD",status:"draft",version:"1.0.0",demoUrl:"",driveFileId:"",coverUrl:"",features:"",requirements:"",license:"Single-project commercial license",saleType:"normal",bannerUrl:""};
const money=(x,c="USD")=>{try{return new Intl.NumberFormat("en-US",{style:"currency",currency:c}).format(Number(x)||0)}catch{return `${c} ${Number(x)||0}`}};
const makeSlug=x=>String(x||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const validUrl=x=>!x||/^https?:\/\/[^\s]+$/i.test(x);
const timestampValue=x=>x?.toMillis?x.toMillis():x?.seconds?x.seconds*1000:Number(x)||0;
const errText=e=>e?.code?`${e.code}: ${e.message||"Operation failed"}`:(e?.message||"Operation failed");
const MAX_SOURCE_BYTES=3*1024*1024;
const MAX_COVER_BYTES=2*1024*1024;

function App(){
 const[user,setUser]=useState(null),[authLoading,setAuthLoading]=useState(true),[products,setProducts]=useState([]),[orders,setOrders]=useState([]),[customers,setCustomers]=useState([]),[view,setView]=useState("dashboard"),[edit,setEdit]=useState(null),[modal,setModal]=useState(false),[search,setSearch]=useState(""),[msg,setMsg]=useState(""),[loading,setLoading]=useState(false);
 const allowed=!!user&&ADMIN_EMAILS.includes((user.email||"").toLowerCase());
 useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false)});const close=e=>document.querySelectorAll("details[open]").forEach(d=>{if(!d.contains(e.target))d.removeAttribute("open")});document.addEventListener("pointerdown",close);return()=>{unsub();document.removeEventListener("pointerdown",close)}},[]);
 useEffect(()=>{if(!allowed||!db){setProducts([]);setOrders([]);setCustomers([]);return}
   let active=true;
   const handleError=e=>{if(active)setMsg(`Firestore error: ${errText(e)}`)};
   const unsubs=[
    onSnapshot(collection(db,"products"),s=>active&&setProducts(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timestampValue(b.createdAt)-timestampValue(a.createdAt))),handleError),
    onSnapshot(collection(db,"orders"),s=>active&&setOrders(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>timestampValue(b.createdAt)-timestampValue(a.createdAt))),handleError),
    onSnapshot(collection(db,"customers"),s=>active&&setCustomers(s.docs.map(d=>({id:d.id,...d.data()}))),handleError)
   ];
   return()=>{active=false;unsubs.forEach(u=>u())};
 },[allowed]);
 async function save(e){
   e.preventDefault();
   const fail=t=>{setMsg(t);alert(t)};
   const f=new FormData(e.currentTarget), name=String(f.get("name")||"").trim(), rawSlug=String(f.get("slug")||"").trim(), productSlug=makeSlug(rawSlug||name), price=Number(f.get("price"));
   const currency=String(f.get("currency")||"USD").toUpperCase();
   if(!name||!String(f.get("description")||"").trim()||!Number.isFinite(price)||price<0.01||!String(f.get("version")||"").trim()||!/^[A-Z]{3}$/.test(currency)){return fail("Name, description, valid price, and version are required.")}
   const demoUrl=String(f.get("demoUrl")||"").trim(),coverUrl=String(f.get("coverUrl")||"").trim(),bannerUrl=String(f.get("bannerUrl")||"").trim();
   if(!validUrl(demoUrl)||!validUrl(coverUrl)||!validUrl(bannerUrl)){return fail("Demo URL, cover URL, and banner image URL must be valid http/https URLs.")}
   const saleType=f.get("saleType")==="special"?"special":"normal";
   const driveFileId=String(f.get("driveFileId")||"").trim();
   if(f.get("status")==="published"&&!driveFileId){return fail("Upload a product file (or paste a Google Drive file ID) before publishing.")}
   if(saleType==="special"&&f.get("status")==="published"&&!bannerUrl){return fail("A banner image URL is required to publish a special sale product.")}
   const d={name,slug:productSlug,description:String(f.get("description")||"").trim(),category:f.get("category"),price,currency,status:f.get("status"),version:String(f.get("version")||"").trim(),demoUrl,driveFileId,coverUrl,features:String(f.get("features")||"").trim(),requirements:String(f.get("requirements")||"").trim(),license:String(f.get("license")||"").trim(),saleType,bannerUrl,updatedAt:serverTimestamp()};
   setLoading(true);
   try{
    const dup=products.some(x=>x.id!==edit?.id&&String(x.slug||"").toLowerCase()===productSlug.toLowerCase());
    if(dup){return fail(`Slug "${productSlug}" is already used.`)}
    if(edit)await updateDoc(doc(db,"products",edit.id),d);else await addDoc(collection(db,"products"),{...d,createdAt:serverTimestamp(),sales:0});
    setModal(false);setEdit(null);setMsg("✓ Product saved successfully.");alert("Product saved successfully.");
   }catch(e){setMsg(errText(e));alert(errText(e))}finally{setLoading(false)}
 }
 async function remove(id){
   if(!confirm("Archive this product? Existing orders will remain intact."))return;
   setLoading(true);try{await updateDoc(doc(db,"products",id),{status:"archived",updatedAt:serverTimestamp()});setMsg("Product archived.")}catch(e){setMsg(errText(e));alert(errText(e))}finally{setLoading(false)}
 }
 async function login(){try{setMsg("");await signInWithPopup(auth,provider)}catch(e){setMsg(`Google sign-in failed: ${errText(e)}`)}}
 async function logout(){try{await signOut(auth)}catch(e){setMsg(`Sign-out failed: ${errText(e)}`)}}
 if(authLoading)return <div className="center"><div className="login"><div className="logo big">W</div><h1>WyCode Studio</h1><p>Checking secure session…</p></div></div>;if(!user)return <Login onLogin={login} msg={msg}/>;if(!allowed)return <Denied onLogout={logout} email={user.email}/>;
 const revenueByCurrency=orders.filter(x=>x.status==="paid").reduce((m,x)=>{const c=String(x.currency||"USD").toUpperCase();m[c]=(m[c]||0)+Number(x.amount||0);return m},{}),revenue=Object.entries(revenueByCurrency).map(([c,v])=>money(v,c)).join(" · ")||"—",list=products.filter(x=>(x.name||"").toLowerCase().includes(search.toLowerCase())||(x.category||"").toLowerCase().includes(search.toLowerCase()));
 return <div className="app"><aside><div className="brand"><div className="logo">W</div><b>WyCode<br/><small>Studio</small></b></div><nav>{[["dashboard","Dashboard",LayoutDashboard],["products","Products",Package],["orders","Orders",ShoppingBag],["customers","Customers",Users],["settings","Settings",SettingsIcon]].map(([id,t,I])=><button key={id} className={view===id?"active":""} onClick={()=>setView(id)}><I size={18}/>{t}</button>)}</nav><details className="helpMenu"><summary>Help & Legal</summary><a href="mailto:wytetechcompany@gmail.com?subject=WyCode%20Studio%20support">Contact</a><button type="button" onClick={()=>setView("settings")}>Privacy</button><button type="button" onClick={()=>setView("settings")}>Terms</button><button type="button" onClick={()=>setView("settings")}>About</button></details><button className="logout" onClick={logout}><LogOut size={17}/>Sign out</button></aside><main><header><div><small>PRIVATE ADMIN</small><h1>{view[0].toUpperCase()+view.slice(1)}</h1></div><div className="headRight"><button className="contactStudio" onClick={()=>location.href="mailto:wytetechcompany@gmail.com?subject=WyCode%20Studio%20payment%20or%20bug%20support&body=Issue%20type%3A%20%5BPayment%20issue%20%2F%20Bug%20%2F%20Other%5D%0A%0ADescription%3A%20%0A%0ASteps%20to%20reproduce%3A%20%0A%0ADevice%2Fbrowser%3A%20%0A%0APlease%20attach%20screenshots.%20"}>CONTACT ME</button><span>{user.email}</span></div></header>{msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}><X size={15}/></button></div>}{loading&&<div className="notice">Working…</div>}{view==="dashboard"&&<Dashboard p={products} o={orders} c={customers} r={revenue}/>} {view==="products"&&<><div className="toolbar"><div className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search products..."/></div><button className="primary" onClick={()=>{setEdit(null);setModal(true)}}><Plus size={17}/>Add product</button></div><Table p={list} edit={x=>{setEdit(x);setModal(true)}} remove={remove}/></>}{view==="orders"&&<Orders o={orders}/>} {view==="customers"&&<Customers c={customers}/>} {view==="settings"&&<Settings user={user}/>}</main>{modal&&<Modal p={edit||blank} close={()=>{setModal(false);setEdit(null)}} save={save}/>}</div>
}
function Dashboard({p,o,c,r}){return <><div className="cards"><Card t="Products" v={p.length}/><Card t="Paid orders" v={o.filter(x=>x.status==="paid").length}/><Card t="Customers" v={c.length}/><Card t="Revenue" v={money(r)}/></div><div className="grid"><section className="panel"><h2>Recent products</h2>{p.length?p.slice(0,6).map(x=><div className="row" key={x.id}><span><b>{x.name}</b><small>{x.category}</small></span><b>{money(x.price,x.currency)}</b></div>):<p>No products yet.</p>}</section><section className="panel"><h2>Recent orders</h2>{o.length?o.slice(0,6).map(x=><div className="row" key={x.id}><span><b>{x.productName||"Order"}</b><small>{x.email||"—"}</small></span><b>{x.status}</b></div>):<p>No orders yet.</p>}</section></div></>}
function Card({t,v}){return <div className="card"><small>{t}</small><strong>{v}</strong></div>}
function Table({p,edit,remove}){return <section className="panel table"><div className="tr head"><span>Product</span><span>Price</span><span>Status</span><span>Drive</span><span/></div>{p.length?p.map(x=><div className="tr" key={x.id}><span><b>{x.name}</b>{x.saleType==="special"&&<span className="pill special">★ Special</span>}<small>{x.slug}</small></span><span>{money(x.price,x.currency)}</span><span className="pill">{x.status}</span><span>{x.driveFileId?"✓":"!"}</span><span><button onClick={()=>edit(x)} aria-label={`Edit ${x.name}`}><Pencil size={15}/></button><button onClick={()=>remove(x.id)} aria-label={`Archive ${x.name}`} title="Archive product"><Trash2 size={15}/></button></span></div>):<p>No products match your search.</p>}</section>}
function Orders({o}){return <section className="panel table"><h2>Orders</h2>{o.length?o.map(x=><div className="tr" key={x.id}><span>{x.email||"—"}</span><span>{x.productName||"—"}</span><span>{money(x.amount)}</span><span className="pill">{x.status||"pending"}</span><span>{x.reference||"—"}</span></div>):<p>No orders yet.</p>}</section>}
function Customers({c}){return <section className="panel table"><h2>Customers</h2>{c.length?c.map(x=><div className="tr" key={x.id}><span>{x.email||"—"}</span><span>{x.name||"—"}</span><span>{x.orders||0}</span><span>Customer</span><span/></div>):<p>No customers yet.</p>}</section>}
function Settings({user}){return <section className="panel"><h2>Studio settings</h2><p>Admin: <b>{user.email}</b></p><div className="security"><LockKeyhole size={20}/><span>Product source files and cover images are stored in Google Drive. Firebase Storage is not used by this Studio.</span></div><details><summary>Privacy</summary><p>This private admin tool processes only information needed to operate the marketplace. Credentials and private source files should remain server-side.</p></details><details><summary>Terms</summary><p>Studio access is restricted to the authorized administrator. Keep credentials private and use the dashboard only to manage your own marketplace data.</p></details><details><summary>About</summary><p>WyCode Studio is the private administration panel for the personal WyCode source-code marketplace.</p></details></section>}
function Picker({label,icon:Icon,accept,onChange,disabled,filename,helper,children}){
 return <div className="pickerField"><div className="pickerLabel"><span>{Icon&&<Icon size={15}/>} {label}</span>{filename&&<small title={filename}>{filename}</small>}</div><label className={`picker${disabled?" disabled":""}`}><input type="file" accept={accept} onChange={onChange} disabled={disabled}/><span className="pickerIcon"><Icon size={18}/></span><span className="pickerCopy"><b>{filename?"Choose another file":"Choose a file"}</b><small>{helper}</small></span><span className="pickerButton">Browse</span></label>{children}</div>
}
function SelectPicker({label,name,value,onChange,options,icon:Icon}){
 return <label className="selectField"><span className="selectLabel">{Icon&&<Icon size={15}/>} {label}</span><span className="selectWrap"><select name={name} value={value} onChange={onChange}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><span className="selectChevron">⌄</span></span></label>
}
function Modal({p,close,save}){
 const[driveFileId,setDriveFileId]=useState(p.driveFileId||"");
 const[fileName,setFileName]=useState("");
 const[uploading,setUploading]=useState(false),[uploadMsg,setUploadMsg]=useState("");
 const[coverUrl,setCoverUrl]=useState(p.coverUrl||""),[coverName,setCoverName]=useState("");
 const[coverUploading,setCoverUploading]=useState(false),[coverMsg,setCoverMsg]=useState("");
 const[bannerUrl,setBannerUrl]=useState(p.bannerUrl||""),[bannerName,setBannerName]=useState("");
 const[bannerUploading,setBannerUploading]=useState(false),[bannerMsg,setBannerMsg]=useState("");
 const[saleType,setSaleType]=useState(p.saleType||"normal");
 const[status,setStatus]=useState(p.status||"draft");
 const[category,setCategory]=useState(p.category||"Developer Tools");
 const[currency,setCurrency]=useState(p.currency||"USD");
 const fields=["name","slug","description","price","version","demoUrl","features","requirements","license"];
 async function uploadImage(file,setUrl,setName,setBusy,setMsg,label,kind){
  if(!file)return;
  if(!file.type.startsWith("image/")){setMsg("Please choose an image file.");alert(`Invalid ${label.toLowerCase()}: please choose an image file.`);return}
  if(file.size>MAX_COVER_BYTES){setMsg(`${label} is larger than 2 MB.`);alert(`Invalid ${label.toLowerCase()}: images must be 2 MB or smaller.`);return}
  setBusy(true);setMsg(`Uploading ${file.name}…`);
  try{
   if(!auth.currentUser)throw new Error("Your session expired. Sign in again.");
   const idToken=await auth.currentUser.getIdToken();
   const dataBase64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]||"");r.onerror=()=>reject(new Error("Could not read the selected image"));r.readAsDataURL(file)});
   const res=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${idToken}`},body:JSON.stringify({filename:file.name,mimeType:file.type,dataBase64,kind})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(j.error||`${label} upload failed`);
   setUrl(j.viewUrl||j.downloadUrl||"");setName(j.name||file.name);setMsg(`✓ ${label} uploaded to Google Drive.`);setUploadMsg("");
  }catch(err){setMsg(err.message||`${label} upload failed`);alert(err.message||`${label} upload failed.`)}finally{setBusy(false)}
 }
 function handleCover(e){uploadImage(e.target.files?.[0],setCoverUrl,setCoverName,setCoverUploading,setCoverMsg,"Cover image","cover")}
 function handleBanner(e){uploadImage(e.target.files?.[0],setBannerUrl,setBannerName,setBannerUploading,setBannerMsg,"Special sale banner","special-cover")}
 async function handleFile(e){
  const file=e.target.files?.[0];if(!file)return;
  if(!/\.zip$/i.test(file.name)){setUploadMsg("Please choose a ZIP source archive.");alert("Invalid upload: product source files must be ZIP archives.");e.target.value="";return}
  if(file.size>MAX_SOURCE_BYTES){setUploadMsg("File is larger than 3 MB. Upload it to Drive manually and paste its file ID instead.");alert("Invalid upload: direct source uploads are limited to 3 MB. Upload the larger ZIP to Google Drive manually and paste its file ID.");e.target.value="";return}
  setCoverMsg("");setBannerMsg("");setUploading(true);setUploadMsg(`Uploading ${file.name}…`);
  try{
   if(!auth.currentUser)throw new Error("Your session expired. Sign in again.");
   const idToken=await auth.currentUser.getIdToken();
   const dataBase64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]||"");r.onerror=()=>reject(new Error("Could not read the selected file"));r.readAsDataURL(file)});
   const res=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${idToken}`},body:JSON.stringify({filename:file.name,mimeType:file.type||"application/octet-stream",dataBase64,kind:"source"})});
   const j=await res.json().catch(()=>({}));if(!res.ok)throw new Error(j.error||"Upload failed");
   setDriveFileId(j.fileId);setFileName(j.name||file.name);setUploadMsg(`✓ Uploaded "${j.name||file.name}" to Google Drive. Drive file ID filled in below.`);
  }catch(err){setUploadMsg(err.message||"Upload failed");alert(err.message||"Upload failed.")}finally{setUploading(false)}
 }
 return <div className="back" onPointerDown={e=>{if(e.target===e.currentTarget)close()}}><form className="modal" onSubmit={save}><div className="modalhead"><div><small className="eyebrow">PRODUCT EDITOR</small><h2>{p.id?"Edit product":"Add product"}</h2></div><button type="button" onClick={close} aria-label="Close"><X/></button></div><div className="form">{fields.map(k=><label key={k} className={k==="description"?"wideField":""}>{k}<input name={k} defaultValue={p[k]??""} required={["name","description","price","version"].includes(k)} type={k==="price"?"number":"text"} min={k==="price"?"0.01":undefined} step={k==="price"?"0.01":undefined}/></label>)}
 <Picker label="Product source ZIP" icon={FileArchive} accept=".zip,application/zip" onChange={handleFile} disabled={uploading} filename={fileName} helper="ZIP archive · direct upload up to 3 MB" />
 {uploadMsg&&<small className="notice inlineNotice">{uploadMsg}</small>}
 <label>Google Drive file ID{driveFileId?"":" (or upload a file above)"}<input name="driveFileId" value={driveFileId} onChange={e=>setDriveFileId(e.target.value)} placeholder="Auto-filled after upload, or paste manually"/></label>
 <Picker label="Cover image" icon={ImageIcon} accept="image/*" onChange={handleCover} disabled={coverUploading} filename={coverName} helper="PNG/JPG/WebP · max 2 MB · recommended 800×400px"><div className="imagePreview">{coverUrl?<img src={coverUrl} alt="Cover preview"/>:<div className="emptyPreview">No cover selected</div>}</div></Picker>
 {coverMsg&&<small className="notice inlineNotice">{coverMsg}</small>}<input type="hidden" name="coverUrl" value={coverUrl} readOnly/>
 <SelectPicker label="Currency" name="currency" value={currency} onChange={e=>setCurrency(e.target.value)} icon={DollarSign} options={["USD","NGN","GBP","EUR","CAD","AUD"].map(x=>({value:x,label:`${x} — ${x==="USD"?"US Dollar":x==="NGN"?"Nigerian Naira":x==="GBP"?"British Pound":x==="EUR"?"Euro":x==="CAD"?"Canadian Dollar":"Australian Dollar"}`}))}/>
 <SelectPicker label="Status" name="status" value={status} onChange={e=>setStatus(e.target.value)} icon={LockKeyhole} options={[{value:"draft",label:"Draft — hidden from buyers"},{value:"published",label:"Published — visible in market"},{value:"archived",label:"Archived — no longer for sale"}]}/>
 <SelectPicker label="Category" name="category" value={category} onChange={e=>setCategory(e.target.value)} icon={Tag} options={["Developer Tools","Productivity","Business","Creative","Utilities","Other"].map(x=>({value:x,label:x}))}/>
 <SelectPicker label="Sale type" name="saleType" value={saleType} onChange={e=>setSaleType(e.target.value)} icon={Sparkles} options={[{value:"normal",label:"Normal sale"},{value:"special",label:"Special sale — featured carousel"}]}/>
 {saleType==="special"&&<Picker label="Special sale cover / banner" icon={ImageIcon} accept="image/*" onChange={handleBanner} disabled={bannerUploading} filename={bannerName} helper="PNG/JPG/WebP · max 2 MB · recommended 520×280px"><div className="imagePreview bannerPreview">{bannerUrl?<img src={bannerUrl} alt="Special sale banner preview"/>:<div className="emptyPreview">No special banner selected</div>}</div></Picker>}
 {bannerMsg&&saleType==="special"&&<small className="notice inlineNotice">{bannerMsg}</small>}
 <input type="hidden" name="bannerUrl" value={bannerUrl} readOnly/>
 </div><button className="primary" type="submit" disabled={uploading||coverUploading||bannerUploading}>{uploading?"Uploading source…":coverUploading?"Uploading cover…":bannerUploading?"Uploading banner…":"Save product"}</button></form></div>
}
function Login({onLogin,msg}){return <div className="center"><div className="login"><div className="logo big">W</div><h1>WyCode Studio</h1><p>Private control center for your source-code marketplace.</p>{msg&&<div className="notice">{msg}</div>}<button className="primary full" onClick={onLogin}>Continue with Google</button></div></div>}
function Denied({onLogout,email}){return <div className="center"><div className="login"><LockKeyhole/><h1>Access denied</h1><p>{email} is not authorized to access this private Studio.</p><button onClick={onLogout}>Sign out</button></div></div>}
createRoot(document.getElementById("root")).render(<App/>);
