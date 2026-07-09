(function(){
  // ---------- INDEXEDDB ----------
  const DB_NAME = 'startube-db';
  const DB_VERSION = 1;
  let db;

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains('videos')) {
          _db.createObjectStore('videos', { keyPath: 'id' });
        }
        if (!_db.objectStoreNames.contains('meta')) {
          _db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbGetAllVideos(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readonly');
      const store = tx.objectStore('videos');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function dbPutVideo(record){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function dbDeleteVideo(id){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function dbGetMeta(key, fallback){
    return new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => resolve(fallback);
    });
  }

  function dbSetMeta(key, value){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- STATE ----------
  let channelName = "My Channel";
  let subCount = 3;
  let subscribed = false;
  let videos = []; // {id,title,blob,url,thumb,views,likes,liked,createdAt,comments:[]}
  let currentEffectIndex = 0;
  let facingMode = "user";
  let camStream = null, videoEl = null, canvas, ctx, drawing = false;
  let mediaRecorder = null, recordedChunks = [], recording = false, recStartTime = 0, recTimerInterval = null;
  let recordedBlob = null, recordedBlobUrl = null, recordedThumb = null;
  let watchInterval = null;
  let currentWatchVideo = null;

  const effects = [
    {label:"Normal", em:"🎬", filter:"none", mirror:false},
    {label:"B&W", em:"🎞️", filter:"grayscale(1) contrast(1.1)", mirror:false},
    {label:"Old Timey", em:"🕰️", filter:"sepia(0.9)", mirror:false},
    {label:"Alien", em:"👽", filter:"invert(1) hue-rotate(60deg)", mirror:false},
    {label:"Dreamy", em:"☁️", filter:"blur(3px) brightness(1.15)", mirror:false},
    {label:"Sparkle", em:"✨", filter:"brightness(1.35) saturate(1.8)", mirror:false},
    {label:"Icy", em:"❄️", filter:"hue-rotate(180deg) saturate(1.4)", mirror:false},
    {label:"Mirror", em:"🪞", filter:"none", mirror:true},
  ];

  const commentPool = [
    "This is amazing!! 🎉","First!! omg","You're so talented ✨","Do a part 2!!",
    "I can't stop watching this 😂","This made my whole day","So creative!!",
    "Wow just wow 👏","Best video ever, no cap","Subscribed instantly!",
    "Can you do a tutorial next?","This deserves way more views","I showed my friends this lol",
    "Absolutely incredible 🔥","10/10 no notes","okay but why is this so good",
    "the effect on this is so cool", "new fan right here 🙋"
  ];
  const commenterAdj = ["Cosmic","Pixel","Turbo","Mega","Sunny","Rapid","Silly","Glow","Frosty","Jolly","Comet","Wobbly"];
  const commenterNoun = ["Panda","Fox","Otter","Comet","Waffle","Nugget","Sparkle","Penguin","Taco","Robot","Doodle","Muffin"];
  const avatarEmojis = ["🦊","🐼","🐸","🦄","🐙","🦋","🐨","🐯","🐰","🐻","🐢","🦉","🐬","🦖"];

  function randomCommenter(){
    return {
      name: commenterAdj[Math.floor(Math.random()*commenterAdj.length)] + commenterNoun[Math.floor(Math.random()*commenterNoun.length)] + Math.floor(Math.random()*90+10),
      avatar: avatarEmojis[Math.floor(Math.random()*avatarEmojis.length)]
    };
  }

  // ---------- ELEMENTS ----------
  const tabHomeBtn = document.getElementById('tabHomeBtn');
  const tabRecordBtn = document.getElementById('tabRecordBtn');
  const homeView = document.getElementById('homeView');
  const recordView = document.getElementById('recordView');
  const emptyState = document.getElementById('emptyState');
  const videoGrid = document.getElementById('videoGrid');
  const emptyRecordBtn = document.getElementById('emptyRecordBtn');
  const channelNameDisplay = document.getElementById('channelNameDisplay');
  const subCountNum = document.getElementById('subCountNum');
  const camStatus = document.getElementById('camStatus');
  const shutterBtn = document.getElementById('shutterBtn');
  const switchCamBtn = document.getElementById('switchCamBtn');
  const recTimer = document.getElementById('recTimer');
  const recTimerText = document.getElementById('recTimerText');
  const effectRow = document.getElementById('effectRow');
  const previewWrap = document.getElementById('previewWrap');
  const previewVideo = document.getElementById('previewVideo');
  const titleInput = document.getElementById('titleInput');
  const publishBtn = document.getElementById('publishBtn');
  const discardBtn = document.getElementById('discardBtn');
  const viewfinderWrap = document.getElementById('viewfinderWrap');
  const toast = document.getElementById('toast');
  const storageNote = document.getElementById('storageNote');
  const loadingScreen = document.getElementById('loadingScreen');

  // ---------- INIT ----------
  async function init(){
    db = await openDB();
    channelName = await dbGetMeta('channelName', "My Channel");
    subCount = await dbGetMeta('subCount', 3);
    subscribed = await dbGetMeta('subscribed', false);

    const stored = await dbGetAllVideos();
    videos = stored
      .map(v => ({ ...v, url: URL.createObjectURL(v.blob) }))
      .sort((a,b) => b.createdAt - a.createdAt);

    channelNameDisplay.addEventListener('click', editChannelName);

    effects.forEach((fx, i) => {
      const chip = document.createElement('div');
      chip.className = 'effect-chip' + (i === 0 ? ' active' : '');
      chip.innerHTML = `<span class="em">${fx.em}</span><span>${fx.label}</span>`;
      chip.addEventListener('click', () => {
        currentEffectIndex = i;
        [...effectRow.children].forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      effectRow.appendChild(chip);
    });

    tabHomeBtn.addEventListener('click', () => switchTab('home'));
    tabRecordBtn.addEventListener('click', () => switchTab('record'));
    emptyRecordBtn.addEventListener('click', () => switchTab('record'));
    shutterBtn.addEventListener('click', toggleRecording);
    switchCamBtn.addEventListener('click', flipCamera);
    discardBtn.addEventListener('click', discardRecording);
    publishBtn.addEventListener('click', publishVideo);
    document.getElementById('closeWatchBtn').addEventListener('click', closeWatch);
    document.getElementById('deleteVideoBtn').addEventListener('click', deleteCurrentVideo);
    document.getElementById('watchLikeBtn').addEventListener('click', toggleWatchLike);
    document.getElementById('watchSubBtn').addEventListener('click', toggleSubscribe);

    renderHome();
    updateStorageNote();
    loadingScreen.classList.add('hidden');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  async function editChannelName(){
    const name = prompt("What's your channel name?", channelName);
    if (name && name.trim()) {
      channelName = name.trim().slice(0, 30);
      channelNameDisplay.textContent = channelName;
      await dbSetMeta('channelName', channelName);
    }
  }

  function switchTab(tab){
    if (tab === 'home') {
      homeView.hidden = false; recordView.hidden = true;
      tabHomeBtn.classList.add('active'); tabRecordBtn.classList.remove('active');
      drawing = false;
    } else {
      homeView.hidden = true; recordView.hidden = false;
      tabRecordBtn.classList.add('active'); tabHomeBtn.classList.remove('active');
      previewWrap.style.display = 'none';
      viewfinderWrap.style.display = '';
      document.querySelector('.effect-row').style.display = 'flex';
      document.querySelector('.record-controls').style.display = 'flex';
      document.querySelector('.hint').style.display = 'block';
      startCamera();
    }
  }

  // ---------- CAMERA ----------
  async function startCamera(){
    if (camStream) { drawing = true; requestAnimationFrame(drawLoop); return; }
    camStatus.style.display = 'flex';
    camStatus.textContent = 'Tap "Allow" to turn on your camera 🎥';
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode }, audio: true
      });
    } catch(err){
      camStatus.textContent = "Couldn't access the camera. Check Settings > Safari/App > Camera and try again.";
      return;
    }
    camStatus.style.display = 'none';
    videoEl = document.createElement('video');
    videoEl.srcObject = camStream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    await videoEl.play();

    canvas = document.getElementById('camCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = videoEl.videoWidth || 720;
    canvas.height = videoEl.videoHeight || 960;

    drawing = true;
    requestAnimationFrame(drawLoop);
  }

  function drawLoop(){
    if (!drawing || !videoEl) return;
    const fx = effects[currentEffectIndex];
    ctx.save();
    ctx.filter = fx.filter;
    if (fx.mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    requestAnimationFrame(drawLoop);
  }

  function fullStopCamera(){
    drawing = false;
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    videoEl = null;
  }

  async function flipCamera(){
    facingMode = facingMode === 'user' ? 'environment' : 'user';
    fullStopCamera();
    await startCamera();
  }

  // ---------- RECORDING ----------
  function toggleRecording(){
    if (!camStream) { showToast("Camera's not on yet — allow camera access first"); return; }
    recording ? stopRecording() : startRecording();
  }

  function startRecording(){
    recordedChunks = [];
    const canvasStream = canvas.captureStream(30);
    const audioTrack = camStream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    let options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'video/webm' };
    try { mediaRecorder = new MediaRecorder(canvasStream, options); }
    catch(e) { mediaRecorder = new MediaRecorder(canvasStream); }

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = onRecordingStop;
    mediaRecorder.start();

    recording = true;
    shutterBtn.classList.add('recording');
    recTimer.classList.add('show');
    recStartTime = Date.now();
    recTimerInterval = setInterval(updateRecTimer, 250);

    setTimeout(() => { if (recording) stopRecording(); }, 60000);
  }

  function updateRecTimer(){
    const secs = Math.floor((Date.now() - recStartTime) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    recTimerText.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }

  function stopRecording(){
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recording = false;
    shutterBtn.classList.remove('recording');
    recTimer.classList.remove('show');
    clearInterval(recTimerInterval);
  }

  function onRecordingStop(){
    recordedBlob = new Blob(recordedChunks, { type: 'video/webm' });
    recordedBlobUrl = URL.createObjectURL(recordedBlob);
    recordedThumb = canvas.toDataURL('image/jpeg', 0.7);

    previewVideo.src = recordedBlobUrl;
    viewfinderWrap.style.display = 'none';
    document.querySelector('.effect-row').style.display = 'none';
    document.querySelector('.record-controls').style.display = 'none';
    document.querySelector('.hint').style.display = 'none';
    previewWrap.style.display = 'block';
    titleInput.value = '';
    titleInput.focus();
  }

  function discardRecording(){
    resetToViewfinder();
  }

  function resetToViewfinder(){
    previewWrap.style.display = 'none';
    viewfinderWrap.style.display = '';
    document.querySelector('.effect-row').style.display = 'flex';
    document.querySelector('.record-controls').style.display = 'flex';
    document.querySelector('.hint').style.display = 'block';
    previewVideo.pause();
    previewVideo.src = '';
  }

  async function publishVideo(){
    const title = titleInput.value.trim() || "My New Video";
    const vid = {
      id: Date.now(),
      title: title,
      blob: recordedBlob,
      thumb: recordedThumb,
      views: Math.floor(Math.random()*4),
      likes: 0,
      liked: false,
      createdAt: Date.now(),
      comments: []
    };
    await dbPutVideo(vid);
    videos.unshift({ ...vid, url: recordedBlobUrl });

    burstConfetti();
    showToast("Published! 🎉 Your video is live");
    resetToViewfinder();
    switchTab('home');
    renderHome();
    updateStorageNote();
  }

  // ---------- HOME RENDER ----------
  function renderHome(){
    channelNameDisplay.textContent = channelName;
    subCountNum.textContent = subCount;

    if (videos.length === 0) {
      emptyState.style.display = 'block';
      videoGrid.style.display = 'none';
      return;
    }
    emptyState.style.display = 'none';
    videoGrid.style.display = 'grid';
    videoGrid.innerHTML = '';

    videos.forEach(v => {
      const card = document.createElement('div');
      card.className = 'video-card';
      card.innerHTML = `
        <div class="thumb-wrap">
          <img src="${v.thumb}">
          <div class="thumb-badge">${timeAgo(v.createdAt)}</div>
        </div>
        <div class="card-meta">
          <p class="card-title">${escapeHtml(v.title)}</p>
          <div class="card-sub">${v.views} views · ${v.likes} likes</div>
        </div>
      `;
      card.addEventListener('click', () => openWatch(v));
      videoGrid.appendChild(card);
    });
  }

  function timeAgo(ts){
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs/24) + "d ago";
  }

  function escapeHtml(s){
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function updateStorageNote(){
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const mb = (est.usage / (1024*1024)).toFixed(1);
        storageNote.textContent = videos.length ? `${videos.length} video${videos.length===1?'':'s'} saved on this iPad · ~${mb} MB used` : '';
      } catch(e){ storageNote.textContent = ''; }
    }
  }

  // ---------- WATCH OVERLAY ----------
  function openWatch(v){
    v.views++;
    currentWatchVideo = v;
    document.getElementById('watchOverlay').classList.add('open');
    const wv = document.getElementById('watchVideo');
    wv.src = v.url;
    wv.play().catch(()=>{});
    document.getElementById('watchTitle').textContent = v.title;
    document.getElementById('watchViews').textContent = `${v.views} views · ${timeAgo(v.createdAt)}`;
    document.getElementById('watchChannelName').textContent = channelName;
    document.getElementById('watchSubs').textContent = `${subCount} subscribers`;
    document.getElementById('watchLikeCount').textContent = v.likes;
    updateLikeBtnUI(v);
    updateSubBtnUI();

    document.getElementById('commentsList').innerHTML = '';
    v.comments.forEach(c => renderComment(c));

    watchInterval = setInterval(() => simulateEngagement(v), 3200);
  }

  async function closeWatch(){
    document.getElementById('watchOverlay').classList.remove('open');
    const wv = document.getElementById('watchVideo');
    wv.pause(); wv.src = '';
    clearInterval(watchInterval);
    if (currentWatchVideo) {
      const { url, ...record } = currentWatchVideo;
      await dbPutVideo(record).catch(()=>{});
    }
    currentWatchVideo = null;
    renderHome();
  }

  async function deleteCurrentVideo(){
    if (!currentWatchVideo) return;
    if (!confirm(`Delete "${currentWatchVideo.title}"? This can't be undone.`)) return;
    const id = currentWatchVideo.id;
    await dbDeleteVideo(id);
    URL.revokeObjectURL(currentWatchVideo.url);
    videos = videos.filter(v => v.id !== id);
    clearInterval(watchInterval);
    document.getElementById('watchOverlay').classList.remove('open');
    const wv = document.getElementById('watchVideo');
    wv.pause(); wv.src = '';
    currentWatchVideo = null;
    showToast("Video deleted");
    renderHome();
    updateStorageNote();
  }

  function updateLikeBtnUI(v){
    const btn = document.getElementById('watchLikeBtn');
    btn.classList.toggle('liked', v.liked);
    btn.querySelector('.heart').textContent = v.liked ? '❤️' : '🤍';
    document.getElementById('watchLikeCount').textContent = v.likes;
  }

  function toggleWatchLike(){
    const v = currentWatchVideo;
    if (!v) return;
    if (v.liked) { v.liked = false; v.likes = Math.max(0, v.likes - 1); }
    else { v.liked = true; v.likes++; }
    updateLikeBtnUI(v);
  }

  function updateSubBtnUI(){
    const btn = document.getElementById('watchSubBtn');
    btn.textContent = subscribed ? "Subscribed" : "Subscribe";
    btn.classList.toggle('subbed', subscribed);
    document.getElementById('watchSubs').textContent = `${subCount} subscribers`;
    subCountNum.textContent = subCount;
  }

  async function toggleSubscribe(){
    if (subscribed) {
      subscribed = false;
      subCount = Math.max(1, subCount - 1);
    } else {
      subscribed = true;
      subCount++;
      showToast("You subscribed! 🌟");
    }
    updateSubBtnUI();
    await dbSetMeta('subscribed', subscribed);
    await dbSetMeta('subCount', subCount);
  }

  function simulateEngagement(v){
    const roll = Math.random();
    if (roll < 0.45) {
      v.likes++;
      updateLikeBtnUI(v);
    } else if (roll < 0.7) {
      subCount++;
      updateSubBtnUI();
      dbSetMeta('subCount', subCount);
      const c = randomCommenter();
      showToast(`${c.avatar} ${c.name} subscribed!`);
    } else {
      const c = randomCommenter();
      const text = commentPool[Math.floor(Math.random()*commentPool.length)];
      const comment = { name: c.name, avatar: c.avatar, text: text };
      v.comments.unshift(comment);
      renderComment(comment, true);
    }
  }

  function renderComment(c, prepend){
    const list = document.getElementById('commentsList');
    const el = document.createElement('div');
    el.className = 'comment';
    el.innerHTML = `
      <div class="c-avatar">${c.avatar}</div>
      <div class="c-body">
        <div class="c-name">${escapeHtml(c.name)}</div>
        <div class="c-text">${escapeHtml(c.text)}</div>
      </div>
    `;
    if (prepend) list.insertBefore(el, list.firstChild);
    else list.appendChild(el);
  }

  // ---------- TOAST + CONFETTI ----------
  let toastTimer = null;
  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function burstConfetti(){
    const colors = ['#FF5C7A','#FFC93C','#7B5EA7','#4CD9A8'];
    for (let i = 0; i < 40; i++){
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random()*100 + 'vw';
      p.style.background = colors[Math.floor(Math.random()*colors.length)];
      p.style.transform = `rotate(${Math.random()*360}deg)`;
      document.body.appendChild(p);
      const duration = 1400 + Math.random()*900;
      const drift = (Math.random()-0.5)*160;
      p.animate([
        { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${drift}px, 100vh) rotate(${360+Math.random()*360}deg)`, opacity: 0.9 }
      ], { duration: duration, easing: 'ease-in' });
      setTimeout(() => p.remove(), duration + 50);
    }
  }

  init();
})();
