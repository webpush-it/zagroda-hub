import { useEffect, useRef } from "react";
import L from "leaflet";
import { defaultIcon, OSM_ATTRIBUTION, OSM_MAX_ZOOM, OSM_TILE_URL } from "./leaflet";

interface Props {
  latitude: number;
  longitude: number;
}

const VIEW_ZOOM = 13;

// Read-only map with a fixed marker at the zagroda's location. Leaflet touches
// `window` at import, so this island is mounted client-side only (client:visible).
export default function ZagrodaMapView({ latitude, longitude }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Coords come from the server and are stable for the component's life, so the
  // map is built once; the guard also absorbs StrictMode's double-invoke.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, { scrollWheelZoom: false }).setView([latitude, longitude], VIEW_ZOOM);
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: OSM_MAX_ZOOM }).addTo(map);
    L.marker([latitude, longitude], { icon: defaultIcon }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  return <div ref={containerRef} className="border-edge z-0 h-64 w-full overflow-hidden rounded-xl border" />;
}
