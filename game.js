import * as THREE from 'three';
const canvas=document.getElementById('game');
const isMobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)||navigator.maxTouchPoints>2;
let QUALITY=isMobile?'MED':'HIGH';
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
function applyQuality(){const pr=Math.min(devicePixelRatio||1,QUALITY==='LOW'?1:QUALITY==='MED'?1.5:2);renderer.setPixelRatio(pr);renderer.shadowMap.enabled=QUALITY!=='LOW';renderer.setSize(innerWidth,innerHeight);}
applyQuality();addEventListener('resize',()=>renderer.setSize(innerWidth,innerHeight));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x2a1a3a);scene.fog=new THREE.Fog(0x2a1a3a,40,220);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,0.1,600);
const hemi=new THREE.HemisphereLight(0xffc8a0,0x2a3a5a,1.05);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xff9a5a,1.6);sun.position.set(-60,80,30);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-120;sun.shadow.camera.right=120;sun.shadow.camera.top=120;sun.shadow.camera.bottom=-120;sun.shadow.camera.far=300;sun.shadow.bias=-0.0006;scene.add(sun);
scene.add(new THREE.AmbientLight(0x334,0.5));
const moon=new THREE.DirectionalLight(0x7bdff2,0.35);moon.position.set(60,90,-50);scene.add(moon);
// sky sun sprite
{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,4,64,64,64);gr.addColorStop(0,'#fff2cc');gr.addColorStop(0.35,'#ff9a5a');gr.addColorStop(1,'rgba(255,100,50,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);const t=new THREE.CanvasTexture(c);const m=new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false});const s=new THREE.Sprite(m);s.scale.set(90,90,1);s.position.set(-220,70,-200);scene.add(s);}
// ---------- helpers ----------
let seed=7;function rnd(){seed=(seed*16807)%2147483647;return (seed-1)/2147483646;}
const colliders=[];const occluders=[];const rooftops=[];const bushes=[];const hayStacks=[];const scrolls=[];const smokes=[];const projectiles=[];
const WORLD=170;
function mat(c,r=0.8,m=0){return new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});}
const M={wood:mat(0x6b4a2f),woodD:mat(0x3d2a1c),wall:mat(0xd9c9a8),wall2:mat(0xb8a888),roof:mat(0x2e3a4a,0.7),roofR:mat(0x8a2a2a,0.75),stone:mat(0x8d8d99),dark:mat(0x141824),leaf:mat(0x2d6a4f,0.9),bush:mat(0x1e4d3a,1),pink:mat(0xff9ec6,0.9),hay:mat(0xe9c46a,0.95),water:new THREE.MeshStandardMaterial({color:0x2a9d8f,roughness:0.2,metalness:0.3,transparent:true,opacity:0.85}),gold:new THREE.MeshStandardMaterial({color:0xffd166,emissive:0x7a4d00,emissiveIntensity:0.7,roughness:0.3})};
// ground
{const g=new THREE.Mesh(new THREE.PlaneGeometry(WORLD*2.6,WORLD*2.6,1,1),mat(0x3a5f3a,1));g.rotation.x=-Math.PI/2;g.receiveShadow=true;scene.add(g);
const pathM=mat(0x9a7f5a,1);
for(let i=0;i<5;i++){const p=new THREE.Mesh(new THREE.PlaneGeometry(12,340),pathM);p.rotation.x=-Math.PI/2;p.position.set(-60+i*30,0.02,0);p.receiveShadow=true;scene.add(p);}
for(let i=0;i<3;i++){const p=new THREE.Mesh(new THREE.PlaneGeometry(340,12),pathM);p.rotation.x=-Math.PI/2;p.position.set(0,0.021,-60+i*60);p.receiveShadow=true;scene.add(p);}
const pond=new THREE.Mesh(new THREE.CircleGeometry(22,24),M.water);pond.rotation.x=-Math.PI/2;pond.position.set(95,0.03,75);scene.add(pond);
const sand=new THREE.Mesh(new THREE.RingGeometry(22,27,24),mat(0xcbb27a,1));sand.rotation.x=-Math.PI/2;sand.position.set(95,0.025,75);scene.add(sand);}
// perimeter walls
function addWall(x,z,w,d,h=7){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),M.stone);m.position.set(x,h/2,z);m.castShadow=m.receiveShadow=true;scene.add(m);occluders.push(m);colliders.push({min:new THREE.Vector3(x-w/2,0,z-d/2),max:new THREE.Vector3(x+w/2,h,z+d/2),roofH:h,mesh:m});}
addWall(0,-WORLD,WORLD*2,4);addWall(0,WORLD,WORLD*2,4);addWall(-WORLD,0,4,WORLD*2);addWall(WORLD,0,4,WORLD*2);
// torii gate
function torii(x,z,ry=0,s=1){const g=new THREE.Group();const pm=mat(0xb3272b,0.6);const p1=new THREE.Mesh(new THREE.CylinderGeometry(0.6*s,0.7*s,9*s,10),pm);p1.position.set(-4*s,4.5*s,0);const p2=p1.clone();p2.position.x=4*s;const top=new THREE.Mesh(new THREE.BoxGeometry(12*s,1*s,1.4*s),pm);top.position.y=9*s;const top2=new THREE.Mesh(new THREE.BoxGeometry(10*s,0.7*s,1*s),M.dark);top2.position.y=8*s;g.add(p1,p2,top,top2);p1.castShadow=p2.castShadow=top.castShadow=true;g.position.set(x,0,z);g.rotation.y=ry;scene.add(g);}
torii(0,-WORLD+6);torii(0,WORLD-6,Math.PI);torii(-WORLD+6,0,Math.PI/2);torii(WORLD-6,0,-Math.PI/2);
// houses
const houseGeo=new THREE.BoxGeometry(1,1,1);
function addHouse(x,z,w,h,d,roofColor=0x2e3a4a){const g=new THREE.Group();
const base=new THREE.Mesh(houseGeo,M.wall);base.scale.set(w,h,d);base.position.set(x,h/2,z);base.castShadow=base.receiveShadow=true;scene.add(base);occluders.push(base);
const trim=new THREE.Mesh(houseGeo,M.woodD);trim.scale.set(w+0.6,0.7,d+0.6);trim.position.set(x,h-0.3,z);scene.add(trim);
const roofH=2.5+rnd()*1.5;
const roof=new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*0.78,roofH,4),mat(roofColor,0.75));roof.position.set(x,h+roofH/2,z);roof.rotation.y=Math.PI/4;roof.castShadow=true;scene.add(roof);
const winM=new THREE.MeshStandardMaterial({color:0x332200,emissive:0xffb703,emissiveIntensity:0.9});
for(const sx of[-1,1]){const win=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.2,w*0.3),1.2),winM);win.position.set(x+sx*w*0.28,h*0.55,z+d/2+0.06);scene.add(win);}
const door=new THREE.Mesh(new THREE.PlaneGeometry(1.6,2.6),M.dark);door.position.set(x,1.3,z+d/2+0.06);scene.add(door);
colliders.push({min:new THREE.Vector3(x-w/2,0,z-d/2),max:new THREE.Vector3(x+w/2,h,z+d/2),roofH:h,mesh:base,roof:roof});rooftops.push({x,z,w,d,h});return{x,z,w,d,h};}
const houseSpots=[[-40,-40],[ -10,-45],[22,-42],[55,-40],[-65,-10],[-35,-8],[-5,-10],[28,-8],[60,-10],[95,-15],[-70,25],[-38,28],[-8,28],[25,28],[60,30],[-55,60],[-20,62],[15,60],[55,62],[-45,-75],[-12,-75],[20,-75],[55,-75],[-85,-45],[85,25],[90,55],[30,95],[-5,95],[-45,95],[85,-70],[-90,60],[40,-110],[-30,-110],[0,-110],[70,95],[-90,-5],[110,0],[0,120]];
for(const [x,z] of houseSpots){const w=8+rnd()*6,h=5+rnd()*3.5,d=8+rnd()*6;addHouse(x+rnd()*4-2,z+rnd()*4-2,w,h,d,rnd()>0.75?0x8a2a2a:0x2e3a4a);}
// fortress (daimyo estate) NE
const fortress={x:110,z:-95};
{const cx=fortress.x,cz=fortress.z;addWall(cx-18,cz,4,44,9);addWall(cx+18,cz,4,44,9);addWall(cx,cz-22,40,4,9);addWall(cx,cz+22,40,4,9);
addHouse(cx,cz,16,8,14,0x8a2a2a);const tw=new THREE.Mesh(new THREE.BoxGeometry(8,22,8),M.stone);tw.position.set(cx,11,cz-14);tw.castShadow=true;scene.add(tw);occluders.push(tw);colliders.push({min:new THREE.Vector3(cx-4,0,cz-18),max:new THREE.Vector3(cx+4,22,cz-10),roofH:22,mesh:tw});rooftops.push({x:cx,z:cz-14,w:8,d:8,h:22});}
// pagoda viewpoint (sync) center-north
const pagoda={x:0,z:-105,h:34};
{const g=new THREE.Group();let y=0;for(let i=0;i<5;i++){const w=16-i*2.4;const tier=new THREE.Mesh(new THREE.BoxGeometry(w,4.5,w),i%2?M.wall:M.wall2);tier.position.set(pagoda.x,y+2.25,pagoda.z);tier.castShadow=tier.receiveShadow=true;scene.add(tier);occluders.push(tier);const roof=new THREE.Mesh(new THREE.ConeGeometry(w*0.95,2.6,4),M.roofR);roof.position.set(pagoda.x,y+5.8,pagoda.z);roof.rotation.y=Math.PI/4;roof.castShadow=true;scene.add(roof);y+=6.2;}
colliders.push({min:new THREE.Vector3(pagoda.x-8,0,pagoda.z-8),max:new THREE.Vector3(pagoda.x+8,30,pagoda.z+8),roofH:31,mesh:g,climbAssist:true});rooftops.push({x:pagoda.x,z:pagoda.z,w:7,d:7,h:31});}
// trees + bushes + hay + lanterns + scrolls
function tree(x,z,s=1){const t=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.4*s,0.6*s,4*s,7),M.woodD);trunk.position.y=2*s;trunk.castShadow=true;t.add(trunk);for(let i=0;i<3;i++){const c=new THREE.Mesh(new THREE.IcosahedronGeometry((1.8+rnd())*s,0),rnd()>0.4?M.pink:M.leaf);c.position.set((rnd()-0.5)*3*s,(4.5+rnd()*2)*s,(rnd()-0.5)*3*s);c.castShadow=true;t.add(c);}t.position.set(x,0,z);scene.add(t);colliders.push({min:new THREE.Vector3(x-0.6,0,z-0.6),max:new THREE.Vector3(x+0.6,4,z+0.6),roofH:4,mesh:trunk,noClimb:true});}
for(let i=0;i<38;i++){const tx=(rnd()-0.5)*300,tz=(rnd()-0.5)*300;if(Math.hypot(tx+45,tz-120)<18)continue;if(Math.hypot(tx-pagoda.x,tz-pagoda.z)<20)continue;tree(tx,tz,0.8+rnd()*0.9);}
function bush(x,z,r=2.6){const b=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),M.bush);b.position.set(x,r*0.7,z);b.castShadow=true;scene.add(b);bushes.push({x,z,r:r+0.8});}
[[-25,-30],[10,-25],[40,-20],[-55,15],[20,15],[-15,45],[50,45],[90,60],[-70,70],[110,-60],[95,-95],[0,-90],[30,80],[-90,-70]].forEach(([x,z])=>bush(x,z,2.4+rnd()));
function hay(x,z){const g=new THREE.Group();const cart=new THREE.Mesh(new THREE.BoxGeometry(4,1.2,3),M.wood);cart.position.y=0.8;cart.castShadow=true;g.add(cart);const h=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,3.4,12),M.hay);h.rotation.z=Math.PI/2;h.position.y=2;h.castShadow=true;g.add(h);g.position.set(x,0,z);scene.add(g);hayStacks.push({x,z});}
hay(-30,-18);hay(18,-32);hay(-48,38);hay(38,38);hay(0,70);hay(105,-80);hay(-60,-55);hay(70,10);
const lanternLights=[];
function lantern(x,z){const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,3,6),M.dark);pole.position.set(x,1.5,z);scene.add(pole);const orb=new THREE.Mesh(new THREE.SphereGeometry(0.55,10,8),new THREE.MeshStandardMaterial({color:0xffd166,emissive:0xff9a00,emissiveIntensity:1.6}));orb.position.set(x,3.2,z);scene.add(orb);if(lanternLights.length<4){const l=new THREE.PointLight(0xff9a3c,12,22);l.position.set(x,3.4,z);scene.add(l);lanternLights.push(l);}}
for(let i=0;i<20;i++)lantern((rnd()-0.5)*240,(rnd()-0.5)*240);
// cherry petals
let petals;{const N=400;const pos=new Float32Array(N*3);for(let i=0;i<N;i++){pos[i*3]=(rnd()-0.5)*320;pos[i*3+1]=rnd()*30;pos[i*3+2]=(rnd()-0.5)*320;}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));petals=new THREE.Points(g,new THREE.PointsMaterial({color:0xffb7d5,size:0.35,transparent:true,opacity:0.85}));scene.add(petals);}
// collectible scrolls
function addScroll(x,y,z){const m=new THREE.Mesh(new THREE.TorusGeometry(0.7,0.25,8,14),M.gold);m.position.set(x,y,z);scene.add(m);scrolls.push({mesh:m,taken:false,x,y,z});}
[[-25,2,-30],[10,2,-25],[60,2,30],[-55,2,60],[95,2,60],[0,33,-105],[110,9,-95],[30,2,80],[-90,2,-70],[70,2,10]].forEach(([x,y,z])=>addScroll(x,y,z));
// ---------- characters ----------
function makeNinja(accent=0xe63946){const g=new THREE.Group();const bodyM=mat(0x1b2436,0.8);const bm=new THREE.Mesh(new THREE.BoxGeometry(0.9,1.3,0.55),bodyM);bm.position.y=1.35;bm.castShadow=true;g.add(bm);
const head=new THREE.Mesh(new THREE.SphereGeometry(0.38,12,10),mat(0x222a3a));head.position.y=2.35;head.castShadow=true;g.add(head);
const mask=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.2,0.1),mat(0x0a0a0a));mask.position.set(0,2.32,0.34);g.add(mask);
const scarf=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.9,0.12),mat(accent,0.7));scarf.position.set(0,1.9,-0.35);g.add(scarf);
const l1=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.9,0.28),bodyM);l1.position.set(-0.25,0.45,0);g.add(l1);const l2=l1.clone();l2.position.x=0.25;g.add(l2);
const a1=new THREE.Mesh(new THREE.BoxGeometry(0.24,0.9,0.24),bodyM);a1.position.set(-0.6,1.4,0);g.add(a1);const a2=a1.clone();a2.position.x=0.6;g.add(a2);
const kat=new THREE.Mesh(new THREE.BoxGeometry(0.1,1.4,0.14),mat(0xc0c0c0,0.3,0.8));kat.position.set(0.3,1.7,-0.4);kat.rotation.z=0.5;g.add(kat);
g.userData={l1,l2,a1,a2,scarf,head};return g;}
function makeGuard(kind='sam'){const g=new THREE.Group();let armor=0x6a1b1b;if(kind==='captain')armor=0x4a2a7a;if(kind==='daimyo')armor=0xc9a227;
const bm=new THREE.Mesh(new THREE.BoxGeometry(1.05,1.4,0.65),mat(armor,0.6));bm.position.y=1.4;bm.castShadow=true;g.add(bm);
const head=new THREE.Mesh(new THREE.SphereGeometry(0.4,12,10),mat(0xd9b48f,0.8));head.position.y=2.45;head.castShadow=true;g.add(head);
const helm=new THREE.Mesh(new THREE.ConeGeometry(0.55,0.6,8),mat(0x222222,0.5));helm.position.y=2.85;g.add(helm);
const kat=new THREE.Mesh(new THREE.BoxGeometry(0.09,1.5,0.12),mat(0xdddddd,0.25,0.9));kat.position.set(0.7,1.4,0.2);kat.rotation.z=-0.4;g.add(kat);
const coneGeo=new THREE.CircleGeometry(26,20, -Math.PI/5.2, Math.PI/2.6);const cone=new THREE.Mesh(coneGeo,new THREE.MeshBasicMaterial({color:0xffd166,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false}));cone.rotation.x=-Math.PI/2;cone.position.y=0.15;g.add(cone);
const mark=document.createElement('div');// handled via sprite? use HTML projected separately - use simple sprite text
g.userData={cone,helm};return g;}
// player state
const player={mesh:makeNinja(),pos:new THREE.Vector3(-45,0,120),vel:new THREE.Vector3(),vy:0,yaw:Math.PI,grounded:true,climbing:false,onRoof:null,hp:100,stamina:100,crouch:false,sprint:false,hidden:false,inBush:false,speed:0,attackCd:0,hurtCd:0,airborne:0,shuriken:5,smoke:3,scrollN:0,synced:false,eagle:false,dead:false,lastCheck:new THREE.Vector3(-45,0,120),kills:0,alerts:0,undetectedKills:0,leaping:false,syncing:false};
player.mesh.position.copy(player.pos);scene.add(player.mesh);
// guards
const guards=[];
function patrolRoute(cx,cz,r,n=4){const a=[];for(let i=0;i<n;i++){const t=i/n*Math.PI*2;a.push(new THREE.Vector3(cx+Math.cos(t)*r,0,cz+Math.sin(t)*r));}return a;}
function addGuard(x,z,route,kind='sam',name=''){const m=makeGuard(kind);m.position.set(x,0,z);scene.add(m);const g={mesh:m,pos:m.position,yaw:rnd()*6.28,hp:kind==='daimyo'?5:kind==='captain'?3:2,kind,route,ri:0,state:'patrol',meter:0,lastSeen:new THREE.Vector3(),waitT:0,attackCd:0,speed:kind==='daimyo'?2.4:2,dead:false,alertPlayed:false,name:name||kind,pauseT:rnd()*2};guards.push(g);return g;}
// village patrols
addGuard(-30,-30,patrolRoute(-30,-30,18),'sam','Ashigaru');
addGuard(20,-30,patrolRoute(20,-30,20),'sam','Ashigaru');
addGuard(-45,40,patrolRoute(-45,40,20),'sam','Ashigaru');
addGuard(35,45,patrolRoute(35,45,22),'sam','Ashigaru');
addGuard(-60,-60,patrolRoute(-60,-60,20),'sam','Ashigaru');
addGuard(70,10,patrolRoute(70,10,24),'sam','Ashigaru');
addGuard(0,70,patrolRoute(0,70,26),'sam','Ashigaru');
addGuard(-15,-100,patrolRoute(-15,-100,22),'sam','Ashigaru');
// captains + daimyo
const captains=[
addGuard(55,-40,patrolRoute(55,-40,16),'captain','Captain Riku'),
addGuard(-38,28,patrolRoute(-38,28,16),'captain','Captain Sora'),
addGuard(55,62,patrolRoute(55,62,18),'captain','Captain Jin'),
addGuard(-90,60,patrolRoute(-90,60,18),'captain','Captain Kaze')];
const daimyo=addGuard(fortress.x,fortress.z,[new THREE.Vector3(fortress.x-8,0,fortress.z-8),new THREE.Vector3(fortress.x+8,0,fortress.z-8),new THREE.Vector3(fortress.x+8,0,fortress.z+8),new THREE.Vector3(fortress.x-8,0,fortress.z+8)],'daimyo','KURO DAIMYO');
daimyo.mesh.scale.set(1.18,1.18,1.18);
// ---------- input ----------
const keys={};addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();if(e.code==='KeyE')tryAct();if(e.code==='KeyC')toggleCrouch();if(e.code==='KeyQ')whistle();if(e.code==='KeyF')throwShuriken();if(e.code==='KeyG')throwSmoke();if(e.code==='KeyV')toggleEagle();if(e.code==='Escape')togglePause();});
addEventListener('keyup',e=>keys[e.code]=false);
let camYaw=Math.PI,camPitch=0.32,camDist=7;
let dragging=false,lx=0,ly=0;
canvas.addEventListener('mousedown',e=>{dragging=true;lx=e.clientX;ly=e.clientY;ensureAudio();});
addEventListener('mouseup',()=>dragging=false);
addEventListener('mousemove',e=>{if(!dragging||!started)return;camYaw-=(e.clientX-lx)*0.005;camPitch+=(e.clientY-ly)*0.003;camPitch=Math.max(-0.2,Math.min(1.1,camPitch));lx=e.clientX;ly=e.clientY;});
canvas.addEventListener('wheel',e=>{camDist=Math.max(4,Math.min(12,camDist+e.deltaY*0.01));},{passive:true});
// joystick
const joy=document.getElementById('joy'),knob=document.getElementById('knob');let joyV={x:0,y:0},joyId=null;
function joyPos(e){const r=joy.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=(e.clientX-cx)/(r.width/2),dy=(e.clientY-cy)/(r.height/2);const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l;}return{x:dx,y:dy};}
joy.addEventListener('touchstart',e=>{e.preventDefault();joyId=e.changedTouches[0].identifier;ensureAudio();},{passive:false});
joy.addEventListener('pointerdown',e=>{joyId='m';});
addEventListener('touchmove',e=>{for(const t of e.changedTouches){if(t.identifier===joyId){const v=joyPos(t);joyV=v;knob.style.transform=`translate(calc(-50% + ${v.x*36}px),calc(-50% + ${v.y*36}px))`;}}},{passive:true});
addEventListener('pointermove',e=>{if(joyId==='m'&&e.buttons){const v=joyPos(e);joyV=v;knob.style.transform=`translate(calc(-50% + ${v.x*36}px),calc(-50% + ${v.y*36}px))`;}});
addEventListener('touchend',e=>{for(const t of e.changedTouches)if(t.identifier===joyId){joyId=null;joyV={x:0,y:0};knob.style.transform='translate(-50%,-50%)';}});
addEventListener('pointerup',()=>{if(joyId==='m'){joyId=null;joyV={x:0,y:0};knob.style.transform='translate(-50%,-50%)';}});
// lookpad
const look=document.getElementById('lookpad');let lookId=null,llx=0,lly=0;
look.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];lookId=t.identifier;llx=t.clientX;lly=t.clientY;ensureAudio();},{passive:false});
addEventListener('touchmove',e=>{for(const t of e.changedTouches)if(t.identifier===lookId){camYaw-=(t.clientX-llx)*0.007;camPitch+=(t.clientY-lly)*0.005;camPitch=Math.max(-0.2,Math.min(1.1,camPitch));llx=t.clientX;lly=t.clientY;}},{passive:true});
addEventListener('touchend',e=>{for(const t of e.changedTouches)if(t.identifier===lookId)lookId=null;});
function btn(id,fn){const el=document.getElementById(id);el.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();fn();},{passive:false});el.addEventListener('mousedown',e=>{e.preventDefault();fn();});}
btn('btnAct',()=>tryAct());btn('btnJump',()=>doJump());btn('btnCrouch',()=>toggleCrouch());btn('btnWhistle',()=>whistle());btn('btnShuriken',()=>throwShuriken());btn('btnSmoke',()=>throwSmoke());btn('btnEagle',()=>toggleEagle());btn('btnSync',()=>trySync());btn('btnPause',()=>togglePause());
// ---------- audio ----------
let AC=null;function ensureAudio(){if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch{}}
function tone(f=440,d=0.15,type='sine',v=0.15,slide=0){if(!AC)return;const o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.value=f;if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f+slide),AC.currentTime+d);g.gain.value=v;g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+d);o.connect(g).connect(AC.destination);o.start();o.stop(AC.currentTime+d);}
const sfx={step:()=>tone(180+Math.random()*60,0.06,'triangle',0.05),jump:()=>tone(300,0.18,'sine',0.12,300),kill:()=>{tone(900,0.12,'sawtooth',0.14,-700);setTimeout(()=>tone(150,0.25,'sine',0.16,-80),60);},alert:()=>{tone(660,0.14,'square',0.12);setTimeout(()=>tone(880,0.2,'square',0.12),140);},sus:()=>tone(520,0.18,'sine',0.1,120),whistle:()=>tone(1200,0.35,'sine',0.14,600),throw:()=>tone(500,0.12,'sawtooth',0.08,400),smoke:()=>tone(200,0.5,'sine',0.12,-120),sync:()=>{[523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,0.3,'sine',0.14),i*140));},scroll:()=>tone(880,0.2,'triangle',0.12,220),hurt:()=>tone(140,0.3,'sawtooth',0.18,-60),leap:()=>tone(400,0.8,'sine',0.14,500)};
// ---------- UI ----------
const $=id=>document.getElementById(id);
const toastEl=$('toast'),promptEl=$('prompt'),objEl=$('objectives'),killfeed=$('killfeed');
let toastT=null;function toast(t,ms=2200){toastEl.textContent=t;toastEl.style.opacity=1;clearTimeout(toastT);toastT=setTimeout(()=>toastEl.style.opacity=0,ms);}
function feed(t){const d=document.createElement('div');d.className='killmsg';d.textContent=t;killfeed.appendChild(d);setTimeout(()=>d.remove(),4200);while(killfeed.children.length>4)killfeed.firstChild.remove();}
function updateObjectives(){const alive=guards.filter(g=>!g.dead&&(g.kind==='captain'||g.kind==='daimyo'));const tAlive=alive.length;const scTaken=scrolls.filter(s=>s.taken).length;
objEl.innerHTML=`<b>☠️ ASSASSINATE</b> ${5-tAlive}/5 warlords<br>${alive.map(g=>`${g.dead?'✅':'🔻'} ${g.name}`).join('<br>')}<br><b>📜 SCROLLS</b> ${scTaken}/${scrolls.length}<br>${player.synced?'🦅 <b>MAP SYNCED</b>':'🦅 Reach the <b>pagoda</b> & SYNC'}${player.inBush?' • <b>🌿 HIDDEN</b>':''}`;}
// minimap
const mm=$('minimap').getContext('2d');
function drawMinimap(){const S=256,C=S/2,scale=S/(WORLD*2.3);mm.clearRect(0,0,S,S);mm.fillStyle='rgba(10,18,14,0.9)';mm.beginPath();mm.arc(C,C,C-2,0,7);mm.fill();
mm.save();mm.beginPath();mm.arc(C,C,C-2,0,7);mm.clip();
mm.fillStyle='#3a5f4a';mm.fillRect(0,0,S,S);
mm.fillStyle='#9a7f5a';for(let i=0;i<5;i++){mm.fillRect(C+(-60+i*30)*scale-3,0,6,S);} 
mm.fillStyle='#5a6a7a';for(const r of rooftops){mm.fillRect(C+(r.x-r.w/2)*scale,C+(r.z-r.d/2)*scale,r.w*scale,r.d*scale);}
mm.fillStyle='#2a9d8f';mm.beginPath();mm.arc(C+95*scale,C+75*scale,22*scale,0,7);mm.fill();
for(const s of scrolls)if(!s.taken){mm.fillStyle='#ffd166';mm.beginPath();mm.arc(C+s.x*scale,C+s.z*scale,3,0,7);mm.fill();}
for(const h of hayStacks){mm.fillStyle='#e9c46a';mm.fillRect(C+h.x*scale-3,C+h.z*scale-3,6,6);}
mm.fillStyle='#ff5a5a';mm.font='bold 13px system-ui';mm.fillText('🦅',C+pagoda.x*scale-7,C+pagoda.z*scale+5);
const showAll=player.synced||player.eagle;
for(const g of guards){if(g.dead)continue;const dx=g.pos.x-player.pos.x,dz=g.pos.z-player.pos.z;const d=Math.hypot(dx,dz);if(!showAll&&d>55)continue;mm.fillStyle=g.state==='chase'?'#ff2222':g.state==='suspicious'?'#ffd166':g.kind==='daimyo'?'#ff00ff':g.kind==='captain'?'#c77dff':'#ffffff';mm.beginPath();mm.arc(C+g.pos.x*scale,C+g.pos.z*scale,g.kind==='daimyo'?5:3.5,0,7);mm.fill();}
mm.fillStyle='#7bdff2';mm.save();mm.translate(C+player.pos.x*scale,C+player.pos.z*scale);mm.rotate(-player.yaw);mm.beginPath();mm.moveTo(0,-8);mm.lineTo(5,6);mm.lineTo(-5,6);mm.closePath();mm.fill();mm.restore();
mm.restore();mm.strokeStyle='rgba(255,255,255,0.4)';mm.lineWidth=3;mm.beginPath();mm.arc(C,C,C-2,0,7);mm.stroke();}
// ---------- gameplay fns ----------
function toggleCrouch(){player.crouch=!player.crouch;$('stance').textContent=player.crouch?'HIDDEN — CROUCH':'STANDING';tone(player.crouch?300:420,0.1,'sine',0.08);}
function toggleEagle(){player.eagle=!player.eagle;$('eagleOverlay').style.display=player.eagle?'block':'none';$('btnEagle').classList.toggle('active',player.eagle);tone(player.eagle?700:400,0.2,'sine',0.1);toast(player.eagle?'👁️ EAGLE VISION':'👁️ VISION OFF',1200);}
function whistle(){if(player.dead||!started||paused)return;ensureAudio();sfx.whistle();feed('🎵 You whistle...');tone(1200,0.3,'sine',0.1);for(const g of guards){if(g.dead)continue;const d=g.pos.distanceTo(player.pos);if(d<32&&g.state!=='chase'){g.state='suspicious';g.meter=Math.max(g.meter,45);g.lastSeen.copy(player.pos);g.waitT=0;}}}
function throwShuriken(){if(player.shuriken<=0){toast('No shuriken! Find scrolls 📜',1500);return;}if(player.attackCd>0)return;player.attackCd=0.5;player.shuriken--;sfx.throw();const dir=new THREE.Vector3(Math.sin(player.yaw),0.05,Math.cos(player.yaw));const m=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,6),new THREE.MeshStandardMaterial({color:0xcccccc,metalness:0.9,roughness:0.2,emissive:0x555555}));m.position.copy(player.pos).add(new THREE.Vector3(0,1.8,0)).addScaledVector(dir,1);scene.add(m);projectiles.push({mesh:m,vel:dir.multiplyScalar(34),life:1.6});player.mesh.userData.a1.rotation.x=-1.5;setTimeout(()=>player.mesh.userData.a1.rotation.x=0,200);}
function throwSmoke(){if(player.smoke<=0){toast('No smoke! Find scrolls 📜',1500);return;}player.smoke--;sfx.smoke();const p=player.pos.clone();smokes.push({pos:p,t:8,mesh:null});const m=new THREE.Mesh(new THREE.SphereGeometry(6,14,12),new THREE.MeshBasicMaterial({color:0xcccccc,transparent:true,opacity:0.55,depthWrite:false}));m.position.copy(p).setY(1.5);scene.add(m);smokes[smokes.length-1].mesh=m;feed('💨 Smoke bomb!');}
function doJump(){if(!started||paused||player.dead||player.leaping||player.syncing)return;if(player.grounded||player.onRoof||player.climbing){player.vy=8.2;player.grounded=false;player.onRoof=null;player.climbing=false;sfx.jump();}}
function nearestGuard(maxD=2.6){let best=null,bd=maxD;for(const g of guards){if(g.dead)continue;const d=g.pos.distanceTo(player.pos);const dy=Math.abs((g.pos.y||0)-player.pos.y);if(d<bd&&dy<4){bd=d;best=g;}}return best;}
function behindGuard(g){const fx=Math.sin(g.yaw),fz=Math.cos(g.yaw);const dx=player.pos.x-g.pos.x,dz=player.pos.z-g.pos.z;const l=Math.hypot(dx,dz)||1;return (dx/l*fx+dz/l*fz)<-0.25;}
function tryAct(){if(!started||paused||player.dead)return;ensureAudio();
 // scroll pickup
 for(const s of scrolls){if(!s.taken&&s.mesh.position.distanceTo(player.pos.clone().setY(s.mesh.position.y))<2.5&&Math.abs(player.pos.y+1-s.mesh.position.y)<3){s.taken=true;scene.remove(s.mesh);player.scrollN++;player.shuriken=Math.min(9,player.shuriken+2);player.smoke=Math.min(6,player.smoke+1);player.hp=Math.min(100,player.hp+25);sfx.scroll();feed('📜 Scroll! +2✦ +1💨 +HP');toast('📜 SECRET SCROLL',1400);return;}}
 // sync
 const pd=Math.hypot(player.pos.x-pagoda.x,player.pos.z-pagoda.z);
 if(pd<12&&(player.pos.y>26||player.onRoof)){doSync();return;}
 // leap check first
 const lp=leapTarget();if(lp&&player.pos.y>8){doLeap(lp);return;}
 const g=nearestGuard(2.9);
 if(g){const air=player.pos.y-g.pos.y>2.5&&!player.grounded;const unaware=g.state==='patrol'||g.state==='suspicious'||behindGuard(g);
  if(air||unaware||g.meter<50){assassinate(g,air?'AIR ASSASSINATION':unaware?'SILENT KILL':'ASSASSINATION');return;}
  else{duel(g);return;}}
 // pagoda base climb
 if(pd<14){autoClimbPagoda();return;}
 toast('Nothing here — sneak behind guards',1300);}
function assassinate(g,label){g.dead=true;g.state='dead';g.mesh.rotation.x=-Math.PI/2;g.mesh.position.y=Math.max(0.3,g.mesh.position.y*0+ (g.pos.y||0)+0.2);g.mesh.userData.cone.visible=false;player.kills++;sfx.kill();const wasUnseen=g.meter<50;if(wasUnseen)player.undetectedKills++;else player.alerts++;
 feed(`🗡️ ${label} — ${g.name} slain`);toast(label+'!',1800);
 if(g.kind==='daimyo'){toast('👑 DAIMYO SLAIN — ESCAPE!',3000);sfx.sync();}
 player.attackCd=0.6;player.vy=Math.max(player.vy,1);
 // lunge anim
 player.mesh.position.lerp(g.pos,0.2);
 checkWin();}
function duel(g){if(player.attackCd>0)return;player.attackCd=0.7;g.hp--;sfx.kill();g.meter=100;g.state='chase';g.lastSeen.copy(player.pos);player.alerts=Math.max(1,player.alerts);
 if(g.hp<=0){assassinate(g,'DUEL KILL');}else{feed(`⚔️ You strike ${g.name} (${g.hp}❤ left)`);hurtPlayer(8,g);}}
function hurtPlayer(n,from){if(player.hurtCd>0||player.dead)return;player.hurtCd=0.7;player.hp-=n;$('dmgflash').style.opacity=0.7;setTimeout(()=>$('dmgflash').style.opacity=0,180);sfx.hurt();if(player.hp<=0){player.hp=0;die();}}
function die(){if(player.dead)return;player.dead=true;toast('💀 SLAIN... respawning',2500);setTimeout(()=>{player.pos.copy(player.lastCheck);player.vy=0;player.hp=100;player.dead=false;for(const g of guards){if(!g.dead&&g.state==='chase'){g.state='search';g.meter=40;}}toast('🌙 The shadow returns',1800);},2400);}
function checkWin(){const left=guards.filter(g=>!g.dead&&(g.kind==='captain'||g.kind==='daimyo')).length;$('scorepill').innerHTML=`🎯 ${5-left}/5 &nbsp;•&nbsp; ⏱️ ${fmtTime(elapsed)}`;if(left===0)endGame(true);}
function leapTarget(){for(const h of hayStacks){const d=Math.hypot(player.pos.x-h.x,player.pos.z-h.z);if(d<8&&player.pos.y>7)return h;}return null;}
function doLeap(h){player.leaping=true;sfx.leap();toast('🦅 LEAP OF FAITH!',2000);const from=player.pos.clone();const to=new THREE.Vector3(h.x,0.5,h.z);let t=0;const iv=setInterval(()=>{t+=0.03;player.pos.lerpVectors(from,to,t);player.pos.y=from.y*(1-t)+2.2+Math.sin(t*Math.PI)*-2+2.2*t;player.mesh.rotation.x=-1.2*t;if(t>=1){clearInterval(iv);player.pos.copy(to);player.vy=0;player.grounded=true;player.mesh.rotation.x=0;player.leaping=false;player.hp=Math.min(100,player.hp+10);player.smoke=Math.min(6,player.smoke+1);feed('🌾 Hidden in hay — unseen');}},30);}
function autoClimbPagoda(){if(player.syncing)return;player.syncing=true;toast('🦅 Ascending...',2000);const from=player.pos.clone();const to=new THREE.Vector3(pagoda.x,31.5,pagoda.z+2);let t=0;const iv=setInterval(()=>{t+=0.015;player.pos.lerpVectors(from,to,t);if(t>=1){clearInterval(iv);player.syncing=false;player.grounded=false;player.onRoof={x:pagoda.x,z:pagoda.z,w:7,d:7,h:31};doSync();}},30);}
function trySync(){const pd=Math.hypot(player.pos.x-pagoda.x,player.pos.z-pagoda.z);if(pd<16&&player.pos.y>20){doSync();}else if(pd<16){autoClimbPagoda();}else toast('🦅 Climb the tall PAGODA (north) to sync',2000);}
function doSync(){if(player.synced){toast('Already synchronized 🦅',1500);return;}player.synced=true;sfx.sync();const c=$('synccine');c.style.display='flex';setTimeout(()=>c.style.display='none',2600);toast('🦅 SYNCHRONIZED',2500);feed('🦅 Eagle sees all — map revealed');player.eagle=true;$('eagleOverlay').style.display='block';setTimeout(()=>{if(!player.eagle){} },1);}
// collision
const tmpBox=new THREE.Box3();
function collide(pos,r=0.7){for(const c of colliders){if(pos.y>c.max.y-0.4||pos.y+1.8<c.min.y)continue;const nx=Math.max(c.min.x,Math.min(pos.x,c.max.x)),nz=Math.max(c.min.z,Math.min(pos.z,c.max.z));const dx=pos.x-nx,dz=pos.z-nz;const d=Math.hypot(dx,dz);if(d<r){if(d>0.001){pos.x=nx+dx/d*r;pos.z=nz+dz/d*r;}else{pos.x=c.max.x+r;}}}}
function roofAt(pos){for(const r of rooftops){if(Math.abs(pos.x-r.x)<r.w/2+0.4&&Math.abs(pos.z-r.z)<r.d/2+0.4){if(pos.y>=r.h-1.2&&pos.y<=r.h+0.6)return r;}}return null;}
function wallAhead(pos,yaw){const fx=Math.sin(yaw),fz=Math.cos(yaw);const px=pos.x+fx*0.9,pz=pos.z+fz*0.9;for(const c of colliders){if(c.noClimb)continue;if(px>c.min.x&&px<c.max.x&&pz>c.min.z&&pz<c.max.z){const top=c.max.y;if(top>pos.y+1&&top<pos.y+9)return c;}}return null;}
function inSmoke(p){for(const s of smokes)if(Math.hypot(p.x-s.pos.x,p.z-s.pos.z)<7)return true;return false;}
// LOS
const ray=new THREE.Raycaster();
function los(a,b){const dir=new THREE.Vector3().subVectors(b,a);const d=dir.length();if(d<0.5)return true;dir.normalize();ray.set(a,dir);ray.far=d;const hits=ray.intersectObjects(occluders,false);return hits.length===0;}
// ---------- game state ----------
let started=false,paused=false,elapsed=0,mmT=0;
const clock=new THREE.Clock();
$('playBtn').onclick=()=>{ensureAudio();AC&&AC.resume();$('menu').classList.add('hidden');started=true;paused=false;clock.start();toast('🗡️ Find the pagoda 🦅 — sneak, climb, kill',3000);feed('Mission: slay 4 captains + the Daimyo 👑');};
$('qualityBtn').onclick=e=>{QUALITY=QUALITY==='HIGH'?'MED':QUALITY==='MED'?'LOW':'HIGH';e.target.textContent='QUALITY: '+QUALITY;applyQuality();};
$('helpBtn').onclick=()=>{const h=$('helpText');h.style.display=h.style.display==='none'?'block':'none';};
$('resumeBtn').onclick=()=>togglePause();$('restartBtn').onclick=()=>location.reload();$('menuBtn').onclick=()=>location.reload();$('againBtn').onclick=()=>location.reload();
function togglePause(){if(!started)return;paused=!paused;$('pause').classList.toggle('hidden',!paused);if(paused){$('pauseStats').innerHTML=`Targets: ${5-guards.filter(g=>!g.dead&&(g.kind==='captain'||g.kind==='daimyo')).length}/5 • Scrolls ${scrolls.filter(s=>s.taken).length}/${scrolls.length} • Time ${fmtTime(elapsed)}`;} }
function fmtTime(s){s=Math.floor(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function endGame(win){started=false;setTimeout(()=>{$('end').classList.remove('hidden');const left=guards.filter(g=>!g.dead&&(g.kind==='captain'||g.kind==='daimyo')).length;
if(win){const rank=player.alerts===0?'S — TRUE GHOST 👻':player.alerts<4?'A — SHADOW':'B — BLADE';$('endTitle').textContent='👑 SHOGUN SLAIN';$('endSub').textContent='THE VALLEY IS FREE • RANK '+rank;$('endStats').innerHTML=`Time ${fmtTime(elapsed)} • Kills ${player.kills} • Silent ${player.undetectedKills} • Scrolls ${player.scrollN}/${scrolls.length} • ${player.synced?'🦅 Synced':'No sync'}`;sfx.sync();}else{$('endTitle').textContent='DEFEATED';$('endSub').textContent='TRY AGAIN';$('endStats').textContent='';}},600);}
// fake loading
{let p=0;const iv=setInterval(()=>{p+=25;$('loadingfill').style.width=p+'%';if(p>=100)clearInterval(iv);},120);}
// ---------- main loop ----------
const eyeEl=$('eye'),detFill=$('detectfill');
const fwdV=new THREE.Vector3(),rgtV=new THREE.Vector3(),moveV=new THREE.Vector3(),camT=new THREE.Vector3(),camP=new THREE.Vector3(),toP=new THREE.Vector3(),eyeP=new THREE.Vector3(),gp=new THREE.Vector3();
let walkPhase=0;
function tick(){requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),0.05);
if(!started||paused){renderer.render(scene,camera);return;}
elapsed+=dt;
// petals drift
petals.rotation.y+=dt*0.02;const pp=petals.geometry.attributes.position;for(let i=0;i<40;i++){let y=pp.getY(i)-dt*1.2;if(y<0)y=28;pp.setY(i,y);}pp.needsUpdate=true;
for(const s of scrolls)if(!s.taken){s.mesh.rotation.y+=dt*1.5;s.mesh.position.y=s.z!==undefined?s.mesh.position.y:s.mesh.position.y;}
// input move
let ix=0,iz=0;
if(keys['KeyW']||keys['ArrowUp'])iz+=1;if(keys['KeyS']||keys['ArrowDown'])iz-=1;if(keys['KeyA']||keys['ArrowLeft'])ix-=1;if(keys['KeyD']||keys['ArrowRight'])ix+=1;
ix+=joyV.x;iz-=joyV.y;const il=Math.hypot(ix,iz);if(il>1){ix/=il;iz/=il;}
const sprint=(keys['ShiftLeft']||keys['ShiftRight']||il>0.92)&&!player.crouch&&iz>0.1;
player.sprint=sprint;
fwdV.set(Math.sin(camYaw),0,Math.cos(camYaw));rgtV.set(fwdV.z,0,-fwdV.x);
moveV.set(0,0,0).addScaledVector(fwdV,iz).addScaledVector(rgtV,-ix);
const moving=moveV.lengthSq()>0.01;
if(moving)moveV.normalize();
let speed=player.crouch?2.6:sprint?7.6:5.0;
if(player.eagle)speed*=0.95;
if(sprint&&moving){player.stamina=Math.max(0,player.stamina-dt*16);}else{player.stamina=Math.min(100,player.stamina+dt*14);}
if(player.stamina<=0)speed=4;
player.speed=moving?speed:0;
// face movement
if(moving&&!player.leaping&&!player.syncing){const ty=Math.atan2(moveV.x,moveV.z);let d=ty-player.yaw;while(d>Math.PI)d-=6.283;while(d<-Math.PI)d+=6.283;player.yaw+=d*Math.min(1,dt*10);}
// horizontal
if(!player.leaping&&!player.syncing){player.pos.x+=moveV.x*speed*dt;player.pos.z+=moveV.z*speed*dt;player.pos.x=Math.max(-WORLD+3,Math.min(WORLD-3,player.pos.x));player.pos.z=Math.max(-WORLD+3,Math.min(WORLD-3,player.pos.z));}
// climb
player.climbing=false;
if(moving&&!player.grounded||moving){const w=wallAhead(player.pos,Math.atan2(moveV.x,moveV.z));if(w&&(keys['Space']||iz>0.3||isMobile&&il>0.3)){if(player.stamina>1&&w.max.y>player.pos.y+1){player.climbing=true;player.pos.y+=3.4*dt;player.stamina-=dt*10;player.vy=0;const fx=Math.sin(Math.atan2(moveV.x,moveV.z)),fz=Math.cos(Math.atan2(moveV.x,moveV.z));player.pos.x+=fx*dt*1.2;player.pos.z+=fz*dt*1.2;collide(player.pos);if(player.pos.y>=w.max.y-0.2){player.pos.y=w.max.y;player.vy=0;player.grounded=false;}}}}
// gravity
if(!player.leaping&&!player.syncing&&!player.climbing){player.vy-=22*dt;player.pos.y+=player.vy*dt;}
collide(player.pos);
// ground / roof
const r=roofAt(player.pos);
if(player.pos.y<=0){if(!player.grounded&&player.vy<-14){hurtPlayer(Math.round((-player.vy-14)*4));}player.pos.y=0;player.vy=0;player.grounded=true;player.onRoof=null;player.airborne=0;}
else if(r&&player.vy<=0.1&&player.pos.y<=r.h+0.4&&player.pos.y>=r.h-1.4){if(!player.grounded&&!player.onRoof&&player.vy<-16)hurtPlayer(15);player.pos.y=r.h;player.vy=0;player.grounded=true;player.onRoof=r;player.airborne=0;}
else{if(player.pos.y>0.05){player.grounded=false;player.onRoof=null;player.airborne+=dt;}}
if(keys['Space']){/* jump handled on keydown? also hold */}
// jump via held space edge
if(player._jumpQ){player._jumpQ=false;doJump();}
player.attackCd=Math.max(0,player.attackCd-dt);player.hurtCd=Math.max(0,player.hurtCd-dt);
// bush hide
player.inBush=false;for(const b of bushes){if(Math.hypot(player.pos.x-b.x,player.pos.z-b.z)<b.r&&player.pos.y<2){player.inBush=true;break;}}
let inHay=false;for(const h of hayStacks){if(Math.hypot(player.pos.x-h.x,player.pos.z-h.z)<2.6&&player.pos.y<2)inHay=true;}
player.hidden=(player.inBush&&(player.crouch||!moving))||inHay||inSmoke(player.pos);
if(moving&&player.grounded&&Math.random()<dt*8)sfx.step();
// mesh update + anim
player.mesh.position.copy(player.pos);player.mesh.rotation.y=player.yaw;
walkPhase+=dt*(moving?speed*1.6:1.5);const sw=moving?Math.sin(walkPhase)*0.5:0;
player.mesh.userData.l1.rotation.x=sw;player.mesh.userData.l2.rotation.x=-sw;
player.mesh.position.y+=player.climbing?0:Math.abs(Math.sin(walkPhase))*0.06;
player.mesh.rotation.x=player.climbing?-0.25:player.grounded?0:0.25;
if(player.crouch)player.mesh.scale.set(1,0.78,1);else player.mesh.scale.set(1,1,1);
if(player.hidden)player.mesh.traverse?.(o=>{}); 
// checkpoint
if(player.grounded&&Math.hypot(player.pos.x+90,player.pos.z-120)>20)player.lastCheck.copy(player.pos);
// smokes
for(let i=smokes.length-1;i>=0;i--){const s=smokes[i];s.t-=dt;s.mesh.material.opacity=Math.min(0.6,s.t*0.2);s.mesh.scale.setScalar(1+(8-s.t)*0.08);if(s.t<=0){scene.remove(s.mesh);smokes.splice(i,1);}}
// projectiles
for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.life-=dt;p.vel.y-=6*dt;p.mesh.position.addScaledVector(p.vel,dt);let hit=false;
for(const g of guards){if(g.dead)continue;if(p.mesh.position.distanceTo(g.pos.clone().setY(p.mesh.position.y))<1.2&&Math.abs(p.mesh.position.y-1.5-g.pos.y)<2){g.hp-=2;if(g.hp<=0)assassinate(g,'SHURIKEN KILL');else{g.state='suspicious';g.meter=60;g.lastSeen.copy(player.pos);feed(`✦ ${g.name} wounded`);}hit=true;break;}}
if(p.mesh.position.y<=0.1)hit=true;
if(hit||p.life<=0){scene.remove(p.mesh);projectiles.splice(i,1);}}
// guards AI
let globalDet=0;
for(const g of guards){if(g.dead)continue;
 gp.copy(g.pos);gp.y+=1.6;eyeP.copy(player.pos);eyeP.y+=1.5;
 const toPlayer=new THREE.Vector3().subVectors(eyeP,gp);const dist=toPlayer.length();
 const fx=Math.sin(g.yaw),fz=Math.cos(g.yaw);toPlayer.normalize();
 const ang=Math.acos(Math.max(-1,Math.min(1,toPlayer.x*fx+toPlayer.z*fz)));
 let seeR=27;if(player.crouch)seeR*=0.55;if(player.hidden)seeR*=0.18;if(!moving)seeR*=0.8;if(player.eagle)seeR*=1;
 const fov=g.state==='chase'?1.25:0.62;
 let canSee=dist<seeR&&Math.abs(ang)<fov&&los(gp,eyeP)&&!inSmoke(g.pos)&&!inSmoke(player.pos)&&!player.leaping;
 if(player.pos.y-g.pos.y>6&&dist<4)canSee=true; // above = spotted if close
 if(canSee){const rate=(1-dist/seeR)*130+30;g.meter=Math.min(100,g.meter+rate*dt);g.lastSeen.copy(player.pos);}else{g.meter=Math.max(0,g.meter-dt*(g.state==='chase'?6:22));}
 globalDet=Math.max(globalDet,g.meter);
 // state transitions
 if(g.meter>=85&&g.state!=='chase'){g.state='chase';sfx.alert();player.alerts++;feed(`❗ ${g.name} spots you!`);}
 else if(g.meter>=35&&g.state==='patrol'){g.state='suspicious';sfx.sus();}
 if(g.state==='chase'&&g.meter<=0){g.state='search';g.waitT=6;}
 // movement
 const sp=g.state==='chase'?5.4:g.state==='suspicious'?3.4:g.speed;
 let target=null;
 if(g.state==='patrol'){target=g.route[g.ri];if(g.pos.distanceTo(target)<2){g.pauseT-=dt;if(g.pauseT<=0){g.ri=(g.ri+1)%g.route.length;g.pauseT=1+rnd()*2;}}else{g.pauseT=0.2;}}
 else if(g.state==='suspicious'||g.state==='search'){target=g.lastSeen;if(g.pos.distanceTo(target)<2.5){g.waitT+=dt;g.yaw+=dt*2.2;if(g.waitT>5){g.state='patrol';g.meter=0;g.waitT=0;}}}
 else if(g.state==='chase'){target=player.pos;if(dist<2.1&&g.attackCd<=0){g.attackCd=1.2;hurtPlayer(g.kind==='daimyo'?22:g.kind==='captain'?14:10,g);g.mesh.position.z+=0;}}
 g.attackCd=Math.max(0,(g.attackCd||0)-dt);
 if(target&&!(g.state==='suspicious'&&g.waitT>0.5&&g.pos.distanceTo(target)<2.5)){const dx=target.x-g.pos.x,dz=target.z-g.pos.z;const ty=Math.atan2(dx,dz);let d=ty-g.yaw;while(d>Math.PI)d-=6.283;while(d<-Math.PI)d+=6.283;g.yaw+=d*Math.min(1,dt*6);
  const nx=g.pos.x+Math.sin(g.yaw)*sp*dt,nz=g.pos.z+Math.cos(g.yaw)*sp*dt;const ox=g.pos.x,oz=g.pos.z;g.pos.x=nx;g.pos.z=nz;collide(g.pos,0.7);if(Math.abs(g.pos.x-ox)+Math.abs(g.pos.z-oz)<0.001)g.yaw+=dt*3;}
 g.mesh.rotation.y=g.yaw;
 // vision cone color
 const cone=g.mesh.userData.cone;cone.material.color.set(g.state==='chase'?0xff2222:g.meter>35?0xffd166:0xffd166);cone.material.opacity=g.state==='chase'?0.3:g.meter>35?0.24:0.13;
 if(player.eagle){g.mesh.children.forEach(c=>{if(c.material&&c.material.emissive)c.material.emissive.setHex(0x550000);});cone.material.opacity=0.35;}
 // attack anim bob
 g.mesh.position.y=g.pos.y+Math.abs(Math.sin(elapsed*6+g.ri))*0.05;
 // mark ? !
 g.mesh.userData.mark=g.meter>=85?'!':g.meter>=35?'?':'';
}
// detection UI
detFill.style.width=globalDet+'%';detFill.style.background=globalDet>80?'#e63946':globalDet>35?'#ffd166':'#7bdff2';
eyeEl.textContent=globalDet>80?'🔴':globalDet>35?'🟡':'👁️';eyeEl.className=globalDet>80?'spotted':player.hidden?'hidden':'';
// prompt logic: find nearest interact
let prompt='';
const ng=nearestGuard(2.9);
const lpt=leapTarget();
if(player.pos.y>8&&lpt)prompt='🦅 LEAP — press ACT';
else if(ng){const air=player.pos.y-ng.pos.y>2.5;prompt=(air?'🗡️ AIR KILL — ACT!':(ng.state==='patrol'||behindGuard(ng))?'🗡️ ASSASSINATE — ACT':'⚔️ FIGHT — ACT');}
else{for(const s of scrolls){if(!s.taken&&s.mesh.position.distanceTo(player.pos.clone().setY(s.mesh.position.y))<2.5){prompt='📜 TAKE SCROLL — ACT';break;}}
if(!prompt){const pd=Math.hypot(player.pos.x-pagoda.x,player.pos.z-pagoda.z);if(pd<16&&player.pos.y<20)prompt='🦅 CLIMB PAGODA — ACT';else if(pd<16)prompt='🦅 SYNC — ACT';}}
if(prompt){promptEl.textContent=prompt;promptEl.style.display='block';}else promptEl.style.display='none';
// markers projection for guards (!/?)
 // HUD
 $('healthbar').style.width=player.hp+'%';$('staminabar').style.width=player.stamina+'%';
 $('inv').textContent=`⭐${player.scrollN}  ✦${player.shuriken} 💨${player.smoke}`;
 $('scorepill').innerHTML=`🎯 ${5-guards.filter(g=>!g.dead&&(g.kind==='captain'||g.kind==='daimyo')).length}/5 &nbsp;•&nbsp; ⏱️ ${fmtTime(elapsed)}`;
 updateObjectives();
 mmT+=dt;if(mmT>0.12){mmT=0;drawMinimap();}
// camera
camT.copy(player.pos);camT.y+=2.3;
const cx=camT.x-Math.sin(camYaw)*Math.cos(camPitch)*camDist,cz=camT.z-Math.cos(camYaw)*Math.cos(camPitch)*camDist,cy=camT.y+Math.sin(camPitch)*camDist+0.6;
camP.set(cx,Math.max(1.2,cy),cz);
// camera collision
eyeP.copy(camT);toP.copy(camP).sub(camT);const cl=toP.length();toP.normalize();ray.set(camT,toP);ray.far=cl;const hits=ray.intersectObjects(occluders,false);if(hits.length)camP.copy(camT).addScaledVector(toP,Math.max(1.5,hits[0].distance-0.6));
camera.position.lerp(camP,Math.min(1,dt*10));camera.lookAt(camT.x+Math.sin(camYaw)*2,camT.y-0.3,camT.z+Math.cos(camYaw)*2);
renderer.render(scene,camera);
}
// jump edge trigger
addEventListener('keydown',e=>{if(e.code==='Space'){player._jumpQ=true;}});
document.getElementById('btnJump').addEventListener('touchstart',()=>{player._jumpQ=true;},{passive:true});
setInterval(()=>{if(started&&!paused&&!player.dead){/* autosave checkpoint implicit */}},5000);
tick();
