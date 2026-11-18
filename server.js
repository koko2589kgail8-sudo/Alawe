const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const rooms = new Map();
const COLORS = ['#ff5252','#40c4ff','#69f0ae','#ffd740','#e040fb','#ff9100','#7c4dff','#00e5ff','#f06292','#c6ff00','#b388ff','#a1887f','#18ffff','#ff6e40','#8bc34a','#f48fb1','#90caf9','#dce775','#bcaaa4','#ffffff'];
const BANK = {
  'رياضيات': [
    ['ما ناتج 7 × 8؟',['54','56','64','48'],1],['ما ناتج 45 ÷ 5؟',['8','9','10','7'],1],['كم ضلعاً للمثلث؟',['2','3','4','5'],1],['ما ناتج 12 + 19؟',['29','30','31','32'],2],['ما نصف العدد 36؟',['16','18','20',' depends'],1]
  ],
  'إنجليزي': [
    ['ما معنى كلمة Apple؟',['برتقال','تفاحة','موز','عنب'],1],['اختر جمع كلمة Child',['Childs','Childes','Children','Childrens'],2],['ما عكس كلمة Hot؟',['Cold','Warm','Big','Fast'],0],['أكمل: I ___ a student',['is','am','are','be'],1],['ما معنى Book؟',['قلم','باب','كتاب','كرسي'],2]
  ],
  'اجتماعيات': [
    ['ما عاصمة المملكة العربية السعودية؟',['جدة','مكة','الرياض','الدمام'],2],['في أي قارة تقع السعودية؟',['أفريقيا','آسيا','أوروبا','أمريكا'],1],['ما اسم البحر غرب السعودية؟',['البحر الأحمر','بحر العرب','المتوسط','قزوين'],0],['ما العملة الرسمية للسعودية؟',['درهم','دينار','ريال سعودي','جنيه'],2],['ما عاصمة مصر؟',['الإسكندرية','القاهرة','الأقصر','أسوان'],1]
  ],
  'علوم': [
    ['ما الكوكب المعروف بالكوكب الأحمر؟',['الزهرة','المريخ','المشتري','زحل'],1],['ما الغاز الذي تحتاجه معظم الكائنات للتنفس؟',['الأكسجين','الهيليوم','الهيدروجين','النيتروجين'],0],['كم عدد حالات المادة الأساسية التي تدرس عادة؟',['2','3','4','5'],1],['ما العضو الذي يضخ الدم؟',['الرئة','الكبد','القلب','المعدة'],2],['ما أقرب نجم إلى الأرض؟',['الشمس','الشعرى','النسر','القمر'],0]
  ]
};
function mapSize(n){ return n<=4?650:n<=8?820:n<=12?1000:n<=16?1180:1360; }
function publicRoom(r){ return {code:r.code,maxPlayers:r.maxPlayers,started:r.started,mapSize:r.mapSize,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,dir:p.dir,alive:p.alive,revives:p.revives,host:p.host,trail:p.trail}))}; }
function emitRoom(r){ io.to(r.code).emit('state', publicRoom(r)); }
function questionFor(subject){ const list=BANK[subject] || BANK['علوم']; const q=list[Math.floor(Math.random()*list.length)]; return {subject,text:q[0],choices:q[1],correct:q[2]}; }
function finishRoom(r){ if(r.loop){clearInterval(r.loop);r.loop=null;} r.started=false; const alive=[...r.players.values()].filter(p=>p.alive); io.to(r.code).emit('finished',{winner:alive.length===1?alive[0].name:null,draw:alive.length!==1}); }
function startRoom(r){
  if(r.started || r.players.size<2) return false;
  r.started=true; r.mapSize=mapSize(r.players.size); r.tick=0;
  const ps=[...r.players.values()];
  ps.forEach((p,i)=>{const a=2*Math.PI*i/ps.length; const radius=r.mapSize*.30; p.x=r.mapSize/2+Math.cos(a)*radius; p.y=r.mapSize/2+Math.sin(a)*radius; p.dir=(a+Math.PI/2); p.alive=true;p.revives=0;p.trail=[];if(p.pending?.timer)clearTimeout(p.pending.timer);p.pending=null;p.lastTurn=0;});
  emitRoom(r);
  r.loop=setInterval(()=>{
    const alive=[...r.players.values()].filter(p=>p.alive);
    if(alive.length<=1){finishRoom(r);return;}
    for(const p of alive){
      const speed=3.1; p.x+=Math.cos(p.dir)*speed; p.y+=Math.sin(p.dir)*speed;
      const x=p.x,y=p.y;
      let hit=x<8||y<8||x>r.mapSize-8||y>r.mapSize-8;
      if(!hit){
        for(const other of r.players.values()){
          if(other.id===p.id) continue; // اللاعب لا يخسر بلمس خطه هو
          for(let k=0;k<other.trail.length;k+=2){const t=other.trail[k]; if(Math.hypot(x-t.x,y-t.y)<9){hit=true;break;}}
          if(hit)break;
        }
      }
      p.trail.push({x,y});
      if(hit){p.alive=false; io.to(p.id).emit('died',{canRevive:p.revives<2,revives:p.revives});}
    }
    if(++r.tick%2===0) emitRoom(r);
  },35);
  return true;
}
io.on('connection', socket=>{
  socket.on('createRoom', ({name,maxPlayers})=>{
    maxPlayers=Math.max(2,Math.min(20,Number(maxPlayers)||8));
    let code; do{code=Math.random().toString(36).slice(2,7).toUpperCase();}while(rooms.has(code));
    const r={code,maxPlayers,mapSize:650,started:false,players:new Map(),loop:null};rooms.set(code,r);
    const p={id:socket.id,name:String(name||'لاعب').slice(0,16),color:COLORS[0],x:0,y:0,dir:0,alive:true,revives:0,trail:[],host:true,pending:null};r.players.set(socket.id,p);socket.join(code);
    socket.emit('joined',{code,host:true});emitRoom(r);
  });
  socket.on('joinRoom', ({code,name})=>{
    const r=rooms.get(String(code||'').toUpperCase());
    if(!r)return socket.emit('errorMsg','رمز الغرفة غير موجود.');
    if(r.started)return socket.emit('errorMsg','المباراة بدأت بالفعل.');
    if(r.players.size>=r.maxPlayers)return socket.emit('errorMsg','الغرفة ممتلئة.');
    const p={id:socket.id,name:String(name||'لاعب').slice(0,16),color:COLORS[r.players.size%COLORS.length],x:0,y:0,dir:0,alive:true,revives:0,trail:[],host:false,pending:null};r.players.set(socket.id,p);socket.join(r.code);
    socket.emit('joined',{code:r.code,host:false});emitRoom(r);
  });
  socket.on('startGame',()=>{const r=[...rooms.values()].find(x=>x.players.has(socket.id));if(!r)return;const p=r.players.get(socket.id);if(!p.host)return;if(r.players.size<2)return socket.emit('errorMsg','تحتاج الغرفة إلى لاعبين على الأقل.');startRoom(r);});
  socket.on('turn',dir=>{const r=[...rooms.values()].find(x=>x.players.has(socket.id));if(!r||!r.started)return;const p=r.players.get(socket.id);if(!p.alive)return;const now=Date.now();if(now-p.lastTurn<90)return;const d=Number(dir);if(Number.isFinite(d)&&Math.abs(d-p.dir)>0.25){let delta=((d-p.dir+Math.PI*3)%(Math.PI*2))-Math.PI;if(Math.abs(delta)>0.35)p.dir+=Math.sign(delta)*Math.min(Math.abs(delta),0.16);p.lastTurn=now;}});
  socket.on('chooseSubject',subject=>{const r=[...rooms.values()].find(x=>x.players.has(socket.id));if(!r)return;const p=r.players.get(socket.id);if(p.alive||p.revives>=2||p.pending)return;const q=questionFor(subject);p.pending={correct:q.correct,expires:Date.now()+20000};p.pending.timer=setTimeout(()=>{if(p.pending && Date.now()>=p.pending.expires){p.pending=null;socket.emit('quizFailed');emitRoom(r);}},20000);socket.emit('question',{subject:q.subject,text:q.text,choices:q.choices,seconds:20});});
  socket.on('answer',index=>{const r=[...rooms.values()].find(x=>x.players.has(socket.id));if(!r)return;const p=r.players.get(socket.id);if(!p.pending)return;const pending=p.pending;clearTimeout(pending.timer);const ok=Date.now()<=pending.expires&&Number(index)===pending.correct;p.pending=null;if(ok){p.revives++;p.alive=true;const a=Math.random()*Math.PI*2;p.x=r.mapSize/2+Math.cos(a)*r.mapSize*.20;p.y=r.mapSize/2+Math.sin(a)*r.mapSize*.20;p.dir=a+Math.PI/2;socket.emit('revived',{revives:p.revives});emitRoom(r);}else{socket.emit('quizFailed');emitRoom(r);}});
  socket.on('disconnect',()=>{for(const [code,r] of rooms){if(r.players.delete(socket.id)){emitRoom(r);if(r.players.size===0){if(r.loop)clearInterval(r.loop);rooms.delete(code);}else if(r.started&&[...r.players.values()].filter(p=>p.alive).length<=1)finishRoom(r);break;}}});
});
const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log(`Ink Battle running on ${PORT}`));
