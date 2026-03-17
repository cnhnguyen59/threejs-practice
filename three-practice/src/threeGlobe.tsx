import React, { useMemo, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, Sphere } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/Addons.js";
// import { motion } from "motion/react";
import Globe from "react-globe.gl";
import { Stars } from "@react-three/drei";
import rewind from "@turf/rewind";
import simplify from "@turf/simplify";
import countriesGeoJson from "./assets/ne_110m_admin_0_countries.json";
import centroid from "@turf/centroid";

function StarfieldBackground() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <Canvas
        style={{ width: "100%", height: "100%" }}
        camera={{ position: [0, 0, 5], fov: 60 }}
      >
        <color attach="background" args={["black"]} />
        <ambientLight intensity={1} />
        <Stars radius={100} depth={50} count={3000} factor={4} fade />
      </Canvas>
    </div>
  );
}

const CornerBrackets = () => (
  <>
    <div className="absolute -left-1 -top-1 z-10 h-4 w-4 border-l-2 border-t-2 border-[#C4D600]" />
    <div className="absolute -right-1 -top-1 z-10 h-4 w-4 border-r-2 border-t-2 border-[#C4D600]" />
    <div className="absolute -bottom-1 -left-1 z-10 h-4 w-4 border-b-2 border-l-2 border-[#C4D600]" />
    <div className="absolute -bottom-1 -right-1 z-10 h-4 w-4 border-b-2 border-r-2 border-[#C4D600]" />
  </>
);

export interface Operation {
  _id: string;
  created: string;
  name: string;
  classification: string;
  status: string;
  regions?: string[];
  region_loading?: boolean;
  users?: string[];
  user_loading?: boolean;
}

const regions = ["Costa Rica", "China", "Scarborough Reef"];

const SATELLITE_MODEL_URL = "src/assets/models/landsat.glb";

const DC = { lat: 38.9072, lng: -77.0369 };

type ArcDatum = {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  label: string;
};

type SatelliteDatum = {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
};

type RegionFeature = {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
  properties: {
    name: string;
    display_name: string;
    place_id: number | string;
    osm_id: number | string;
    category: string;
    type: string;
  };
};

function getFeatureCenter(feature: RegionFeature) {
  const c = centroid(feature as any);
  const [lng, lat] = c.geometry.coordinates;
  return { lat, lng };
}

function projectLatLngToScreen(
  globe: any,
  container: HTMLDivElement,
  lat: number,
  lng: number,
  altitude = 0.01,
) {
  const camera = globe.camera();
  const pos = globe.getCoords(lat, lng, altitude);

  const vector = new THREE.Vector3(pos.x, pos.y, pos.z);
  vector.project(camera);

  const rect = container.getBoundingClientRect();

  const x = ((vector.x + 1) / 2) * rect.width;
  const y = ((-vector.y + 1) / 2) * rect.height;

  const visible = vector.z < 1;

  return { x, y, visible };
}

export default function AGlobe() {
  const globeRef = useRef<any>(null);
  const [polygonData, setPolygonData] = useState<RegionFeature[]>([]);
  const [hoveredPolygon, setHoveredPolygon] = useState<RegionFeature | null>(
    null,
  );
  const [calloutAnchor, setCalloutAnchor] = useState<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  const [arcData, setArcData] = useState<ArcDatum[]>([]);

  const [globeSize, setGlobeSize] = useState(100);

  const satelliteModelRef = useRef<THREE.Object3D | null>(null);
  const [satellites, setSatellites] = useState<SatelliteDatum[]>([
    { id: "sat-1", lat: 0, lng: 0, altitude: 0.2 },
  ]);
  const [modelReady, setModelReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loader = new GLTFLoader();

    loader.load(
      SATELLITE_MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(2);
        model.rotation.x = Math.PI / 2;
        satelliteModelRef.current = model;
        setModelReady(true);
      },
      undefined,
      (error) => {
        console.error("Failed to load satellite model", error);
      },
    );
  }, []);

  useEffect(() => {
    const updateSize = () => {
      const size = Math.min(window.innerWidth, window.innerHeight) * 0.9;
      setGlobeSize(size);
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    if (!hoveredPolygon || !globeRef.current || !containerRef.current) {
      setCalloutAnchor(null);
      return;
    }

    let frameId = 0;

    const updateAnchor = () => {
      if (!globeRef.current || !containerRef.current || !hoveredPolygon) return;

      const { lat, lng } = getFeatureCenter(hoveredPolygon);

      const projected = projectLatLngToScreen(
        globeRef.current,
        containerRef.current,
        lat,
        lng,
        0.01,
      );

      setCalloutAnchor(projected);
      frameId = requestAnimationFrame(updateAnchor);
    };

    updateAnchor();

    return () => cancelAnimationFrame(frameId);
  }, [hoveredPolygon, globeSize]);

  async function searchPlaceGeoJSON(q: string) {
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({
        q,
        format: "jsonv2",
        polygon_geojson: "1",
        limit: "1",
      });

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Nominatim request failed: ${res.status}`);
    }

    return res.json();
  }

  function getCountryFeature(region: string): RegionFeature[] {
    const feature = countriesGeoJson.features.find((f: any) => {
      const name = f?.properties?.NAME;
      const admin = f?.properties?.ADMIN;
      return name === region || admin === region;
    });

    if (!feature?.geometry) return [];

    const geometryType = feature.geometry.type;
    if (geometryType !== "Polygon" && geometryType !== "MultiPolygon") {
      return [];
    }

    return [
      {
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          name: feature.properties?.NAME ?? region,
          display_name: feature.properties?.ADMIN ?? region,
          place_id: feature.properties?.ISO_A3 ?? region,
          osm_id: feature.properties?.ISO_A3 ?? region,
          category: "country",
          type: "boundary",
        },
      },
    ];
  }

  function isCountryRegion(region: string) {
    return countriesGeoJson.features.some((f: any) => {
      const name = f?.properties?.NAME;
      const admin = f?.properties?.ADMIN;
      return name === region || admin === region;
    });
  }

  useEffect(() => {
    if (!globeRef.current) return;

    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enablePan = false;
  }, []);

  useEffect(() => {
    let frameId = 0;
    let angle = 0;

    const animate = () => {
      angle += 0.2;

      setSatellites([
        {
          id: "sat-1",
          lat: 15 * Math.sin((angle * Math.PI) / 180),
          lng: angle % 360,
          altitude: 0.2,
        },
      ]);

      frameId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(frameId);
  }, []);

  const objectThreeObject = useMemo(() => {
    return () => {
      if (!satelliteModelRef.current) {
        return new THREE.Mesh(
          new THREE.BoxGeometry(4, 2, 2),
          new THREE.MeshStandardMaterial({ color: "#cccccc" }),
        );
      }

      return satelliteModelRef.current.clone(true);
    };
  }, [modelReady]);

  useEffect(() => {
    let cancelled = false;

    const fetchPolyData = async () => {
      const allPolygons: RegionFeature[] = [];

      for (const region of regions) {
        try {
          if (isCountryRegion(region)) {
            allPolygons.push(...getCountryFeature(region));
            continue;
          }

          const geoJsonData = await searchPlaceGeoJSON(region);
          const firstMatch = Array.isArray(geoJsonData) ? geoJsonData[0] : null;

          if (!firstMatch?.geojson) continue;

          const type = firstMatch.geojson.type;
          if (type !== "Polygon" && type !== "MultiPolygon") continue;

          let geometry = firstMatch.geojson;

          if (
            geometry.type === "Polygon" &&
            Array.isArray(geometry.coordinates) &&
            geometry.coordinates.length > 0
          ) {
            geometry = {
              ...geometry,
              coordinates: [[...geometry.coordinates[0]].reverse()],
            };
          }

          allPolygons.push({
            type: "Feature",
            geometry,
            properties: {
              name: firstMatch.name ?? region,
              display_name: firstMatch.display_name ?? region,
              place_id: firstMatch.place_id ?? region,
              osm_id: firstMatch.osm_id ?? region,
              category: firstMatch.category ?? "place",
              type: firstMatch.type ?? "boundary",
            },
          });
        } catch (error) {
          console.error(`Failed to fetch polygon for ${region}`, error);
        }
      }

      if (!cancelled) {
        console.log(allPolygons);
        setPolygonData(allPolygons);
        const arcs = allPolygons.map((feature) => {
          const center = getFeatureCenter(feature);

          return {
            startLat: DC.lat,
            startLng: DC.lng,
            endLat: center.lat,
            endLng: center.lng,
            label: feature.properties?.name ?? "Unknown region",
          };
        });

        setArcData(arcs);
      }
    };

    fetchPolyData();

    return () => {
      cancelled = true;
    };
  }, []);

  //   return polygonData
  //     .filter((f) => f.properties.name === "Scarborough Shoal")
  //     .flatMap((feature) => {
  //       const geom = feature.geometry;

  //       if (geom.type === "Polygon") {
  //         const outerRing = geom.coordinates[0] ?? [];
  //         const points = outerRing
  //           .filter(
  //             (coord: any) =>
  //               Array.isArray(coord) &&
  //               coord.length >= 2 &&
  //               Number.isFinite(coord[0]) &&
  //               Number.isFinite(coord[1]),
  //           )
  //           .map(([lng, lat]: [number, number]) => ({ lat, lng }));

  //         return points.length > 1
  //           ? [{ name: feature.properties.name, points }]
  //           : [];
  //       }

  //       return [];
  //     });
  // }, [polygonData]);

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-full overflow-hidden bg-black items-center justify-center"
    >
      <StarfieldBackground />
      <div className="relative z-10 flex h-full w-full items-center justify-center">
        <Globe
          ref={globeRef}
          width={globeSize}
          height={globeSize}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
          objectsData={satellites}
          objectLat="lat"
          objectLng="lng"
          objectAltitude="altitude"
          objectThreeObject={objectThreeObject}
          polygonsData={polygonData}
          polygonGeoJsonGeometry="geometry"
          polygonAltitude={0.003}
          polygonStrokeColor={() => "#C4D600"}
          polygonsTransitionDuration={300}
          onPolygonHover={(polygon: RegionFeature | null) =>
            setHoveredPolygon(polygon)
          }
          polygonCapColor={(d: RegionFeature) =>
            d === hoveredPolygon
              ? "rgba(196,214,0,0.55)"
              : "rgba(196,214,0,0.28)"
          }
          polygonSideColor={(d: RegionFeature) =>
            d === hoveredPolygon
              ? "rgba(196,214,0,0.22)"
              : "rgba(196,214,0,0.12)"
          }
          arcsData={arcData}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={() => ["rgba(196,214,0,0.95)", "rgba(0,229,255,0.9)"]}
          arcStroke={0.25}
          arcAltitude={0.3}
          arcDashLength={0.3}
          arcDashGap={0.01}
          arcDashAnimateTime={3000}
        />
      </div>

      {hoveredPolygon && calloutAnchor?.visible && (
        <PolygonCallout
          x={calloutAnchor.x}
          y={calloutAnchor.y}
          label={hoveredPolygon.properties?.name ?? "Unknown region"}
        />
      )}

      {/* {hoveredPolygon && (
        <div
          style={{
            position: "absolute",
            left: mousePos.x + 20,
            top: mousePos.y + 20,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "relative",
              background: "black",
              color: "white",
              padding: "12px 16px",
              border: "solid 1px #C4D600",
              minWidth: 140,
            }}
          >
            <CornerBrackets />
            {hoveredPolygon.properties?.name ?? "Unknown region"}
          </div>
        </div>
      )} */}
    </div>
  );
}

type PolygonCalloutProps = {
  x: number;
  y: number;
  label: string;
};

function PolygonCallout({ x, y, label }: PolygonCalloutProps) {
  const boxWidth = 180;
  const boxHeight = 56;

  const boxOffsetX = 70;
  const boxOffsetY = -28;

  const lineStartX = 0;
  const lineStartY = 0;

  const lineEndX = boxOffsetX;
  const lineEndY = boxOffsetY + boxHeight / 2;

  const svgLeft = Math.min(lineStartX, lineEndX);
  const svgTop = Math.min(lineStartY, lineEndY);
  const svgWidth = Math.abs(lineEndX - lineStartX) + 4;
  const svgHeight = Math.abs(lineEndY - lineStartY) + 4;

  const pathStartX = lineStartX - svgLeft + 2;
  const pathStartY = lineStartY - svgTop + 2;
  const pathEndX = lineEndX - svgLeft + 2;
  const pathEndY = lineEndY - svgTop + 2;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{
          position: "absolute",
          left: svgLeft - 2,
          top: svgTop - 2,
          overflow: "visible",
        }}
      >
        <line
          x1={pathStartX}
          y1={pathStartY}
          x2={pathEndX}
          y2={pathEndY}
          stroke="#C4D600"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      <div
        style={{
          position: "absolute",
          left: boxOffsetX,
          top: boxOffsetY,
          width: boxWidth,
          minHeight: boxHeight,
          overflow: "visible",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.96) 0%, rgba(10,16,0,0.94) 100%)",
          color: "white",
          padding: "10px 14px 12px 14px",
          border: "1px solid rgba(196,214,0,0.65)",
          boxShadow: `
      0 0 0 1px rgba(196,214,0,0.12) inset,
      0 0 10px rgba(196,214,0,0.12),
      0 0 24px rgba(196,214,0,0.08)
    `,
          clipPath:
            "polygon(0 8px, 8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px))",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 4,
            border: "1px solid rgba(196,214,0,0.18)",
            pointerEvents: "none",
            clipPath:
              "polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 28,
            height: 28,
            borderTop: "2px solid #C4D600",
            borderLeft: "2px solid #C4D600",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 28,
            height: 28,
            borderTop: "2px solid #C4D600",
            borderRight: "2px solid #C4D600",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 28,
            height: 28,
            borderBottom: "2px solid #C4D600",
            borderLeft: "2px solid #C4D600",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 28,
            height: 28,
            borderBottom: "2px solid #C4D600",
            borderRight: "2px solid #C4D600",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: "#C4D600",
              fontSize: 10,
              opacity: 0.9,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: "#C4D600",
                boxShadow: "0 0 8px rgba(196,214,0,0.55)",
              }}
            />
            Operation
          </div>

          <h5
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.1,
              fontWeight: 700,
              color: "#ffffff",
              textShadow: "0 0 8px rgba(196,214,0,0.15)",
            }}
          >
            {label}
          </h5>

          <p
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.3,
              color: "rgba(255,255,255,0.72)",
              letterSpacing: "0.12em",
            }}
          >
            Classification:
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.3,
              color: "blue",
              letterSpacing: "0.12em",
            }}
          >
            Confidential
          </p>
        </div>
      </div>
    </div>
  );
}
