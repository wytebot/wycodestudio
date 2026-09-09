import React,{useEffect,useState}from"react";
import{createRoot}from"react-dom/client";
import{getAuth,onAuthStateChanged,signInWithPopup,signOut,GoogleAuthProvider}from"firebase/auth";
import{getFirestore,addDoc,collection,doc,onSnapshot,serverTimestamp,updateDoc}from"firebase/firestore";
import{initializeApp}from"firebase/app";
import{LayoutDashboard,Package,ShoppingBag,Users,Settings as SettingsIcon,Plus,Search,LogOut,Pencil,Trash2,X,LockKeyhole}from"lucide-react";
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

function App(){
 const[user,setUser]=useState(null),[authLoading,setAuthLoading]=useState(true),[products,setProducts]=useState([]),[orders,setOrders]=useState([]),[customers,setCustomers]=useState([]),[view,setView]=useState("dashboard"),[edit,setEdit]=useState(null),[modal,setModal]=useState(false),[search,setSearch]=useState(""),[msg,setMsg]=useState(""),[loading,setLoading]=useState(false);
 const allowed=!!user&&ADMIN_EMAILS.includes((user.email||"").toLowerCase());
 useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false)});return unsub},[]);
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
   const f=new FormData(e.currentTarget), name=String(f.get("name")||"").trim(), rawSlug=String(f.get("slug")||"").trim(), productSlug=makeSlug(rawSlug||name), price=Number(f.get("price"));
   const currency=String(f.get("currency")||"USD").toUpperCase();
   if(!name||!String(f.get("description")||"").trim()||!Number.isFinite(price)||price<0.01||!String(f.get("version")||"").trim()||!/^[A-Z]{3}$/.test(currency)){setMsg("Name, description, valid non-negative price, and version are required.");return}
   const demoUrl=String(f.get("demoUrl")||"").trim(),coverUrl=String(f.get("coverUrl")||"").trim(),bannerUrl=String(f.get("bannerUrl")||"").trim();
   if(!validUrl(demoUrl)||!validUrl(coverUrl)||!validUrl(bannerUrl)){setMsg("Demo URL, cover URL, and banner image URL must be valid http/https URLs.");return}
   const saleType=f.get("saleType")==="special"?"special":"normal";
   const driveFileId=String(f.get("driveFileId")||"").trim();
   if(f.get("status")==="published"&&!driveFileId){setMsg("Upload a product file (or paste a Google Drive file ID) before publishing.");return}
   if(saleType==="special"&&f.get("status")==="published"&&!bannerUrl){setMsg("A banner image URL (520×280) is required to publish a special sale product.");return}
   const d={name,slug:productSlug,description:String(f.get("description")||"").trim(),category:f.get("category"),price,currency,status:f.get("status"),version:String(f.get("version")||"").trim(),demoUrl,driveFileId,coverUrl,features:String(f.get("features")||"").trim(),requirements:String(f.get("requirements")||"").trim(),license:String(f.get("license")||"").trim(),saleType,bannerUrl,updatedAt:serverTimestamp()};
   setLoading(true);
   try{
    const dup=products.some(x=>x.id!==edit?.id&&String(x.slug||"").toLowerCase()===productSlug.toLowerCase());
    if(dup){setMsg(`Slug "${productSlug}" is already used.`);return}
    if(edit)await updateDoc(doc(db,"products",edit.id),d);else await addDoc(collection(db,"products"),{...d,createdAt:serverTimestamp(),sales:0});
    setModal(false);setEdit(null);setMsg("Product saved successfully.");
   }catch(e){setMsg(errText(e))}finally{setLoading(false)}
 }
 async function remove(id){
   if(!confirm("Archive this product? Existing orders will remain intact."))return;
   setLoading(true);try{await updateDoc(doc(db,"products",id),{status:"archived",updatedAt:serverTimestamp()});setMsg("Product archived.")}catch(e){setMsg(errText(e))}finally{setLoading(false)}
 }
 async function login(){try{setMsg("");await signInWithPopup(auth,provider)}catch(e){setMsg(`Google sign-in failed: ${errText(e)}`)}}
 async function logout(){try{await signOut(auth)}catch(e){setMsg(`Sign-out failed: ${errText(e)}`)}}
 if(authLoading)return <div className="center"><div className="login"><div className="logo big">W</div><h1>WyCode Studio</h1><p>Checking secure session…</p></div></div>;if(!user)return <Login onLogin={login} msg={msg}/>;if(!allowed)return <Denied onLogout={logout} email={user.email}/>;
 const revenueByCurrency=orders.filter(x=>x.status==="paid").reduce((m,x)=>{const c=String(x.currency||"USD").toUpperCase();m[c]=(m[c]||0)+Number(x.amount||0);return m},{}),revenue=Object.entries(revenueByCurrency).map(([c,v])=>money(v,c)).join(" · ")||"—",list=products.filter(x=>(x.name||"").toLowerCase().includes(search.toLowerCase())||(x.category||"").toLowerCase().includes(search.toLowerCase()));
 return <div className="app"><aside><div className="brand"><div className="logo">W</div><b>WyCode<br/><small>Studio</small></b></div><nav>{[["dashboard","Dashboard",LayoutDashboard],["products","Products",Package],["orders","Orders",ShoppingBag],["customers","Customers",Users],["settings","Settings",SettingsIcon]].map(([id,t,I])=><button key={id} className={view===id?"active":""} onClick={()=>setView(id)}><I size={18}/>{t}</button>)}</nav><button className="logout" onClick={logout}><LogOut size={17}/>Sign out</button></aside><main><header><div><small>PRIVATE ADMIN</small><h1>{view[0].toUpperCase()+view.slice(1)}</h1></div><span>{user.email}</span></header>{msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}><X size={15}/></button></div>}{loading&&<div className="notice">Working…</div>}{view==="dashboard"&&<Dashboard p={products} o={orders} c={customers} r={revenue}/>} {view==="products"&&<><div className="toolbar"><div className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search products..."/></div><button className="primary" onClick={()=>{setEdit(null);setModal(true)}}><Plus size={17}/>Add product</button></div><Table p={list} edit={x=>{setEdit(x);setModal(true)}} remove={remove}/></>}{view==="orders"&&<Orders o={orders}/>} {view==="customers"&&<Customers c={customers}/>} {view==="settings"&&<Settings user={user}/>}</main>{modal&&<Modal p={edit||blank} close={()=>{setModal(false);setEdit(null)}} save={save}/>}</div>
}
function Dashboard({p,o,c,r}){return <><div className="cards"><Card t="Products" v={p.length}/><Card t="Paid orders" v={o.filter(x=>x.status==="paid").length}/><Card t="Customers" v={c.length}/><Card t="Revenue" v={money(r)}/></div><div className="grid"><section className="panel"><h2>Recent products</h2>{p.length?p.slice(0,6).map(x=><div className="row" key={x.id}><span><b>{x.name}</b><small>{x.category}</small></span><b>{money(x.price,x.currency)}</b></div>):<p>No products yet.</p>}</section><section className="panel"><h2>Recent orders</h2>{o.length?o.slice(0,6).map(x=><div className="row" key={x.id}><span><b>{x.productName||"Order"}</b><small>{x.email||"—"}</small></span><b>{x.status}</b></div>):<p>No orders yet.</p>}</section></div></>}
function Card({t,v}){return <div className="card"><small>{t}</small><strong>{v}</strong></div>}
function Table({p,edit,remove}){return <section className="panel table"><div className="tr head"><span>Product</span><span>Price</span><span>Status</span><span>Drive</span><span/></div>{p.length?p.map(x=><div className="tr" key={x.id}><span><b>{x.name}</b>{x.saleType==="special"&&<span className="pill special">★ Special</span>}<small>{x.slug}</small></span><span>{money(x.price,x.currency)}</span><span className="pill">{x.status}</span><span>{x.driveFileId?"✓":"!"}</span><span><button onClick={()=>edit(x)} aria-label={`Edit ${x.name}`}><Pencil size={15}/></button><button onClick={()=>remove(x.id)} aria-label={`Archive ${x.name}`} title="Archive product"><Trash2 size={15}/></button></span></div>):<p>No products match your search.</p>}</section>}
function Orders({o}){return <section className="panel table"><h2>Orders</h2>{o.length?o.map(x=><div className="tr" key={x.id}><span>{x.email||"—"}</span><span>{x.productName||"—"}</span><span>{money(x.amount)}</span><span className="pill">{x.status||"pending"}</span><span>{x.reference||"—"}</span></div>):<p>No orders yet.</p>}</section>}
function Customers({c}){return <section className="panel table"><h2>Customers</h2>{c.length?c.map(x=><div className="tr" key={x.id}><span>{x.email||"—"}</span><span>{x.name||"—"}</span><span>{x.orders||0}</span><span>Customer</span><span/></div>):<p>No customers yet.</p>}</section>}
function Settings({user}){return <section className="panel"><h2>Studio settings</h2><p>Admin: <b>{user.email}</b></p><div className="security"><LockKeyhole size={20}/><span>Keep Flutterwave secrets and Google Drive credentials server-side. This Studio stores only Drive file IDs.</span></div></section>}
function Modal({p,close,save}){
 const fields=["name","slug","description","price","version","demoUrl","coverUrl","features","requirements","license"];
 const[saleType,setSaleType]=useState(p.saleType==="special"?"special":"normal");
 const[driveFileId,setDriveFileId]=useState(p.driveFileId||"");
 const[fileName,setFileName]=useState("");
 const[uploading,setUploading]=useState(false);
 const[uploadMsg,setUploadMsg]=useState("");
 async function handleFile(e){
  const file=e.target.files?.[0];
  if(!file)return;
  setUploading(true);setUploadMsg(`Uploading ${file.name}…`);
  try{
   if(!auth.currentUser)throw new Error("Your session expired. Sign in again.");
   const idToken=await auth.currentUser.getIdToken();
   const dataBase64=await new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(",")[1]||"");
    r.onerror=()=>reject(new Error("Could not read the selected file"));
    r.readAsDataURL(file);
   });
   const res=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${idToken}`},body:JSON.stringify({filename:file.name,mimeType:file.type||"application/octet-stream",dataBase64})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(j.error||"Upload failed");
   setDriveFileId(j.fileId);setFileName(j.name||file.name);setUploadMsg(`Uploaded "${j.name||file.name}" ✓ — Drive file ID filled in below.`);
  }catch(err){setUploadMsg(err.message||"Upload failed")}
  finally{setUploading(false)}
 }
 return <div className="back"><form className="modal" onSubmit={save}><div className="modalhead"><h2>{p.id?"Edit product":"Add product"}</h2><button type="button" onClick={close} aria-label="Close"><X/></button></div><div className="form">{fields.map(k=><label key={k}>{k}<input name={k} defaultValue={p[k]??""} required={["name","description","price","version","currency"].includes(k)} type={k==="price"?"number":"text"} min={k==="price"?"0.01":undefined} step={k==="price"?"0.01":undefined}/></label>)}<label>Add file (uploads straight to Drive){fileName&&<small> — {fileName}</small>}<input type="file" onChange={handleFile} disabled={uploading}/></label>{uploadMsg&&<small className="notice" style={{gridColumn:"1 / -1"}}>{uploadMsg}</small>}<label>Google Drive file ID{driveFileId?"":" (or upload a file above)"}<input name="driveFileId" value={driveFileId} onChange={e=>setDriveFileId(e.target.value)} placeholder="Auto-filled after upload, or paste manually"/></label><label>Currency<select name="currency" defaultValue={p.currency||"USD"}><option>USD</option><option>NGN</option><option>GBP</option><option>EUR</option><option>CAD</option><option>AUD</option></select></label><label>Status<select name="status" defaultValue={p.status}><option>draft</option><option>published</option><option>archived</option></select></label><label>Category<select name="category" defaultValue={p.category}><option>Developer Tools</option><option>Productivity</option><option>Business</option><option>Creative</option><option>Utilities</option><option>Other</option></select></label><label>Sale type<select name="saleType" value={saleType} onChange={e=>setSaleType(e.target.value)}><option value="normal">Normal sale</option><option value="special">Special sale (rollercoaster carousel)</option></select></label>{saleType==="special"&&<label>Special sale banner image URL (recommended 520×280px, a big clear rectangle)<input name="bannerUrl" defaultValue={p.bannerUrl??""} placeholder="https://.../banner-520x280.png"/></label>}</div><button className="primary" type="submit" disabled={uploading}>{uploading?"Uploading file…":"Save product"}</button></form></div>}
function Login({onLogin,msg}){return <div className="center"><div className="login"><div className="logo big">W</div><h1>WyCode Studio</h1><p>Private control center for your source-code marketplace.</p>{msg&&<div className="notice">{msg}</div>}<button className="primary full" onClick={onLogin}>Continue with Google</button></div></div>}
function Denied({onLogout,email}){return <div className="center"><div className="login"><LockKeyhole/><h1>Access denied</h1><p>{email} is not authorized to access this private Studio.</p><button onClick={onLogout}>Sign out</button></div></div>}
createRoot(document.getElementById("root")).render(<App/>);
