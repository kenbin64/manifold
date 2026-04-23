// Minimal 3D Brickbreaker prototype using Three.js (no external physics)
(function(){
  const container = document.getElementById('container');
  let scene, camera, renderer, paddle, ball, bricks = [], raycaster;
  let ballVel = new THREE.Vector3(0.18, 0.18, -0.25);
  let paddleX = 0;
  let score = 0, lives = 3;
  let launched = false;

  init();
  animate();

  function init(){
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050514);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
    camera.position.set(0, 6, 18);

    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5,10,7);
    scene.add(dir);

    // Floor/backdrop
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60,40), new THREE.MeshStandardMaterial({color:0x081124,metalness:0.2,roughness:0.8}));
    floor.rotation.x = -Math.PI/2; floor.position.y = -2; floor.position.z = 0; scene.add(floor);

    // Paddle
    const padGeo = new THREE.BoxGeometry(4,0.6,1);
    const padMat = new THREE.MeshStandardMaterial({color:0xffcc33,metalness:0.3,roughness:0.4});
    paddle = new THREE.Mesh(padGeo,padMat);
    paddle.position.set(0,0.5,8);
    scene.add(paddle);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.35, 16, 12);
    const ballMat = new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x8888ff,metalness:0.2,roughness:0.1});
    ball = new THREE.Mesh(ballGeo, ballMat);
    resetBall();
    scene.add(ball);

    // Bricks: layers in 3D wall
    createBricks();

    // Controls
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown);

    raycaster = new THREE.Raycaster();

    updateHUD();
  }

  function createBricks(){
    const rows = 6, cols = 10, depthLayers = 3;
    const brickW = 2.2, brickH = 0.9, gap = 0.2;
    const startX = -((cols*(brickW+gap))-gap)/2 + brickW/2;
    const startY = 3.5;
    const startZ = -4;
    const colors = [0xff6666,0xffaa66,0xffdd66,0x66ccff,0x88ff88,0xcc88ff];

    for(let d=0; d<depthLayers; d++){
      for(let r=0;r<rows;r++){
        for(let c=0;c<cols;c++){
          const geo = new THREE.BoxGeometry(brickW, brickH, 1.0);
          const mat = new THREE.MeshStandardMaterial({color: colors[r%colors.length], metalness:0.2, roughness:0.4});
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(startX + c*(brickW+gap), startY + r*(brickH+gap), startZ - d*1.2);
          mesh.userData = { hits: 1 };
          scene.add(mesh);
          bricks.push(mesh);
        }
      }
    }
  }

  function resetBall(){
    ball.position.set(0,1.1,7.2);
    ballVel.set(0.18, 0.18, -0.25);
    launched = false;
  }

  function onMouseMove(e){
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    paddleX = nx * 7; // map to world x
    paddle.position.x = paddleX;
    if (!launched){ ball.position.x = paddle.position.x; }
  }

  function onResize(){
    camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function onClick(){ if (!launched) launched = true; }

  function onKeyDown(e){
    if(e.key === 'ArrowLeft') paddle.position.x -= 0.6;
    if(e.key === 'ArrowRight') paddle.position.x += 0.6;
    if(!launched && (e.key===' '||e.key==='Enter')) launched = true;
  }

  function updateHUD(){ document.getElementById('score').textContent = score; document.getElementById('lives').textContent = lives; }

  function animate(){
    requestAnimationFrame(animate);
    step();
    renderer.render(scene,camera);
  }

  function step(){
    if(launched){
      ball.position.add(ballVel);

      // Collide with walls
      if(ball.position.x < -10 || ball.position.x > 10) { ballVel.x *= -1; ball.position.x = THREE.MathUtils.clamp(ball.position.x,-10,10); }
      if(ball.position.y > 12) { ballVel.y *= -1; ball.position.y = 12; }
      if(ball.position.z < -20) { ballVel.z *= -1; ball.position.z = -20; }

      // Paddle collision (AABB simple)
      const padBB = new THREE.Box3().setFromObject(paddle);
      const ballBB = new THREE.Sphere(ball.position, 0.35);
      if(padBB.containsPoint(ball.position) || padBB.distanceToPoint(ball.position) < 0.6){
        // Reflect based on where it hit
        const rel = (ball.position.x - paddle.position.x) / 4; // -1..1
        ballVel.x = rel * 0.6;
        ballVel.z *= -1;
        ball.position.z = paddle.position.z - 0.9;
      }

      // Floor (miss)
      if(ball.position.y < -1){ lives--; updateHUD(); if(lives<=0){ alert('Game Over'); resetGame(); } else { resetBall(); }}

      // Brick collisions
      for(let i=bricks.length-1;i>=0;i--){
        const b = bricks[i];
        const bb = new THREE.Box3().setFromObject(b);
        if(bb.distanceToPoint(ball.position) < 0.6){
          // simple response: invert Z and a bit of Y
          ballVel.z *= -1; ballVel.y *= 1;
          scene.remove(b); bricks.splice(i,1); score += 10; updateHUD();
        }
      }
    } else {
      // follow paddle
      ball.position.x = paddle.position.x;
      ball.position.z = paddle.position.z - 0.2;
    }
  }

  function resetGame(){
    // clear bricks
    for(const b of bricks) scene.remove(b);
    bricks.length = 0; score = 0; lives = 3; createBricks(); resetBall(); updateHUD();
  }

})();
