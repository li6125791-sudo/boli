/* Boli 账本 — one script for both pages.
   index.html sets BOLI_MODE="public"  → client rate board + online order form
   admin.html sets BOLI_MODE="admin"   → password login, ledger, orders, rates
   All data lives in Supabase (see supabase/setup.sql); every change is saved immediately. */
(function(){
"use strict";
const MODE=window.BOLI_MODE||"public";
const CFG=window.BOLI_CONFIG||{};
const CURS=["CNY","USD","KZT"];
const SYM={CNY:"¥",USD:"$",KZT:"₸"};
const CNAME={CNY:"人民币",USD:"美元",KZT:"坚戈"};
const CATS={in:["货款","换汇收入","服务费","佣金","退款","其他收入"],out:["采购成本","运费物流","关税清关","佣金提成","工资","房租办公","银行手续费","其他支出"],fx:["换汇"]};
const DEFAULT_SETTINGS={rates:{CNY:7.10,KZT:505},updated:""};
const DEFAULT_PUB={company:CFG.company||"Boli",contact:"",notice:"",updated:"",published:false,
  pairs:[{b:"USD",q:"KZT",r:505,buy:"",sell:"",on:true},{b:"USD",q:"CNY",r:7.1,buy:"",sell:"",on:true},{b:"CNY",q:"KZT",r:71,buy:"",sell:"",on:true}]};
const ORDER_ST={new:"待确认",confirmed:"已确认",done:"已完成",cancelled:"已取消"};

let PUB=JSON.parse(JSON.stringify(DEFAULT_PUB));
const S={role:"loading",txns:new Map(),clients:new Map(),orders:new Map(),settings:{...DEFAULT_SETTINGS,rates:{...DEFAULT_SETTINGS.rates}},
  view:"dash",disp:"CNY",period:"month",from:"",to:"",lf:{q:"",type:"",cur:"",client:"",cat:"",status:""},of:"open",
  preview:false,lang:"zh",draft:null,email:"",save:{pending:0,last:0,error:false},loaded:false};
let sb=null;

/* ---------- utils ---------- */
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const isoD=x=>x.getFullYear()+"-"+pad(x.getMonth()+1)+"-"+pad(x.getDate());
const today=()=>isoD(new Date());
const num=v=>{const n=parseFloat(String(v??"").replace(/[,\s]/g,""));return isFinite(n)?n:0};
function fmt(n,cur,opts={}){
  const dec=opts.dec??(cur==="KZT"?0:2);
  const s=Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec});
  return (n<0?"−":(opts.plus&&n>0?"+":""))+(cur?SYM[cur]:"")+s;
}
function compact(n,cur){
  const a=Math.abs(n);let v=n,u="";
  if(a>=1e8){v=n/1e8;u="亿"}else if(a>=1e4){v=n/1e4;u="万"}
  return (n<0?"−":"")+SYM[cur]+Math.abs(v).toLocaleString("en-US",{maximumFractionDigits:u?2:0})+u;
}
const rfmt=(n,d=4)=>(+n).toLocaleString("en-US",{maximumFractionDigits:d});
function sig(n){const a=Math.abs(n);return rfmt(n,a>=100?2:a>=1?4:a>=0.01?5:7)}
function plain(n){const a=Math.abs(n);return String(+n.toFixed(a>=100?2:a>=1?4:a>=0.01?5:7))}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600)}
function newId(){return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,10))}
function fmtTime(iso){if(!iso)return "";const d=new Date(iso);return isoD(d)+" "+pad(d.getHours())+":"+pad(d.getMinutes())}
function nowStamp(){const d=new Date(),off=-d.getTimezoneOffset(),a=Math.abs(off);return isoD(d)+" "+pad(d.getHours())+":"+pad(d.getMinutes())+" (UTC"+(off>=0?"+":"-")+Math.floor(a/60)+(a%60?":"+pad(a%60):"")+")"}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function savePrefs(){lsSet("boli-prefs",JSON.stringify({disp:S.disp,period:S.period,view:S.view,lang:S.lang}))}
async function copyText(txt,el){try{await navigator.clipboard.writeText(txt);toast(S.role==="client"?L[S.lang].copied:"已复制")}catch(e){if(el){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}}}
const ICON={
  eye:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  out:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  dash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  orders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12l2 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/><path d="M4 6h16M9 11h6M9 15h4"/></svg>',
  ledger:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  clients:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/></svg>',
  rates:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>'
};
const VIEWS=[["dash","概览"],["orders","订单"],["ledger","流水"],["clients","客户"],["rates","汇率"]];

/* ---------- money math: a transaction's rates are "units per 1 USD" ---------- */
function rateOf(rates,c){return c==="USD"?1:num(rates&&rates[c])||num(S.settings.rates[c])||1}
function conv(amount,from,to,rates){return amount/rateOf(rates,from)*rateOf(rates,to)}
function crossRate(rates,a,b){return rateOf(rates,b)/rateOf(rates,a)}
function txValue(t,D){
  const r=t.rates,a=num(t.amount),f=num(t.fee);
  if(t.type==="in") return {inc:conv(a-f,t.currency,D,r),exp:0,fx:0};
  if(t.type==="out") return {inc:0,exp:conv(a+f,t.currency,D,r),fx:0};
  return {inc:0,exp:0,fx:conv(num(t.toAmount),t.toCurrency,D,r)-conv(a+f,t.currency,D,r)};
}
function pubRate1(ps,f,t){const d=ps.find(p=>p.b===f&&p.q===t);if(d)return num(d.r);const v=ps.find(p=>p.b===t&&p.q===f);return v?1/num(v.r):0}
function pubRate(P,from,to){
  const ps=(P.pairs||[]).filter(p=>p.on!==false&&num(p.r)>0),dir=pubRate1(ps,from,to);if(dir)return dir;
  for(const mid of CURS){if(mid===from||mid===to)continue;const a=pubRate1(ps,from,mid),b=pubRate1(ps,mid,to);if(a&&b)return a*b}
  return 0;
}

/* ---------- database (Supabase) ---------- */
function configured(){return !!(CFG.supabaseUrl&&CFG.supabaseAnonKey&&window.supabase&&window.supabase.createClient)}
async function q(p){const {data,error}=await p;if(error)throw error;return data}
async function fetchAll(table,cols){
  const out=[];for(let i=0;;i+=1000){const d=await q(sb.from(table).select(cols).range(i,i+999));out.push(...d);if(d.length<1000)break}return out;
}
function track(p){
  S.save.pending++;S.save.error=false;paintSave();
  return p.then(v=>{S.save.pending--;S.save.last=Date.now();paintSave();return v},e=>{S.save.pending--;S.save.error=true;paintSave();
    toast(/JWT|auth|session/i.test(e&&e.message||"")?"登录已过期，请重新登录":"没有保存成功，请检查网络。改动已保留在页面上，稍后会再试");console.error(e);retryLater();throw e});
}
let retryTimer=null;
function retryLater(){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(S.role==="owner")syncAll(true)},15000)}
function paintSave(){
  const el=$("#savestate");if(!el)return;
  if(S.save.pending){el.className="savestate busy";el.textContent="保存中…"}
  else if(S.save.error){el.className="savestate err";el.textContent="未保存"}
  else if(S.save.last){const d=new Date(S.save.last);el.className="savestate ok";el.textContent="已自动保存 "+pad(d.getHours())+":"+pad(d.getMinutes())}
  else{el.className="savestate ok";el.textContent="已连接"}
}
function strip(o){const c={...o};delete c.id;return c}
const stamp=()=>new Date().toISOString();
async function saveTxn(t){if(!t.id)t.id=newId();S.txns.set(t.id,t);render();await track(q(sb.from("txns").upsert({id:t.id,doc:strip(t),updated_at:stamp()})))}
async function delTxn(id){S.txns.delete(id);render();await track(q(sb.from("txns").delete().eq("id",id)))}
async function saveClient(c){if(!c.id)c.id=newId();S.clients.set(c.id,c);render();await track(q(sb.from("clients").upsert({id:c.id,doc:strip(c),updated_at:stamp()})))}
async function delClient(id){S.clients.delete(id);render();await track(q(sb.from("clients").delete().eq("id",id)))}
async function saveMany(table,rows){
  const map=table==="txns"?S.txns:S.clients;rows.forEach(r=>{if(!r.id)r.id=newId();map.set(r.id,r)});render();
  for(let i=0;i<rows.length;i+=500)await track(q(sb.from(table).upsert(rows.slice(i,i+500).map(r=>({id:r.id,doc:strip(r),updated_at:stamp()})))));
}
async function saveSetting(key,value){await track(q(sb.from("settings").upsert({key,value,updated_at:stamp()})))}
async function updateOrder(id,patch){const o=S.orders.get(id);if(o)S.orders.set(id,{...o,...patch});render();await track(q(sb.from("orders").update({...patch,updated_at:stamp()}).eq("id",id)))}

async function syncAll(quiet){
  try{
    const [t,c,s,o]=await Promise.all([fetchAll("txns","id,doc"),fetchAll("clients","id,doc"),q(sb.from("settings").select("key,value")),q(sb.from("orders").select("*").order("created_at",{ascending:false}).limit(1000))]);
    S.txns=new Map(t.map(r=>[r.id,{...(r.doc||{}),id:r.id}]));
    S.clients=new Map(c.map(r=>[r.id,{...(r.doc||{}),id:r.id}]));
    for(const r of s){if(r.key==="internal"&&r.value){S.settings={...DEFAULT_SETTINGS,...r.value,rates:{...DEFAULT_SETTINGS.rates,...(r.value.rates||{})}}}if(r.key==="public"&&r.value)PUB={...DEFAULT_PUB,...r.value}}
    S.orders=new Map(o.map(r=>[r.id,r]));
    S.loaded=true;if(S.save.error&&!S.save.pending){S.save.error=false}paintSave();render();
  }catch(e){console.error(e);if(!quiet)toast("暂时连不上数据库，请检查网络");S.loaded=true;render()}
}
let renderTimer=null;
function soon(){clearTimeout(renderTimer);renderTimer=setTimeout(render,120)}
function subscribe(){
  const ch=sb.channel("boli-admin");
  const apply=(map,p)=>{if(p.eventType==="DELETE"){map.delete(p.old.id)}else{map.set(p.new.id,{...(p.new.doc||{}),id:p.new.id})}soon()};
  ch.on("postgres_changes",{event:"*",schema:"public",table:"txns"},p=>apply(S.txns,p))
    .on("postgres_changes",{event:"*",schema:"public",table:"clients"},p=>apply(S.clients,p))
    .on("postgres_changes",{event:"*",schema:"public",table:"orders"},p=>{
      if(p.eventType==="DELETE"){S.orders.delete(p.old.id)}else{const isNew=p.eventType==="INSERT"&&!S.orders.has(p.new.id);S.orders.set(p.new.id,p.new);
        if(isNew){toast(`新订单：${p.new.name} ${fmt(num(p.new.amount),p.new.from_cur)} → ${p.new.to_cur}`);ping()}}
      soon()})
    .on("postgres_changes",{event:"*",schema:"public",table:"settings"},p=>{if(p.new&&p.new.key==="internal")S.settings={...DEFAULT_SETTINGS,...p.new.value};if(p.new&&p.new.key==="public")PUB={...DEFAULT_PUB,...p.new.value};soon()})
    .subscribe();
  // safety net: refresh when the page comes back and every 2 minutes
  let hiddenAt=0;
  document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(Date.now()-hiddenAt>30000)syncAll(true)});
  setInterval(()=>{if(!document.hidden&&!S.save.pending)refreshOrders()},120000);
}
async function refreshOrders(){try{const o=await q(sb.from("orders").select("*").order("created_at",{ascending:false}).limit(1000));
  const before=S.orders.size;S.orders=new Map(o.map(r=>[r.id,r]));if(S.orders.size>before){ping();toast("有新订单")}render()}catch(e){}}
function ping(){const n=[...S.orders.values()].filter(o=>o.status==="new").length;document.title=(n?`(${n}) `:"")+"Boli 账本"}

/* ---------- boot ---------- */
async function boot(){
  const hadPrefs=lsGet("boli-prefs")!==null;
  try{const o=JSON.parse(lsGet("boli-prefs")||"{}");if(CURS.includes(o.disp))S.disp=o.disp;if(o.period)S.period=o.period;if(o.view&&VIEWS.some(v=>v[0]===o.view))S.view=o.view;if(o.lang)S.lang=o.lang}catch(e){}
  if(!hadPrefs&&/^(ru|kk|ky|uz|be|uk)/i.test(navigator.language||""))S.lang="ru";
  const h=location.hash.slice(1);if(VIEWS.some(v=>v[0]===h))S.view=h;
  if(!configured()){S.role=MODE==="admin"?"setup":"client";render();return}
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  if(MODE==="public"){S.role="client";render();try{const d=await q(sb.from("settings").select("value").eq("key","public").maybeSingle());if(d&&d.value)PUB={...DEFAULT_PUB,...d.value}}catch(e){}render();refreshMyOrders();return}
  sb.auth.onAuthStateChange((ev)=>{if(ev==="SIGNED_OUT"&&S.role==="owner"){S.role="login";render()}});
  let session=null;try{session=(await sb.auth.getSession()).data.session}catch(e){}
  if(!session){S.role="login";render();return}
  await enterAdmin(session);
}
async function enterAdmin(session){
  S.email=session&&session.user&&session.user.email||"";
  let ok=false;try{ok=await q(sb.rpc("claim_admin"))}catch(e){console.error(e)}
  if(!ok){await sb.auth.signOut().catch(()=>{});S.role="login";S.loginErr="这个账号没有后台权限。";render();return}
  S.role="owner";S.loaded=false;render();
  await syncAll();ping();subscribe();
}

/* ---------- period & totals ---------- */
function periodRange(){
  const d=new Date(),y=d.getFullYear(),m=d.getMonth();
  switch(S.period){
    case "month":return [isoD(new Date(y,m,1)),isoD(new Date(y,m+1,0)),"本月"];
    case "lastmonth":return [isoD(new Date(y,m-1,1)),isoD(new Date(y,m,0)),"上月"];
    case "quarter":return [isoD(new Date(y,m-2,1)),isoD(new Date(y,m+1,0)),"近3个月"];
    case "year":return [y+"-01-01",y+"-12-31","今年"];
    case "custom":return [S.from||"0000-01-01",S.to||"9999-12-31",(S.from||"…")+" 至 "+(S.to||"…")];
    default:return ["0000-01-01","9999-12-31","全部"];
  }
}
const allTx=()=>[...S.txns.values()].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0));
function inPeriod(t){const [a,b]=periodRange();return t.date>=a&&t.date<=b}
function totals(list,D){
  let inc=0,exp=0,fx=0,recv=0,pay=0;
  for(const t of list){const v=txValue(t,D);inc+=v.inc;exp+=v.exp;fx+=v.fx;if(t.status==="pending"){if(t.type==="in")recv+=v.inc;if(t.type==="out")pay+=v.exp}}
  return {inc,exp,fx,profit:inc-exp+fx,recv,pay,count:list.length};
}
function balances(list){
  const b={CNY:0,USD:0,KZT:0};
  for(const t of list){if(t.status==="pending")continue;const a=num(t.amount),f=num(t.fee);
    if(t.type==="in")b[t.currency]+=a-f;else if(t.type==="out")b[t.currency]-=a+f;else{b[t.currency]-=a+f;b[t.toCurrency]+=num(t.toAmount)}}
  return b;
}
function clientNames(){
  const set=new Map();for(const c of S.clients.values())if(c.name)set.set(c.name,c);
  for(const t of S.txns.values())if(t.client&&!set.has(t.client))set.set(t.client,null);
  return [...set.keys()].sort((a,b)=>a.localeCompare(b,"zh"));
}
const openOrders=()=>[...S.orders.values()].filter(o=>o.status==="new"||o.status==="confirmed");

/* ---------- top-level render ---------- */
let shellRole=null;
function render(){
  const root=$("#root");
  if(S.role==="loading")return;
  if(S.role==="setup"){shellRole="setup";root.innerHTML=setupPage();return}
  if(S.role==="login"){shellRole="login";root.innerHTML=loginPage();bindLogin();return}
  if(S.role==="client"||S.preview){shellRole="client";root.innerHTML=publicPage(S.preview?previewPub():PUB,S.preview);bindPublic();return}
  if(shellRole!=="owner"||!$("#main")){shellRole="owner";root.innerHTML=ownerShell();bindShell();paintSave()}
  else{
    document.querySelectorAll(".tabs button,.bnav button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.v===S.view)));
    document.querySelectorAll("#dispCur button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.c===S.disp)));
    $("#period").value=S.period;$("#customRange").hidden=S.period!=="custom";
  }
  const n=openOrders().filter(o=>o.status==="new").length;
  document.querySelectorAll("[data-badge]").forEach(b=>{b.textContent=n;b.hidden=!n});
  const m=$("#main");
  if(!S.loaded){m.innerHTML='<div class="loading">正在打开账本…</div>';return}
  // keep focus & caret when a background refresh re-renders a form the owner is typing in
  const ae=document.activeElement,keep=ae&&ae.id&&m.contains(ae)?{id:ae.id,s:ae.selectionStart,e:ae.selectionEnd}:null;
  if(S.view==="rates")readDraft();
  let html="";
  if([...S.txns.values()].some(t=>t.demo))html+='<div class="banner"><b>示例数据</b>账本里有用来演示的示例记录。<button class="btn" id="clearDemo" type="button">删除所有示例记录</button></div>';
  if(n&&S.view!=="orders")html+=`<div class="banner info"><b>${n} 个新订单</b>客户在网站上提交了预约，等你确认。<button class="btn primary" type="button" data-goto="orders">去处理</button></div>`;
  if(S.txns.size===0&&(S.view==="dash"||S.view==="ledger"))html+=emptyState();
  else html+=({dash:viewDash,orders:viewOrders,ledger:viewLedger,clients:viewClients,rates:viewRates}[S.view])();
  m.innerHTML=html;
  bindView();
  if(keep){const el=document.getElementById(keep.id);if(el){el.focus();try{el.setSelectionRange(keep.s,keep.e)}catch(e){}}}
}

/* ---------- setup / login ---------- */
function setupPage(){
  return `<section class="pub-hero ornament auth-hero"><div class="wrap"><div class="brand"><span class="mark">B</span><div><b>Boli 账本</b><small>还差一步</small></div></div></div></section>
  <div class="auth-body"><div class="card" style="display:grid;gap:10px"><h2 style="margin:0">网站还没有连接数据库</h2>
  <p style="margin:0;color:var(--muted)">按仓库里 <b>SETUP.md</b> 的步骤：创建免费的 Supabase 项目 → 运行 <code>supabase/setup.sql</code> → 把 Project URL 和 anon key 填进 <code>config.js</code>。填好后刷新这个页面。</p></div></div>`;
}
function loginPage(){
  const em=lsGet("boli-email")||"";
  return `<section class="pub-hero ornament auth-hero"><div class="wrap"><div class="brand"><span class="mark">B</span><div><b>Boli 账本</b><small>后台登录</small></div></div></div></section>
  <div class="auth-body"><form class="card auth-card" id="loginForm" novalidate>
    <h2 style="margin:0">登录后台</h2>
    <div class="field"><label for="lg-email">邮箱</label><input id="lg-email" type="email" autocomplete="username" value="${esc(em)}" required></div>
    <div class="field"><label for="lg-pass">密码</label><input id="lg-pass" type="password" autocomplete="current-password" required></div>
    <div class="err" id="lg-err" ${S.loginErr?"":"hidden"}>${esc(S.loginErr||"")}</div>
    <button class="btn primary" type="submit" id="lg-btn" style="width:100%">登录</button>
    <div style="font-size:12px;color:var(--muted)">账号在 Supabase 控制台 → Authentication → Users 创建。第一个登录的账号会自动成为管理员。</div>
  </form></div>`;
}
function bindLogin(){
  const f=$("#loginForm");if(!f)return;
  (lsGet("boli-email")?$("#lg-pass"):$("#lg-email")).focus();
  f.onsubmit=async e=>{e.preventDefault();const email=$("#lg-email").value.trim(),password=$("#lg-pass").value,err=$("#lg-err"),btn=$("#lg-btn");
    if(!email||!password){err.textContent="请填写邮箱和密码";err.hidden=false;return}
    btn.disabled=true;btn.textContent="正在登录…";S.loginErr="";
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error){btn.disabled=false;btn.textContent="登录";err.textContent=/confirm/i.test(error.message)?"这个邮箱还没确认，请在 Supabase 里把用户设为已确认":"邮箱或密码不对";err.hidden=false;return}
    lsSet("boli-email",email);await enterAdmin(data.session);
  };
}

/* ---------- owner shell ---------- */
function ownerShell(){
  return `<header class="top"><div class="wrap top-in">
    <div class="brand"><span class="mark">B</span><div><b>Boli 账本</b><small><span id="savestate" class="savestate">已连接</span></small></div></div>
    <nav class="tabs" role="tablist">${VIEWS.map(([k,l])=>`<button type="button" role="tab" data-v="${k}" aria-selected="${S.view===k}">${l}${k==="orders"?'<span class="badge" data-badge hidden></span>':""}</button>`).join("")}</nav>
    <div class="ctrls">
      <select id="period" aria-label="统计期间">${[["month","本月"],["lastmonth","上月"],["quarter","近3个月"],["year","今年"],["all","全部"],["custom","自定义…"]].map(([k,l])=>`<option value="${k}"${S.period===k?" selected":""}>${l}</option>`).join("")}</select>
      <span class="ctrls" id="customRange" ${S.period==="custom"?"":"hidden"}><input type="date" id="from" aria-label="开始日期" value="${esc(S.from)}"><input type="date" id="to" aria-label="结束日期" value="${esc(S.to)}"></span>
      <div class="seg" id="dispCur" aria-label="折算币种">${CURS.map(c=>`<button type="button" data-c="${c}" aria-pressed="${S.disp===c}" title="按${CNAME[c]}折算">${SYM[c]}</button>`).join("")}</div>
      <button class="iconbtn" type="button" id="toPreview" title="客户看到的页面">${ICON.eye}<span class="hide-sm">客户视图</span></button>
      <button class="iconbtn" type="button" id="logout" title="退出登录 ${esc(S.email)}">${ICON.out}<span class="hide-sm">退出</span></button>
    </div>
  </div></header>
  <main class="wrap" id="main"></main>
  <button class="fab" id="fab" type="button"><span style="font-size:20px;line-height:1">＋</span>记一笔</button>
  <nav class="bnav">${VIEWS.map(([k,l])=>`<button type="button" data-v="${k}" aria-selected="${S.view===k}">${ICON[k]}${l}${k==="orders"?'<span class="badge" data-badge hidden></span>':""}</button>`).join("")}</nav>
  <div id="modal"></div>`;
}
function emptyState(){
  return `<div class="card emptystate"><span class="lock">${ICON.lock}只有你能看到账本</span><h3>账本还是空的</h3><p>点「记一笔」添加第一笔进账或出账。每笔都会记下当时的美元、坚戈、人民币汇率，自动折算利润，并马上保存到云端。</p>
  <div class="ctrls" style="justify-content:center"><button class="btn primary" type="button" data-act="new">记第一笔</button><button class="btn" type="button" id="loadDemo">载入示例数据看看</button></div></div>`;
}

/* ---------- dashboard ---------- */
function monthsSeries(D,count){
  const all=allTx(),[a,b]=periodRange();
  const endKey=b.startsWith("9999")?(all[0]?.date||today()).slice(0,7):b.slice(0,7);
  const startKey=a.startsWith("0000")?(all.length?all[all.length-1].date.slice(0,7):null):a.slice(0,7);
  const months=[];let [y,m]=endKey.split("-").map(Number);
  for(let i=0;i<count;i++){const k=y+"-"+pad(m);months.unshift(k);if(startKey&&k<=startKey&&months.length>=3)break;m--;if(m===0){m=12;y--}}
  while(months.length<3){let [yy,mm]=months[0].split("-").map(Number);mm--;if(!mm){mm=12;yy--}months.unshift(yy+"-"+pad(mm))}
  return months.map(k=>({k,...totals(all.filter(t=>(t.date||"").startsWith(k)),D)}));
}
function viewDash(){
  const D=S.disp,list=allTx().filter(inPeriod),T=totals(list,D),[,,plabel]=periodRange(),A=totals(allTx(),D);
  const margin=T.inc?T.profit/T.inc*100:0,bal=balances(allTx()),series=monthsSeries(D,12);
  let h=`<section class="hero ornament">
    <div><div class="eyebrow">净利润 · ${esc(plabel)} · ${CNAME[D]}</div><div class="big">${fmt(T.profit,D)}</div>
      <div class="sub"><span>利润率 <b>${margin.toFixed(1)}%</b></span>${T.fx?`<span>含换汇利润 <b>${fmt(T.fx,D,{plus:true})}</b></span>`:""}<span>${T.count} 笔记录</span></div>
      ${spark(series)}</div>
    <div class="hstats">
      <div class="hstat"><small>进账</small><div class="v in">${fmt(T.inc,D)}</div><div class="t">${list.filter(t=>t.type==="in").length} 笔</div></div>
      <div class="hstat"><small>出账</small><div class="v out">${fmt(T.exp,D)}</div><div class="t">${list.filter(t=>t.type==="out").length} 笔</div></div>
      <div class="hstat"><small>应收（未结）</small><div class="v">${fmt(A.recv,D)}</div><div class="t">全部期间</div></div>
      <div class="hstat"><small>应付（未结）</small><div class="v">${fmt(A.pay,D)}</div><div class="t">全部期间</div></div>
    </div></section>`;
  h+=`<section class="grid g-2"><div class="card"><h2>月度进出与利润 <span class="hint">按每笔当时汇率折算为${CNAME[D]}</span></h2>${monthChart(series,D)}</div>
    <div class="card"><h2>各币种余额 <span class="hint">已结清 · 原币</span></h2><div class="bal">${CURS.map(c=>`
      <div class="bal-row"><span class="sym c-${c}">${SYM[c]}</span><div><b>${CNAME[c]} ${c}</b><div class="nm">≈ ${fmt(conv(bal[c],c,D,S.settings.rates),D)}</div></div><span class="amt ${bal[c]<0?"neg":""}">${fmt(bal[c],c)}</span></div>`).join("")}
      <div class="bal-row total"><span class="sym">Σ</span><div><b>合计</b><div class="nm">按当前内部汇率折算</div></div><span class="amt">${fmt(CURS.reduce((s,c)=>s+conv(bal[c],c,D,S.settings.rates),0),D)}</span></div>
    </div></div></section>`;
  const byClient=new Map();
  for(const t of list){if(!t.client)continue;const v=txValue(t,D);const o=byClient.get(t.client)||0;byClient.set(t.client,o+v.inc-v.exp+v.fx)}
  const topC=[...byClient.entries()].map(([n,p])=>({n,p})).sort((a,b)=>b.p-a.p).slice(0,6),maxP=Math.max(1,...topC.map(x=>Math.abs(x.p)));
  const byCat=new Map();for(const t of list){if(t.type!=="out")continue;const k=t.category||"其他支出";byCat.set(k,(byCat.get(k)||0)+txValue(t,D).exp)}
  const cats=[...byCat.entries()].sort((a,b)=>b[1]-a[1]),maxC=Math.max(1,...cats.map(c=>c[1]));
  const byCur={CNY:0,USD:0,KZT:0};for(const t of list){if(t.type==="in")byCur[t.currency]+=txValue(t,D).inc}
  const curTot=Object.values(byCur).reduce((a,b)=>a+b,0)||1;
  h+=`<section class="grid g-3">
    <div class="card"><h2>客户 / 对方利润</h2>${topC.length?`<div class="hbar">${topC.map(x=>`<div class="hbar-row"><span class="lab" title="${esc(x.n)}">${esc(x.n)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${Math.abs(x.p)/maxP*100}%;background:${x.p>=0?"var(--in)":"var(--out)"}"></div></div><span class="num ${x.p<0?"neg":""}">${compact(x.p,D)}</span></div>`).join("")}</div>`:'<div class="empty-note">这个期间没有关联客户的记录</div>'}</div>
    <div class="card"><h2>支出构成</h2>${cats.length?`<div class="hbar">${cats.map(([k,v])=>`<div class="hbar-row"><span class="lab">${esc(k)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${v/maxC*100}%;background:var(--out)"></div></div><span class="num">${compact(v,D)}</span></div>`).join("")}</div>`:'<div class="empty-note">这个期间没有支出</div>'}</div>
    <div class="card"><h2>收入币种构成</h2><div class="hbar">${CURS.map(c=>`<div class="hbar-row"><span class="lab"><span class="chip c-${c}">${c}</span></span><div class="hbar-track"><div class="hbar-fill" style="width:${byCur[c]/curTot*100}%;background:var(--${c.toLowerCase()})"></div></div><span class="num">${(byCur[c]/curTot*100).toFixed(0)}%</span></div>`).join("")}</div></div>
  </section>`;
  h+=`<section class="card"><h2>最近记录 <button class="btn ghost" type="button" data-goto="ledger">查看全部 →</button></h2><div class="rows">${allTx().slice(0,6).map(rowHTML).join("")}</div></section>`;
  return h;
}
function spark(series){
  const W=300,H=56,vals=series.map(d=>d.profit),mx=Math.max(...vals,0),mn=Math.min(...vals,0),rng=(mx-mn)||1;
  const pts=vals.map((v,i)=>[i/(vals.length-1||1)*(W-8)+4,H-6-(v-mn)/rng*(H-14)]);
  const line=pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" "),last=pts[pts.length-1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="4,${H} ${line} ${W-4},${H}" fill="rgba(227,191,106,.16)"/><polyline points="${line}" fill="none" stroke="var(--gold-band)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--gold-band)"/></svg>`;
}
function monthChart(data,D){
  const W=640,H=250,pl=58,pr=12,pt=16,pb=30;
  const maxV=Math.max(1,...data.map(d=>Math.max(d.inc,d.exp))),minP=Math.min(0,...data.map(d=>d.profit));
  const top=niceCeil(Math.max(maxV,...data.map(d=>d.profit))),bot=minP<0?-niceCeil(-minP):0,y_=v=>pt+(top-v)/(top-bot)*(H-pt-pb),bw=(W-pl-pr)/data.length;
  let g="";
  for(let i=0;i<=4;i++){const v=bot+(top-bot)*i/4,yy=y_(v);g+=`<line x1="${pl}" x2="${W-pr}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${pl-8}" y="${yy+4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="JetBrains Mono,monospace">${esc(compact(v,D))}</text>`}
  const pts=[];
  data.forEach((d,i)=>{const x=pl+i*bw,w=Math.min(16,bw*.28);
    g+=`<rect x="${x+bw/2-w-1.5}" y="${y_(d.inc)}" width="${w}" height="${Math.max(0,y_(0)-y_(d.inc))}" rx="4" fill="var(--in)"><title>${d.k} 进账 ${fmt(d.inc,D)}</title></rect>`;
    g+=`<rect x="${x+bw/2+1.5}" y="${y_(d.exp)}" width="${w}" height="${Math.max(0,y_(0)-y_(d.exp))}" rx="4" fill="var(--out)" opacity=".8"><title>${d.k} 出账 ${fmt(d.exp,D)}</title></rect>`;
    g+=`<text x="${x+bw/2}" y="${H-10}" text-anchor="middle" font-size="10" fill="var(--muted)">${+d.k.slice(5)}月</text>`;
    pts.push([x+bw/2,y_(d.profit),d]);
  });
  g+=`<polyline points="${pts.map(p=>p[0]+","+p[1]).join(" ")}" fill="none" stroke="var(--gold)" stroke-width="2.4" stroke-linejoin="round"/>`;
  pts.forEach((p,i)=>{g+=`<circle cx="${p[0]}" cy="${p[1]}" r="${i===pts.length-1?5:3}" fill="var(--panel)" stroke="var(--gold)" stroke-width="2.2"><title>${p[2].k} 利润 ${fmt(p[2].profit,D)}</title></circle>`});
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="月度进出账与利润">${g}</svg></div><div class="legend"><span><i style="background:var(--in)"></i>进账</span><span><i style="background:var(--out)"></i>出账</span><span><i style="background:var(--gold);height:3px;vertical-align:3px"></i>净利润（含换汇）</span></div>`;
}
function niceCeil(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}

/* ---------- orders ---------- */
function orderProfit(o,D){
  // business receives amount(from_cur), pays to_amount(to_cur); value both at internal rates
  const r=S.settings.rates;return conv(num(o.amount),o.from_cur,D,r)-conv(num(o.to_amount),o.to_cur,D,r);
}
function viewOrders(){
  const D=S.disp,all=[...S.orders.values()].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  const groups={open:all.filter(o=>o.status==="new"||o.status==="confirmed"),done:all.filter(o=>o.status==="done"),cancelled:all.filter(o=>o.status==="cancelled"),all};
  const list=groups[S.of]||groups.open;
  const est=groups.open.reduce((s,o)=>s+orderProfit(o,D),0);
  return `<section class="card" style="display:grid;gap:14px">
    <h2>客户订单 <span class="hint">客户在网站首页提交的换汇预约，实时出现在这里</span></h2>
    <div class="ctrls"><div class="seg light">${[["open","待处理"],["done","已完成"],["cancelled","已取消"],["all","全部"]].map(([k,l])=>`<button type="button" data-of="${k}" aria-pressed="${S.of===k}">${l} ${groups[k].length}</button>`).join("")}</div>
      ${groups.open.length?`<span class="hint" style="font-size:12px;color:var(--muted)">待处理订单按内部汇率预计利润 <b class="num ${est<0?"neg":"pos"}">${fmt(est,D,{plus:true})}</b></span>`:""}</div>
    ${list.length?`<div class="orders">${list.map(o=>orderCard(o,D)).join("")}</div>`:`<div class="empty-note">${S.of==="open"?"现在没有待处理的订单。客户在网站首页提交预约后，会马上出现在这里。":"没有订单"}</div>`}
  </section>`;
}
function orderCard(o,D){
  const p=orderProfit(o,D),st=o.status;
  return `<div class="ocard st-${esc(st)}" data-oid="${esc(o.id)}">
    <div class="ohead"><span class="chip ost-${esc(st)}">${ORDER_ST[st]||esc(st)}</span><span class="num ocode">#${esc(o.code)}</span><span class="otime">${esc(fmtTime(o.created_at))}</span></div>
    <div class="owho"><b>${esc(o.name)}</b><button class="linkbtn num" type="button" data-copy="${esc(o.phone)}">${esc(o.phone)}</button></div>
    <div class="odeal"><div><small>客户付</small><b class="num">${fmt(num(o.amount),o.from_cur)}</b></div><span class="arrow">→</span><div><small>客户得</small><b class="num">${fmt(num(o.to_amount),o.to_cur)}</b></div></div>
    <div class="ometa"><span>汇率 1 ${esc(o.from_cur)} = ${sig(num(o.rate))} ${esc(o.to_cur)}</span>${o.method?`<span>${esc(o.method)}</span>`:""}${o.want_date?`<span>希望 ${esc(o.want_date)}</span>`:""}<span class="${p<0?"neg":"pos"}">预计利润 ${fmt(p,D,{plus:true})}</span></div>
    ${o.note?`<div class="onote">客户备注：${esc(o.note)}</div>`:""}
    <div class="field"><label for="an-${esc(o.id)}">给客户的回复（客户查订单时能看到）</label><input id="an-${esc(o.id)}" data-anote="${esc(o.id)}" value="${esc(o.admin_note||"")}" placeholder="例如：明天 10 点到店，带护照"></div>
    <div class="oacts">${st==="new"?`<button class="btn primary" type="button" data-oact="confirm">确认订单</button>`:""}
      ${st==="new"||st==="confirmed"?`<button class="btn gold" type="button" data-oact="book">完成并记账</button><button class="btn danger" type="button" data-oact="cancel">取消</button>`:""}
      ${st==="done"&&o.txn_id&&S.txns.has(o.txn_id)?`<button class="btn" type="button" data-oact="open">查看账目</button>`:""}
      ${st==="cancelled"?`<button class="btn" type="button" data-oact="reopen">恢复订单</button>`:""}</div>
  </div>`;
}
async function orderAction(id,act,btn){
  const o=S.orders.get(id);if(!o)return;
  if(act==="confirm")return updateOrder(id,{status:"confirmed"}).then(()=>toast("已确认，客户查订单时能看到")).catch(()=>{});
  if(act==="reopen")return updateOrder(id,{status:"new"}).catch(()=>{});
  if(act==="cancel"){if(!btn.classList.contains("armed")){btn.classList.add("armed");btn.textContent="确认取消？";return}return updateOrder(id,{status:"cancelled"}).then(()=>toast("订单已取消")).catch(()=>{})}
  if(act==="open")return openTx(o.txn_id);
  if(act==="book"){
    // exchange from the business side: we hand over to_amount(to_cur), we receive amount(from_cur)
    openTx(null,{type:"fx",date:today(),client:o.name,currency:o.to_cur,amount:String(o.to_amount),fee:"",toCurrency:o.from_cur,toAmount:String(o.amount),
      ref:"订单 "+o.code,note:[o.method,o.note].filter(Boolean).join(" · "),orderId:o.id},async txnId=>{
      await updateOrder(id,{status:"done",txn_id:txnId});
      if(!clientByName(o.name))await saveClient({name:o.name,contact:o.phone,country:"",note:"来自网站订单",createdAt:Date.now()});
      toast("已记账，订单完成");
    });
  }
}
function clientByName(n){return [...S.clients.values()].find(c=>c.name===n)}

/* ---------- ledger ---------- */
function rowHTML(t){
  const D=S.disp,v=txValue(t,D);let amt,cv,tag;
  if(t.type==="fx"){
    amt=`<span class="neg">${fmt(-num(t.amount),t.currency)}</span><small class="pos">${fmt(num(t.toAmount),t.toCurrency,{plus:true})}</small>`;
    cv=`<span class="${v.fx<0?"neg":"pos"}">${fmt(v.fx,D,{plus:true})}</span><small>换汇利润</small>`;tag='<span class="chip t-fx">换汇</span>';
  }else{
    const s=t.type==="in"?1:-1;amt=`<span class="${s>0?"pos":"neg"}">${fmt(s*num(t.amount),t.currency,{plus:true})}</span>${num(t.fee)?`<small>手续费 ${fmt(num(t.fee),t.currency)}</small>`:""}`;
    cv=fmt(s*(v.inc||v.exp),D,{plus:true});tag=`<span class="chip ${s>0?"t-in":"t-out"}">${s>0?"进账":"出账"}</span>`;
  }
  const rt=t.type==="fx"?`1${t.currency}=${sig(num(t.toAmount)/(num(t.amount)||1))}${t.toCurrency}`:t.currency==="USD"?`1$=¥${rfmt(rateOf(t.rates,"CNY"))} · ₸${rfmt(rateOf(t.rates,"KZT"),2)}`:`1$=${rfmt(rateOf(t.rates,t.currency),2)}${SYM[t.currency]}`;
  return `<div class="row" data-id="${esc(t.id)}" tabindex="0" role="button"><span class="d">${esc(t.date)}</span>
    <div class="who"><b>${esc(t.client||t.category||"未指定")}</b><span>${tag}<span class="chip c-${t.currency}">${t.currency}</span>${t.status==="pending"?`<span class="chip st-pending">${t.type==="in"?"待收":"待付"}</span>`:""}${esc(t.client?t.category||"":"")}${t.ref?" · "+esc(t.ref):""}${t.note?" · "+esc(t.note):""}<span class="num" style="opacity:.75">${esc(rt)}</span></span></div>
    <div class="amt">${amt}</div><div class="amt conv">${cv}</div></div>`;
}
function filteredLedger(){
  const f=S.lf,q=f.q.trim().toLowerCase();
  return allTx().filter(inPeriod).filter(t=>(!f.type||t.type===f.type)&&(!f.cur||t.currency===f.cur||t.toCurrency===f.cur)&&(!f.client||t.client===f.client)&&(!f.cat||t.category===f.cat)&&(!f.status||(t.status||"done")===f.status)
    &&(!q||[t.client,t.category,t.note,t.ref,t.amount,t.date].join(" ").toLowerCase().includes(q)));
}
function viewLedger(){
  const f=S.lf,D=S.disp,list=filteredLedger(),T=totals(list,D),[,,plabel]=periodRange();
  const cats=[...new Set([...CATS.in,...CATS.out,...allTx().map(t=>t.category).filter(Boolean)])];
  const orig={};for(const t of list){if(t.type==="fx")continue;orig[t.currency]=(orig[t.currency]||0)+(t.type==="in"?1:-1)*num(t.amount)}
  return `<section class="card" style="display:grid;gap:12px">
    <h2>流水账 · ${esc(plabel)} <span class="ctrls"><button class="btn" type="button" id="exportCsv">导出 Excel (CSV)</button><button class="btn" type="button" id="exportJson">备份 JSON</button><label class="btn" for="importJson">导入备份</label><input type="file" id="importJson" accept=".json,application/json" hidden></span></h2>
    <div class="filters">
      <input class="pill grow" id="f-q" placeholder="搜索客户、备注、单号、金额…" value="${esc(f.q)}">
      <select class="pill" id="f-type"><option value="">全部类型</option><option value="in">进账</option><option value="out">出账</option><option value="fx">换汇</option></select>
      <select class="pill" id="f-cur"><option value="">全部币种</option>${CURS.map(c=>`<option value="${c}">${c} ${CNAME[c]}</option>`).join("")}</select>
      <select class="pill" id="f-client"><option value="">全部客户</option>${clientNames().map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
      <select class="pill" id="f-cat"><option value="">全部类别</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
      <select class="pill" id="f-status"><option value="">全部状态</option><option value="done">已结清</option><option value="pending">未结清</option></select>
      ${Object.values(f).some(Boolean)?'<button class="btn ghost" type="button" id="f-reset">清除筛选</button>':""}
    </div>
    <div class="sumbar"><span>${T.count} 笔</span><span>进账 <b class="pos">${fmt(T.inc,D)}</b></span><span>出账 <b class="neg">${fmt(T.exp,D)}</b></span>${T.fx?`<span>换汇利润 <b>${fmt(T.fx,D,{plus:true})}</b></span>`:""}<span>净额 <b>${fmt(T.profit,D)}</b></span>
      ${Object.keys(orig).length?`<span>原币净额 ${Object.entries(orig).map(([c,v])=>`<b>${fmt(v,c,{plus:true})}</b>`).join(" · ")}</span>`:""}</div>
    <div class="rows">${list.length?list.map(rowHTML).join(""):'<div class="empty-note">没有符合条件的记录。试试切换上方的统计期间或清除筛选。</div>'}</div>
  </section>`;
}

/* ---------- clients ---------- */
function viewClients(){
  const D=S.disp,list=allTx().filter(inPeriod),[,,plabel]=periodRange();
  const stats=new Map(clientNames().map(n=>[n,{inc:0,exp:0,fx:0,n:0,recv:0,last:""}]));
  for(const t of list){if(!t.client)continue;const o=stats.get(t.client);if(!o)continue;const v=txValue(t,D);o.inc+=v.inc;o.exp+=v.exp;o.fx+=v.fx;o.n++;if(t.status==="pending"&&t.type==="in")o.recv+=v.inc;if(t.date>o.last)o.last=t.date}
  const arr=[...stats.entries()].map(([n,o])=>({name:n,...o,p:o.inc-o.exp+o.fx,rec:clientByName(n),orders:[...S.orders.values()].filter(x=>x.name===n).length})).sort((a,b)=>b.p-a.p||a.name.localeCompare(b.name,"zh"));
  return `<section class="card" style="display:grid;gap:14px"><h2>客户 · ${esc(plabel)} <button class="btn primary" type="button" id="newClient">＋ 新客户</button></h2>
  ${arr.length?`<div class="clients">${arr.map(c=>{const base=c.inc||Math.abs(c.fx)||0,mg=c.inc?Math.max(0,Math.min(100,c.p/c.inc*100)):(c.p>0?100:0);return `<div class="card client" data-client="${esc(c.name)}" tabindex="0" role="button">
    <div class="hd"><span class="avatar">${esc([...c.name][0]||"?")}</span><div style="min-width:0"><b>${esc(c.name)}</b><span>${esc([c.rec?.country,c.rec?.contact].filter(Boolean).join(" · ")||(c.n+" 笔"+(c.last?" · 最近 "+c.last:"")))}</span></div></div>
    <div class="figs"><div><small>进账</small><span class="num pos">${compact(c.inc,D)}</span></div><div><small>出账</small><span class="num neg">${compact(c.exp,D)}</span></div><div><small>利润</small><span class="num">${compact(c.p,D)}</span></div></div>
    <div class="margin-bar" title="利润率"><i style="width:${mg}%"></i></div>
    <div class="ft"><span>${c.inc?"利润率 "+(c.p/c.inc*100).toFixed(1)+"%":c.n+" 笔"}${c.orders?" · "+c.orders+" 个订单":""}</span>${c.recv?`<span class="chip st-pending">待收 ${fmt(c.recv,D)}</span>`:""}${c.rec?`<button class="btn ghost" type="button" data-editclient="${esc(c.rec.id)}" style="min-height:0;padding:0 4px">编辑</button>`:""}</div>
  </div>`}).join("")}</div>`:'<div class="empty-note">还没有客户。记账时填写客户名称，或客户在网站下单完成后，都会自动加入这里。</div>'}</section>`;
}

/* ---------- rates (internal + published) ---------- */
function getDraft(){if(!S.draft)S.draft=JSON.parse(JSON.stringify(PUB));return S.draft}
function internalPair(b,q){return crossRate(S.settings.rates,b,q)}
function spreadTxt(p){const ir=internalPair(p.b,p.q),sp=ir?(num(p.r)/ir-1)*100:0;return [sp,`比内部价 ${sp>=0?"+":""}${sp.toFixed(2)}%`]}
function viewRates(){
  const r=S.settings.rates,d=getDraft(),used=allTx().filter(t=>t.type!=="fx").slice(0,8);
  return `<section class="card" style="display:grid;gap:16px">
    <h2>对客户公布的汇率 <span class="hint">客户在网站首页只能看到这里发布的内容，下单也按这个汇率计算</span></h2>
    ${PUB.published?`<div class="banner info"><b>当前已发布</b>${esc(PUB.updated)} · ${(PUB.pairs||[]).filter(p=>p.on).map(p=>`1 ${p.b} = ${sig(num(p.r))} ${p.q}`).join(" · ")}</div>`:'<div class="banner"><b>还没发布</b>客户现在只会看到“汇率暂未公布”，也不能下单。填好下面的汇率后点「发布给客户」。</div>'}
    <div class="pubgrid">${d.pairs.map((p,i)=>{const [sp,txt]=spreadTxt(p);return `<div class="pubpair">
      <div class="top-row"><span><span class="chip c-${p.b}">${p.b}</span> → <span class="chip c-${p.q}">${p.q}</span></span><label class="toggle"><input type="checkbox" id="pon-${i}" data-pon="${i}" ${p.on?"checked":""}>给客户显示</label></div>
      <div class="field"><label for="pr-${i}">1 ${p.b} = ? ${p.q}（客户价）</label><input class="rate" id="pr-${i}" data-pr="${i}" inputmode="decimal" value="${esc(p.r)}"></div>
      <div class="fgrid"><div class="field"><label for="pb-${i}">买入价（可选）</label><input id="pb-${i}" inputmode="decimal" value="${esc(p.buy)}" placeholder="—"></div><div class="field"><label for="ps-${i}">卖出价（可选）</label><input id="ps-${i}" inputmode="decimal" value="${esc(p.sell)}" placeholder="—"></div></div>
      <div class="meta"><span class="lock">${ICON.lock}内部价 ${sig(internalPair(p.b,p.q))}</span><span class="${sp>=0?"spread-pos":"spread-neg"}" data-spread="${i}">${txt}</span></div>
    </div>`}).join("")}</div>
    <div class="fgrid">
      <div class="field"><label for="pub-company">公司名称（网站标题）</label><input id="pub-company" value="${esc(d.company)}"></div>
      <div class="field"><label for="pub-contact">联系方式（电话 / 微信 / WhatsApp）</label><input id="pub-contact" value="${esc(d.contact)}" placeholder="例如 +7 700 000 0000"></div>
      <div class="field full"><label for="pub-notice">给客户的说明（可选）</label><textarea id="pub-notice" rows="2" placeholder="例如：大额请提前电话确认 / Крупные суммы — по звонку">${esc(d.notice)}</textarea></div>
    </div>
    <div class="ctrls"><button class="btn gold" type="button" id="publishPub">发布给客户</button><button class="btn" type="button" id="useInternal">按内部汇率填入</button><button class="btn ghost" type="button" id="previewPub">${ICON.eye} 预览客户页面</button><a class="btn ghost" href="./" target="_blank" rel="noopener">打开客户网站 ↗</a></div>
    <div style="font-size:12px;color:var(--muted)">点「发布给客户」后，网站首页马上显示新汇率，客户下单也立即按新汇率计算。你的账本、客户、利润和内部汇率客户都看不到。</div>
  </section>
  <section class="card" style="display:grid;gap:14px"><h2>内部记账汇率 <span class="lock">${ICON.lock}只有你能看到</span></h2>
    <div style="font-size:12px;color:var(--muted);margin-top:-8px">新记账时自动带入，每笔仍可单独修改${S.settings.updated?" · 更新于 "+esc(S.settings.updated):""}</div>
    <div class="rate-big">
      <div class="rate-box"><label for="r-cny">1 美元 USD = ? 人民币 CNY</label><input id="r-cny" inputmode="decimal" value="${r.CNY}"></div>
      <div class="rate-box"><label for="r-kzt">1 美元 USD = ? 坚戈 KZT</label><input id="r-kzt" inputmode="decimal" value="${r.KZT}"></div>
      <div class="rate-box"><label>交叉汇率（自动计算）</label><div class="num" id="r-cross" style="font-size:15px;font-weight:600"></div></div>
    </div>
    <div><button class="btn primary" type="button" id="saveRates">保存内部汇率</button></div>
    <div class="table-wrap"><table class="matrix" id="matrix"></table></div>
  </section>
  <section class="grid g-2">
    <div class="card"><h2>汇率换算器 <span class="hint">按内部汇率</span></h2><div class="fgrid">
      <div class="field"><label for="cv-amt">金额</label><input id="cv-amt" class="big" inputmode="decimal" value="10000"></div>
      <div class="field"><label for="cv-from">币种</label><select id="cv-from">${CURS.map(c=>`<option value="${c}"${c==="USD"?" selected":""}>${c} ${CNAME[c]}</option>`).join("")}</select></div>
      <div class="full calc" id="cv-out"></div></div></div>
    <div class="card"><h2>最近记账使用的汇率</h2>${used.length?`<div class="table-wrap"><table class="matrix"><tr><th>日期</th><th>USD/CNY</th><th>USD/KZT</th><th>CNY/KZT</th></tr>${used.map(t=>`<tr><td>${esc(t.date)}</td><td>${rfmt(rateOf(t.rates,"CNY"))}</td><td>${rfmt(rateOf(t.rates,"KZT"),2)}</td><td>${rfmt(crossRate(t.rates,"CNY","KZT"),3)}</td></tr>`).join("")}</table></div>`:'<div class="empty-note">还没有记账记录</div>'}</div>
  </section>`;
}
function updateRatesView(){
  const r={CNY:num($("#r-cny").value)||1,KZT:num($("#r-kzt").value)||1};
  $("#r-cross").innerHTML=`1 CNY = ${rfmt(r.KZT/r.CNY,3)} KZT<br>100 KZT = ¥${rfmt(100*r.CNY/r.KZT,4)}`;
  $("#matrix").innerHTML=`<tr><th>1 单位 →</th>${CURS.map(c=>`<th>${c}</th>`).join("")}</tr>`+CURS.map(a=>`<tr><td><span class="chip c-${a}">${a}</span></td>${CURS.map(b=>`<td>${sig(crossRate(r,a,b))}</td>`).join("")}</tr>`).join("");
  const amt=num($("#cv-amt").value),from=$("#cv-from").value;
  $("#cv-out").innerHTML=CURS.filter(c=>c!==from).map(c=>`<div class="r hl"><span>${CNAME[c]} ${c}</span><b>${fmt(conv(amt,from,c,r),c)}</b></div>`).join("");
}
function readDraft(){
  if(!$("#pub-company"))return;const d=getDraft();
  d.pairs.forEach((p,i)=>{if(!$("#pr-"+i))return;p.r=$("#pr-"+i).value;p.buy=$("#pb-"+i).value;p.sell=$("#ps-"+i).value;p.on=$("#pon-"+i).checked});
  d.company=$("#pub-company").value.trim();d.contact=$("#pub-contact").value.trim();d.notice=$("#pub-notice").value.trim();
}
async function publishPub(btn){
  readDraft();const d=getDraft();
  const bad=d.pairs.find(p=>p.on&&!(num(p.r)>0));if(bad){toast(`请填写 ${bad.b}→${bad.q} 的汇率`);return}
  if(!d.pairs.some(p=>p.on)){toast("至少给客户显示一个汇率");return}
  const opt=v=>String(v??"").trim()===""?"":num(v)||"";
  const next={company:d.company||CFG.company||"Boli",contact:d.contact,notice:d.notice,updated:nowStamp(),published:true,
    pairs:d.pairs.map(p=>({b:p.b,q:p.q,r:num(p.r),buy:opt(p.buy),sell:opt(p.sell),on:!!p.on}))};
  btn.disabled=true;btn.textContent="正在发布…";
  try{await saveSetting("public",next);PUB=next;S.draft=null;render();toast("已发布，客户网站已更新")}
  catch(e){btn.disabled=false;btn.textContent="发布给客户"}
}

/* ---------- public site ---------- */
const L={
  zh:{title:"今日汇率",sub:"以下汇率由我们设定，可在线预约换汇",upd:"更新于",none:"汇率暂未公布，请联系我们获取报价。",buy:"买入",sell:"卖出",
    names:{USD:"美元",KZT:"坚戈",CNY:"人民币"},preview:"这是客户看到的页面（预览）",back:"返回后台",noconv:"暂无汇率",copy:"复制",copied:"已复制",contact:"联系我们",
    disc:"汇率仅供参考，以我们确认的订单为准。",order:"在线预约换汇",orderSub:"填好金额和联系方式，我们确认后会联系你。",pay:"我付",get:"我要换成",amount:"金额",youGet:"预计可得",rate:"汇率",
    name:"姓名",phone:"电话 / WhatsApp / 微信",method:"交割方式",methods:["到店现金","银行转账","其他"],date:"希望日期",note:"备注（可选）",submit:"提交预约",sending:"正在提交…",
    ok:"预约已提交",code:"订单号",keep:"请保存订单号，用它随时查询进度。我们会尽快联系你。",again:"再预约一笔",my:"我的订单",lookup:"查询订单",lookupPh:"输入订单号",check:"查询",notfound:"没有找到这个订单号",reply:"我们的回复",
    st:{new:"待确认",confirmed:"已确认",done:"已完成",cancelled:"已取消"},
    err:{missing_contact:"请填写姓名和电话",bad_amount:"请输入正确的金额",no_rate:"这个币种暂时不能预约，请直接联系我们",bad_currency:"请选择两种不同的币种",busy:"现在提交的人太多，请稍后再试",fail:"提交失败，请检查网络后重试，或直接联系我们"}},
  ru:{title:"Курс валют",sub:"Курсы установлены нами, обмен можно забронировать онлайн",upd:"Обновлено",none:"Курсы пока не опубликованы. Свяжитесь с нами для расчёта.",buy:"Покупка",sell:"Продажа",
    names:{USD:"Доллар США",KZT:"Тенге",CNY:"Юань"},preview:"Так страницу видят клиенты (предпросмотр)",back:"Вернуться",noconv:"Нет курса",copy:"Копировать",copied:"Скопировано",contact:"Контакты",
    disc:"Курс справочный, окончательный — в подтверждённой заявке.",order:"Заявка на обмен",orderSub:"Укажите сумму и контакты — мы подтвердим и свяжемся с вами.",pay:"Я отдаю",get:"Хочу получить",amount:"Сумма",youGet:"Вы получите примерно",rate:"Курс",
    name:"Имя",phone:"Телефон / WhatsApp",method:"Способ",methods:["Наличные в офисе","Банковский перевод","Другое"],date:"Желаемая дата",note:"Комментарий (необязательно)",submit:"Отправить заявку",sending:"Отправляем…",
    ok:"Заявка отправлена",code:"Номер заявки",keep:"Сохраните номер — по нему можно проверить статус. Мы скоро свяжемся с вами.",again:"Новая заявка",my:"Мои заявки",lookup:"Проверить заявку",lookupPh:"Номер заявки",check:"Проверить",notfound:"Заявка не найдена",reply:"Наш ответ",
    st:{new:"Ожидает подтверждения",confirmed:"Подтверждена",done:"Выполнена",cancelled:"Отменена"},
    err:{missing_contact:"Укажите имя и телефон",bad_amount:"Введите корректную сумму",no_rate:"Этот обмен сейчас недоступен, свяжитесь с нами",bad_currency:"Выберите две разные валюты",busy:"Слишком много заявок, попробуйте чуть позже",fail:"Не удалось отправить. Проверьте интернет или свяжитесь с нами"}}
};
const OF={from:"USD",to:"KZT",amount:"1000",name:"",phone:"",method:0,date:"",note:"",result:null,sending:false,err:""};
let MY=[];try{MY=JSON.parse(lsGet("boli-myorders")||"[]")}catch(e){MY=[]}
const myStatus=new Map();
const hasVal=v=>v!==""&&v!=null&&num(v)>0;
function previewPub(){const d=getDraft();return {...d,published:true,updated:d.updated||PUB.updated||nowStamp()}}
function publicPage(P,preview){
  const T=L[S.lang]||L.zh,ps=(P.pairs||[]).filter(p=>p.on!==false&&num(p.r)>0),ok=P.published&&ps.length;
  return `${preview?`<div class="preview-bar"><div class="wrap"><span>${esc(T.preview)}</span><button class="btn" type="button" id="exitPreview">${esc(T.back)}</button></div></div>`:""}
  <section class="pub-hero ornament"><div class="wrap">
    <div class="pub-head"><div class="brand"><span class="mark">${esc([...(P.company||"B")][0])}</span><div><b>${esc(P.company||"Boli")}</b><small>USD · KZT · CNY</small></div></div>
      <div class="langs">${[["zh","中文"],["ru","Рус"]].map(([k,l])=>`<button type="button" data-lang="${k}" aria-pressed="${S.lang===k}">${l}</button>`).join("")}</div></div>
    <div class="pub-title"><h1>${esc(T.title)}</h1><p>${esc(T.sub)}</p>${ok?`<span class="stamp"><i></i>${esc(T.upd)} ${esc(P.updated)}</span>`:""}</div>
  </div></section>
  <div class="pub-body">
    ${ok?`<div class="board">${ps.map(p=>`<div class="quote">
      <div class="pair"><span class="chip c-${p.b}">${p.b}</span><span class="arrow">→</span><span class="chip c-${p.q}">${p.q}</span><span style="color:var(--muted);font-weight:600;margin-left:auto;font-size:12px">${esc(T.names[p.b])} → ${esc(T.names[p.q])}</span></div>
      <div class="val">${sig(num(p.r))}<small>${SYM[p.q]}</small></div>
      <div class="inv">1 ${p.b} = ${sig(num(p.r))} ${p.q} · 1 ${p.q} = ${sig(1/num(p.r))} ${p.b}</div>
      ${hasVal(p.buy)||hasVal(p.sell)?`<div class="bs"><div><small>${esc(T.buy)}</small><b>${hasVal(p.buy)?sig(num(p.buy)):"—"}</b></div><div><small>${esc(T.sell)}</small><b>${hasVal(p.sell)?sig(num(p.sell)):"—"}</b></div></div>`:""}
    </div>`).join("")}</div>
    ${orderSection(P,T,preview)}`
    :`<div class="card emptystate"><h3>${esc(T.title)}</h3><p>${esc(T.none)}</p></div>`}
    ${myOrdersSection(T)}
    ${P.notice?`<div class="notice">${esc(P.notice)}</div>`:""}
    ${P.contact?`<div class="card contact"><div><div class="eyebrow">${esc(T.contact)}</div><div class="val" id="pc-contact">${esc(P.contact)}</div></div><button class="btn" type="button" id="copyContact">${esc(T.copy)}</button></div>`:""}
    <div class="disclaimer">${esc(T.disc)}</div>
  </div>`;
}
function orderSection(P,T,preview){
  if(OF.result){const R=OF.result;return `<div class="card okpanel"><div class="okmark">✓</div><h2 style="margin:0">${esc(T.ok)}</h2>
    <div class="okcode"><small>${esc(T.code)}</small><b class="num" id="okcode">${esc(R.code)}</b><button class="btn" type="button" id="copyCode">${esc(T.copy)}</button></div>
    <div class="conv-out"><div><span>${esc(T.pay)}</span><b>${fmt(num(OF.amount),OF.from)}</b></div><div><span>${esc(T.youGet)}</span><b>${fmt(num(R.to_amount),OF.to)}</b></div></div>
    <p style="margin:0;color:var(--muted)">${esc(T.keep)}</p><button class="btn" type="button" id="orderAgain">${esc(T.again)}</button></div>`}
  const opts=c=>CURS.map(x=>`<option value="${x}"${x===c?" selected":""}>${x} · ${esc(T.names[x])}</option>`).join("");
  return `<form class="card orderform" id="orderForm" novalidate>
    <div><h2 style="margin:0 0 4px">${esc(T.order)}</h2><p style="margin:0;color:var(--muted);font-size:13px">${esc(T.orderSub)}</p></div>
    <div class="swaprow">
      <div class="field"><label for="of-amount">${esc(T.pay)}</label><div class="conv-row"><input id="of-amount" inputmode="decimal" value="${esc(OF.amount)}" aria-label="${esc(T.amount)}"><select id="of-from" aria-label="${esc(T.pay)}">${opts(OF.from)}</select></div></div>
      <button class="swapbtn" type="button" id="of-swap" aria-label="swap">⇅</button>
      <div class="field"><label for="of-to">${esc(T.get)}</label><select id="of-to" class="bigsel">${opts(OF.to)}</select></div>
    </div>
    <div class="quotebox" id="of-quote"></div>
    <div class="fgrid">
      <div class="field"><label for="of-name">${esc(T.name)}</label><input id="of-name" autocomplete="name" value="${esc(OF.name)}"></div>
      <div class="field"><label for="of-phone">${esc(T.phone)}</label><input id="of-phone" autocomplete="tel" inputmode="tel" value="${esc(OF.phone)}"></div>
      <div class="field"><label for="of-method">${esc(T.method)}</label><select id="of-method">${T.methods.map((m,i)=>`<option value="${i}"${i===OF.method?" selected":""}>${esc(m)}</option>`).join("")}</select></div>
      <div class="field"><label for="of-date">${esc(T.date)}</label><input id="of-date" type="date" min="${today()}" value="${esc(OF.date)}"></div>
      <div class="field full"><label for="of-note">${esc(T.note)}</label><input id="of-note" value="${esc(OF.note)}"></div>
    </div>
    <div class="err" id="of-err" ${OF.err?"":"hidden"}>${esc(OF.err)}</div>
    <button class="btn gold big" type="submit" id="of-submit" ${OF.sending||preview?"disabled":""}>${esc(OF.sending?T.sending:T.submit)}</button>
  </form>`;
}
function myOrdersSection(T){
  return `<div class="card lookup"><h2 style="margin:0">${esc(MY.length?T.my:T.lookup)}</h2>
    ${MY.length?`<div class="mylist">${MY.slice(0,8).map(c=>{const s=myStatus.get(c);return `<div class="myrow"><span class="num">#${esc(c)}</span>${s?`<span>${fmt(num(s.amount),s.from_cur)} → ${fmt(num(s.to_amount),s.to_cur)}</span><span class="chip ost-${esc(s.status)}">${esc(T.st[s.status]||s.status)}</span>`:"<span></span><span></span>"}${s&&s.admin_note?`<div class="myreply">${esc(T.reply)}：${esc(s.admin_note)}</div>`:""}</div>`}).join("")}</div>`:""}
    <form class="conv-row" id="lookupForm"><input id="lk-code" placeholder="${esc(T.lookupPh)}" autocomplete="off" style="font-size:18px"><button class="btn" type="submit">${esc(T.check)}</button></form>
    <div id="lk-out"></div></div>`;
}
async function refreshMyOrders(){
  if(!sb||!MY.length)return;
  for(const c of MY.slice(0,8)){try{const d=await q(sb.rpc("order_status",{p_code:c}));if(d)myStatus.set(c,d)}catch(e){}}
  if(S.role==="client"&&!document.activeElement?.closest?.("form"))render();
}
function updateQuote(){
  const box=$("#of-quote");if(!box)return;const T=L[S.lang]||L.zh,P=S.preview?previewPub():PUB;
  const r=pubRate(P,OF.from,OF.to),amt=num(OF.amount);
  box.innerHTML=OF.from===OF.to?`<span>${esc(T.err.bad_currency)}</span>`:r?`<span>${esc(T.youGet)}</span><b class="num">${fmt(amt*r,OF.to)}</b><small>${esc(T.rate)} 1 ${OF.from} = ${sig(r)} ${OF.to}</small>`:`<span>${esc(T.noconv)}</span>`;
}
function readOF(){const g=id=>{const el=$("#"+id);return el?el.value:""};
  if(!$("#orderForm"))return;OF.amount=g("of-amount");OF.from=g("of-from");OF.to=g("of-to");OF.name=g("of-name");OF.phone=g("of-phone");OF.method=+g("of-method")||0;OF.date=g("of-date");OF.note=g("of-note")}
async function submitOrder(){
  readOF();const T=L[S.lang]||L.zh,err=$("#of-err");
  const fail=m=>{OF.err=m;err.textContent=m;err.hidden=false};
  if(OF.from===OF.to)return fail(T.err.bad_currency);
  if(!(num(OF.amount)>0))return fail(T.err.bad_amount);
  if(!OF.name.trim()||!OF.phone.trim())return fail(T.err.missing_contact);
  if(!sb)return fail(T.err.fail);
  OF.sending=true;OF.err="";render();
  try{
    const d=await q(sb.rpc("place_order",{p:{from:OF.from,to:OF.to,amount:num(OF.amount),name:OF.name.trim(),phone:OF.phone.trim(),method:T.methods[OF.method],date:OF.date,note:OF.note.trim(),lang:S.lang}}));
    OF.result=d;OF.sending=false;MY=[d.code,...MY.filter(c=>c!==d.code)].slice(0,20);lsSet("boli-myorders",JSON.stringify(MY));
    myStatus.set(d.code,{code:d.code,status:"new",from_cur:OF.from,to_cur:OF.to,amount:num(OF.amount),to_amount:d.to_amount});
    render();window.scrollTo({top:document.querySelector(".okpanel")?.offsetTop-20||0,behavior:"smooth"});
  }catch(e){OF.sending=false;const key=Object.keys(T.err).find(k=>(e.message||"").includes(k));OF.err=T.err[key]||T.err.fail;render()}
}
function bindPublic(){
  document.querySelectorAll("[data-lang]").forEach(b=>b.onclick=()=>{readOF();S.lang=b.dataset.lang;savePrefs();render()});
  const cc=$("#copyContact");if(cc)cc.onclick=()=>copyText((S.preview?getDraft():PUB).contact||"",$("#pc-contact"));
  const ex=$("#exitPreview");if(ex)ex.onclick=()=>{S.preview=false;shellRole=null;render();window.scrollTo({top:0})};
  const f=$("#orderForm");
  if(f){
    f.oninput=()=>{readOF();updateQuote()};f.onchange=()=>{readOF();updateQuote()};
    f.onsubmit=e=>{e.preventDefault();if(!S.preview)submitOrder()};
    $("#of-swap").onclick=()=>{readOF();[OF.from,OF.to]=[OF.to,OF.from];render()};
    updateQuote();
  }
  const cp=$("#copyCode");if(cp)cp.onclick=()=>copyText(OF.result.code,$("#okcode"));
  const ag=$("#orderAgain");if(ag)ag.onclick=()=>{OF.result=null;render()};
  const lf=$("#lookupForm");if(lf)lf.onsubmit=async e=>{e.preventDefault();const T=L[S.lang]||L.zh,code=$("#lk-code").value.trim().toUpperCase(),out=$("#lk-out");if(!code)return;
    if(!sb){out.textContent=T.notfound;return}
    try{const d=await q(sb.rpc("order_status",{p_code:code}));
      if(!d){out.innerHTML=`<div class="empty-note">${esc(T.notfound)}</div>`;return}
      myStatus.set(d.code,d);if(!MY.includes(d.code)){MY=[d.code,...MY].slice(0,20);lsSet("boli-myorders",JSON.stringify(MY))}render();
    }catch(err){out.innerHTML=`<div class="empty-note">${esc(T.err.fail)}</div>`}};
}

/* ---------- transaction form ---------- */
let F=null;
function openTx(id,preset,after){
  const t=id?{...S.txns.get(id)}:null;
  F=t?{...t,rates:{...S.settings.rates,...(t.rates||{})}}:{type:"in",date:today(),currency:"USD",amount:"",fee:"",rates:{...S.settings.rates},status:"done",client:"",category:"货款",toCurrency:"KZT",toAmount:"",ref:"",note:"",...(preset||{})};
  F._after=after||null;
  drawTx();
}
function drawTx(){
  const t=F,isFx=t.type==="fx",cats=CATS[t.type];
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="txForm" novalidate>
    <h3>${t.id?"编辑记录":t.orderId?"订单记账":"记一笔"}<button class="btn ghost" type="button" data-close aria-label="关闭">✕</button></h3>
    ${t.orderId?'<div class="banner info" style="margin:0"><b>换汇订单</b>我们付出客户要的币种，收进客户付的币种。可以按实际成交修改金额。</div>':""}
    <div class="typeseg">${[["in","进账"],["out","出账"],["fx","换汇"]].map(([k,l])=>`<button type="button" data-t="${k}" aria-pressed="${t.type===k}">${l}</button>`).join("")}</div>
    <div class="fgrid">
      <div class="field"><label for="tx-date">日期</label><input type="date" id="tx-date" value="${esc(t.date)}" required></div>
      <div class="field"><label for="tx-client">客户 / 对方</label><input id="tx-client" list="clientList" value="${esc(t.client)}" placeholder="例如 Astana Trade TOO"><datalist id="clientList">${clientNames().map(n=>`<option value="${esc(n)}"></option>`).join("")}</datalist></div>
      <div class="field full"><label>${isFx?"我们付出的币种":"币种"}</label><div class="curseg" id="tx-cur">${CURS.map(c=>`<button type="button" data-c="${c}" aria-pressed="${t.currency===c}"><span class="chip c-${c}">${c}</span> ${CNAME[c]}</button>`).join("")}</div></div>
      <div class="field"><label for="tx-amount">${isFx?"付出金额":"金额"}（${SYM[t.currency]}）</label><input id="tx-amount" class="big" inputmode="decimal" value="${esc(t.amount)}" placeholder="0" required></div>
      <div class="field"><label for="tx-fee">手续费（${SYM[t.currency]}，可选）</label><input id="tx-fee" inputmode="decimal" value="${esc(t.fee)}" placeholder="0"></div>
      ${isFx?`<div class="field full"><label>我们收进的币种</label><div class="curseg" id="tx-tocur">${CURS.map(c=>`<button type="button" data-c="${c}" aria-pressed="${t.toCurrency===c}" ${c===t.currency?"disabled":""}><span class="chip c-${c}">${c}</span> ${CNAME[c]}</button>`).join("")}</div></div>
      <div class="field full"><label for="tx-toAmount">收进金额（${SYM[t.toCurrency]}）</label><input id="tx-toAmount" class="big" inputmode="decimal" value="${esc(t.toAmount)}" placeholder="0"></div>`:""}
      <div class="field"><label for="tx-rcny">本笔汇率 1 USD = CNY</label><input id="tx-rcny" inputmode="decimal" value="${esc(t.rates.CNY)}"></div>
      <div class="field"><label for="tx-rkzt">本笔汇率 1 USD = KZT</label><input id="tx-rkzt" inputmode="decimal" value="${esc(t.rates.KZT)}"></div>
      <div class="full calc" id="tx-calc"></div>
      ${isFx?"":`<div class="field"><label for="tx-cat">类别</label><select id="tx-cat">${[...new Set([...cats,t.category].filter(Boolean))].map(c=>`<option${c===t.category?" selected":""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label for="tx-status">状态</label><select id="tx-status"><option value="done"${t.status!=="pending"?" selected":""}>已结清</option><option value="pending"${t.status==="pending"?" selected":""}>${t.type==="in"?"待收款（应收）":"待付款（应付）"}</option></select></div>`}
      <div class="field"><label for="tx-ref">单号 / 合同号</label><input id="tx-ref" value="${esc(t.ref)}" placeholder="可选"></div>
      <div class="field"><label for="tx-note">备注</label><input id="tx-note" value="${esc(t.note)}" placeholder="可选"></div>
    </div>
    <div class="err" id="tx-err" hidden></div>
    <div class="sheet-actions">${t.id?`<button class="btn danger" type="button" id="tx-del">删除</button><button class="btn" type="button" id="tx-dup">复制一笔</button>`:""}
      <div class="right"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">${t.id?"保存修改":"保存"}</button></div></div>
  </form></div>`;
  calcTx();
}
function readTx(){
  const g=id=>{const el=$("#"+id);return el?el.value:""};
  F.date=g("tx-date");F.client=g("tx-client").trim();F.amount=g("tx-amount");F.fee=g("tx-fee");F.rates={CNY:g("tx-rcny"),KZT:g("tx-rkzt")};
  if(F.type==="fx"){F.toAmount=g("tx-toAmount");F.category="换汇";F.status="done"}else{F.category=g("tx-cat");F.status=g("tx-status")}
  F.ref=g("tx-ref");F.note=g("tx-note");
}
function calcTx(){
  readTx();const t=F,r={CNY:num(t.rates.CNY),KZT:num(t.rates.KZT)},a=num(t.amount),f=num(t.fee);
  let h=`<div class="r"><span>交叉汇率</span><b>1 CNY = ${r.CNY?rfmt(r.KZT/r.CNY,3):"—"} KZT</b></div>`;
  if(t.type==="fx"){
    const got=num(t.toAmount),book=conv(a+f,t.currency,t.toCurrency,r),impl=got?a/got:0;
    h+=`<div class="r"><span>成交汇率</span><b>1 ${t.toCurrency} = ${sig(impl)} ${t.currency}</b></div><div class="r"><span>按本笔汇率，付出值</span><b>${fmt(book,t.toCurrency)}</b></div>
       <div class="r hl"><span>这笔换汇利润（${CNAME[S.disp]}）</span><b class="${got-book<0?"neg":"pos"}">${fmt(conv(got-book,t.toCurrency,S.disp,r),S.disp,{plus:true})}</b></div>`;
  }else{
    const net=t.type==="in"?a-f:a+f;
    h+=`<div class="r"><span>${t.type==="in"?"实收（扣手续费）":"实付（含手续费）"}</span><b>${fmt(net,t.currency)}</b></div>`+CURS.filter(c=>c!==t.currency).map(c=>`<div class="r hl"><span>折合${CNAME[c]}</span><b>${fmt(conv(net,t.currency,c,r),c)}</b></div>`).join("");
  }
  $("#tx-calc").innerHTML=h;
}
function validTx(){const t=F;
  if(!t.date)return "请选择日期";if(!(num(t.amount)>0))return "请输入大于 0 的金额";if(!(num(t.rates.CNY)>0)||!(num(t.rates.KZT)>0))return "汇率必须大于 0";
  if(t.type==="fx"){if(t.toCurrency===t.currency)return "两种币种不能相同";if(!(num(t.toAmount)>0))return "请输入收进金额"}return ""}
async function submitTx(){
  readTx();const e=validTx(),el=$("#tx-err");if(e){el.textContent=e;el.hidden=false;return}
  const t=F,after=t._after,out={date:t.date,type:t.type,client:t.client,currency:t.currency,amount:num(t.amount),fee:num(t.fee),rates:{CNY:num(t.rates.CNY),KZT:num(t.rates.KZT)},
    category:t.category||"",status:t.status||"done",ref:t.ref||"",note:t.note||"",createdAt:t.createdAt||Date.now(),updatedAt:Date.now()};
  if(t.type==="fx"){out.toCurrency=t.toCurrency;out.toAmount=num(t.toAmount)}
  if(t.orderId)out.orderId=t.orderId;if(t.demo)out.demo=true;if(t.id)out.id=t.id;const wasEdit=!!t.id;
  closeModal();
  try{if(out.client&&!clientByName(out.client)&&!after)await saveClient({name:out.client,contact:"",country:"",note:"",createdAt:Date.now()});
    await saveTxn(out);if(after)await after(out.id);else toast(wasEdit?"已保存修改":"已记账，已自动保存")}catch(err){}
}
function openClient(id){
  const c=id?S.clients.get(id):{name:"",contact:"",country:"",note:""},old=c.name;
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="clForm" novalidate>
    <h3>${id?"编辑客户":"新客户"}<button class="btn ghost" type="button" data-close aria-label="关闭">✕</button></h3>
    <div class="fgrid"><div class="field full"><label for="cl-name">客户名称</label><input id="cl-name" value="${esc(c.name)}" required></div>
    <div class="field"><label for="cl-country">国家 / 城市</label><input id="cl-country" value="${esc(c.country)}" placeholder="例如 阿拉木图"></div>
    <div class="field"><label for="cl-contact">联系方式</label><input id="cl-contact" value="${esc(c.contact)}" placeholder="电话 / 微信 / WhatsApp"></div>
    <div class="field full"><label for="cl-note">备注</label><input id="cl-note" value="${esc(c.note)}"></div></div>
    <div class="err" id="cl-err" hidden></div>
    <div class="sheet-actions">${id?'<button class="btn danger" type="button" id="cl-del">删除客户</button>':""}<div class="right"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">保存</button></div></div>
  </form></div>`;
  $("#clForm").onsubmit=async ev=>{ev.preventDefault();const name=$("#cl-name").value.trim();
    if(!name){const e=$("#cl-err");e.textContent="请填写客户名称";e.hidden=false;return}
    const rec={id:id||undefined,name,country:$("#cl-country").value.trim(),contact:$("#cl-contact").value.trim(),note:$("#cl-note").value.trim(),createdAt:c.createdAt||Date.now()};
    closeModal();
    try{await saveClient(rec);
      if(id&&old&&old!==name){const moved=[...S.txns.values()].filter(t=>t.client===old).map(t=>({...t,client:name}));if(moved.length)await saveMany("txns",moved)}
      toast("已保存客户")}catch(err){}};
  const del=$("#cl-del");if(del)del.onclick=async()=>{if(!del.classList.contains("armed")){del.classList.add("armed");del.textContent="确认删除？账目会保留";return}
    closeModal();try{await delClient(id);toast("已删除客户")}catch(err){}};
}
function closeModal(){const m=$("#modal");if(m)m.innerHTML="";F=null}

/* ---------- export / import ---------- */
function offer(filename,data,type){
  try{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type:type||"application/octet-stream"}));a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}catch(e){toast("无法导出")}
}
function csv(){
  const D=S.disp,head=["日期","类型","客户","类别","币种","金额","手续费","换入币种","换入金额","USD/CNY","USD/KZT","折合"+D,"状态","单号","备注"];
  const q=v=>{const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  return "﻿"+[head.join(","),...filteredLedger().map(t=>{const v=txValue(t,D);return [t.date,{in:"进账",out:"出账",fx:"换汇"}[t.type],t.client,t.category,t.currency,t.amount,t.fee||0,t.toCurrency||"",t.toAmount||"",rateOf(t.rates,"CNY"),rateOf(t.rates,"KZT"),(t.type==="in"?v.inc:t.type==="out"?-v.exp:v.fx).toFixed(2),t.status==="pending"?"未结清":"已结清",t.ref,t.note].map(q).join(",")})].join("\n");
}
async function importBackup(file){
  try{const o=JSON.parse(await file.text());
    const txs=(o.txns||[]).filter(t=>t&&t.date&&t.type),cls=(o.clients||[]).filter(c=>c&&c.name);
    if(!txs.length&&!cls.length){toast("这个文件里没有账本记录");return}
    if(txs.length)await saveMany("txns",txs);if(cls.length)await saveMany("clients",cls);
    if(o.settings&&o.settings.rates){S.settings={...S.settings,...o.settings};await saveSetting("internal",S.settings)}
    toast(`已导入 ${txs.length} 笔记录`);
  }catch(err){toast("这个文件不是 Boli 账本的备份")}
}

/* ---------- demo ---------- */
async function loadDemo(){
  const d=new Date(),ds=(back,day)=>isoD(new Date(d.getFullYear(),d.getMonth()-back,day)),R=(c,k)=>({CNY:c,KZT:k});
  const rows=[
    [5,3,"in","Astana Trade TOO","USD",42000,35,"货款",R(7.18,478)],[5,6,"out","义乌华东工厂","CNY",198000,0,"采购成本",R(7.18,478)],[5,15,"out","霍尔果斯通达物流","CNY",21500,0,"运费物流",R(7.18,480)],
    [4,4,"in","Almaty Market LLP","KZT",9800000,12000,"货款",R(7.16,486)],[4,9,"out","广州新兴电子","CNY",96000,0,"采购成本",R(7.16,488)],[4,20,"out","KZ 清关代理","KZT",620000,0,"关税清关",R(7.15,490)],
    [3,2,"in","Astana Trade TOO","USD",38500,30,"货款",R(7.13,495)],[3,12,"out","义乌华东工厂","CNY",172000,0,"采购成本",R(7.13,497)],[3,25,"out","办公室房租","KZT",450000,0,"房租办公",R(7.12,498)],
    [2,5,"in","Shymkent Build","USD",26800,25,"货款",R(7.12,500)],[2,11,"out","霍尔果斯通达物流","CNY",18800,0,"运费物流",R(7.12,502)],[2,18,"in","Almaty Market LLP","KZT",7600000,9500,"货款",R(7.11,503)],[2,22,"out","广州新兴电子","CNY",88000,0,"采购成本",R(7.11,503)],
    [1,3,"in","Astana Trade TOO","USD",45200,40,"货款",R(7.10,504)],[1,8,"out","义乌华东工厂","CNY",205000,0,"采购成本",R(7.10,505)],[1,16,"out","员工工资","KZT",1350000,0,"工资",R(7.10,506)],[1,26,"in","Shymkent Build","USD",19800,20,"佣金",R(7.09,507)],
    [0,2,"in","Almaty Market LLP","KZT",11200000,14000,"货款",R(7.09,508)],[0,5,"out","广州新兴电子","CNY",124000,0,"采购成本",R(7.09,508)],[0,9,"out","KZ 清关代理","KZT",780000,0,"关税清关",R(7.08,509)],
    [0,12,"in","Astana Trade TOO","USD",31000,0,"货款",R(7.08,510),"pending"],[0,14,"out","霍尔果斯通达物流","CNY",16200,0,"运费物流",R(7.08,510),"pending"]];
  const txs=rows.map((r,i)=>({date:ds(r[0],r[1]),type:r[2],client:r[3],currency:r[4],amount:r[5],fee:r[6],category:r[7],rates:r[8],status:r[9]||"done",ref:"示例-"+String(i+1).padStart(3,"0"),note:"",demo:true,createdAt:Date.now()+i}));
  txs.push({date:ds(1,12),type:"fx",client:"Halyk Bank",currency:"USD",amount:20000,fee:0,toCurrency:"KZT",toAmount:10180000,category:"换汇",rates:R(7.10,505),status:"done",ref:"示例-FX1",note:"美元换坚戈",demo:true,createdAt:Date.now()+99});
  txs.push({date:ds(0,10),type:"fx",client:"Halyk Bank",currency:"KZT",amount:7000000,fee:0,toCurrency:"CNY",toAmount:97500,category:"换汇",rates:R(7.08,509),status:"done",ref:"示例-FX2",note:"坚戈换人民币付工厂",demo:true,createdAt:Date.now()+100});
  const cls=[["Astana Trade TOO","阿斯塔纳"],["Almaty Market LLP","阿拉木图"],["Shymkent Build","奇姆肯特"],["义乌华东工厂","义乌"]].filter(([n])=>!clientByName(n)).map(([n,co])=>({name:n,country:co,contact:"",note:"示例客户",demo:true,createdAt:Date.now()}));
  S.period="all";savePrefs();
  try{await saveMany("txns",txs);if(cls.length)await saveMany("clients",cls);toast("已载入示例数据")}catch(e){}
}
async function clearDemo(btn){
  if(!btn.classList.contains("armed")){btn.classList.add("armed","danger");btn.textContent="确认删除示例记录";return}
  const t=[...S.txns.values()].filter(t=>t.demo).map(t=>t.id),c=[...S.clients.values()].filter(c=>c.demo).map(c=>c.id);
  t.forEach(id=>S.txns.delete(id));c.forEach(id=>S.clients.delete(id));render();
  try{if(t.length)await track(q(sb.from("txns").delete().in("id",t)));if(c.length)await track(q(sb.from("clients").delete().in("id",c)));toast("示例记录已删除")}catch(e){}
}

/* ---------- events ---------- */
function setView(v){readDraft();S.view=v;savePrefs();try{history.replaceState(null,"","#"+v)}catch(e){}render();window.scrollTo({top:0})}
function bindShell(){
  $("#fab").onclick=()=>openTx();
  $("#period").onchange=e=>{S.period=e.target.value;if(S.period==="custom"&&!S.from){S.from=new Date().getFullYear()+"-01-01";S.to=today();$("#from").value=S.from;$("#to").value=S.to}savePrefs();render()};
  $("#from").onchange=e=>{S.from=e.target.value;render()};$("#to").onchange=e=>{S.to=e.target.value;render()};
  $("#toPreview").onclick=()=>{readDraft();S.preview=true;render();window.scrollTo({top:0})};
  $("#logout").onclick=async()=>{await sb.auth.signOut().catch(()=>{});S.role="login";S.txns.clear();S.orders.clear();S.clients.clear();render()};
}
const noteTimers={};
function bindView(){
  const m=$("#main");
  m.querySelectorAll(".row[data-id]").forEach(r=>{r.onclick=()=>openTx(r.dataset.id);r.onkeydown=e=>{if(e.key==="Enter")openTx(r.dataset.id)}});
  m.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>setView(b.dataset.goto));
  m.querySelectorAll("[data-act=new]").forEach(b=>b.onclick=()=>openTx());
  const ld=$("#loadDemo");if(ld)ld.onclick=loadDemo;
  const cd=$("#clearDemo");if(cd)cd.onclick=()=>clearDemo(cd);
  if(S.view==="orders"){
    m.querySelectorAll("[data-of]").forEach(b=>b.onclick=()=>{S.of=b.dataset.of;render()});
    m.querySelectorAll("[data-oact]").forEach(b=>b.onclick=()=>orderAction(b.closest("[data-oid]").dataset.oid,b.dataset.oact,b));
    m.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>copyText(b.dataset.copy,b));
    m.querySelectorAll("[data-anote]").forEach(inp=>inp.oninput=()=>{const id=inp.dataset.anote;clearTimeout(noteTimers[id]);
      noteTimers[id]=setTimeout(()=>{const o=S.orders.get(id);if(o&&o.admin_note!==inp.value){o.admin_note=inp.value;track(q(sb.from("orders").update({admin_note:inp.value,updated_at:stamp()}).eq("id",id))).catch(()=>{})}},700)});
  }
  if(S.view==="ledger"&&$("#f-q")){
    for(const k of ["type","cur","client","cat","status"]){const el=$("#f-"+k);el.value=S.lf[k];el.onchange=()=>{S.lf[k]=el.value;render()}}
    let tm;$("#f-q").oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>{S.lf.q=e.target.value;render()},250)};
    const rs=$("#f-reset");if(rs)rs.onclick=()=>{S.lf={q:"",type:"",cur:"",client:"",cat:"",status:""};render()};
    $("#exportCsv").onclick=()=>offer("boli-流水-"+today()+".csv",csv(),"text/csv;charset=utf-8");
    $("#exportJson").onclick=()=>offer("boli-备份-"+today()+".json",JSON.stringify({txns:allTx(),clients:[...S.clients.values()],settings:S.settings},null,1),"application/json");
    $("#importJson").onchange=e=>{const f=e.target.files[0];if(f)importBackup(f);e.target.value=""};
  }
  if(S.view==="clients"){
    const nc=$("#newClient");if(nc)nc.onclick=()=>openClient();
    m.querySelectorAll("[data-editclient]").forEach(b=>b.onclick=e=>{e.stopPropagation();openClient(b.dataset.editclient)});
    m.querySelectorAll("[data-client]").forEach(c=>{const go=()=>{S.lf={q:"",type:"",cur:"",client:c.dataset.client,cat:"",status:""};setView("ledger")};c.onclick=go;c.onkeydown=e=>{if(e.key==="Enter")go()}});
  }
  if(S.view==="rates"&&$("#r-cny")){
    ["r-cny","r-kzt","cv-amt","cv-from"].forEach(id=>{$("#"+id).oninput=updateRatesView});updateRatesView();
    $("#saveRates").onclick=async()=>{const c=num($("#r-cny").value),k=num($("#r-kzt").value);if(!(c>0&&k>0)){toast("汇率必须大于 0");return}
      readDraft();S.settings={...S.settings,rates:{CNY:c,KZT:k},updated:today()};try{await saveSetting("internal",S.settings);render();toast("内部汇率已保存")}catch(e){}};
    m.querySelectorAll("[data-pr]").forEach(inp=>inp.oninput=()=>{const i=+inp.dataset.pr,p=getDraft().pairs[i];p.r=inp.value;const [sp,txt]=spreadTxt(p),el=m.querySelector(`[data-spread="${i}"]`);el.textContent=txt;el.className=sp>=0?"spread-pos":"spread-neg"});
    $("#useInternal").onclick=()=>{readDraft();getDraft().pairs.forEach(p=>p.r=plain(internalPair(p.b,p.q)));render()};
    $("#previewPub").onclick=()=>{readDraft();S.preview=true;render();window.scrollTo({top:0})};
    $("#publishPub").onclick=e=>publishPub(e.currentTarget);
  }
}
document.addEventListener("click",e=>{
  const tb=e.target.closest(".tabs button,.bnav button");if(tb&&tb.dataset.v){setView(tb.dataset.v);return}
  const dc=e.target.closest("#dispCur button");if(dc){readDraft();S.disp=dc.dataset.c;savePrefs();render();return}
  if(e.target.closest("[data-close]")||e.target.id==="scrim"){closeModal();return}
  if(!F)return;
  const ty=e.target.closest(".typeseg button");if(ty){readTx();F.type=ty.dataset.t;F.category=CATS[F.type][0];if(F.type==="fx"&&F.toCurrency===F.currency)F.toCurrency=CURS.find(c=>c!==F.currency);drawTx();return}
  const cu=e.target.closest("#tx-cur button");if(cu){readTx();F.currency=cu.dataset.c;if(F.toCurrency===F.currency)F.toCurrency=CURS.find(c=>c!==F.currency);drawTx();return}
  const tc=e.target.closest("#tx-tocur button");if(tc&&!tc.disabled){readTx();F.toCurrency=tc.dataset.c;drawTx();return}
  if(e.target.id==="tx-del"){const b=e.target;if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="再点一次确认删除";return}const id=F.id;closeModal();delTxn(id).then(()=>toast("已删除")).catch(()=>{});return}
  if(e.target.id==="tx-dup"){readTx();const c={...F};delete c.id;delete c.demo;delete c.orderId;c.date=today();c.createdAt=Date.now();c._after=null;F=c;drawTx();toast("已复制，修改后保存");return}
});
document.addEventListener("input",e=>{if(F&&e.target.closest("#txForm"))calcTx()});
document.addEventListener("submit",e=>{if(e.target.id==="txForm"){e.preventDefault();submitTx()}});
document.addEventListener("keydown",e=>{const m=$("#modal");if(e.key==="Escape"&&m&&m.innerHTML)closeModal()});
window.addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(S.role==="owner"&&!S.preview&&VIEWS.some(v=>v[0]===h)&&h!==S.view){S.view=h;render()}});
window.addEventListener("beforeunload",e=>{if(S.save.pending){e.preventDefault();e.returnValue=""}});

boot();
})();
