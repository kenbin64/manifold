/**
 * AVATAR BUILDER — Procedural 3D Character System
 * Labyrinth A (Encode): User customization -> config -> save
 * Labyrinth B (Decode): Config -> 3D mesh -> render
 */
const AvatarBuilder = {
  DEFAULTS: {
    gender:'neutral', bodyType:'average', skinTone:'#c68642',
    hairStyle:'short', hairColor:'#2c1810', eyeColor:'#4a6741',
    glasses:'none', topStyle:'tshirt', topColor:'#2244aa',
    bottomStyle:'jeans', bottomColor:'#1a1a2e', shoeColor:'#333333',
    personality:3, name:'',
  },
  SKIN_TONES:['#fce4c7','#f5d0a9','#e0ac69','#c68642','#8d5524','#5c3310','#3b1f0b'],
  HAIR_COLORS:['#2c1810','#4a3728','#8b6914','#d4a017','#c0392b','#1a1a2a','#e8e8e8','#ff69b4','#00d4ff','#39ff14'],
  EYE_COLORS:['#4a6741','#2e5090','#634e34','#3d6b50','#8b4513','#1a1a1a','#b24dff','#00d4ff'],
  TOP_COLORS:['#2244aa','#cc2233','#228833','#ffaa00','#8844cc','#ff2d95','#00d4ff','#1a1a2e','#e8e8e8'],
  BOTTOM_COLORS:['#1a1a2e','#2c3e50','#4a4a4a','#8b4513','#1a3a5c','#2d1b4e'],
  PERSONALITIES:[
    {id:0,name:'Bold',emoji:'\u26a1',desc:'Aggressive, first to act'},
    {id:1,name:'Chill',emoji:'\ud83c\udf0a',desc:'Relaxed, goes with the flow'},
    {id:2,name:'Trickster',emoji:'\ud83c\udccf',desc:'Unpredictable, loves surprises'},
    {id:3,name:'Strategist',emoji:'\u265f\ufe0f',desc:'Calculated, thinks ahead'},
    {id:4,name:'Social',emoji:'\ud83d\udcac',desc:'Talkative, team player'},
    {id:5,name:'Rebel',emoji:'\ud83d\udd25',desc:'Rule-bender, wildcard'},
    {id:6,name:'Zen',emoji:'\ud83e\uddd8',desc:'Patient, unshakeable'},
  ],
  HAIR_STYLES:['none','buzz','short','medium','long','mohawk','ponytail'],
  GLASSES_STYLES:['none','round','square','aviator'],
  BODY_TYPES:['slim','average','athletic','heavy'],
  GENDERS:['male','female','neutral'],
  TOP_STYLES:['tshirt','hoodie','jacket','tank'],
  BOTTOM_STYLES:['jeans','shorts','skirt','sweats'],

  _config:null, _scene:null, _camera:null, _renderer:null,
  _avatarGroup:null, _animFrame:null, _container:null,
  _orbitState:{dragging:false,prevX:0,prevY:0,rotY:0,rotX:0.1},
  _gyroEnabled:false,

  init(containerId, config) {
    this._config = {...this.DEFAULTS, ...(config||{})};
    this._container = document.getElementById(containerId);
    if (!this._container) return;
    const w = this._container.clientWidth||320, h = this._container.clientHeight||480;
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(40, w/h, 0.1, 50);
    this._camera.position.set(0, 1.4, 3.5);
    this._camera.lookAt(0, 0.9, 0);
    this._renderer = new THREE.WebGLRenderer({alpha:true, antialias:true});
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.shadowMap.enabled = true;
    this._container.appendChild(this._renderer.domElement);
    this._scene.add(new THREE.AmbientLight(0x404060, 0.6));
    const key = new THREE.DirectionalLight(0xffeedd, 1.2);
    key.position.set(3,5,4); key.castShadow=true; this._scene.add(key);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
    fill.position.set(-3,3,2); this._scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff2d95, 0.6);
    rim.position.set(0,2,-4); this._scene.add(rim);
    this._addGroundPlane();
    this._avatarGroup = new THREE.Group();
    this._scene.add(this._avatarGroup);
    this.rebuild();
    this._initOrbitControls();
    this._initGyroscope();
    this._animate();
    this._resizeHandler = () => {
      const nw=this._container.clientWidth, nh=this._container.clientHeight;
      this._camera.aspect=nw/nh; this._camera.updateProjectionMatrix();
      this._renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', this._resizeHandler);
  },

  _addGroundPlane() {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,0.05,32),
      new THREE.MeshPhongMaterial({color:0x0a0a1a,emissive:0x050510,transparent:true,opacity:0.8}));
    p.position.y=-0.025; p.receiveShadow=true; this._scene.add(p);
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.25,0.02,8,64),
      new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.7}));
    r.rotation.x=Math.PI/2; r.position.y=0.01; this._scene.add(r); this._neonRing=r;
  },

  rebuild() {
    while(this._avatarGroup.children.length>0){
      const c=this._avatarGroup.children[0];
      if(c.geometry)c.geometry.dispose();
      if(c.material){if(Array.isArray(c.material))c.material.forEach(m=>m.dispose());else c.material.dispose();}
      this._avatarGroup.remove(c);
    }
    const cfg=this._config, bs=this._getBodyScale(cfg.bodyType,cfg.gender);
    const skin=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.skinTone),shininess:30});
    this._buildBody(bs,skin,cfg); this._buildHead(bs,skin,cfg);
    this._buildArms(bs,skin,cfg); this._buildLegs(bs,cfg);
    this._buildHair(cfg,1.55); this._buildGlasses(cfg,1.55);
  },

  set(k,v){if(this._config&&k in this.DEFAULTS){this._config[k]=v;this.rebuild();}},
  getConfig(){return{...this._config};},
  setConfig(c){this._config={...this.DEFAULTS,...c};this.rebuild();},
  saveToProfile(){try{localStorage.setItem('kensgames_avatar',JSON.stringify(this._config));}catch(e){}},
  loadFromProfile(){
    try{const d=localStorage.getItem('kensgames_avatar');
      if(d){this._config={...this.DEFAULTS,...JSON.parse(d)};if(this._avatarGroup)this.rebuild();return true;}}
    catch(e){}return false;
  },
  destroy(){
    cancelAnimationFrame(this._animFrame);
    window.removeEventListener('resize',this._resizeHandler);
    if(this._renderer){this._renderer.dispose();this._container?.removeChild(this._renderer.domElement);}
    this._scene=this._camera=this._renderer=null;
  },

  /**
   * Derive body proportions via ManifoldProportion (z = x·y).
   * bodyType is x-coordinate, gender is y-coordinate on the saddle.
   * Each body dimension = ManifoldProportion.derive(bt, g, baseDimension).
   */
  _getBodyScale(bt, g) {
    // Base dimensions (average/neutral saddle origin)
    const B = { tW: .38, tH: .55, tD: .22, hW: .35, sW: .42, lW: .12, aW: .08 };
    return {
      tW: ManifoldProportion.derive(bt, g, B.tW),
      tH: ManifoldProportion.derive(bt, g, B.tH),
      tD: ManifoldProportion.derive(bt, g, B.tD),
      hW: ManifoldProportion.derive(bt, g, B.hW),
      sW: ManifoldProportion.derive(bt, g, B.sW),
      lW: ManifoldProportion.derive(bt, g, B.lW),
      aW: ManifoldProportion.derive(bt, g, B.aW),
    };
  },

  _buildBody(s, skin, cfg) {
    const tg = new THREE.BoxGeometry(s.tW, s.tH, s.tD, 2, 2, 2);
    const pos = tg.attributes.position;
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const f=1-Math.pow(Math.abs(y)/(s.tH/2),3)*0.08;
      pos.setX(i,x*f); pos.setZ(i,z*f);
    }
    tg.computeVertexNormals();
    const topMat=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.topColor),shininess:20});
    const torso=new THREE.Mesh(tg,topMat); torso.position.y=1.05; torso.castShadow=true;
    this._avatarGroup.add(torso);
    if(cfg.topStyle==='hoodie'||cfg.topStyle==='jacket'){
      const cg=new THREE.CylinderGeometry(s.tW*0.35,s.tW*0.38,0.08,12);
      const cm=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.topColor).multiplyScalar(0.8)});
      const col=new THREE.Mesh(cg,cm); col.position.y=1.05+s.tH/2-0.02; this._avatarGroup.add(col);
    }
    const belt=new THREE.Mesh(new THREE.BoxGeometry(s.hW+0.02,0.04,s.tD+0.02),
      new THREE.MeshPhongMaterial({color:0x1a1a1a}));
    belt.position.y=0.78; this._avatarGroup.add(belt);
    const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.08,0.1,8),skin);
    neck.position.y=1.05+s.tH/2+0.05; this._avatarGroup.add(neck);
  },

  _buildHead(s, skin, cfg) {
    const hY=1.55;
    const hg=new THREE.SphereGeometry(0.16,16,12); hg.scale(1,1.1,0.95);
    const head=new THREE.Mesh(hg,skin); head.position.y=hY; head.castShadow=true;
    this._avatarGroup.add(head);
    const eyeW=new THREE.MeshPhongMaterial({color:0xffffff,shininess:80});
    const irisM=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.eyeColor),shininess:60});
    const pupilM=new THREE.MeshPhongMaterial({color:0x000000});
    for(const side of[-1,1]){
      const e=new THREE.Mesh(new THREE.SphereGeometry(0.032,8,8),eyeW);
      e.position.set(side*0.055,hY+0.02,0.14); this._avatarGroup.add(e);
      const ir=new THREE.Mesh(new THREE.SphereGeometry(0.018,8,8),irisM);
      ir.position.set(side*0.055,hY+0.02,0.165); this._avatarGroup.add(ir);
      const pu=new THREE.Mesh(new THREE.SphereGeometry(0.009,6,6),pupilM);
      pu.position.set(side*0.055,hY+0.02,0.175); this._avatarGroup.add(pu);
    }
    // Eyebrows
    for(const side of[-1,1]){
      const bg=new THREE.BoxGeometry(0.04,0.008,0.01);
      const bm=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.hairColor)});
      const brow=new THREE.Mesh(bg,bm);
      brow.position.set(side*0.055,hY+0.06,0.145); brow.rotation.z=side*-0.15;
      this._avatarGroup.add(brow);
    }
    const mouth=new THREE.Mesh(new THREE.TorusGeometry(0.03,0.006,4,8,Math.PI),
      new THREE.MeshPhongMaterial({color:0xcc6666}));
    mouth.position.set(0,hY-0.055,0.14); mouth.rotation.x=Math.PI; mouth.rotation.z=Math.PI;
    this._avatarGroup.add(mouth);
    const ng=new THREE.SphereGeometry(0.02,6,6); ng.scale(0.7,0.8,1);
    const nose=new THREE.Mesh(ng,skin); nose.position.set(0,hY-0.01,0.16);
    this._avatarGroup.add(nose);
    // Ears
    for(const side of[-1,1]){
      const eg=new THREE.SphereGeometry(0.035,6,6); eg.scale(0.5,0.7,0.4);
      const ear=new THREE.Mesh(eg,skin); ear.position.set(side*0.155,hY+0.01,0.0);
      this._avatarGroup.add(ear);
    }
  },

  _buildArms(s, skin, cfg) {
    const topMat=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.topColor),shininess:20});
    const shoulderY=1.05+s.tH/2-0.05;
    for(const side of[-1,1]){
      // Upper arm (clothed)
      const ua=new THREE.Mesh(new THREE.CylinderGeometry(s.aW,s.aW*0.9,0.28,8),
        cfg.topStyle==='tank'?skin:topMat);
      ua.position.set(side*(s.sW/2+s.aW),shoulderY-0.14,0); this._avatarGroup.add(ua);
      // Lower arm (skin)
      const la=new THREE.Mesh(new THREE.CylinderGeometry(s.aW*0.85,s.aW*0.7,0.25,8),skin);
      la.position.set(side*(s.sW/2+s.aW),shoulderY-0.42,0); this._avatarGroup.add(la);
      // Hand
      const hand=new THREE.Mesh(new THREE.SphereGeometry(s.aW*0.9,6,6),skin);
      hand.position.set(side*(s.sW/2+s.aW),shoulderY-0.56,0); this._avatarGroup.add(hand);
    }
  },

  _buildLegs(s, cfg) {
    const bottomMat=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.bottomColor),shininess:15});
    const shoeMat=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.shoeColor),shininess:40});
    const isShorts=cfg.bottomStyle==='shorts';
    const isSkirt=cfg.bottomStyle==='skirt';
    if(isSkirt){
      const sg=new THREE.CylinderGeometry(s.hW*0.4,s.hW*0.7,0.35,12);
      const skirt=new THREE.Mesh(sg,bottomMat); skirt.position.y=0.6; this._avatarGroup.add(skirt);
    }
    for(const side of[-1,1]){
      const legH=isShorts?0.18:0.35;
      const ul=new THREE.Mesh(new THREE.CylinderGeometry(s.lW,s.lW*0.95,legH,8),bottomMat);
      ul.position.set(side*0.09,isShorts?0.55:0.45,0); this._avatarGroup.add(ul);
      if(isShorts){
        const skinMat=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.skinTone),shininess:30});
        const ll=new THREE.Mesh(new THREE.CylinderGeometry(s.lW*0.9,s.lW*0.8,0.2,8),skinMat);
        ll.position.set(side*0.09,0.35,0); this._avatarGroup.add(ll);
      }
      // Lower leg
      const llg=new THREE.Mesh(new THREE.CylinderGeometry(s.lW*0.9,s.lW*0.75,0.3,8),bottomMat);
      llg.position.set(side*0.09,0.15,0); this._avatarGroup.add(llg);
      // Shoe
      const sg2=new THREE.BoxGeometry(s.lW*1.4,0.08,s.lW*2);
      const shoe=new THREE.Mesh(sg2,shoeMat);
      shoe.position.set(side*0.09,0.02,0.02); this._avatarGroup.add(shoe);
    }
  },

  _buildHair(cfg, hY) {
    if(cfg.hairStyle==='none') return;
    const hm=new THREE.MeshPhongMaterial({color:new THREE.Color(cfg.hairColor),shininess:40});
    const R=0.17;
    if(cfg.hairStyle==='buzz'){
      const g=new THREE.SphereGeometry(R,16,12); g.scale(1.02,1.05,0.98);
      const h=new THREE.Mesh(g,hm); h.position.y=hY+0.02; this._avatarGroup.add(h);
    } else if(cfg.hairStyle==='short'){
      const g=new THREE.SphereGeometry(R,16,12); g.scale(1.05,1.1,1.0);
      const h=new THREE.Mesh(g,hm); h.position.y=hY+0.03; this._avatarGroup.add(h);
    } else if(cfg.hairStyle==='medium'){
      const g=new THREE.SphereGeometry(R*1.1,16,12); g.scale(1.08,1.12,1.05);
      const h=new THREE.Mesh(g,hm); h.position.y=hY+0.03; this._avatarGroup.add(h);
      // Side strands
      for(const side of[-1,1]){
        const sg=new THREE.CylinderGeometry(0.04,0.03,0.15,6);
        const s=new THREE.Mesh(sg,hm); s.position.set(side*0.14,hY-0.05,0); this._avatarGroup.add(s);
      }
    } else if(cfg.hairStyle==='long'){
      const g=new THREE.SphereGeometry(R*1.12,16,12); g.scale(1.1,1.15,1.08);
      const h=new THREE.Mesh(g,hm); h.position.y=hY+0.04; this._avatarGroup.add(h);
      const bg=new THREE.CylinderGeometry(0.1,0.06,0.35,8);
      const back=new THREE.Mesh(bg,hm); back.position.set(0,hY-0.15,-0.08); this._avatarGroup.add(back);
      for(const side of[-1,1]){
        const sg=new THREE.CylinderGeometry(0.04,0.025,0.25,6);
        const s=new THREE.Mesh(sg,hm); s.position.set(side*0.14,hY-0.1,0); this._avatarGroup.add(s);
      }
    } else if(cfg.hairStyle==='mohawk'){
      for(let i=0;i<6;i++){
        const sz=0.04-i*0.003;
        const mg=new THREE.BoxGeometry(0.02,sz*2,0.04);
        const m=new THREE.Mesh(mg,hm); m.position.set(0,hY+0.12+i*0.015,-0.02+i*0.015);
        this._avatarGroup.add(m);
      }
    } else if(cfg.hairStyle==='ponytail'){
      const g=new THREE.SphereGeometry(R*1.05,16,12); g.scale(1.05,1.08,1.0);
      const h=new THREE.Mesh(g,hm); h.position.y=hY+0.03; this._avatarGroup.add(h);
      const pg=new THREE.CylinderGeometry(0.04,0.02,0.25,6);
      const pt=new THREE.Mesh(pg,hm); pt.position.set(0,hY-0.05,-0.15);
      pt.rotation.x=0.4; this._avatarGroup.add(pt);
    }
  },

  _buildGlasses(cfg, hY) {
    if(cfg.glasses==='none') return;
    const gm=new THREE.MeshPhongMaterial({color:0x222222,shininess:80});
    const lensM=new THREE.MeshPhongMaterial({color:0x88aacc,transparent:true,opacity:0.3,shininess:90});
    if(cfg.glasses==='round'){
      for(const side of[-1,1]){
        const fr=new THREE.Mesh(new THREE.TorusGeometry(0.03,0.003,8,16),gm);
        fr.position.set(side*0.055,hY+0.02,0.155); this._avatarGroup.add(fr);
        const lens=new THREE.Mesh(new THREE.CircleGeometry(0.028,12),lensM);
        lens.position.set(side*0.055,hY+0.02,0.156); this._avatarGroup.add(lens);
      }
    } else if(cfg.glasses==='square'){
      for(const side of[-1,1]){
        const fg=new THREE.BoxGeometry(0.06,0.04,0.005);
        const fr=new THREE.Mesh(fg,gm); fr.position.set(side*0.055,hY+0.02,0.155); this._avatarGroup.add(fr);
        const lg=new THREE.BoxGeometry(0.05,0.03,0.003);
        const lens=new THREE.Mesh(lg,lensM); lens.position.set(side*0.055,hY+0.02,0.157); this._avatarGroup.add(lens);
      }
    } else if(cfg.glasses==='aviator'){
      for(const side of[-1,1]){
        const fg=new THREE.SphereGeometry(0.035,8,8); fg.scale(1,1.2,0.1);
        const fr=new THREE.Mesh(fg,gm); fr.position.set(side*0.055,hY+0.015,0.155); this._avatarGroup.add(fr);
        const lg=new THREE.SphereGeometry(0.03,8,8); lg.scale(1,1.1,0.1);
        const lens=new THREE.Mesh(lg,new THREE.MeshPhongMaterial({color:0x446688,transparent:true,opacity:0.5}));
        lens.position.set(side*0.055,hY+0.015,0.157); this._avatarGroup.add(lens);
      }
    }
    // Bridge
    const bridge=new THREE.Mesh(new THREE.CylinderGeometry(0.003,0.003,0.04,4),gm);
    bridge.rotation.z=Math.PI/2; bridge.position.set(0,hY+0.02,0.157); this._avatarGroup.add(bridge);
    // Temples
    for(const side of[-1,1]){
      const tg=new THREE.CylinderGeometry(0.002,0.002,0.12,4);
      const temple=new THREE.Mesh(tg,gm); temple.rotation.x=Math.PI/2;
      temple.position.set(side*0.08,hY+0.025,0.1); this._avatarGroup.add(temple);
    }
  },

  _initOrbitControls() {
    const el=this._renderer.domElement;
    const onDown=(x,y)=>{this._orbitState.dragging=true;this._orbitState.prevX=x;this._orbitState.prevY=y;};
    const onMove=(x,y)=>{
      if(!this._orbitState.dragging)return;
      const dx=x-this._orbitState.prevX, dy=y-this._orbitState.prevY;
      this._orbitState.rotY+=dx*0.01; this._orbitState.rotX+=dy*0.005;
      this._orbitState.rotX=Math.max(-0.3,Math.min(0.6,this._orbitState.rotX));
      this._orbitState.prevX=x; this._orbitState.prevY=y;
    };
    const onUp=()=>{this._orbitState.dragging=false;};
    el.addEventListener('mousedown',e=>onDown(e.clientX,e.clientY));
    el.addEventListener('mousemove',e=>onMove(e.clientX,e.clientY));
    el.addEventListener('mouseup',onUp);
    el.addEventListener('touchstart',e=>{const t=e.touches[0];onDown(t.clientX,t.clientY);},{passive:true});
    el.addEventListener('touchmove',e=>{const t=e.touches[0];onMove(t.clientX,t.clientY);},{passive:true});
    el.addEventListener('touchend',onUp,{passive:true});
  },

  _initGyroscope() {
    if(typeof DeviceOrientationEvent==='undefined')return;
    const handler=(e)=>{
      if(e.gamma===null)return;
      this._gyroEnabled=true;
      this._orbitState.rotY=e.gamma*Math.PI/180*0.5;
      this._orbitState.rotX=Math.max(-0.3,Math.min(0.6,(e.beta-70)*Math.PI/180*0.3));
    };
    if(DeviceOrientationEvent.requestPermission){
      this._gyroPermissionNeeded=true;
      this._requestGyro=()=>DeviceOrientationEvent.requestPermission().then(r=>{
        if(r==='granted')window.addEventListener('deviceorientation',handler);
      });
    } else { window.addEventListener('deviceorientation',handler); }
  },

  _animate() {
    const loop=()=>{
      this._animFrame=requestAnimationFrame(loop);
      if(!this._renderer||!this._scene||!this._camera)return;
      // Orbit camera
      const r=3.5, o=this._orbitState;
      this._camera.position.x=Math.sin(o.rotY)*r;
      this._camera.position.z=Math.cos(o.rotY)*r;
      this._camera.position.y=1.4+o.rotX*2;
      this._camera.lookAt(0,0.9,0);
      // Neon ring pulse
      if(this._neonRing){
        const t=Date.now()*0.002;
        this._neonRing.material.opacity=0.5+Math.sin(t)*0.2;
      }
      this._renderer.render(this._scene,this._camera);
    };
    loop();
  },

  /** Create a mini avatar for lobby/thumbnail (returns canvas element) */
  createMiniAvatar(config, size) {
    size = size || 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    cam.position.set(0, 1.5, 2.5); cam.lookAt(0, 1.0, 0);
    scene.add(new THREE.AmbientLight(0x606060, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 1); dl.position.set(2,4,3); scene.add(dl);
    const oldCfg = this._config;
    this._config = {...this.DEFAULTS, ...(config||{})};
    const grp = new THREE.Group(); this._avatarGroup = grp; scene.add(grp);
    this.rebuild();
    this._avatarGroup = null; this._config = oldCfg;
    const r = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
    r.setSize(size,size); r.setClearColor(0x000000,0); r.render(scene,cam); r.dispose();
    // cleanup
    grp.traverse(c=>{if(c.geometry)c.geometry.dispose();if(c.material){
      if(Array.isArray(c.material))c.material.forEach(m=>m.dispose());else c.material.dispose();}});
    return canvas;
  },
};
if(typeof window!=='undefined')window.AvatarBuilder=AvatarBuilder;

