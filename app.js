import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)], v=a=>new THREE.Vector3(...a);
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={reactor:'pwr',mode:'cutaway',started:false,playing:false,follow:!reduceMotion,speed:1,time:0,labels:true,step:'overview',rendered:false};
let scene,camera,renderer,controls,root,lastTime=0,cameraTween=null,rotor,magnet;
const flows=[],covers=[],labels=[],pickables=[],variants={},fuelMats=[],powerMats=[];
const dummy=new THREE.Object3D(), yy=new THREE.Vector3(0,1,0);
const clamp=THREE.MathUtils.clamp;
const ramp=(t,a,b)=>{const f=clamp((t-a)/(b-a),0,1);return f*f*(3-2*f)};
const mat=(c,m=.3,r=.5)=>new THREE.MeshStandardMaterial({color:c,metalness:m,roughness:r,side:THREE.DoubleSide});
const steel=mat(0xb9c8c2,.73,.28),cream=mat(0xc9d1b9),dark=mat(0x4b6560,.5),copper=mat(0xb97e4e,.7,.3),pale=mat(0xe0e3d4,.1,.85),support=mat(0x7f9587),hot=mat(0xdc9459),water=mat(0x468eaf),cool=mat(0x5baba0),gold=mat(0xc9ab52);
const primary=mat(0xc67091),primaryCool=mat(0xa975ad),fuel=mat(0xae9676,.68,.32);
function mesh(geo,mat,pos,parent=root){const m=new THREE.Mesh(geo,mat);m.position.copy(v(pos));m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function box(size,pos,mat=steel,parent=root){return mesh(new THREE.BoxGeometry(...size),mat,pos,parent);}
function cylinder(r1,r2,len,pos,mat=steel,parent=root,axis='x',segments=40){const m=mesh(new THREE.CylinderGeometry(r1,r2,len,segments),mat,pos,parent);if(axis==='x')m.rotation.z=-Math.PI/2;if(axis==='z')m.rotation.x=Math.PI/2;return m;}
function torus(r,t,pos,mat=steel,parent=root,axis='x'){const m=mesh(new THREE.TorusGeometry(r,t,8,48),mat,pos,parent);if(axis==='x')m.rotation.y=Math.PI/2;if(axis==='y')m.rotation.x=Math.PI/2;return m;}
function pipe(points,r,mat,parent=root,rounded=true){const curve=rounded?new THREE.CatmullRomCurve3(points.map(v),false,'centripetal'):new THREE.CurvePath();if(!rounded) for(let i=0;i<points.length-1;i++)curve.add(new THREE.LineCurve3(v(points[i]),v(points[i+1])));const m=mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*12),r,10,false),mat,[0,0,0],parent);return {mesh:m,curve};}
function lineBetween(a,b,r,mat,parent=root){const delta=v(b).sub(v(a)),m=cylinder(r,r,delta.length(),v(a).add(v(b)).multiplyScalar(.5).toArray(),mat,parent,'y',10);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;}
function newGroup(name,variant='common'){const g=new THREE.Group();g.userData={part:name,variant};root.add(g);return g;}
function addCover(obj,variant='common'){covers.push({obj,variant});}
function label(text,pos,part,variant='common',priority=1){const el=document.createElement('button');el.className='part-label';el.textContent=text;el.title=text+'を見る';$('#labels').append(el);el.onclick=()=>{setFollow(false);state.step=part;setCamera(part);};labels.push({el,pos:v(pos),part,variant,priority});}
function addFlow(points,color,type,start=0,variant='common',opts={}){
 const curve=points instanceof THREE.Curve?points:new THREE.CatmullRomCurve3(points.map(v),false,'centripetal');
 const count=opts.count||18,r=opts.radius||.044;
 const inst=new THREE.InstancedMesh(new THREE.ConeGeometry(r,r*3.2,6),new THREE.MeshBasicMaterial({color,toneMapped:false}),count);
 inst.frustumCulled=false;inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(inst);
 const samples=Array.from({length:301},(_,i)=>curve.getPointAt(i/300));
 const qs=Array.from({length:301},(_,i)=>new THREE.Quaternion().setFromUnitVectors(yy,curve.getTangentAt(i/300).normalize()));
 flows.push({inst,curve,samples,qs,count,type,start,variant,velocity:opts.velocity||2.8,length:curve.getLength(),inside:opts.inside||false});
 return curve;
}
function fluid(points,r,material,color,type,start,variant='common',parent=root,opts={}){
 const m=material.clone();m.transparent=true;m.opacity=.30;m.depthWrite=false;
 const p=pipe(points,r,m,parent);addFlow(p.curve,color,type,start,variant,opts);return p;
}
function annulus(ri,ro,height,pos,material,parent,start=0,arc=Math.PI*2){const pts=[[ri,-height/2],[ro,-height/2],[ro,height/2],[ri,height/2],[ri,-height/2]].map(p=>new THREE.Vector2(...p));return mesh(new THREE.LatheGeometry(pts,48,start,arc),material,pos,parent);}
function vessel(cx,cz,bottom,height,r,material,parent,variant){
 const back=new THREE.Group(),front=new THREE.Group();parent.add(back,front);
 // Vertical split across x: remove the front (positive z) for an unobstructed cutaway.
 for(const [g,start] of [[back,Math.PI/2],[front,-Math.PI/2]]){
  mesh(new THREE.CylinderGeometry(r,r,height,48,1,true,start,Math.PI),material,[cx,bottom+height/2,cz],g);
  const top=mesh(new THREE.SphereGeometry(r,36,18,start+Math.PI/2,Math.PI,0,Math.PI/2),material,[cx,bottom+height,cz],g);top.scale.y=.48;
  const base=mesh(new THREE.SphereGeometry(r,36,18,start+Math.PI/2,Math.PI,Math.PI/2,Math.PI/2),material,[cx,bottom,cz],g);base.scale.y=.48;
  annulus(r-.045,r+.055,.12,[cx,bottom+height-.08,cz],steel,g,start,Math.PI);
 }
 addCover(front,variant);
 return {back,front};
}
function pump(pos,parent,material=water){const [x,y,z]=pos;cylinder(.27,.27,.36,[x,y,z],material,parent,'x');cylinder(.20,.20,.55,[x-.4,y,z],dark,parent,'x');box([.95,.13,.57],[x-.2,y-.32,z],pale,parent);for(let i=0;i<5;i++)torus(.21,.02,[x-.60+i*.095,y,z],steel,parent,'x');}
function buildBase(){
 box([27,.4,12],[.8,0,0],pale);box([26.7,.04,11.7],[.8,.225,0],mat(0xd9e0d2,.05,.9));
 const grid=new THREE.GridHelper(26,52,0xbac9b3,0xcdd8c5);grid.position.set(.8,.25,0);grid.scale.z=.43;grid.material.transparent=true;grid.material.opacity=.23;root.add(grid);
 box([17,.14,1.7],[3.7,.28,4.85],cool);box([17,.045,1.65],[3.7,.37,4.85],new THREE.MeshStandardMaterial({color:0x74b8bc,transparent:true,opacity:.8,roughness:.3}));
 for(let x=-4;x<12;x+=1.1)pipe([[x,.4,4.6],[x+.26,.4,4.64],[x+.65,.4,4.6]],.013,pale);
 for(const z of [-4.6,3.55])for(let x=-10;x<13;x+=1.1)box([.42,.01,.055],[x,.26,z],pale);
}
function containment(kind,parent){
 const pwr=kind==='pwr',cx=pwr?-6.3:-7.3,r=pwr?3.55:2.32;
 const wall=mat(0xc2cbbc,.12,.82),front=new THREE.Group();parent.add(front);
 if(pwr){
  for(const [g,start] of [[parent,Math.PI/2],[front,-Math.PI/2]]){
   mesh(new THREE.CylinderGeometry(r,r,5.9,64,1,true,start,Math.PI),wall,[cx,3.25,0],g);
   const dome=mesh(new THREE.SphereGeometry(r,48,20,start+Math.PI/2,Math.PI,0,Math.PI/2),wall,[cx,6.2,0],g);dome.scale.y=.66;
  }
 }else{
  const profile=[[r,.45],[r,2.2],[1.92,5.35],[1.2,6.95],[1.2,7.25],[0,7.25]];
  for(const [g,start] of [[parent,Math.PI/2],[front,-Math.PI/2]])mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),48,start,Math.PI),wall,[cx,0,0],g);
  // Wetwell separated from drywell; vent pipes end below the pool surface.
  const inner=.75;
  annulus(inner,r-.13,.52,[cx,.9,0],new THREE.MeshStandardMaterial({color:0x4b9fc0,transparent:true,opacity:.65,side:THREE.DoubleSide}),parent,Math.PI/2,Math.PI*1.35);
  annulus(inner,r-.13,.12,[cx,1.52,0],pale,parent,Math.PI/2,Math.PI*1.35);
  for(const a of [1.9,2.8,4.0,4.9]){const xx=cx+Math.sin(a)*1.8,zz=Math.cos(a)*1.8;pipe([[xx,2.1,zz],[xx,1.4,zz],[xx,.76,zz]],.09,steel,parent);}
  cylinder(.78,.78,.16,[cx,1.53,0],dark,parent,'y');
  label('圧力抑制プール',[cx,1.5,2.03],'reactor',kind,2);
 }
 addCover(front,kind);
 label('原子炉格納容器',[cx-1.7,pwr?7.0:6.35,-1.1],'reactor',kind,2);
}
function fuelCore(cx,cz,cy,parent,kind){
 const m=fuel.clone();m.emissive.set(0xaa5520);fuelMats.push({mat:m,variant:kind});
 // Each represented assembly contains a visible array of fuel rods and spacer grids.
 for(const ax of [-.32,.32])for(const az of [-.32,.32]){
  for(let i=0;i<4;i++)for(let j=0;j<4;j++)cylinder(.036,.036,1.55,[cx+ax+(i-1.5)*.105,cy,cz+az+(j-1.5)*.105],m,parent,'y',8);
  for(const dy of [-.65,0,.65]){const frame=box([.47,.055,.47],[cx+ax,cy+dy,cz+az],steel,parent);frame.material=steel;}
  if(kind!=='pwr'){
   box([.48,1.64,.035],[cx+ax,cy,cz+az-.24],steel,parent);
   box([.035,1.64,.48],[cx+ax-.24,cy,cz+az],steel,parent);
   pipe([[cx+ax-.16,cy+.83,cz+az],[cx+ax-.16,cy+.99,cz+az],[cx+ax+.16,cy+.99,cz+az],[cx+ax+.16,cy+.83,cz+az]],.027,steel,parent);
  }
  // PWR rod clusters use guide tubes within each assembly, entering from above.
  if(kind==='pwr'){
   for(const dx of [-.105,.105]){cylinder(.025,.025,1.2,[cx+ax+dx,cy+1.07,cz+az],dark,parent,'y',8);}
   box([.31,.055,.12],[cx+ax,cy+1.68,cz+az],dark,parent);cylinder(.04,.04,1.1,[cx+ax,cy+2.25,cz+az],dark,parent,'y',8);
  }
 }
 if(kind!=='pwr'){
  // Cruciform absorber blade between four fuel assemblies, entering from below.
  box([1.04,1.36,.055],[cx,cy-.33,cz],mat(0x66575b),parent);box([.055,1.36,1.04],[cx,cy-.33,cz],mat(0x66575b),parent);
  cylinder(.055,.055,1.65,[cx,cy-1.72,cz],dark,parent,'y',12);
 }
 label(kind==='pwr'?'制御棒（上から挿入）':'制御棒（下から挿入）',[cx,kind==='pwr'?cy+2.85:cy-1.35,cz+.25],'reactor',kind,3);
 label('燃料集合体',[cx-.75,cy,cz+.85],'reactor',kind,2);
}
function buildPWR(){
 const kind='pwr',g=newGroup('reactor',kind);variants[kind]=g;containment(kind,g);
 vessel(-8,0,1.65,3.32,.95,steel,g,kind);fuelCore(-8,0,2.7,g,kind);
 cylinder(.6,.7,.13,[-8,1.86,0],dark,g,'y');
 // The downcomer is outside the core barrel; the core outlet enters the hot leg.
 mesh(new THREE.CylinderGeometry(.75,.75,2.5,40,1,true,Math.PI/2,Math.PI),dark,[-8,3.06,0],g);
 fluid([[-7.07,3.85,0],[-6.28,3.85,0],[-5.9,2.1,-.05],[-4.57,2.1,-.05]],.16,primary,0xf49bb4,'primary',1,kind,g);
 fluid([[-4.07,2.1,-.05],[-3.45,1.7,.45],[-3.8,1.2,1.45],[-5.3,1.2,1.45],[-6.85,2.4,1.45],[-7.06,3.2,.30]],.16,primaryCool,0xd1a1e1,'primary',1,kind,g);
 pump([-5.3,1.2,1.45],g,primaryCool);
 addFlow([[-7.12,3.2,.2],[-7.27,2.25,.2],[-7.56,1.75,.05],[-8,1.92,0],[-8,3.5,0],[-7.72,3.85,0],[-7.07,3.85,0]],0xf3acbc,'primary',1,kind,{inside:true});
 // One representative vertical U-tube steam generator, with separated lower plenums.
 vessel(-4.3,0,2.15,3.53,.86,cream,g,kind);
 box([.055,.53,1.23],[-4.3,2.18,0],dark,g);cylinder(.80,.80,.10,[-4.3,2.45,0],steel,g,'y');
 for(let k=0;k<6;k++){
  const z=-.5+k*.2,pts=[[-4.60,2.16,z],[-4.60,4.50,z],[-4.52,4.8,z],[-4.30,4.96,z],[-4.08,4.8,z],[-4.0,4.5,z],[-4.0,2.16,z]];
  pipe(pts,.054,primary,g);if(k===4)addFlow(pts,0xffa6c3,'primary',1,kind,{inside:true,radius:.04});
 }
 const secWater=water.clone();secWater.transparent=true;secWater.opacity=.12;secWater.depthWrite=false;cylinder(.78,.78,2.9,[-4.3,3.94,0],secWater,g,'y');
 for(let i=0;i<5;i++)addFlow([[-4.9+i*.25,2.8,.46],[-4.9+i*.25,4.4,.46],[-4.55+i*.10,5.2,.3]],0xffc475,'boiling',4,kind,{inside:true,count:6,velocity:.9,radius:.03});
 // Separator/steam space above the U-tubes.
 for(let i=0;i<4;i++)cylinder(.10,.10,.28,[-4.65+i*.23,5.35,0],steel,g,'y');
 fluid([[-4.3,5.88,0],[-4.3,6.42,0],[-2.9,6.42,0],[-1.5,5.65,0],[-1.5,3.95,0],[-.7,3.6,0]],.14,hot,0xffd17c,'steam',7,kind,g);
 // Feedwater enters the secondary side above the tube sheet, never the U-tube plenum.
 fluid([[-1.65,.78,2.3],[-2.7,.78,2.3],[-3.2,3.0,1.25],[-3.53,3.0,.1]],.12,water,0x9ce4ff,'feedwater',20,kind,g);
 // Pressurizer branches off the hot leg. It is not a through-flow steam generator.
 vessel(-6.75,-1.28,3.95,1.45,.41,primaryCool,g,kind);
 pipe([[-6.28,3.85,0],[-6.30,3.52,-.7],[-6.75,3.55,-1.28],[-6.75,3.96,-1.28]],.085,primary,g);
 cylinder(.33,.33,.66,[-6.75,4.32,-1.28],primary,g,'y');
 label('原子炉圧力容器',[-8,5.7,0],'reactor',kind,1);
 label('蒸気発生器',[-4.3,6.4,.25],'steamgen',kind,1);
 label('加圧器',[-6.75,5.8,-1.2],'reactor',kind,2);
 label('一次冷却材ポンプ',[-5.3,1.55,1.75],'steamgen',kind,3);
}
function buildBWR(){
 const kind='bwr',g=newGroup('reactor',kind);variants[kind]=g;containment(kind,g);
 const cx=-7.3;vessel(cx,0,2.17,3.84,1.02,steel,g,kind);fuelCore(cx,0,3.3,g,kind);
 mesh(new THREE.CylinderGeometry(.74,.74,2.3,40,1,true,Math.PI/2,Math.PI),dark,[cx,3.6,0],g);
 // Steam separators and dryer are above the core, leaving a steam outlet at the top.
 cylinder(.74,.74,.11,[cx,4.56,0],steel,g,'y');
 for(const x of [-.4,0,.4])for(const z of [-.4,0,.4])cylinder(.09,.13,.55,[cx+x,4.89,z],steel,g,'y');
 for(let x=-.64;x<.7;x+=.16)box([.04,.34,1.24],[cx+x,5.47,0],cream,g);
 fluid([[cx+.95,5.75,0],[-5.8,5.75,0],[-4.45,5.75,0],[-2.65,5.75,0],[-1.5,5.1,0],[-1.5,3.95,0],[-.7,3.6,0]],.14,hot,0xffd17c,'steam',7,kind,g);
 // Two schematically placed main steam isolation valves straddle containment boundary.
 for(const x of [-5.23,-4.52]){cylinder(.21,.21,.21,[x,5.75,0],dark,g,'x');cylinder(.065,.065,.4,[x,6.0,0],steel,g,'y');box([.3,.22,.27],[x,6.25,0],cream,g);}
 fluid([[-1.65,.78,2.3],[-3.5,.78,2.3],[-5.2,1.6,2.3],[-5.55,4.35,.25],[cx+1,4.35,.05]],.12,water,0x9ce4ff,'feedwater',20,kind,g);
 addFlow([[cx+.96,4.35,.1],[cx+.85,3.7,.1],[cx+.85,2.5,.1],[cx+.2,2.3,.1],[cx,2.65,0],[cx,4.25,0]],0x9ce4ff,'reactor-water',1,kind,{inside:true});
 for(const z of [-.26,.26])addFlow([[cx-.2,3.1,z],[cx-.2,4.4,z],[cx-.15,5.15,z],[cx,5.65,z],[cx+.95,5.75,0]],0xffd398,'boiling',4,kind,{inside:true,count:14,velocity:1.2});
 // Separated liquid returns down the annulus, not through a turbine steam line.
 addFlow([[cx-.46,4.95,0],[cx-.86,4.5,0],[cx-.86,2.65,0],[cx-.3,2.4,0],[cx,2.7,0]],0x82cdef,'reactor-water',1,kind,{inside:true});

  for(const side of [-1,1]){
   const x=cx+side*1.52,z=-.05;
   fluid([[cx+side*.96,3.1,z],[x,3.1,z],[x,2.22,z],[x,1.95,.3],[x+side*.35,1.95,.3],[x+side*.45,2.72,.3],[cx+side*.98,2.72,.3]],.10,water,0x8cd6ef,'recirculation',1,kind,g,{count:12});
   pump([x,1.95,.3],g,water);
   // Jet pump mixing section directs recirculated/downcomer water toward lower plenum.
   pipe([[cx+side*.98,2.72,.3],[cx+side*.81,3.85,.3],[cx+side*.74,4.04,.3],[cx+side*.68,3.83,.3],[cx+side*.68,2.43,.3]],.055,steel,g);
  }
  label('外部再循環ポンプ',[cx+1.8,2.3,.75],'reactor',kind,2);
 label('原子炉圧力容器',[cx,6.55,0],'reactor',kind,1);
 label('気水分離器・蒸気乾燥器',[cx,5.65,.93],'reactor',kind,2);
}
function turbineModule(cx,len,r,group,doubleFlow=false){
 const cy=3.45,front=new THREE.Group();group.add(front);
 for(const [g,start] of [[group,0],[front,Math.PI]]){const o=mesh(new THREE.CylinderGeometry(r,r,len,48,1,true,start,Math.PI),cream,[cx,cy,0],g);o.rotation.z=-Math.PI/2;}
 addCover(front);
 for(let i=0;i<7;i++){
  const x=cx-len*.41+i*len*.137,rad=doubleFlow?r*(.46+.4*Math.abs(i-3)/3):r*(.46+.4*i/6);
  cylinder(rad*.4,rad*.4,.12,[x,0,0],dark,rotor,'x');
  for(let b=0;b<20;b++){const a=b/20*Math.PI*2,m=box([.08,rad*.62,.10],[x,Math.cos(a)*rad*.66,Math.sin(a)*rad*.66],steel,rotor);m.rotation.x=a;m.rotation.y=(doubleFlow&&i<3?-.3:.3);}
  torus(rad*.96,.015,[x,0,0],steel,rotor,'x');
  if(i<6)for(let b=0;b<14;b++){const a=b/14*Math.PI*2,m=box([.055,rad*.35,.06],[x+len*.069,cy+Math.cos(a)*rad*.74,Math.sin(a)*rad*.74],support,group);m.rotation.x=a;}
 }
 for(const x of [cx-len/2-.1,cx+len/2+.1]){box([.24,.43,.58],[x,cy-.45,0],support,group);cylinder(.24,.24,.26,[x,cy,0],steel,group,'x');}
}
function buildTurbines(){
 const g=newGroup('turbine');
 box([7,.23,3.1],[2.08,1.87,0],pale,g);for(const x of [-.95,1.25,4.9])for(const z of [-1.1,1.1])box([.25,1.44,.3],[x,1.03,z],support,g);
 rotor=new THREE.Group();rotor.position.y=3.45;g.add(rotor);cylinder(.15,.15,11.1,[3.85,0,0],steel,rotor,'x');
 turbineModule(-.12,1.6,.61,g,false);turbineModule(3.3,3.16,1.04,g,true);
 // Crossover steam path: HP exhaust -> moisture separator/reheater -> central LP inlet.
 fluid([[-.7,3.6,0],[0,3.68,0],[.58,3.6,0],[.72,3.3,-1.2],[1.1,3.3,-2.0]],.14,hot,0xffd394,'turbine',10,'common',g,{inside:true});
 cylinder(.38,.38,2.36,[1.85,3.3,-2.0],cream,g,'x');for(const x of [.7,3])torus(.39,.035,[x,3.3,-2],steel,g,'x');
 box([.21,2.6,.30],[.85,1.65,-2],support,g);box([.21,2.6,.30],[2.85,1.65,-2],support,g);
 fluid([[2.94,3.3,-2],[3.3,4.5,-1.9],[3.3,4.55,-.3],[3.3,4.25,0]],.17,hot,0xffd394,'turbine',11,'common',g);
 for(const x of [1.9,4.7])fluid([[3.3,4.25,0],[3.3,3.75,.2],[x,3.60,.2],[x,2.65,.32],[x,1.63,.32]],.21,hot,0xffd394,'exhaust',12,'common',g,{inside:true});
 label('高圧タービン',[-.2,4.30,0],'turbine','common',1);label('低圧タービン',[3.3,4.95,.15],'turbine','common',1);
 label('湿分分離加熱器',[1.8,3.85,-2],'turbine','common',3);
}
function buildGenerator(){
 const g=newGroup('generator'),x=7.2,y=3.45,len=2.5;
 box([3.4,.24,2.7],[x,1.85,0],pale,g);for(const dx of [-.9,.9])box([.55,.8,1.2],[x+dx,2.36,0],cream,g);
 const front=new THREE.Group();g.add(front);
 for(const [gr,start] of [[g,0],[front,Math.PI]]){const m=mesh(new THREE.CylinderGeometry(.90,.90,len,48,1,true,start,Math.PI),cream,[x,y,0],gr);m.rotation.z=-Math.PI/2;}addCover(front);
 for(const dx of [-1.31,1.31])torus(.86,.067,[x+dx,y,0],steel,g,'x');
 for(let i=0;i<12;i++){
  const a=i/12*Math.PI*2,b=a+Math.PI*.7,r=.70,at=(xx,ang,rr=r)=>[xx,y+Math.cos(ang)*rr,Math.sin(ang)*rr];
  const pts=[at(x-1.1,a),at(x+1.1,a)];
  for(let j=0;j<=8;j++)pts.push(at(x+1.15+.18*Math.sin(j/8*Math.PI),a+(b-a)*j/8));pts.push(at(x-1.1,b));
  for(let j=0;j<=8;j++)pts.push(at(x-1.15-.18*Math.sin(j/8*Math.PI),b+(a-b)*j/8));pts.push(at(x-1.1,a));pipe(pts,.026,copper,g);
 }
 magnet=new THREE.Group();magnet.position.set(x,y,0);g.add(magnet);cylinder(.43,.43,2.4,[0,0,0],steel,magnet,'x');
 for(let i=0;i<4;i++){const a=i*Math.PI/2;for(let j=-1;j<=1;j++){const winding=box([2.1,.07,.09],[0,Math.cos(a)*.40-Math.sin(a)*j*.08,Math.sin(a)*.40+Math.cos(a)*j*.08],copper,magnet);winding.rotation.x=a;}}
 cylinder(.25,.25,.4,[8.8,y,0],dark,g,'x');cylinder(.42,.42,.6,[9.15,y,0],cream,g,'x');box([.8,1.4,1.1],[9.15,2.28,0],pale,g);
 label('発電機',[7.2,4.65,0],'generator','common',1);
}
function energized(points,parent){
 const p=pipe(points,.025,dark,parent);
 for(const [r,opacity] of [[.039,.9],[.075,.28],[.12,.09]]){const m=new THREE.MeshBasicMaterial({color:0xffd35f,transparent:true,opacity:0,depthWrite:false,toneMapped:false});pipe(points,r,m,parent);powerMats.push({m,opacity});}
 addFlow(p.curve,0xfff0ae,'electric',15,'common',{velocity:4,count:15,radius:.026});
}
function buildGrid(){
 const g=newGroup('grid');box([2,1.35,1.8],[10.8,1.15,1.9],support,g);box([2.3,.18,2.1],[10.8,.41,1.9],pale,g);
 for(let i=0;i<12;i++)box([.055,1.15,2.0],[9.93+i*.16,1.12,1.9],dark,g);
 for(let i=0;i<3;i++){
  const x=10.23+i*.55;cylinder(.065,.065,.65,[x,2.1,1.9],copper,g,'y');for(let j=0;j<5;j++)cylinder(.12,.12,.05,[x,1.95+j*.105,1.9],cream,g,'y');
  energized([[7.5,2.55,.65+i*.18],[7.8,1.2,1.0+i*.22],[8.7,.65,2.85+i*.16],[x,.65,2.8+i*.16],[x,2.0,1.9]],g);
 }
 const px=11.8,pz=-2.5;
 for(const z of [-.25,.25])for(const side of [-1,1])lineBetween([px+side*.64,.3,pz+z*2],[px+side*.14,5.8,pz+z*.3],.028,support,g);
 for(let i=0;i<7;i++){let y=.45+i*.72,w=.6-i*.064;for(const z of [-.3,.3]){lineBetween([px-w,y,pz+z],[px+w-.07,y+.72,pz+z],.018,support,g);lineBetween([px+w,y,pz+z],[px-w+.07,y+.72,pz+z],.018,support,g);}}
 lineBetween([px-1.2,4.6,pz],[px+1.2,4.6,pz],.04,support,g);
 for(let i=0;i<3;i++){const xx=px+(i-1)*.95;cylinder(.07,.07,.34,[xx,4.4,pz],cream,g,'y');energized([[10.23+i*.55,2.43,1.9],[xx,4.23,pz],[xx+.6,4.0,-3.8],[xx+.75,4.3,-5.35]],g);}
 label('主変圧器',[10.8,2.9,1.9],'grid','common',2);label('送電（三相交流）',[11.8,6,-2.5],'grid','common',2);
}
function buildCondenser(){
 const g=newGroup('condenser'),cx=3.3;
 const cover=new THREE.Group();g.add(cover);box([3.55,1.34,2.12],[cx,1.12,.32],cream,cover);addCover(cover);
 const glass=new THREE.MeshStandardMaterial({color:0x99c4b4,transparent:true,opacity:.09,depthWrite:false,side:THREE.DoubleSide});box([3.56,1.35,2.13],[cx,1.12,.32],glass,g);
 box([3.44,.23,1.98],[cx,.53,.32],water,g);
 // Sea water flows only inside the sealed tubes between end water boxes.
 for(let j=0;j<3;j++)for(let k=0;k<4;k++)cylinder(.06,.06,3.20,[cx,.91+j*.2,-.34+k*.42],cool,g,'x');
 for(const xx of [1.6,5.0])box([.22,.92,1.84],[xx,1.14,.32],cool,g);
 fluid([[.05,.42,4.5],[.05,.8,3.1],[.45,1.1,1.7],[1.50,1.1,.32]],.14,cool,0xa7e4d5,'seawater',.1,'common',g);pump([.05,.8,3.1],g,cool);
 for(const z of [-.34,.08,.5,.92])addFlow([[1.61,1.1,z],[3.3,1.1,z],[4.99,1.1,z]],0x9adfd1,'seawater',.1,'common',{inside:true,count:9,velocity:2.2,radius:.028});
 fluid([[5.10,1.1,.32],[5.7,1.1,1.7],[6.3,.8,3.2],[6.3,.42,4.5]],.14,cool,0xa7e4d5,'seawater',.1,'common',g);
 for(let i=0;i<6;i++){const x=1.93+(i%3)*1.35,z=-.13+Math.floor(i/3)*.85;addFlow([[x,1.71,z],[x+.08,1.30,z],[x,.61,z]],0xa6dcf1,'condense',14,'common',{inside:true,count:6,velocity:.5,radius:.026});}
 fluid([[3.3,.50,1.26],[3.3,.78,2.3],[1.2,.78,2.3],[-1.65,.78,2.3]],.12,water,0x9ce4ff,'feedwater',20,'common',g);pump([-1.65,.78,2.3],g,water);
 label('復水器',[3.3,1.85,1.48],'condenser','common',1);label('復水・給水ポンプ',[-1.65,1.27,2.6],'condenser','common',3);
 label('海水取水',[.05,.73,4.6],'condenser','common',2);label('放水（海へ）',[6.3,.73,4.6],'condenser','common',2);
}
const views={
 overview:{target:[.6,2.4,.1],offset:[19,16,29]},
 reactor:{target:[-6.9,3.6,0],offset:[6.3,4.4,10]},
 steamgen:{target:[-4.6,3.5,.4],offset:[4.8,3.9,8.3]},
 turbine:{target:[1.8,3.2,-.3],offset:[5.6,4.5,8.8]},
 generator:{target:[7.15,3.2,0],offset:[4.6,3.1,6.6]},
 condenser:{target:[2.5,1.25,1.7],offset:[6,4.2,8.5]},
 grid:{target:[10.3,2.3,.5],offset:[6.3,4,8.8]}
};
function offsetFor(view,key){const o=v(view.offset);if(camera.aspect<1.15)o.multiplyScalar(Math.min(key==='overview'?2.8:1.8,1.15/camera.aspect));return o;}
function setCamera(key,instant=false){
 if(!camera||!controls)return;const view=views[key]||views.overview,target=v(view.target),to=target.clone().add(offsetFor(view,key));
 if(instant||reduceMotion){controls.target.copy(target);camera.position.copy(to);controls.update();cameraTween=null;}
 else cameraTween={from:camera.position.clone(),to,fromTarget:controls.target.clone(),target,elapsed:0};
}
function setFollow(value){state.follow=value;cameraTween=null;$('#follow').classList.toggle('active',value);$('#follow').setAttribute('aria-pressed',String(value));}
function tour(){
 const sequence=[[0,'overview'],[3,'reactor'],[6,state.reactor==='pwr'?'steamgen':'reactor'],[10,'turbine'],[14,'generator'],[18,'grid'],[22,'condenser'],[27,'overview'],[30,'overview']];
 const t=Math.min(state.time,30);let i=0;while(i<sequence.length-2&&t>sequence[i+1][0])i++;
 const [ta,ka]=sequence[i],[tb,kb]=sequence[i+1],a=views[ka],b=views[kb],f=ramp(t,ta,tb);
 controls.target.lerpVectors(v(a.target),v(b.target),f);camera.position.copy(controls.target).add(offsetFor(a,ka).lerp(offsetFor(b,kb),f));
}
function setMode(mode){state.mode=mode;$$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});if(!state.started||!state.follow)setCamera(state.step);updateVisuals();}
function chooseReactor(type){
 state.reactor=type;$$('[data-reactor]').forEach(b=>{b.classList.toggle('active',b.dataset.reactor===type);b.setAttribute('aria-pressed',String(b.dataset.reactor===type));});
 $('#type-summary').textContent={pwr:'一次系と二次系を分けて熱を伝える',bwr:'原子炉の蒸気で直接タービンを回す'}[type];
 $('#primary-key').hidden=type!=='pwr';reset();
}
function updateVisuals(){
 const t=state.started?state.time:0;
 for(const [key,g] of Object.entries(variants))g.visible=key===state.reactor;
 for(const c of covers)c.obj.visible=state.mode==='outside';
 const angle=2.1*Math.max(0,t-10)*ramp(t,10,12);rotor.rotation.x=angle;magnet.rotation.x=angle;
 for(const f of fuelMats)f.mat.emissiveIntensity=state.started?ramp(t,0,2)*.6:0;
 for(const p of powerMats)p.m.opacity=state.started?ramp(t,15,17)*p.opacity:0;
 for(const f of flows){
  const elapsed=state.started?t-f.start:-1;f.inst.visible=elapsed>=0&&(f.variant==='common'||f.variant===state.reactor)&&!(f.inside&&state.mode==='outside');
  if(!f.inst.visible)continue;
  for(let i=0;i<f.count;i++){
   const u=elapsed*f.velocity/f.length-i/f.count,frac=((u%1)+1)%1,idx=Math.min(299,Math.floor(frac*300));
   dummy.position.lerpVectors(f.samples[idx],f.samples[idx+1],frac*300-idx);dummy.quaternion.copy(f.qs[idx]);dummy.scale.setScalar(u>=0?1:0);dummy.updateMatrix();f.inst.setMatrixAt(i,dummy.matrix);
  }f.inst.instanceMatrix.needsUpdate=true;
 }
 $('#timeline').value=Math.min(t,30);$('#timeline').style.setProperty('--progress',`${Math.min(t/30,1)*100}%`);
}
function updateLabels(){
 const rect=renderer.domElement.getBoundingClientRect(),placed=[];
 const candidates=labels.filter(l=>l.variant==='common'||l.variant===state.reactor).sort((a,b)=>a.priority-b.priority);
 for(const l of labels)l.el.hidden=true;if(!state.labels)return;
 for(const l of candidates){
  if(state.mode==='outside'&&!['grid','generator'].includes(l.part))continue;
  if(rect.width<600&&l.priority>1)continue;
  if(l.priority===3&&camera.position.distanceTo(controls.target)>20)continue;
  const p=l.pos.clone().project(camera),x=(p.x*.5+.5)*rect.width,y=(-p.y*.5+.5)*rect.height-13;
  if(p.z>1||p.z<0||x<45||x>rect.width-45||y<(rect.width<600?175:150)||y>rect.height-(rect.width<600?225:190))continue;
  const width=l.el.textContent.length*(rect.width<600?9:10)+16,box={x:x-width/2,y:y-26,w:width,h:43};
  if(placed.some(b=>box.x<b.x+b.w+5&&box.x+box.w+5>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y))continue;
  placed.push(box);l.el.style.left=x+'px';l.el.style.top=y+'px';l.el.hidden=false;
 }
}
function updateButtons(){
 $('#start span').textContent=state.started?'最初から':'スタート';$('#pause').disabled=!state.started;$('#timeline').disabled=!state.started;
 $('#pause').innerHTML=state.playing?'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>':'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>';
 $('#pause').setAttribute('aria-label',state.playing?'一時停止':'再開');$('#pause').title=state.playing?'一時停止':'再開';
}
function start(){state.started=true;state.playing=true;state.time=0;state.step='overview';setFollow(!reduceMotion);setMode('cutaway');setCamera('overview',true);updateButtons();}
function reset(){state.started=false;state.playing=false;state.time=0;state.step='overview';setFollow(!reduceMotion);setCamera('overview',true);updateButtons();updateVisuals();}
function mergeStaticSiblings(parent){
 for(const c of [...parent.children])if(c.isGroup)mergeStaticSiblings(c);
 const batches=new Map();
 for(const o of [...parent.children]){
  if(!o.isMesh||o.isInstancedMesh||Array.isArray(o.material)||o.material.transparent)continue;
  const key=o.material.uuid;
  if(!batches.has(key))batches.set(key,[]);batches.get(key).push(o);
 }
 for(const objects of batches.values()){
  if(objects.length<3)continue;
  const positions=[],normals=[];
  for(const o of objects){
   o.updateMatrix();const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrix);
   positions.push(g.getAttribute('position').array);normals.push(g.getAttribute('normal').array);g.dispose();
  }
  const join=arrays=>{const result=new Float32Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){result.set(a,at);at+=a.length}return result;};
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(join(positions),3));g.setAttribute('normal',new THREE.BufferAttribute(join(normals),3));
  const merged=new THREE.Mesh(g,objects[0].material);merged.castShadow=true;merged.receiveShadow=true;parent.add(merged);for(const o of objects)parent.remove(o);
 }
}
function init(){
 const wrap=$('#scene-wrap');scene=new THREE.Scene();scene.background=new THREE.Color(0xe8eee8);
 camera=new THREE.PerspectiveCamera(35,wrap.clientWidth/wrap.clientHeight,.1,220);
 renderer=new THREE.WebGLRenderer({canvas:$('#scene'),antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.97;
 const env=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(env,.04).texture;scene.environmentIntensity=.58;env.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight(0xffffff,0x95a889,1.7));const sun=new THREE.DirectionalLight(0xfff7e5,2.6);sun.position.set(-5,18,10);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-20,right:20,top:15,bottom:-15,near:1,far:60});sun.shadow.normalBias=.035;sun.shadow.bias=-.0002;scene.add(sun);
 const fill=new THREE.DirectionalLight(0xe5f7ff,1.05);fill.position.set(8,7,-7);scene.add(fill);
 const floor=mesh(new THREE.PlaneGeometry(250,250),mat(0xe5ece2,.05,1),[0,-.23,0],scene);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
 root=new THREE.Group();scene.add(root);buildBase();buildPWR();buildBWR();buildTurbines();buildGenerator();buildCondenser();buildGrid();mergeStaticSiblings(root);
 root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh){let p=o;while(p&&!p.userData.part)p=p.parent;if(p){o.userData.part=p.userData.part;pickables.push(o);}}});
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=4;controls.maxDistance=115;controls.minPolarAngle=.15;controls.maxPolarAngle=Math.PI*.48;controls.addEventListener('start',()=>setFollow(false));setCamera('overview',true);
 let oldWidth=wrap.clientWidth,oldHeight=wrap.clientHeight;
 new ResizeObserver(()=>{camera.aspect=wrap.clientWidth/wrap.clientHeight;camera.updateProjectionMatrix();renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);if(Math.abs(oldWidth-wrap.clientWidth)>35||Math.abs(oldHeight-wrap.clientHeight)>80){oldWidth=wrap.clientWidth;oldHeight=wrap.clientHeight;if(state.follow&&state.started)tour();else setCamera(state.step,true);}}).observe(wrap);
 const ray=new THREE.Raycaster();let down;
 $('#scene').addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
 $('#scene').addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(pickables).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent}return true});if(hit){setFollow(false);state.step=hit.object.userData.part;setCamera(state.step);}});
 $('#scene').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key))return;e.preventDefault();setFollow(false);const s=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));if(e.key==='ArrowLeft')s.theta-=.12;if(e.key==='ArrowRight')s.theta+=.12;if(e.key==='ArrowUp')s.phi=Math.max(.2,s.phi-.12);if(e.key==='ArrowDown')s.phi=Math.min(1.48,s.phi+.12);if(e.key==='+'||e.key==='=')s.radius*=.88;if(e.key==='-')s.radius*=1.12;camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();});
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();state.playing=false;$('#loading').hidden=false;$('#loading').className='error';$('#loading').textContent='3Dの描画が中断されました。ページを再読み込みしてください。';});
 $('#loading').hidden=true;updateButtons();updateVisuals();requestAnimationFrame(animate);
}
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-(lastTime||now))/1000,.06);lastTime=now;if(document.hidden)return;if(state.playing)state.time+=dt*state.speed;if(state.follow&&state.started&&state.time<=30)tour();else if(cameraTween){cameraTween.elapsed+=dt;const f=ramp(cameraTween.elapsed,0,.95);camera.position.lerpVectors(cameraTween.from,cameraTween.to,f);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.target,f);if(f===1)cameraTween=null;}updateVisuals();controls.update();updateLabels();renderer.render(scene,camera);state.rendered=true;}
$('#start').onclick=start;$('#pause').onclick=()=>{state.playing=!state.playing;updateButtons();};$('#reset').onclick=reset;
$('#speed').onchange=e=>state.speed=Number(e.target.value);$('#follow').onclick=()=>setFollow(!state.follow);
$('#timeline').oninput=e=>{state.time=Number(e.target.value);updateVisuals();if(state.follow)tour();};
$$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$$('[data-reactor]').forEach(b=>b.onclick=()=>chooseReactor(b.dataset.reactor));
$('#reset-camera').onclick=()=>{setFollow(false);state.step='overview';setCamera('overview');};
function zoom(f){if(!camera)return;setFollow(false);camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update();}
$('#zoom-in').onclick=()=>zoom(.82);$('#zoom-out').onclick=()=>zoom(1.22);
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#scene-wrap').requestFullscreen?.();}catch{}};
$('#toggle-labels').onclick=()=>{state.labels=!state.labels;$('#toggle-labels').setAttribute('aria-pressed',String(state.labels));};
try{init()}catch(err){console.error(err);$('#loading').hidden=false;$('#loading').className='error';$('#loading').innerHTML='<div>3Dを表示できませんでした。</div><button onclick="location.reload()">再読み込み</button>';$$('button,select,input').forEach(b=>{if(!b.closest('#loading'))b.disabled=true;});}
window.energyLab={snapshot:()=>({...state,rotorAngle:rotor?.rotation.x,magnetAngle:magnet?.rotation.x,drawCalls:renderer?.info.render.calls,visibleVariants:Object.entries(variants).filter(([,g])=>g.visible).map(([k])=>k),flows:flows.filter(f=>f.inst.visible).map(f=>({type:f.type,variant:f.variant})),visibleCovers:covers.filter(c=>c.obj.visible&&(c.variant==='common'||c.variant===state.reactor)).length,labels:labels.filter(l=>!l.el.hidden).map(l=>l.el.textContent),camera:camera?.position.toArray()} )};
