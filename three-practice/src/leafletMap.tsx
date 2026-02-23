import React, { useMemo, useState } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import TerrainGridScene from "./OSMMapScene";

type LatLng = { lat: number; lng: number };

function LeafletSync({
  onChange,
}: {
  onChange: (center: LatLng, zoom: number) => void;
}) {
  // Listens for pan/zoom and pushes new values to parent state
  useMapEvents({
    moveend: (e: any) => {
      const map = e.target;
      const c = map.getCenter();
      onChange({ lat: c.lat, lng: c.lng }, map.getZoom());
    },
    zoomend: (e:any ) => {
      const map = e.target;
      const c = map.getCenter();
      onChange({ lat: c.lat, lng: c.lng }, map.getZoom());
    },
  });
  return null;
}

export default function MapViewToggle() {
  const [mode, setMode] = useState<"map" | "terrain">("map");
  const [center, setCenter] = useState<LatLng>({
    lat: 27.986065,
    lng: 86.922623,
  });
  const [zoom, setZoom] = useState<number>(13);

  const label = mode === "map" ? "Switch to 3D" : "Switch to Map";

  const osmUrl = useMemo(() => "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <button
        onClick={() => setMode((m) => (m === "map" ? "terrain" : "map"))}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.55)",
          color: "white",
          cursor: "pointer",
        }}
      >
        {label}
      </button>

      {/* MAP VIEW */}
      {mode === "map" && (
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={zoom}
          style={{ width: "100%", height: "100%" }}
          zoomControl
        >
          <TileLayer url={osmUrl} />
          <LeafletSync
            onChange={(c, z) => {
              setCenter(c);
              setZoom(z);
            }}
          />
        </MapContainer>
      )}

      {/* 3D VIEW */}
      {mode === "terrain" && (
        <div style={{ width: "100%", height: "100%" }}>
          <TerrainGridScene
            lat={center.lat}
            lon={center.lng}
            zoom={zoom}
          />
        </div>
      )}

    </div>
  );
}
