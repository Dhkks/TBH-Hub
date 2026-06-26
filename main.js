const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('path');
const fs2=require('fs');
const chokidar=require('chokidar');

const SAVE=path.join(process.env.APPDATA,'..','LocalLow','TesseractStudio','TaskbarHero','SaveFile_Live.es3');
const SAVE_DIR=path.dirname(SAVE);
const SAVE_NAME=path.basename(SAVE);
const LOG_PATH=path.join(process.env.APPDATA,'..','LocalLow','TesseractStudio','TaskbarHero','Player.log');
const W=560,H=800;

let win=null;
let watcher=null;

function readAndSend(){
  try{
    const d=fs2.readFileSync(SAVE);
    if(win)win.webContents.send('save-updated',Array.from(d));
  }catch(e){
    if(e.code==='EBUSY'||e.code==='EPERM'){
      setTimeout(()=>{
        try{const d=fs2.readFileSync(SAVE);if(win)win.webContents.send('save-updated',Array.from(d));}
        catch(ex){}
      },600);
    }
  }
}

function watchSave(){
  if(!fs2.existsSync(SAVE_DIR))return;
  watcher=chokidar.watch(SAVE_DIR,{
    depth:0,
    ignoreInitial:true,
    usePolling:true,
    interval:500,
    ignored:/(\.tmp|\.bak)$/,
    awaitWriteFinish:{stabilityThreshold:400,pollInterval:100}
  });
  const onSaveFile=p=>{if(path.basename(p)===SAVE_NAME)setTimeout(readAndSend,300);};
  watcher.on('add',onSaveFile);
  watcher.on('change',onSaveFile);
}

let lastLogSize=0;
let sessionBoxCount=0;

function watchLog(){
  if(!fs2.existsSync(LOG_PATH))return;
  lastLogSize=fs2.statSync(LOG_PATH).size;
  fs2.watchFile(LOG_PATH,{persistent:true,interval:300},(curr)=>{
    try{
      const stat=fs2.statSync(LOG_PATH);
      const newSize=stat.size;
      if(newSize<=lastLogSize){lastLogSize=newSize;return;}
      const buf=Buffer.alloc(newSize-lastLogSize);
      const fd=fs2.openSync(LOG_PATH,'r');
      fs2.readSync(fd,buf,0,buf.length,lastLogSize);
      fs2.closeSync(fd);
      lastLogSize=newSize;
      const matches=(buf.toString('utf8').match(/GetBoxCount Success Count : \d+/g)||[]);
      if(matches.length>0&&win){sessionBoxCount+=matches.length;win.webContents.send('box-opened',matches.length);}
    }catch(e){}
  });
}

function createWindow(){
  win=new BrowserWindow({
    width:W,height:H,
    minWidth:W,minHeight:H,
    maxWidth:W,maxHeight:H,
    resizable:false,maximizable:false,
    frame:false,
    backgroundColor:'#080a10',
    roundedCorners:false,
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      nodeIntegration:false
    },
    show:false
  });
  win.loadFile(path.join(__dirname,'renderer','index.html'));
  win.once('ready-to-show',()=>{
    win.show();
    // TODO: remove openDevTools before publishing
    win.webContents.openDevTools({mode:'detach'});
  });
  win.on('will-resize',(e)=>e.preventDefault());
  win.on('closed',()=>{
    win=null;
    if(watcher)watcher.close();
    fs2.unwatchFile(LOG_PATH);
  });
}

ipcMain.handle('read-save',()=>{if(!fs2.existsSync(SAVE))return null;return Array.from(fs2.readFileSync(SAVE));});
ipcMain.handle('save-exists',()=>fs2.existsSync(SAVE));
ipcMain.handle('get-save-path',()=>SAVE);
ipcMain.on('win-min',()=>win&&win.minimize());
ipcMain.on('win-close',()=>win&&win.close());

app.whenReady().then(()=>{createWindow();watchSave();watchLog();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
