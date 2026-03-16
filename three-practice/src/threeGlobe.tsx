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
const classificationColors: Record<string, string> = {
  unclassified: "#007A33",
  confidential: "#0033A0",
  secret: "#D80000",
  topsecret: "#FF671F",
  "topsecret-sci": "#FFFF00",
};

const regions = ["China", "Scarborough Reef"];

const SATELLITE_MODEL_URL = "src/assets/models/landsat.glb";

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

export default function AGlobe() {
  const globeRef = useRef<any>(null);
  const [polygonData, setPolygonData] = useState<RegionFeature[]>([]);
  const [globeSize, setGlobeSize] = useState(100);

  const satelliteModelRef = useRef<THREE.Object3D | null>(null);
  const [satellites, setSatellites] = useState<SatelliteDatum[]>([
    { id: "sat-1", lat: 0, lng: 0, altitude: 0.2 },
  ]);
  const [modelReady, setModelReady] = useState(false);

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

          const isScarborough =
            firstMatch?.name === "Scarborough Shoal" ||
            firstMatch?.display_name?.includes("Scarborough Shoal");

          if (
            isScarborough &&
            geometry.type === "Polygon" &&
            Array.isArray(geometry.coordinates) &&
            geometry.coordinates.length > 0
          ) {
            geometry = {
              ...geometry,
              coordinates: [geometry.coordinates[0]],
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
        setPolygonData(allPolygons);
      }
    };

    fetchPolyData();

    return () => {
      cancelled = true;
    };
  }, []);

  const countryPolygons = useMemo(() => {
    return polygonData.filter((f) => f.properties.category === "country");
  }, [polygonData]);

  const shoalPaths = useMemo(() => {
    return polygonData
      .filter((f) => f.properties.name === "Scarborough Shoal")
      .flatMap((feature) => {
        const geom = feature.geometry;

        if (geom.type === "Polygon") {
          const outerRing = geom.coordinates[0] ?? [];
          const points = outerRing
            .filter(
              (coord: any) =>
                Array.isArray(coord) &&
                coord.length >= 2 &&
                Number.isFinite(coord[0]) &&
                Number.isFinite(coord[1]),
            )
            .map(([lng, lat]: [number, number]) => ({ lat, lng }));

          return points.length > 1
            ? [{ name: feature.properties.name, points }]
            : [];
        }

        return [];
      });
  }, [polygonData]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black items-center justify-center">
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
          polygonsData={countryPolygons}
          polygonGeoJsonGeometry="geometry"
          polygonAltitude={0.003}
          polygonCapColor={() => "rgba(196,214,0,0.28)"}
          polygonSideColor={() => "rgba(196,214,0,0.12)"}
          polygonStrokeColor={() => "#C4D600"}
          polygonsTransitionDuration={300}
          pathsData={shoalPaths}
          pathPoints="points"
          pathPointLat="lat"
          pathPointLng="lng"
          pathPointAlt={0.004}
          pathColor={() => "#C4D600"}
          pathStroke={0.5}
          pathResolution={2}
        />
      </div>
    </div>
  );
}
