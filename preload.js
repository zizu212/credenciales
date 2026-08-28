const { contextBridge, ipcRenderer } = require('electron');

// API segura disponible en window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
	invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
	send: (channel, payload) => ipcRenderer.send(channel, payload)
});
