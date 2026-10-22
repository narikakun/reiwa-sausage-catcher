import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';

const $ = (selector) => document.querySelector(selector);
const ui = {
  game: $('#game'), canvas: $('#scene'), score: $('#score'), best: $('#best'),
  judgement: $('#judgement'), start: $('#startPanel'), result: $('#resultPanel'),
  finalScore: $('#finalScore'), newBest: $('#newBest'), startButton: $('#startButton'), retryButton: $('#retryButton'), titleButton: $('#titleButton'),
  soundToggle: $('#soundToggle'), tapZone: $('#tapZone'), flash: $('#flash'), loading: $('#loading'),
  titleBest: $('#titleBest'), resultTitle: $('#resultTitle'), resultTitleImage: $('#resultTitleImage'),
  resultShot: $('#resultShot'), resultBest: $('#resultBest'), resultBestLabel: $('#resultBestLabel'), resultBestScore: $('#resultBestScore'), resultBestGap: $('#resultBestGap'), resultBestGapNumber: $('#resultBestGapNumber'), resultCaught: $('#resultCaught'), resultMisses: $('#resultMisses'), resultTime: $('#resultTime'),
  rankingForm: $('#rankingForm'), rankingName: $('#rankingName'), rankingSubmit: $('#rankingSubmit'), rankingStatus: $('#rankingStatus'),
  rankingPanel: $('#rankingPanel'), rankingList: $('#rankingList'), rankingMessage: $('#rankingMessage'), rankingClose: $('#rankingClose'),
  titleRankingButton: $('#titleRankingButton'), resultRankingButton: $('#resultRankingButton'), shareButton: $('#shareButton')
};

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const BEST_KEY = 'sausage-catcher-3d-best-v1';
const NAME_KEY = 'sausage-catcher-ranking-name';
const PLAYER_KEY = 'sausage-catcher-player-key';
// Base URL of the ranking API on the rental server (server/public), without a
// trailing slash. Leave empty to hide the ranking features.
const RANKING_API = 'https://db-api.nakn.jp/reiwa-sausage-catcher-api';
const EARTH_GRAVITY = 9.81;
const PERFECT_HALF_WIDTH = .24;
const BALANCE_LIMIT = 1.2;
const FALL_ANGLE = THREE.MathUtils.degToRad(70);
const SAUSAGE_COLLIDER_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
const FORK_REST_Y = -1.15;
const FORK_BASE_TINE_LENGTH = 1.42;
const FORK_STACK_STOP_Y = .55;
const FORK_TIP_CLEARANCE = .66;
const SAUSAGE_DENSITY = 1.18;
const PHYSICS_STEP = 1 / 60;
const MAX_FORK_TRAVEL = 1.55;
const MAX_CAMERA_DISTANCE = 30;
const TINE_OFFSETS = [0];
// Storage can throw when site data is blocked; the game still runs without a saved best.
function readBest(){try{return Number(localStorage.getItem(BEST_KEY)||0)||0}catch{return 0}}
function writeBest(value){try{localStorage.setItem(BEST_KEY,String(value))}catch{}}
function readName(){try{return localStorage.getItem(NAME_KEY)||''}catch{return ''}}
function writeName(value){try{localStorage.setItem(NAME_KEY,value)}catch{}}
// A random key that identifies this browser's player in the ranking, so later
// games update the same entry. Without storage it only lasts for this visit.
let sessionPlayerKey='';
function playerKey(){
  try{
    const saved=localStorage.getItem(PLAYER_KEY);
    if(/^[0-9a-f]{32}$/.test(saved||''))return saved;
  }catch{}
  sessionPlayerKey||=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  try{localStorage.setItem(PLAYER_KEY,sessionPlayerKey)}catch{}
  return sessionPlayerKey;
}
const state = {
  mode: 'loading', score: 0, best: readBest(),
  caught: 0, misses: 0, elapsed: 0, nextSpawn: 0, forkTargetX: 0, pointerNdcX: 0,
  active: null, stack: [], debris: [], muted: false,
  shake: 0, audio: null, balance: 0, endingReason: 'balance', aimRotation: null, shotDueAt: -1
};

renderImageNumber(ui.score,0,4);
renderImageNumber(ui.best,state.best,4);
ui.titleBest.textContent = pad(state.best);

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .92;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .035).texture;
pmrem.dispose();
const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
camera.position.set(0, 3.15, 9.4);
camera.lookAt(0, 1.9, 0);

scene.add(new THREE.HemisphereLight(0xffefbb, 0x682514, 1.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.intensity=2.05;keyLight.position.set(-4, 8, 6); keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff5b32, 1.35); rimLight.position.set(5, 3, -3); scene.add(rimLight);

const world = new RAPIER.World({ x: 0, y: -EARTH_GRAVITY, z: 0 });
world.timestep = PHYSICS_STEP;

const root = new THREE.Group(); scene.add(root);

function makeFork() {
  const group = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({
    color:0xdce4e6,metalness:1,roughness:.2,clearcoat:.45,clearcoatRoughness:.12,
    envMapIntensity:1.65
  });
  const wood=new THREE.MeshPhysicalMaterial({color:0x4a2114,roughness:.48,clearcoat:.38,clearcoatRoughness:.24});
  const handle=new THREE.Mesh(new THREE.CapsuleGeometry(.23,1.62,10,24),wood);
  handle.position.y=-1.36;handle.scale.z=.62;handle.castShadow=true;group.add(handle);
  const tang=new THREE.Mesh(new THREE.CylinderGeometry(.085,.115,.92,20),metal);tang.position.y=-.26;tang.scale.z=.58;tang.castShadow=true;group.add(tang);
  [-1.62,-1.08].forEach(y=>{const rivet=new THREE.Mesh(new THREE.SphereGeometry(.055,16,10),metal);rivet.position.set(0,y,.145);rivet.scale.z=.32;group.add(rivet)});
  const cross=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.42,6,18),metal);
  cross.rotation.z=Math.PI/2;cross.position.y=.18;cross.scale.z=.58;cross.castShadow=true;group.add(cross);
  const tines=[];
  TINE_OFFSETS.forEach(x=>{
    const tine=new THREE.Mesh(new THREE.CapsuleGeometry(.055,1,8,14),metal);
    tine.position.x=x;tine.scale.z=.58;tine.castShadow=true;group.add(tine);tines.push(tine);
  });
  group.position.set(0,FORK_REST_Y,.1); root.add(group);
  group.userData.tines=tines;
  group.userData.framingParts=[cross,...tines];
  group.userData.metal=metal;
  group.userData.extensionLength=0;
  return group;
}
const fork = makeFork();

const forkPhysicsBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,FORK_REST_Y,.1));
const forkTipColliders=TINE_OFFSETS.map(()=>world.createCollider(
  RAPIER.ColliderDesc.capsule(.42,.11).setSensor(true).setDensity(0),forkPhysicsBody
));

function resetForkExtensions() {
  fork.userData.extensionLength=0;
  fork.userData.tines.forEach(tine=>{
    tine.scale.y=FORK_BASE_TINE_LENGTH/1.082;
    tine.position.y=.14+FORK_BASE_TINE_LENGTH/2;
  });
}

function terminalForkAngle(){return 0}

function forkTipLocalPosition(){
  return new THREE.Vector3(0,.14+FORK_BASE_TINE_LENGTH+fork.userData.extensionLength,0);
}

function forkTipWorldPosition(){
  fork.updateMatrixWorld(true);
  return fork.localToWorld(forkTipLocalPosition());
}

function updateForkTipColliders(){
  const tip=forkTipLocalPosition(),angle=terminalForkAngle();
  const direction=new THREE.Vector3(Math.sin(angle),Math.cos(angle),0);
  const across=new THREE.Vector3(Math.cos(angle),-Math.sin(angle),0);
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-angle);
  TINE_OFFSETS.forEach((offset,i)=>{
    const center=tip.clone().addScaledVector(direction,-.11).addScaledVector(across,offset);
    forkTipColliders[i].setTranslationWrtParent({x:center.x,y:center.y,z:center.z});
    forkTipColliders[i].setRotationWrtParent({x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w});
  });
}

function setForkTipsSolid(solid){
  forkTipColliders.forEach(collider=>collider.setSensor(!solid));
}

function setForkExtensionLength(length){
  fork.userData.extensionLength=Math.max(0,length);
  const totalLength=FORK_BASE_TINE_LENGTH+fork.userData.extensionLength;
  fork.userData.tines.forEach(tine=>{
    tine.scale.y=totalLength/1.082;
    tine.position.y=.14+totalLength/2;
  });
  updateForkTipColliders();
}

function updateForkLengthFromStack(dt){
  if(!state.stack.length)return;
  const forkPosition=forkPhysicsBody.translation(),forkRotation=forkPhysicsBody.rotation();
  const inverseForkRotation=new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w).invert();
  // Measure each sausage's upper end, not its centre, so vertical and diagonal
  // sausages are still pierced all the way through.
  let highestTop=FORK_STACK_STOP_Y;
  state.stack.forEach(({body,topExtent})=>{
    const p=body.translation();
    const local=new THREE.Vector3(p.x-forkPosition.x,p.y-forkPosition.y,p.z-forkPosition.z).applyQuaternion(inverseForkRotation);
    highestTop=Math.max(highestTop,local.y+topExtent);
  });
  const desiredTipY=Math.max(.14+FORK_BASE_TINE_LENGTH,highestTop+FORK_TIP_CLEARANCE);
  const desiredExtension=desiredTipY-(.14+FORK_BASE_TINE_LENGTH);
  const response=desiredExtension>fork.userData.extensionLength?4.5:2.4;
  const next=lerp(fork.userData.extensionLength,desiredExtension,Math.min(1,dt*response));
  if(Math.abs(next-fork.userData.extensionLength)>.001)setForkExtensionLength(next);
}
resetForkExtensions();updateForkTipColliders();

function makeSausagePbrMaps(sourceTexture) {
  const size=256,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(sourceTexture.image,0,0,size,size);
  const pixels=context.getImageData(0,0,size,size).data;
  const height=new Float32Array(size*size);
  for(let i=0;i<height.length;i++)height[i]=(pixels[i*4]*.22+pixels[i*4+1]*.62+pixels[i*4+2]*.16)/255;
  const normalData=new Uint8Array(size*size*4),roughnessData=new Uint8Array(size*size*4);
  const at=(x,y)=>height[((y+size)%size)*size+(x+size)%size];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,dx=(at(x-1,y)-at(x+1,y))*1.7,dy=(at(x,y-1)-at(x,y+1))*1.7;
    const inv=1/Math.hypot(dx,dy,1);
    normalData[i]=128+dx*inv*127;normalData[i+1]=128+dy*inv*127;normalData[i+2]=128+inv*127;normalData[i+3]=255;
    const charred=1-height[y*size+x],rough=THREE.MathUtils.clamp(.68-charred*.22+(Math.random()-.5)*.06,.34,.78)*255;
    roughnessData[i]=roughnessData[i+1]=roughnessData[i+2]=rough;roughnessData[i+3]=255;
  }
  const normalMap=new THREE.DataTexture(normalData,size,size,THREE.RGBAFormat);
  const roughnessMap=new THREE.DataTexture(roughnessData,size,size,THREE.RGBAFormat);
  [normalMap,roughnessMap].forEach(texture=>{texture.needsUpdate=true;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.copy(sourceTexture.repeat);texture.flipY=true;});
  return {normalMap,roughnessMap};
}
// Every variety uses its own albedo; gold and charred also change the finish.
// `weight` only applies inside a rare roll (see pickSausageKind).
const sausageVarieties=[
  {name:'normal',weight:2},{name:'bacon'},{name:'cheese'},{name:'herb'},{name:'spicy'},{name:'white'},
  {name:'charred',material:{roughness:.86,clearcoat:.12,sheen:.08}},
  {name:'gold',weight:.4,material:{metalness:.55,roughness:.32,clearcoat:.85,sheen:0}},
  {name:'rainbow',weight:.4,material:{clearcoat:.7}}
];
const textureLoader=new THREE.TextureLoader();
await Promise.all(sausageVarieties.map(async variety=>{
  const texture=await textureLoader.loadAsync(`./assets/${variety.name}.webp`);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(1.15,1);
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  variety.texture=texture;variety.pbr=makeSausagePbrMaps(texture);
}));

// Each shape is a spine curve plus a radius. Straight shapes collide as a
// capsule; the curved one uses a convex hull around its spine. `extentPoints`
// and `colliderRadius` describe the collider in body space for fork framing.
const sausageShapes=[
  {name:'normal',weight:2,radius:.285,spine:[[-.72,-.015,0],[-.38,.035,.015],[0,.055,0],[.4,.02,-.012],[.72,-.025,0]]},
  {name:'fat',weight:1,radius:.4,spine:[[-.6,-.01,0],[-.3,.03,.01],[0,.04,0],[.3,.02,-.01],[.6,-.015,0]]},
  {name:'thin',weight:1,radius:.18,spine:[[-.84,-.02,0],[-.42,.03,.01],[0,.045,0],[.42,.015,-.01],[.84,-.03,0]]},
  {name:'long',weight:1,radius:.24,spine:[[-1.05,-.02,0],[-.52,.04,.015],[0,.06,0],[.52,.02,-.012],[1.05,-.03,0]]},
  {name:'curved',weight:1,radius:.27,curved:true,spine:[[-.66,-.2,0],[-.36,.07,.01],[0,.16,0],[.36,.07,-.01],[.66,-.2,0]]}
];
const NO_ROTATION=new THREE.Quaternion();
sausageShapes.forEach(shape=>{
  const curve=new THREE.CatmullRomCurve3(shape.spine.map(([x,y,z])=>new THREE.Vector3(x,y,z)));
  shape.geometry={body:new THREE.TubeGeometry(curve,32,shape.radius,16,false),cap:new THREE.SphereGeometry(shape.radius*.975,16,10)};
  shape.ends=[0,1].map(t=>({point:curve.getPointAt(t),outward:curve.getTangentAt(t).multiplyScalar(t?1:-1)}));
  const colliderRadius=shape.radius*.93;
  shape.colliderRadius=colliderRadius;
  if(shape.curved){
    const hull=[],spinePoints=[];
    for(let i=0;i<=12;i++){
      const u=i/12,point=curve.getPointAt(u),tangent=curve.getTangentAt(u);
      const side=new THREE.Vector3(-tangent.y,tangent.x,0).normalize(),depth=new THREE.Vector3(0,0,1);
      for(let k=0;k<8;k++){
        const angle=k/8*Math.PI*2;
        hull.push(point.clone().addScaledVector(side,Math.cos(angle)*colliderRadius).addScaledVector(depth,Math.sin(angle)*colliderRadius));
      }
      spinePoints.push(point);
    }
    shape.ends.forEach(({point,outward})=>hull.push(point.clone().addScaledVector(outward,colliderRadius)));
    const hullPoints=new Float32Array(hull.flatMap(p=>[p.x,p.y,p.z]));
    shape.colliderDesc=()=>RAPIER.ColliderDesc.convexHull(hullPoints);
    shape.colliderRotation=NO_ROTATION;
    shape.extentPoints=spinePoints;
  } else {
    const halfLength=shape.spine.at(-1)[0]-.06;
    shape.colliderDesc=()=>RAPIER.ColliderDesc.capsule(halfLength,colliderRadius);
    shape.colliderRotation=SAUSAGE_COLLIDER_ROTATION;
    shape.extentPoints=[new THREE.Vector3(-halfLength,0,0),new THREE.Vector3(halfLength,0,0)];
  }
});
const sausagePuckerGeometry=new THREE.SphereGeometry(.043,10,8);
const sausageKnotMaterial=new THREE.MeshPhysicalMaterial({color:0x4f170e,roughness:.62,clearcoat:.12});
const X_AXIS=new THREE.Vector3(1,0,0);

function pickWeighted(list){
  let roll=Math.random()*list.reduce((sum,item)=>sum+(item.weight??1),0);
  return list.find(item=>(roll-=item.weight??1)<0)??list[0];
}

// Most throws are the plain sausage. A rare roll changes the texture, the
// shape or both, but never comes out as the plain sausage again.
const RARE_SAUSAGE_CHANCE=.2;
function pickSausageKind(){
  const [normalVariety]=sausageVarieties,[normalShape]=sausageShapes;
  if(Math.random()>=RARE_SAUSAGE_CHANCE)return {variety:normalVariety,shape:normalShape};
  let variety,shape;
  do{variety=pickWeighted(sausageVarieties);shape=pickWeighted(sausageShapes)}while(variety===normalVariety&&shape===normalShape);
  return {variety,shape};
}

// Geometry is shared per shape; only the per-sausage skin material is created
// (and disposed) each time.
function makeSausageMesh(variety,shape) {
  const group = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({
    color:new THREE.Color().setScalar(.9+Math.random()*.1),map:variety.texture,normalMap:variety.pbr.normalMap,normalScale:new THREE.Vector2(.24,.24),
    roughness:.68,roughnessMap:variety.pbr.roughnessMap,metalness:0,clearcoat:.48,clearcoatRoughness:.28,
    sheen:.3,sheenColor:new THREE.Color(0xff9b72),envMapIntensity:1.25,...variety.material
  });
  const body = new THREE.Mesh(shape.geometry.body,skin);
  body.castShadow=true; body.receiveShadow=true; group.add(body);
  shape.ends.forEach(({point,outward})=>{
    const facing=new THREE.Quaternion().setFromUnitVectors(X_AXIS,outward);
    const cap=new THREE.Mesh(shape.geometry.cap,skin);
    cap.scale.set(.34,.97,.97);cap.quaternion.copy(facing);cap.position.copy(point).addScaledVector(outward,.015);cap.castShadow=true;group.add(cap);
    const pucker=new THREE.Mesh(sausagePuckerGeometry,sausageKnotMaterial);
    pucker.scale.set(.65,1,1);pucker.quaternion.copy(facing);pucker.position.copy(point).addScaledVector(outward,shape.radius*.42);group.add(pucker);
  });
  group.userData.skin=skin;
  return group;
}

function disposeSausageMesh(mesh){
  mesh.removeFromParent();
  mesh.userData.skin.dispose();
}

const throwPatterns = [
  { time:[1.18,1.34], gravity:1, spin:[.7,1.5] },
  { time:[1.45,1.62], gravity:.82, spin:[.4,1] },
  { time:[.98,1.1], gravity:1.12, spin:[1.1,2] }
];

function spawnSausage() {
  if (state.active || state.mode !== 'playing') return;
  const pattern=throwPatterns[Math.floor(Math.random()*throwPatterns.length)];
  const flightTime=lerp(pattern.time[0],pattern.time[1],Math.random()) / (1+Math.min(.18,state.score/9000));
  const {variety,shape}=pickSausageKind();
  const mesh = makeSausageMesh(variety,shape);
  const viewDistance=Math.max(1,camera.position.z-.1);
  const visibleHalfHeight=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*viewDistance;
  const visibleHalfWidth=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*viewDistance*camera.aspect;
  // Aim at the current end of the bent fork path instead of the screen center.
  state.aimRotation=fork.rotation.z;
  const restingTip=forkTipWorldPosition();
  // Every sausage falls through the skewer's reachable horizontal lane. The
  // player slides the skewer under this point instead of thrusting upward.
  // A leaning tall tower shifts the tip sideways, so centre the drop lane on
  // where the tip leans at the frozen aim angle.
  const tipLean=restingTip.x-fork.position.x;
  const targetX=tipLean+lerp(-MAX_FORK_TRAVEL*.86,MAX_FORK_TRAVEL*.86,Math.random());
  const targetY=restingTip.y;
  const horizontalOffset=lerp(-Math.min(.45,visibleHalfWidth*.1),Math.min(.45,visibleHalfWidth*.1),Math.random());
  const startX=clamp(targetX+horizontalOffset,camera.position.x-visibleHalfWidth*.66,camera.position.x+visibleHalfWidth*.66);
  const startY=camera.position.y+visibleHalfHeight*.72;
  const side=Math.sign(horizontalOffset)||1;
  mesh.position.set(startX,startY,.1+Math.random()*.08);
  const spin=-side*lerp(pattern.spin[0],pattern.spin[1],Math.random());
  const orientationRoll=Math.random();
  const angleOffset=orientationRoll<.3
    ? (Math.random()<.5?-1:1)*lerp(THREE.MathUtils.degToRad(76),Math.PI/2,Math.random())
    : lerp(-THREE.MathUtils.degToRad(68),THREE.MathUtils.degToRad(68),Math.random());
  const targetAngle=fork.rotation.z-terminalForkAngle()+angleOffset;
  const initialAngle=targetAngle-spin*flightTime;
  const initialRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),initialAngle);
  mesh.quaternion.copy(initialRotation);
  root.add(mesh);
  const gravity=EARTH_GRAVITY*pattern.gravity;
  // Every throw is solved to pass through the fork-tip centre at flightTime.
  const vx=(targetX-startX)/flightTime;
  const vy=(targetY-startY+.5*gravity*flightTime*flightTime)/flightTime;
  const body=world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x,mesh.position.y,mesh.position.z)
      .setRotation({x:initialRotation.x,y:initialRotation.y,z:initialRotation.z,w:initialRotation.w})
      .setLinvel(vx,vy,0).setAngvel({x:0,y:0,z:spin})
      .setGravityScale(pattern.gravity).setLinearDamping(0).setAngularDamping(0).setCcdEnabled(true)
  );
  const collider=world.createCollider(
    shape.colliderDesc().setRotation({x:shape.colliderRotation.x,y:shape.colliderRotation.y,z:shape.colliderRotation.z,w:shape.colliderRotation.w}).setDensity(SAUSAGE_DENSITY).setFriction(.82).setRestitution(0),body
  );
  state.active = {
    mesh,body,collider,shape,side,age:0,pattern,flightTime,
    targetX,targetY,trajectoryCorrected:false,hasBeenVisible:false,visibleDuration:0,caught:false
  };
  ui.judgement.className='judgement';ui.judgement.textContent='';
  sound('whoosh');
}

function updateFlying(dt) {
  const s = state.active; if (!s) return;
  s.age += dt;
  const p=s.body.translation();
  const projected=new THREE.Vector3(p.x,p.y,p.z).project(camera);
  const onScreen=projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<=.96&&Math.abs(projected.y)<=.94;
  if(onScreen){s.hasBeenVisible=true;s.visibleDuration+=dt}
  if(!s.trajectoryCorrected&&s.age>=s.flightTime-.18){
    const remaining=Math.max(.06,s.flightTime-s.age);
    const gravityDrop=-.5*EARTH_GRAVITY*s.pattern.gravity*remaining*remaining;
    const velocity=s.body.linvel();
    const desiredX=(s.targetX-p.x)/remaining,desiredY=(s.targetY-p.y-gravityDrop)/remaining;
    const correctionX=clamp(desiredX-velocity.x,-1.25,1.25),correctionY=clamp(desiredY-velocity.y,-1.25,1.25);
    s.body.setLinvel({x:velocity.x+correctionX,y:velocity.y+correctionY,z:0},true);
    s.trajectoryCorrected=true;
  }
  if(s.age>s.flightTime+.1){
    const wasClearlyVisible=s.hasBeenVisible&&s.visibleDuration>=.35;
    if(wasClearlyVisible)miss();
    else {removeActive();state.aimRotation=null;scheduleNext(.12)}
  }
}

function removeActive(removeMesh=true){
  const s=state.active;if(!s)return;
  if(removeMesh)disposeSausageMesh(s.mesh);
  world.removeRigidBody(s.body);
  state.active=null;
}

function forkHitData(s){
  const contactPoints=[];
  let tineCount=0;
  forkTipColliders.forEach(collider=>{
    let touched=false;
    world.contactPair(s.collider,collider,manifold=>{
      for(let i=0;i<manifold.numSolverContacts();i++){
        const point=manifold.solverContactPoint(i);
        contactPoints.push(new THREE.Vector3(point.x,point.y,point.z));
        touched=true;
      }
    });
    if(touched)tineCount++;
  });
  if(!contactPoints.length)return null;
  const contactWorld=contactPoints.reduce((sum,point)=>sum.add(point),new THREE.Vector3()).multiplyScalar(1/contactPoints.length);
  const sausagePosition=s.body.translation();
  const sausageCenter=new THREE.Vector3(sausagePosition.x,sausagePosition.y,sausagePosition.z);
  const centerToContact=contactWorld.clone().sub(sausageCenter);
  const forkRotation=forkPhysicsBody.rotation();
  const forkQuaternion=new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w);
  const forkAngle=new THREE.Euler().setFromQuaternion(forkQuaternion,'XYZ').z;
  const forkAxis=new THREE.Vector3(Math.sin(forkAngle),Math.cos(forkAngle),0);
  const acrossAxis=new THREE.Vector3(Math.cos(forkAngle),-Math.sin(forkAngle),0);
  const alongDistance=centerToContact.dot(forkAxis);
  const perpendicular=centerToContact.clone().addScaledVector(forkAxis,-alongDistance);
  const lateralOffset=centerToContact.dot(acrossAxis);
  return {worldPoint:contactWorld,tineCount,lateralOffset,leverDistance:perpendicular.length()};
}

function checkForkContact(){
  const s=state.active;
  if(!s||state.mode!=='playing')return;
  const hit=forkHitData(s);
  if(hit)catchSausage(hit);
}

function catchSausage(hit) {
  const s=state.active; if(!s) return;
  if(hit.leverDistance>.62){
    dropGlancingSausage(s,hit);
    return;
  }
  state.active=null;state.aimRotation=null;state.caught++;
  const kind=Math.abs(hit.lateralOffset)<=PERFECT_HALF_WIDTH?'PERFECT':'GOOD';
  const points=kind==='PERFECT'?100:50;
  state.score += points;
  const forkPosition=forkPhysicsBody.translation(),forkRotation=forkPhysicsBody.rotation();
  const inverseForkRotation=new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w).invert();
  const localAnchor=hit.worldPoint.clone().sub(new THREE.Vector3(forkPosition.x,forkPosition.y,forkPosition.z)).applyQuaternion(inverseForkRotation);
  const slideAxis={x:Math.sin(terminalForkAngle()),y:Math.cos(terminalForkAngle()),z:0};
  const incoming=s.body.linvel();
  const forkAxis=new THREE.Vector3(slideAxis.x,slideAxis.y,slideAxis.z).applyQuaternion(new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w));
  const slideSpeed=Math.min(-.12,new THREE.Vector3(incoming.x,incoming.y,incoming.z).dot(forkAxis)*.28);
  s.body.setLinvel({x:forkAxis.x*slideSpeed,y:forkAxis.y*slideSpeed,z:forkAxis.z*slideSpeed},true);
  s.body.setGravityScale(1,true);s.body.setLinearDamping(.04);s.body.setAngularDamping(.45);
  // The collider stays physical after piercing. The prismatic joint keeps the
  // actual puncture point on the fork axis, while Rapier contacts decide where
  // this sausage comes to rest against the sausages below it.
  s.collider.setSensor(false);
  // Rapier only reads frame1/frame2 for fixed joints. A prismatic joint builds
  // both local frames from the same `slideAxis`, so it locks the sausage body
  // to the fork's orientation and caught sausages snap horizontal. Rebase the
  // sausage body onto the fork orientation and move the contact-time tilt into
  // the collider and mesh instead, so the joint keeps the real hit angle.
  const forkQuaternion=new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w);
  const sausageRotation=s.body.rotation();
  const sausageQuaternion=new THREE.Quaternion(sausageRotation.x,sausageRotation.y,sausageRotation.z,sausageRotation.w);
  const bodyOffset=forkQuaternion.clone().invert().multiply(sausageQuaternion);
  const colliderRotation=bodyOffset.clone().multiply(s.shape.colliderRotation);
  s.body.setRotation(forkRotation,true);s.body.setAngvel({x:0,y:0,z:0},true);
  s.collider.setRotationWrtParent({x:colliderRotation.x,y:colliderRotation.y,z:colliderRotation.z,w:colliderRotation.w});
  s.mesh.userData.bodyOffset=bodyOffset;
  const sausagePosition=s.body.translation();
  const sausageAnchor=hit.worldPoint.clone().sub(new THREE.Vector3(sausagePosition.x,sausagePosition.y,sausagePosition.z)).applyQuaternion(forkQuaternion.clone().invert());
  const jointData=RAPIER.JointData.prismatic(
    {x:localAnchor.x,y:localAnchor.y,z:localAnchor.z},
    {x:sausageAnchor.x,y:sausageAnchor.y,z:sausageAnchor.z},slideAxis
  );
  const distanceToGuard=Math.max(.08,localAnchor.x*slideAxis.x+localAnchor.y*slideAxis.y-FORK_STACK_STOP_Y);
  jointData.limitsEnabled=true;jointData.limits=[-distanceToGuard,.015];
  const joint=world.createImpulseJoint(jointData,forkPhysicsBody,s.body,true);
  // Skewered sausages overlap the solid fork tip, especially diagonal and
  // vertical ones. Let the joint alone hold them instead of fighting contacts.
  joint.setContactsEnabled(false);
  // The joint locks the sausage's tilt relative to the fork, so its upper end
  // above the body centre stays constant in fork space.
  const topExtent=Math.max(...s.shape.extentPoints.map(point=>point.clone().applyQuaternion(bodyOffset).y))+s.shape.colliderRadius;
  const lateralOffset=new THREE.Vector3(sausagePosition.x-forkPosition.x,sausagePosition.y-forkPosition.y,sausagePosition.z-forkPosition.z).applyQuaternion(forkQuaternion.clone().invert()).x;
  const item={mesh:s.mesh,body:s.body,collider:s.collider,joint,topExtent,lateralOffset,index:state.stack.length,age:0};
  state.stack.push(item);
  showJudgement(kind); sound(kind==='PERFECT'?'perfect':'good'); updateHud();
  state.shake=kind==='PERFECT'?.1:.07;
  state.shotDueAt=state.elapsed+.6;
  scheduleNext(.92);
}

function dropGlancingSausage(s,hit){
  state.active=null;state.aimRotation=null;state.misses++;
  s.body.setGravityScale(1,true);s.body.setLinearDamping(.02);s.body.setAngularDamping(.04);
  const outward=Math.sign(hit.lateralOffset)||Math.sign(s.body.translation().x-fork.position.x)||1;
  s.body.applyImpulse({x:outward*.32,y:.08,z:0},true);
  s.body.applyTorqueImpulse({x:0,y:0,z:-outward*.22},true);
  state.debris.push({mesh:s.mesh,body:s.body});
  showJudgement('SLIP');updateHud();collapse('drop');
}

function updatePhysicalBalance(){
  if(!state.stack.length){state.balance=0;return}
  const forkPosition=forkPhysicsBody.translation(),forkRotation=forkPhysicsBody.rotation();
  const inverseForkRotation=new THREE.Quaternion(forkRotation.x,forkRotation.y,forkRotation.z,forkRotation.w).invert();
  let torque=0;
  state.stack.forEach(item=>{
    const p=item.body.translation();
    const local=new THREE.Vector3(p.x-forkPosition.x,p.y-forkPosition.y,p.z-forkPosition.z).applyQuaternion(inverseForkRotation);
    // The joint fixes each centre's sideways offset at the moment of piercing.
    // Reading it back from the solver picks up joint stretch while the fork
    // sways, which feeds into the tilt and makes tall towers oscillate.
    torque+=item.body.mass()*item.lateralOffset*(.7+Math.max(0,local.y)*.13);
  });
  state.balance=clamp(torque,-BALANCE_LIMIT*1.3,BALANCE_LIMIT*1.3);
}

function miss() {
  if(state.mode!=='playing') return;
  if(state.active){
    const dropped=state.active;
    state.active=null;
    dropped.body.setGravityScale(1,true);dropped.body.setLinearDamping(.01);dropped.body.setAngularDamping(.03);
    state.debris.push({mesh:dropped.mesh,body:dropped.body});
  }
  state.aimRotation=null;
  state.misses++;
  showJudgement('MISS');sound('miss');updateHud();collapse('drop');
}

function collapse(reason='balance') {
  if(state.mode!=='playing')return;
  if(state.stack.length>towerShot.count)captureTowerShot();
  state.mode='collapsing'; ui.tapZone.classList.remove('ready');
  state.endingReason=reason;
  setForkTipsSolid(false);
  if(state.active)removeActive();
  state.stack.forEach((item,i)=>{
    world.removeImpulseJoint(item.joint,true);
    item.collider.setSensor(false);
    item.body.setGravityScale(1,true);item.body.setLinearDamping(.05);item.body.setAngularDamping(.05);
    item.body.applyImpulse({x:(Math.random()-.5)*3 + (i%2?.8:-.8),y:1+Math.random()*2,z:(Math.random()-.5)*2},true);
    item.body.applyTorqueImpulse({x:Math.random()*2,y:Math.random()*3,z:(Math.random()-.5)*7},true);
    state.debris.push({mesh:item.mesh,body:item.body});
  });
  state.stack=[];resetForkExtensions();updateForkTipColliders();state.shake=.65; sound('collapse');
  ui.game.classList.add('shake'); setTimeout(()=>ui.game.classList.remove('shake'),320);
  setTimeout(showResult,1650);
}

function showResult() {
  state.mode='result'; const previousBest=state.best,isBest=state.score>previousBest;
  if(isBest){state.best=state.score;writeBest(state.best);}
  ui.resultBestLabel.textContent=isBest?'これまでのベスト':'ベストスコア';
  renderImageNumber(ui.resultBestScore,isBest?previousBest:state.best,4);
  ui.resultBestGap.hidden=isBest;if(!isBest)renderImageNumber(ui.resultBestGapNumber,state.best-state.score+1);
  renderImageNumber(ui.best,state.best,4);ui.titleBest.textContent=pad(state.best);renderImageNumber(ui.finalScore,state.score,4);ui.newBest.hidden=!isBest;
  renderImageNumber(ui.resultCaught,state.caught);renderImageNumber(ui.resultMisses,state.misses);renderImageTime(ui.resultTime,state.elapsed);
  ui.resultTitle.textContent=state.endingReason==='drop'?'落とした！':'崩れた！';
  ui.resultTitleImage.src=state.endingReason==='drop'?'./assets/result/title-dropped.webp':'./assets/result/title-collapsed.webp';
  showTowerShot();
  recordRanking();
  ui.result.hidden=false;
}

function clearSausages() {
  if(state.active)removeActive();
  [...state.stack,...state.debris].forEach(x=>disposeSausageMesh(x.mesh));
  state.stack.forEach(x=>world.removeRigidBody(x.body));
  state.debris.forEach(x=>world.removeRigidBody(x.body));
  state.stack=[];state.debris=[];
}

function showTitle() {
  clearSausages();
  state.mode='start';
  fork.position.set(0,FORK_REST_Y,.1);fork.rotation.set(0,0,0);state.forkTargetX=0;
  resetForkExtensions();updateForkTipColliders();
  ui.result.hidden=true;ui.start.hidden=false;ui.game.classList.add('is-title');ui.tapZone.classList.remove('ready');
}

function resetGame() {
  clearSausages();
  Object.assign(state,{mode:'playing',score:0,caught:0,misses:0,elapsed:0,nextSpawn:0,forkTargetX:0,pointerNdcX:0,active:null,stack:[],debris:[],shake:0,balance:0,endingReason:'balance',aimRotation:null,shotDueAt:-1});
  startRankingSession();
  resetTowerShot();
  fork.position.set(0,FORK_REST_Y,.1);fork.rotation.set(0,0,0);forkPhysicsBody.setTranslation({x:0,y:FORK_REST_Y,z:.1},true);forkPhysicsBody.setRotation({x:0,y:0,z:0,w:1},true);resetForkExtensions();updateForkTipColliders();setForkTipsSolid(true);ui.result.hidden=true;ui.start.hidden=true;ui.game.classList.remove('is-title');ui.tapZone.classList.add('ready');
  updateHud(); scheduleNext(.4); sound('start');
}

function scheduleNext(delay) { state.nextSpawn=delay; }
function updateHud(){renderImageNumber(ui.score,state.score,4);}
function pad(n){return String(Math.max(0,n)).padStart(4,'0')}
function formatTime(seconds){const total=Math.max(0,Math.floor(seconds));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`}
function renderImageNumber(element,value,padLength=0){
  const text=String(Math.max(0,Math.floor(value))).padStart(padLength,'0');
  element.replaceChildren(...[...text].map(makeDigit));
  element.setAttribute('aria-label',text);
}
function makeDigit(digit){
  const slot=document.createElement('span');slot.className='digit-slot';slot.dataset.digit=digit;
  slot.append(Object.assign(document.createElement('img'),{src:`./assets/result/digit-${digit}.webp`,alt:''}));return slot;
}
function renderImageTime(element,seconds){
  const text=formatTime(seconds),nodes=[];
  for(const character of text){
    if(character===':'){const colon=document.createElement('span');colon.className='digit-colon';colon.textContent=':';nodes.push(colon);}
    else nodes.push(makeDigit(character));
  }
  element.replaceChildren(...nodes);element.setAttribute('aria-label',text);
}
function showJudgement(text){ui.judgement.className=`judgement ${text.toLowerCase()}`;ui.judgement.textContent=text;void ui.judgement.offsetWidth;ui.judgement.classList.add('pop');if(text==='PERFECT'){ui.flash.classList.remove('go');void ui.flash.offsetWidth;ui.flash.classList.add('go')}}

function updateFork(dt) {
  const count=state.stack.length,tremble=count>=10?Math.sin(state.elapsed*(count>=20?7.5:5.2))*(.012+Math.min(.05,(count-10)*.004)):0;
  const flex=count>=20?Math.sin(state.elapsed*2.1)*Math.min(.035,(count-19)*.003):0;
  // Taller towers tip further for the same off-centre load. A full balance
  // meter reaches the fall angle once about 8 sausages are skewered.
  const instability=1+Math.min(.5,count*.028);
  const balanceTilt=-Math.sign(state.balance)*Math.pow(Math.abs(state.balance)/BALANCE_LIMIT,1.18)*FALL_ANGLE*.82*instability;
  const targetRotation=state.aimRotation??(balanceTilt+tremble+flex);
  fork.rotation.z=lerp(fork.rotation.z,targetRotation,Math.min(1,dt*5.5));
  if(state.mode==='playing'){
    // The finger steers the skewer tip. The base shifts against the current
    // lean so the tip always stays under the finger, even if the base (which
    // is cropped below the screen) has to leave the view.
    const tipLean=forkTipWorldPosition().x-fork.position.x;
    state.forkTargetX=screenXToTipX(state.pointerNdcX)-tipLean;
  }
  fork.position.x=lerp(fork.position.x,state.forkTargetX,Math.min(1,dt*11));
  fork.position.y=FORK_REST_Y;
  if(state.mode==='playing'&&count>=3&&state.aimRotation===null&&Math.abs(fork.rotation.z)>=FALL_ANGLE)collapse('balance');
}

// World x at the tip's depth and screen height for a horizontal screen position.
const tipScreenPoint=new THREE.Vector3();
function screenXToTipX(ndcX){
  const tip=forkTipWorldPosition();
  tipScreenPoint.copy(tip).project(camera);
  tipScreenPoint.set(ndcX,tipScreenPoint.y,.5).unproject(camera).sub(camera.position);
  return camera.position.x+tipScreenPoint.x*(tip.z-camera.position.z)/tipScreenPoint.z;
}

function syncMeshToBody(mesh,body){
  const p=body.translation(),q=body.rotation();
  mesh.position.set(p.x,p.y,p.z);mesh.quaternion.set(q.x,q.y,q.z,q.w);
  if(mesh.userData.bodyOffset)mesh.quaternion.multiply(mesh.userData.bodyOffset);
}

// Step Rapier at a fixed rate so stacking behaves the same on 60Hz and 120Hz
// screens and during frame drops.
// The kinematic fork pose is spread across this frame's sub-steps so a frame
// with two steps does not move the skewer (and every sausage) in one jump.
let physicsAccumulator=0;
const forkStepStart=new THREE.Vector3(),forkStepStartRotation=new THREE.Quaternion();
const forkStepPosition=new THREE.Vector3(),forkStepRotation=new THREE.Quaternion();
function updatePhysics(dt) {
  physicsAccumulator=Math.min(physicsAccumulator+dt,PHYSICS_STEP*4);
  const steps=Math.floor(physicsAccumulator/PHYSICS_STEP);
  physicsAccumulator-=steps*PHYSICS_STEP;
  const start=forkPhysicsBody.translation(),startRotation=forkPhysicsBody.rotation();
  forkStepStart.set(start.x,start.y,start.z);
  forkStepStartRotation.set(startRotation.x,startRotation.y,startRotation.z,startRotation.w);
  for(let i=1;i<=steps;i++){
    forkStepPosition.lerpVectors(forkStepStart,fork.position,i/steps);
    forkStepRotation.slerpQuaternions(forkStepStartRotation,fork.quaternion,i/steps);
    forkPhysicsBody.setNextKinematicTranslation({x:forkStepPosition.x,y:forkStepPosition.y,z:forkStepPosition.z});
    forkPhysicsBody.setNextKinematicRotation({x:forkStepRotation.x,y:forkStepRotation.y,z:forkStepRotation.z,w:forkStepRotation.w});
    world.step();
    checkForkContact();
  }
  if(state.active)syncMeshToBody(state.active.mesh,state.active.body);
  state.stack.forEach(item=>{item.age+=dt;syncMeshToBody(item.mesh,item.body)});
  updatePhysicalBalance();
  updateForkLengthFromStack(dt);
  state.debris.forEach(({mesh,body})=>syncMeshToBody(mesh,body));
}

function initAudio(){if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==='suspended')state.audio.resume()}
function sound(type){if(state.muted)return;initAudio();const c=state.audio,t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);let f=220,d=.12,w='sine';
  if(type==='whoosh'){f=130;d=.08;w='triangle'} if(type==='stab'){f=430;d=.07;w='square'} if(type==='perfect'){f=760;d=.22;w='triangle'} if(type==='good'){f=540;d=.15;w='sine'} if(type==='miss'){f=120;d=.3;w='sawtooth'} if(type==='collapse'){f=80;d=.7;w='sawtooth'} if(type==='start'){f=350;d=.25;w='square'}
  o.type=w;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(type==='miss'||type==='collapse'?45:f*1.55,t+d);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(type==='collapse'?.2:.09,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.start(t);o.stop(t+d+.03)
}

function resize(){const w=ui.game.clientWidth,h=ui.game.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}

let cameraBaseX=0;
const towerBounds=new THREE.Box3();
const towerCenter=new THREE.Vector3();
const towerSize=new THREE.Vector3();
function updateTowerCamera(dt){
  fork.updateMatrixWorld(true);
  towerBounds.makeEmpty();
  fork.userData.framingParts.forEach(part=>towerBounds.expandByObject(part));
  state.stack.forEach(item=>{
    item.mesh.updateMatrixWorld(true);
    towerBounds.expandByObject(item.mesh);
  });
  const restTip=forkTipWorldPosition();
  towerBounds.expandByPoint(new THREE.Vector3(restTip.x-.85,restTip.y+2.2,restTip.z));
  towerBounds.expandByPoint(new THREE.Vector3(restTip.x+.85,restTip.y+2.2,restTip.z));
  towerBounds.getCenter(towerCenter);towerBounds.getSize(towerSize);
  const portrait=ui.game.clientHeight/ui.game.clientWidth>1.8;
  const targetFov=portrait?40:44;
  const verticalFov=THREE.MathUtils.degToRad(targetFov);
  const horizontalFov=2*Math.atan(Math.tan(verticalFov/2)*camera.aspect);
  // Aim above the geometric centre so the fork stays in the lower part of the
  // playfield and the sausage tower grows into the open sky above it.
  const compositionRatio=.8-Math.min(.15,state.stack.length*.01875);
  const fittedCompositionY=towerBounds.min.y+towerSize.y*compositionRatio;
  const handleCropOffset=Math.max(.12,.45-state.stack.length*.04);
  // Leave room for the score panels, balance meter and tap prompt. Width is
  // especially important once an unbalanced tower leans toward an edge.
  const verticalExtent=Math.max(fittedCompositionY-towerBounds.min.y,towerBounds.max.y-fittedCompositionY);
  const verticalPadding=.12+Math.min(.5,state.stack.length*.055);
  const fitHeight=(verticalExtent+verticalPadding)/Math.tan(verticalFov/2);
  // Cover the whole drop lane at the current lean, rather than where the fork
  // is right now, so the zoom does not change while the player steers and the
  // finger-to-tip mapping stays put.
  const horizontalExtent=MAX_FORK_TRAVEL+Math.abs(restTip.x-fork.position.x)+.85;
  const fitWidth=(horizontalExtent+.675)/Math.tan(horizontalFov/2);
  // Past MAX_CAMERA_DISTANCE the sausages would get too small, so stop pulling
  // back and frame the top of the tower (the tip and the incoming drop lane)
  // instead, letting the lower part leave the bottom of the screen.
  const targetDistance=Math.min(MAX_CAMERA_DISTANCE,Math.max(9.4,fitHeight,fitWidth)+towerSize.z*.35);
  const visibleHalfHeight=Math.tan(verticalFov/2)*targetDistance;
  const compositionY=Math.max(fittedCompositionY+handleCropOffset,towerBounds.max.y+verticalPadding-visibleHalfHeight);
  // A capped view may be too narrow for a strongly leaning drop lane; pan just
  // enough to keep the lane on screen.
  const laneCenter=restTip.x-fork.position.x,laneHalfWidth=MAX_FORK_TRAVEL+.85+.675;
  const visibleHalfWidth=Math.tan(horizontalFov/2)*targetDistance;
  const targetCameraX=Math.sign(laneCenter)*Math.max(0,Math.abs(laneCenter)+laneHalfWidth-visibleHalfWidth);
  const response=Math.min(1,dt*3.1);
  cameraBaseX=lerp(cameraBaseX,targetCameraX,response);
  camera.fov=lerp(camera.fov,targetFov,response);
  camera.position.z=lerp(camera.position.z,towerCenter.z+targetDistance,response);
  const shake=state.shake>0?(state.shake=Math.max(0,state.shake-dt),state.shake):0;
  camera.position.x=cameraBaseX+(Math.random()-.5)*shake*.16;
  camera.position.y=lerp(camera.position.y,compositionY,response)+(Math.random()-.5)*shake*.12;
  camera.lookAt(cameraBaseX,compositionY,towerCenter.z);
  // Tall towers pull the camera far back; keep the whole tower inside the
  // far plane instead of clipping its top.
  camera.far=Math.max(100,camera.position.z+towerSize.y+20);
  camera.updateProjectionMatrix();
}

// The tower only grows during a run, so the latest settled shot is always the
// tallest one. It is rendered with its own camera framing the whole skewer,
// copied out of the WebGL canvas in the same task, and composed onto the
// background for the result screen and sharing.
const SHOT_WIDTH=720,SHOT_HEIGHT=1280;
const towerShot={canvas:Object.assign(document.createElement('canvas'),{width:SHOT_WIDTH,height:SHOT_HEIGHT}),count:0,blob:null,url:''};
const shotCamera=new THREE.PerspectiveCamera(35,1,.1,1000);
const shotBounds=new THREE.Box3(),shotCenter=new THREE.Vector3(),shotSize=new THREE.Vector3();
const shotBackground=new Image();shotBackground.src='./assets/game-bbq-background.webp';

function drawCover(context,image,width,height){
  const scale=Math.max(width/image.naturalWidth,height/image.naturalHeight);
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  context.drawImage(image,(width-w)/2,(height-h)/2,w,h);
}

function captureTowerShot(){
  if(!state.stack.length)return;
  fork.updateMatrixWorld(true);
  shotBounds.makeEmpty().expandByObject(fork);
  state.stack.forEach(item=>shotBounds.expandByObject(item.mesh));
  shotBounds.getCenter(shotCenter);shotBounds.getSize(shotSize);
  // Fit the tower inside the largest 9:16 area of the current canvas.
  const canvas=renderer.domElement,aspect=canvas.width/canvas.height,shotAspect=SHOT_WIDTH/SHOT_HEIGHT;
  const cropWidth=Math.min(canvas.width,canvas.height*shotAspect),cropHeight=cropWidth/shotAspect;
  shotCamera.aspect=aspect;
  const halfTanY=Math.tan(THREE.MathUtils.degToRad(shotCamera.fov)/2)*cropHeight/canvas.height;
  const halfTanX=Math.tan(THREE.MathUtils.degToRad(shotCamera.fov)/2)*aspect*cropWidth/canvas.width;
  // Keep the tower between the title (top 160px) and the score band (bottom
  // 220px): it fills 68% of the height, centred 30px above the middle.
  const distance=Math.max(shotSize.y*.5/.68/halfTanY,shotSize.x*.6/halfTanX)+shotSize.z/2;
  const cameraY=shotCenter.y-30/SHOT_HEIGHT*2*halfTanY*distance;
  shotCamera.position.set(shotCenter.x,cameraY,shotCenter.z+distance);
  shotCamera.lookAt(shotCenter.x,cameraY,shotCenter.z);
  shotCamera.far=distance+shotSize.z+50;
  shotCamera.updateProjectionMatrix();
  const flying=state.active?.mesh;
  if(flying)flying.visible=false;
  renderer.render(scene,shotCamera);
  if(flying)flying.visible=true;
  const context=towerShot.canvas.getContext('2d');
  context.fillStyle='#4fb6ee';context.fillRect(0,0,SHOT_WIDTH,SHOT_HEIGHT);
  if(shotBackground.complete&&shotBackground.naturalWidth)drawCover(context,shotBackground,SHOT_WIDTH,SHOT_HEIGHT);
  context.drawImage(canvas,(canvas.width-cropWidth)/2,(canvas.height-cropHeight)/2,cropWidth,cropHeight,0,0,SHOT_WIDTH,SHOT_HEIGHT);
  towerShot.count=state.stack.length;
}

function resetTowerShot(){
  towerShot.count=0;towerShot.blob=null;
  if(towerShot.url)URL.revokeObjectURL(towerShot.url);
  towerShot.url='';ui.resultShot.hidden=true;ui.resultShot.removeAttribute('src');
}

function shareText(){
  return `${towerShot.count}本刺して${state.score}点！\n#令和版ソーセージキャッチャー`;
}

function showTowerShot(){
  if(!towerShot.count)return;
  const image=document.createElement('canvas');image.width=SHOT_WIDTH;image.height=SHOT_HEIGHT;
  const context=image.getContext('2d');
  context.drawImage(towerShot.canvas,0,0);
  const font='"Hiragino Maru Gothic ProN","Arial Rounded MT Bold","Noto Sans JP",sans-serif';
  context.textAlign='center';context.lineJoin='round';
  const label=(text,y,size,fill)=>{
    context.font=`900 ${size}px ${font}`;
    context.lineWidth=size*.22;context.strokeStyle='#5a260f';context.strokeText(text,SHOT_WIDTH/2,y);
    context.fillStyle=fill;context.fillText(text,SHOT_WIDTH/2,y);
  };
  label('令和版',70,30,'#ffe67d');
  label('ソーセージキャッチャー',124,50,'#ffffff');
  context.fillStyle='rgba(70,26,7,.72)';
  context.beginPath();context.roundRect(60,SHOT_HEIGHT-210,SHOT_WIDTH-120,150,32);context.fill();
  label(`${towerShot.count}本`,SHOT_HEIGHT-140,58,'#ffe152');
  label(`SCORE ${pad(state.score)}`,SHOT_HEIGHT-82,40,'#ffffff');
  image.toBlob(blob=>{
    if(!blob||state.mode!=='result')return;
    towerShot.blob=blob;towerShot.url=URL.createObjectURL(blob);
    ui.resultShot.src=towerShot.url;ui.resultShot.hidden=false;
  },'image/png');
}

async function shareResult(){
  const text=shareText(),url=/^https?:$/.test(location.protocol)?location.href:undefined;
  const file=towerShot.blob&&new File([towerShot.blob],'sausage-tower.png',{type:'image/png'});
  try{
    if(file&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],text,url});return}
    if(navigator.share){await navigator.share({text,url});return}
  }catch(error){if(error.name==='AbortError')return}
  open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}${url?`&url=${encodeURIComponent(url)}`:''}`,'_blank','noopener');
}

// Ranking: every game asks the API for a one-time play token. When the game
// ends the score is recorded right away for this browser's player, whose
// entry keeps their best. The player can then set the name shown for it.
let rankingPeriod='all',rankingEntry=null;
const rankingErrors={
  invalid_name:'その名前は使えません',
  invalid_key:'先にゲームを1回記録してください',
  invalid_token:'この記録はランキングに記録できませんでした',
  invalid_score:'この記録はランキングに記録できませんでした',
  too_many_requests:'少し時間をおいてから試してください'
};

async function rankingApi(path,options){
  const response=await fetch(`${RANKING_API}/${path}`,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||'request_failed'),{code:data.error});
  return data;
}

function postJson(path,body){
  return rankingApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

function startRankingSession(){
  state.playTokenRequest=RANKING_API?rankingApi('start.php',{method:'POST'}).then(data=>data.token).catch(()=>null):Promise.resolve(null);
}

function setRankingStatus(text){
  ui.rankingStatus.textContent=text;ui.rankingStatus.hidden=!text;
}

async function recordRanking(){
  rankingEntry=null;ui.rankingForm.hidden=true;setRankingStatus('');
  if(!RANKING_API||!state.caught)return;
  const request=state.playTokenRequest,score=state.score,sausages=state.caught;
  const isCurrent=()=>state.mode==='result'&&request===state.playTokenRequest;
  setRankingStatus('ランキングに記録中…');
  const token=await request;
  if(!isCurrent())return;
  if(!token){setRankingStatus('通信できなかったため、ランキングに記録できませんでした');return}
  try{
    const result=await postJson('score.php',{token,playerKey:playerKey(),score,sausages,name:readName()||undefined});
    if(!isCurrent())return;
    rankingEntry=result;
    setRankingStatus(rankingSummary(result,score));
    ui.rankingName.value=readName()||'';ui.rankingSubmit.disabled=false;ui.rankingForm.hidden=false;
  }catch(error){
    if(isCurrent())setRankingStatus(rankingErrors[error.code]||'ランキングに記録できませんでした');
  }
}

// The ranking shows each player's best, so say when this game did not beat it.
function rankingSummary(entry,score){
  const ranks=`総合 ${entry.rankAll}位 ／ 今日 ${entry.rankToday}位`;
  return score>=entry.bestAll?`${ranks}（ベスト更新！）`:`${ranks}（ランキングはベスト ${entry.bestAll}点で掲載）`;
}

async function submitRankingName(){
  const name=ui.rankingName.value.trim(),entry=rankingEntry;
  if(!name||!entry)return;
  ui.rankingSubmit.disabled=true;
  try{
    const result=await postJson('name.php',{playerKey:playerKey(),name});
    writeName(result.name);ui.rankingName.value=result.name;
    if(entry===rankingEntry)setRankingStatus(`「${result.name}」で登録しました（総合 ${entry.rankAll}位 ／ 今日 ${entry.rankToday}位）`);
  }catch(error){
    if(entry===rankingEntry)setRankingStatus(rankingErrors[error.code]||'名前を登録できませんでした');
  }finally{
    ui.rankingSubmit.disabled=false;
  }
}

function openRanking(){
  ui.rankingPanel.hidden=false;
  loadRanking(rankingPeriod);
}

async function loadRanking(period){
  rankingPeriod=period;
  ui.rankingPanel.querySelectorAll('[data-period]').forEach(tab=>tab.classList.toggle('active',tab.dataset.period===period));
  ui.rankingList.replaceChildren();
  ui.rankingMessage.textContent='読み込み中…';
  try{
    const {entries}=await rankingApi(`ranking.php?period=${period}`);
    if(period!==rankingPeriod)return;
    ui.rankingList.replaceChildren(...entries.map(entry=>{
      const row=document.createElement('li');
      [['rank',entry.rank],['name',entry.name],['count',`${entry.sausages}本`],['points',entry.score]].forEach(([className,text])=>{
        const cell=document.createElement('span');cell.className=className;cell.textContent=text;row.append(cell);
      });
      return row;
    }));
    ui.rankingMessage.textContent=entries.length?'':'まだ記録がありません';
  }catch{
    if(period===rankingPeriod)ui.rankingMessage.textContent='ランキングを読み込めませんでした';
  }
}

addEventListener('resize',resize,{passive:true});resize();
ui.startButton.addEventListener('click',e=>{e.stopPropagation();initAudio();resetGame()});
ui.retryButton.addEventListener('click',e=>{e.stopPropagation();resetGame()});
ui.titleButton.addEventListener('click',e=>{e.stopPropagation();showTitle()});
ui.shareButton.addEventListener('click',e=>{e.stopPropagation();shareResult()});
ui.rankingForm.addEventListener('submit',e=>{e.preventDefault();submitRankingName()});
[ui.titleRankingButton,ui.resultRankingButton].forEach(button=>{button.hidden=!RANKING_API;button.addEventListener('click',e=>{e.stopPropagation();openRanking()})});
ui.rankingClose.addEventListener('click',e=>{e.stopPropagation();ui.rankingPanel.hidden=true});
ui.rankingPanel.querySelectorAll('[data-period]').forEach(tab=>tab.addEventListener('click',()=>loadRanking(tab.dataset.period)));
function moveForkFromPointer(e){
  if(state.mode!=='playing')return;
  const rect=ui.game.getBoundingClientRect();
  state.pointerNdcX=clamp((e.clientX-rect.left)/rect.width,0,1)*2-1;
}
ui.tapZone.addEventListener('pointerdown',e=>{e.preventDefault();ui.tapZone.setPointerCapture?.(e.pointerId);moveForkFromPointer(e)});
ui.tapZone.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.buttons||e.pointerType==='touch')moveForkFromPointer(e)});
ui.soundToggle.addEventListener('click',e=>{e.stopPropagation();state.muted=!state.muted;ui.soundToggle.classList.toggle('muted',state.muted);ui.soundToggle.setAttribute('aria-label',state.muted?'音を出す':'音を切る');if(!state.muted)sound('good')});
addEventListener('keydown',e=>{if(state.mode==='playing'&&(e.code==='ArrowLeft'||e.code==='ArrowRight')){e.preventDefault();state.pointerNdcX=clamp(state.pointerNdcX+(e.code==='ArrowLeft'?-.1:.1),-1,1)}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.audio?.state==='running')state.audio.suspend()});

let last=performance.now();
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.034,(now-last)/1000);last=now;state.elapsed+=dt;
  if(state.mode==='playing'){state.nextSpawn-=dt;if(state.nextSpawn<=0&&!state.active)spawnSausage();updateFlying(dt)}
  updateFork(dt);updatePhysics(dt);
  updateTowerCamera(dt);
  if(state.mode==='playing'&&state.shotDueAt>=0&&state.elapsed>=state.shotDueAt){state.shotDueAt=-1;captureTowerShot()}
  renderer.render(scene,camera)
}
ui.loading.classList.add('done');state.mode='start';requestAnimationFrame(frame);

