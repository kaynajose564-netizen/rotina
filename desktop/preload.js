'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kaynaDesktop',{isDesktop:true,getMetrics:()=>ipcRenderer.invoke('pc:metrics')});
