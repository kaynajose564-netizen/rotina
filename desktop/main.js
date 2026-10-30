'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const si = require('systeminformation');
const crypto = require('node:crypto');
let windowRef, httpServer;
app.setName('KAYNÃ CONTROL');
app.whenReady().then(async()=>{
  process.env.DATA_DIR=app.getPath('userData');
  process.env.SECRET=crypto.randomBytes(32).toString('hex');
  const webApp=require('../server');
  httpServer=webApp.listen(0,'127.0.0.1',()=>{
    const port=httpServer.address().port;
    windowRef=new BrowserWindow({width:1440,height:940,minWidth:900,minHeight:650,backgroundColor:'#080b09',title:'KAYNÃ CONTROL',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    windowRef.loadURL('http://127.0.0.1:'+port);
    windowRef.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))shell.openExternal(url);return {action:'deny'}});
  });
});
ipcMain.handle('pc:metrics',async()=>{
  const [load,mem,cpu,graphics,disks,fs,temp,network]=await Promise.allSettled([si.currentLoad(),si.mem(),si.cpu(),si.graphics(),si.disksIO(),si.fsSize(),si.cpuTemperature(),si.networkStats()]);
  const value=x=>x.status==='fulfilled'?x.value:null;
  const l=value(load),m=value(mem),c=value(cpu),g=value(graphics),d=value(disks),f=value(fs),t=value(temp),n=value(network);
  return {timestamp:Date.now(),cpu:{usage:l?Number(l.currentLoad.toFixed(1)):null,brand:c?.brand||null,cores:c?.cores||null},memory:{used:m?m.used:null,total:m?m.total:null,percent:m?Number((m.used/m.total*100).toFixed(1)):null},gpu:(g?.controllers||[]).map(x=>({model:x.model||x.name||'GPU',vendor:x.vendor||null,vram:x.vram||null,vramDynamic:Boolean(x.vramDynamic),memoryUsed:Number.isFinite(x.memoryUsed)?x.memoryUsed:null,memoryFree:Number.isFinite(x.memoryFree)?x.memoryFree:null,utilization:Number.isFinite(x.utilizationGpu)?x.utilizationGpu:null,memoryUtilization:Number.isFinite(x.utilizationMemory)?x.utilizationMemory:null,temperature:Number.isFinite(x.temperatureGpu)?x.temperatureGpu:null})),disks:(f||[]).map(x=>({mount:x.mount,used:x.used,size:x.size,percent:x.use})),diskIO:d?{readBytes:d.rIO,writeBytes:d.wIO}:null,temperature:t&&Number.isFinite(t.main)?t.main:null,network:(n||[]).map(x=>({iface:x.iface,rx_sec:x.rx_sec,tx_sec:x.tx_sec})),fps:null,fpsNote:'FPS exige integração específica com cada jogo/overlay.'};
});
app.on('window-all-closed',()=>{if(httpServer)httpServer.close();app.quit()});
app.on('before-quit',()=>{if(httpServer)httpServer.close()});
