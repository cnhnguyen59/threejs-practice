import React from "react";
import OSMMapScene from "./OSMMapScene";
import MapViewToggle from "./leafletMap";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* <OSMMapScene /> */}
      <MapViewToggle />
    </div>
  );
}
