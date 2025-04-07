// src/utils/dataLoader.js
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// Helper function to get the app data directory
const getDataDir = () => {
  // In development mode, use current directory
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '..', '..', 'data');
  }
  
  // In production, use app's user data directory
  return path.join(app.getPath('userData'), 'data');
};

// Ensure data directories exist
const ensureDirectories = () => {
  const dataDir = getDataDir();
  const mapDir = path.join(dataDir, 'map');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  if (!fs.existsSync(mapDir)) {
    fs.mkdirSync(mapDir, { recursive: true });
  }
  
  // Create default settings file if it doesn't exist
  const settingsPath = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    const defaultSettings = {
      hexSize: 60,
      scrollSpeed: 15,
      scrollThreshold: 50,
      minZoom: 0.5,
      maxZoom: 2.0,
      zoomStep: 0.1,
      backgroundColor: '#0a2342',
      gridEnabled: true,
      gridColor: '#2a486b'
    };
    
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
  }
  
  // Create default map file if it doesn't exist
  const mapPath = path.join(mapDir, 'hex_map.json');
  if (!fs.existsSync(mapPath)) {
    const defaultMap = {
      hexes: generateDefaultMap()
    };
    
    fs.writeFileSync(mapPath, JSON.stringify(defaultMap, null, 2));
  }
};

// Generate a simple default map
const generateDefaultMap = () => {
  const hexes = [];
  const radius = 3;
  
  // Generate a hexagon-shaped map
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    
    for (let r = r1; r <= r2; r++) {
      hexes.push({
        q,
        r,
        color: getRandomHexColor(),
        label: `${q},${r}`
      });
    }
  }
  
  return hexes;
};

// Generate a random hex color
const getRandomHexColor = () => {
  const colors = [
    '#3a5e8c', // Blue
    '#4e937a', // Green
    '#b1746f', // Red
    '#8a7f8d', // Purple
    '#697f98', // Light blue
  ];
  
  return colors[Math.floor(Math.random() * colors.length)];
};

// Read map settings from JSON file
export const readMapSettings = async () => {
  try {
    ensureDirectories();
    
    const settingsPath = path.join(getDataDir(), 'settings.json');
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(settingsData);
  } catch (error) {
    console.error('Error reading map settings:', error);
    throw error;
  }
};

// Read map data from JSON file
export const readMapData = async () => {
  try {
    ensureDirectories();
    
    const mapPath = path.join(getDataDir(), 'map', 'hex_map.json');
    const mapData = fs.readFileSync(mapPath, 'utf8');
    return JSON.parse(mapData);
  } catch (error) {
    console.error('Error reading map data:', error);
    throw error;
  }
};

// Save map data to JSON file
export const saveMapData = async (mapData) => {
  try {
    ensureDirectories();
    
    const mapPath = path.join(getDataDir(), 'map', 'hex_map.json');
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving map data:', error);
    throw error;
  }
};

// Save map settings to JSON file
export const saveMapSettings = async (settings) => {
  try {
    ensureDirectories();
    
    const settingsPath = path.join(getDataDir(), 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving map settings:', error);
    throw error;
  }
};