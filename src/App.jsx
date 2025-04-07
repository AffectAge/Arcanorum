// src/App.jsx
import React, { useState } from 'react';
import HexMap from './components/HexMap/HexMap';
import './App.css';

const App = () => {
  const [selectedHex, setSelectedHex] = useState(null);
  
  // Handle hex click
  const handleHexClick = (hex) => {
    setSelectedHex(hex);
    console.log('Hex clicked:', hex);
  };
  
  return (
    <div className="app-container">
      <div className="hex-map-wrapper">
        <HexMap onHexClick={handleHexClick} />
      </div>
      
      {selectedHex && (
        <div className="hex-info-panel">
          <h3>Selected Hex</h3>
          <p>Coordinates: q={selectedHex.q}, r={selectedHex.r}</p>
          <p>Label: {selectedHex.label || 'No label'}</p>
          <button onClick={() => setSelectedHex(null)}>Close</button>
        </div>
      )}
    </div>
  );
};

export default App;