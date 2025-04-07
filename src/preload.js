// public/preload.js
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Expose protected methods that allow the renderer process to use
// Electron APIs without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  }
});

// Expose file system methods to the renderer process
contextBridge.exposeInMainWorld('fs', {
  readFile: (filePath, options) => {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, options, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  },
  writeFile: (filePath, data, options) => {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, data, options, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  readdir: (dirPath) => {
    return new Promise((resolve, reject) => {
      fs.readdir(dirPath, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });
  },
  mkdir: (dirPath, options) => {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, options, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  stat: (path) => {
    return new Promise((resolve, reject) => {
      fs.stat(path, (err, stats) => {
        if (err) reject(err);
        else resolve(stats);
      });
    });
  },
  exists: (path) => {
    return fs.existsSync(path);
  }
});

// Expose path methods
contextBridge.exposeInMainWorld('path', {
  join: (...args) => path.join(...args),
  dirname: (filePath) => path.dirname(filePath),
  basename: (filePath) => path.basename(filePath)
});