// src/components/HexMap/HexMap.jsx
import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './HexMap.css';
import { readMapData, readMapSettings } from '../../utils/dataLoader';

const HexMap = ({ onHexClick }) => {
  // State for map data, settings, view transformation, and more
  const [mapData, setMapData] = useState({ hexes: [] });
  const [settings, setSettings] = useState({
    hexSize: 60,
    scrollSpeed: 15,
    scrollThreshold: 50,
    minZoom: 0.5,
    maxZoom: 2.0,
    zoomStep: 0.1,
    backgroundColor: '#0a2342',
    gridEnabled: true,
    gridColor: '#2a486b'
  });
  
  // View state for panning and zooming
  const [viewTransform, setViewTransform] = useState({
    x: 0,
    y: 0,
    scale: 1
  });
  
  // Mouse tracking for scrolling and interaction
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isMouseInBounds, setIsMouseInBounds] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Refs for animation and DOM elements
  const mapContainerRef = useRef(null);
  const animationFrameId = useRef(null);
  
  // Load map data and settings on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const mapSettings = await readMapSettings();
        const mapData = await readMapData();
        
        setSettings(prevSettings => ({
          ...prevSettings,
          ...mapSettings
        }));
        
        setMapData(mapData);
        
        // Center the map initially
        if (mapContainerRef.current && mapData.hexes.length > 0) {
          centerMap(mapData.hexes);
        }
      } catch (error) {
        console.error('Error loading map data:', error);
      }
    };
    
    loadData();
  }, []);
  
  // Center map based on hex data
  const centerMap = (hexes) => {
    if (!hexes.length) return;
    
    // Find map dimensions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    hexes.forEach(hex => {
      const { x, y } = getHexPosition(hex.q, hex.r);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    
    const mapWidth = maxX - minX + settings.hexSize * 2;
    const mapHeight = maxY - minY + settings.hexSize * 2;
    
    const containerWidth = mapContainerRef.current.clientWidth;
    const containerHeight = mapContainerRef.current.clientHeight;
    
    // Center the map
    setViewTransform({
      x: (containerWidth - mapWidth) / 2 - minX,
      y: (containerHeight - mapHeight) / 2 - minY,
      scale: 1
    });
  };
  
  // Calculate hex position using axial coordinates (q, r)
  const getHexPosition = (q, r) => {
    const size = settings.hexSize;
    const width = size * Math.sqrt(3);
    const height = size * 2;
    
    // Convert axial coordinates to pixel position
    const x = size * Math.sqrt(3) * (q + r/2);
    const y = size * 3/2 * r;
    
    return { x, y };
  };
  
  // Handle edge scrolling when mouse is near the edges
  useEffect(() => {
    const handleEdgeScrolling = () => {
      if (!isMouseInBounds || isDragging) return;
      
      const container = mapContainerRef.current;
      if (!container) return;
      
      const { clientWidth, clientHeight } = container;
      const { x, y } = mousePosition;
      const threshold = settings.scrollThreshold;
      const speed = settings.scrollSpeed;
      
      let dx = 0;
      let dy = 0;
      
      // Check if mouse is near edges
      if (x < threshold) dx = speed;
      else if (x > clientWidth - threshold) dx = -speed;
      
      if (y < threshold) dy = speed;
      else if (y > clientHeight - threshold) dy = -speed;
      
      if (dx !== 0 || dy !== 0) {
        setViewTransform(prev => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy
        }));
      }
    };
    
    // Set up animation frame for smooth scrolling
    const animate = () => {
      handleEdgeScrolling();
      animationFrameId.current = requestAnimationFrame(animate);
    };
    
    animationFrameId.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isMouseInBounds, isDragging, mousePosition, settings.scrollThreshold, settings.scrollSpeed]);
  
  // Mouse event handlers
  const handleMouseMove = (e) => {
    const container = mapContainerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setViewTransform(prev => ({
        ...prev,
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };
  
  const handleMouseDown = (e) => {
    // Middle mouse button (button 1) for dragging
    if (e.button === 1 || e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const handleMouseEnter = () => {
    setIsMouseInBounds(true);
  };
  
  const handleMouseLeave = () => {
    setIsMouseInBounds(false);
    setIsDragging(false);
  };
  
  // Handle wheel event for zooming
  const handleWheel = (e) => {
    e.preventDefault();
    
    const container = mapContainerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate zoom direction
    const delta = e.deltaY < 0 ? 1 : -1;
    const newScale = Math.max(
      settings.minZoom,
      Math.min(settings.maxZoom, viewTransform.scale + delta * settings.zoomStep)
    );
    
    // Zoom toward mouse position
    if (newScale !== viewTransform.scale) {
      const scaleRatio = newScale / viewTransform.scale;
      
      const newX = mouseX - (mouseX - viewTransform.x) * scaleRatio;
      const newY = mouseY - (mouseY - viewTransform.y) * scaleRatio;
      
      setViewTransform({
        x: newX,
        y: newY,
        scale: newScale
      });
    }
  };
  
  // Hex click handler
  const handleHexClick = (hex) => {
    if (onHexClick) {
      onHexClick(hex);
    }
  };
  
  // Render hexes based on current view
  const renderHexes = () => {
    if (!mapData.hexes) return null;
    
    return mapData.hexes.map(hex => {
      const { x, y } = getHexPosition(hex.q, hex.r);
      const transformedX = x * viewTransform.scale + viewTransform.x;
      const transformedY = y * viewTransform.scale + viewTransform.y;
      
      // Check if hex is visible in current view
      const container = mapContainerRef.current;
      if (container) {
        const size = settings.hexSize * viewTransform.scale;
        if (
          transformedX + size < 0 ||
          transformedY + size < 0 ||
          transformedX - size > container.clientWidth ||
          transformedY - size > container.clientHeight
        ) {
          return null; // Skip rendering for off-screen hexes
        }
      }
      
      return (
        <Hexagon
          key={`${hex.q},${hex.r}`}
          x={transformedX}
          y={transformedY}
          size={settings.hexSize * viewTransform.scale}
          hex={hex}
          onClick={() => handleHexClick(hex)}
          gridEnabled={settings.gridEnabled}
          gridColor={settings.gridColor}
        />
      );
    });
  };
  
  return (
    <div
      className="hex-map-container"
      ref={mapContainerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      style={{ backgroundColor: settings.backgroundColor }}
    >
      <div className="hex-map-content">
        {renderHexes()}
      </div>
      <div className="hex-map-controls">
        <button onClick={() => setViewTransform(prev => ({ ...prev, scale: prev.scale + settings.zoomStep }))}>+</button>
        <button onClick={() => setViewTransform(prev => ({ ...prev, scale: prev.scale - settings.zoomStep }))}>-</button>
        <button onClick={() => centerMap(mapData.hexes)}>Center</button>
      </div>
      <div className="hex-map-info">
        Scale: {viewTransform.scale.toFixed(2)}
      </div>
    </div>
  );
};

// Hexagon component for individual hex cells
const Hexagon = ({ x, y, size, hex, onClick, gridEnabled, gridColor }) => {
  // Generate hexagon points
  const getHexPoints = () => {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const pointX = x + size * Math.cos(angle);
      const pointY = y + size * Math.sin(angle);
      points.push(`${pointX},${pointY}`);
    }
    return points.join(' ');
  };
  
  const hexStyle = {
    fill: hex.color || '#3a5e8c',
    stroke: gridEnabled ? gridColor : hex.color || '#3a5e8c',
    strokeWidth: gridEnabled ? 1 : 0,
    cursor: onClick ? 'pointer' : 'default'
  };
  
  return (
    <g onClick={() => onClick(hex)}>
      <polygon points={getHexPoints()} style={hexStyle} />
      {hex.label && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize={size * 0.3}
        >
          {hex.label}
        </text>
      )}
    </g>
  );
};

HexMap.propTypes = {
  onHexClick: PropTypes.func
};

export default HexMap;