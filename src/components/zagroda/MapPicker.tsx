import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import L from "leaflet";
import { defaultIcon, OSM_ATTRIBUTION, OSM_MAX_ZOOM, OSM_TILE_URL, type Coords } from "./leaflet";

export type { Coords };

interface Props {
  /** Manual pin coordinates, or null when the zagroda has no manual pin. */
  latitude: number | null;
  longitude: number | null;
  /** Name-derived coordinates ("city location"), used as the visual anchor when there is no manual pin. */
  fallback: Coords | null;
  onChange: (c: Coords | null) => void;
}

// Centered on Poland when there is neither a pin nor name-derived coords.
const POLAND_CENTER: Coords = { lat: 52.0, lng: 19.2 };
const PIN_ZOOM = 13;
const COUNTRY_ZOOM = 6;

function effectivePosition(latitude: number | null, longitude: number | null, fallback: Coords | null): Coords {
  if (latitude != null && longitude != null) return { lat: latitude, lng: longitude };
  return fallback ?? POLAND_CENTER;
}

export default function MapPicker({ latitude, longitude, fallback, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Keep the latest onChange without re-running the mount effect (which must run once).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // Snapshot the props at first render for the initial view; the sync effect below
  // owns every subsequent update, so the mount effect stays dependency-stable.
  const [initialView] = useState(() => ({ latitude, longitude, fallback }));

  const hasPin = latitude != null && longitude != null;

  // Mount the map once. Leaflet touches `window` at module load, so this component
  // is only ever rendered client-side (lazy-loaded, mounted after hydration).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const { latitude: lat0, longitude: lng0, fallback: fb0 } = initialView;
    const start = effectivePosition(lat0, lng0, fb0);
    const startZoom = lat0 != null || fb0 != null ? PIN_ZOOM : COUNTRY_ZOOM;

    const map = L.map(container).setView([start.lat, start.lng], startZoom);
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: OSM_MAX_ZOOM }).addTo(map);

    const marker = L.marker([start.lat, start.lng], { draggable: true, icon: defaultIcon }).addTo(map);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      onChangeRef.current({ lat, lng });
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [initialView]);

  // Sync the marker to prop changes driven from outside the map (e.g. the parent
  // clearing the pin via "Użyj lokalizacji miasta"). Dragging updates props to the
  // same coords the marker already holds, so this is a no-op on that path.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const pos = effectivePosition(latitude, longitude, fallback);
    marker.setLatLng([pos.lat, pos.lng]);
    map.setView([pos.lat, pos.lng]);
  }, [latitude, longitude, fallback]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="border-edge z-0 h-64 w-full overflow-hidden rounded-xl border" />
      <button
        type="button"
        onClick={() => {
          onChangeRef.current(null);
        }}
        disabled={!hasPin}
        className="btn-secondary w-full disabled:opacity-50"
      >
        <MapPin className="size-4" />
        Użyj lokalizacji miasta
      </button>
    </div>
  );
}
