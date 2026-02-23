import * as THREE from "three";
import React, { Suspense, useMemo, useState } from "react";
import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls, shaderMaterial, useTexture, Sky } from "@react-three/drei";


/**
 * Mapbox Terrain-RGB decoding:
 * meters = -10000 + (R*256*256 + G*256 + B) * 0.1
 */
const TerrainMaterial = shaderMaterial(
  {
    uSat: null,
    uDem: null,
    uHeightScale: 0.0025, // meters -> world units (tune)
  },
  // vertex
  `
 varying vec2 vUv;
uniform sampler2D uDem;
uniform float uHeightScale;

float decodeHeight(vec3 rgb) {
  float r = rgb.r * 255.0;
  float g = rgb.g * 255.0;
  float b = rgb.b * 255.0;
  return -10000.0 + (r * 256.0 * 256.0 + g * 256.0 + b) * 0.1;
}

void main() {
  vUv = uv;

  vec4 dem = texture2D(uDem, uv);
  float hMeters = decodeHeight(dem.rgb);
hMeters = hMeters + 9000.0;

  
  

  vec3 displaced = position;
  displaced += normal * (hMeters * uHeightScale);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
  `,
  // fragment
  `
  varying vec2 vUv;
  uniform sampler2D uSat;

  void main() {
    vec4 color = texture2D(uSat, vUv);
    gl_FragColor = color;
  }
  `
);

extend({ TerrainMaterial });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      terrainMaterial: any;
    }
  }
}

function latLonToTileXY(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function Tile({
  x,
  y,
  zoom,
  tileSize = 10,
  segments = 96,
  heightScale = 0.0025,
  mapboxToken,
  offsetX,
  offsetY,
}: {
  x: number;
  y: number;
  zoom: number;
  tileSize?: number;
  segments?: number;
  heightScale?: number;
  mapboxToken: string;
  offsetX: number;
  offsetY: number;
}) {
  // Mapbox URLs
  const satUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/${zoom}/${x}/${y}@2x?access_token=${mapboxToken}`;
  const demUrl = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${x}/${y}.pngraw?access_token=${mapboxToken}`;
const streetUrl =
  `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${zoom}/${x}/${y}@2x?access_token=${mapboxToken}`;
  const [satTex, demTex, streetTex] = useTexture([satUrl, demUrl, streetUrl]);

satTex.colorSpace = THREE.SRGBColorSpace;
streetTex.colorSpace = THREE.SRGBColorSpace;
satTex.anisotropy = 8;
satTex.wrapS = satTex.wrapT = THREE.ClampToEdgeWrapping;
satTex.needsUpdate = true;

// DEM (data)
demTex.colorSpace = THREE.NoColorSpace;          // MUST be raw
demTex.minFilter = THREE.NearestFilter;          // MUST be nearest
demTex.magFilter = THREE.NearestFilter;
demTex.generateMipmaps = false;                  // MUST be off
demTex.wrapS = demTex.wrapT = THREE.ClampToEdgeWrapping;
demTex.needsUpdate = true;
const EPS = 0.02; // try 0.01–0.05 depending on tileSize



  return (
    <group position={[offsetX * tileSize, 0, offsetY * tileSize]}>
  <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
    <planeGeometry args={[tileSize, tileSize, 1, 1]} />
    <meshBasicMaterial
      map={streetTex}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  </mesh>

  <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
    <planeGeometry args={[tileSize + EPS, tileSize + EPS, segments, segments]} />
    <terrainMaterial uSat={satTex} uDem={demTex} uHeightScale={heightScale} />
  </mesh>
</group>

    
  );
}

function TerrainGrid5x5({
  lat,
  lon,
  zoom = 11,
  tileSize = 10,
  segments = 96, // try 64 for faster, 128 for prettier
  heightScale = 0.0025,
}: {
  lat: number;
  lon: number;
  zoom?: number;
  tileSize?: number;
  segments?: number;
  heightScale?: number;
}) {
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string;
  if (!mapboxToken) {
    throw new Error("Missing VITE_MAPBOX_TOKEN in .env");
  }

  const center = useMemo(() => latLonToTileXY(lat, lon, zoom), [lat, lon, zoom]);

  // Build a 5x5 grid: offsets -2..+2 in x and y
  const tiles = useMemo(() => {
    const out: Array<{ x: number; y: number; ox: number; oy: number }> = [];
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        out.push({ x: center.x + ox, y: center.y + oy, ox, oy });
      }
    }
    return out;
  }, [center.x, center.y]);

  return (
    <group>
      {tiles.map((t) => {

          const dist = Math.max(Math.abs(t.ox), Math.abs(t.oy));
const seg = dist === 0 ? 256 : dist === 1 ? 128 : 64;

        
        return (
        <Suspense fallback={null} key={`${zoom}-${t.x}-${t.y}`}>
          <Tile
            x={t.x}
            y={t.y}
            zoom={zoom}
            tileSize={tileSize}
            segments={seg}
            heightScale={heightScale}
            mapboxToken={mapboxToken}
            offsetX={t.ox}
            offsetY={t.oy}
          />
        </Suspense>
      )})}
    </group>
  );
}

export default function TerrainGridScene({lat, lon, zoom}: {lat: number, lon: number,zoom:number}) {
    const latRad = (35.363602 * Math.PI) / 180;
const zScale = 1 / Math.cos(latRad);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas gl={{ outputColorSpace: THREE.SRGBColorSpace }} camera={{ position: [0, 18, 18], fov: 50 }}>
        <Sky
  distance={450000}
  sunPosition={[5, 1, 8]}
  inclination={0.6}
  azimuth={0.25}
/>
        <ambientLight intensity={0.9} />
        <directionalLight position={[10, 20, 10]} intensity={1.2} />
         <gridHelper
    args={[200, 40, "#3a3a3a", "#1f1f1f"]}
    position={[0, 0, 0]}
  />
        {/* Pick your center */}
        <group scale={[1,1,zScale]}>
        <TerrainGrid5x5
          lat={lat}
          lon={lon}
          zoom={zoom}
          tileSize={10}
          segments={96}
          heightScale={0.0018}
        />
        </group>

        <OrbitControls makeDefault target={[0, 0, 0]} minDistance={0.2} maxDistance={500}/>
      </Canvas>

      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          fontSize: 12,
          background: "rgba(0,0,0,0.5)",
          color: "#fff",
          padding: 8,
          borderRadius: 6,
        }}
      >
        Imagery/terrain: Mapbox · Terrain uses DEM (terrain-rgb)
      </div>
    </div>
  );
}
