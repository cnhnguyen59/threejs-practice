import React from "react";
import OSMMapScene from "./OSMMapScene";
import MapViewToggle from "./leafletMap";
import AGlobe from "./threeGlobe"

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* <OSMMapScene /> */}
      {/* <MapViewToggle /> */}
      <AGlobe />
    
    </div>
  );
}
