import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Leaflet's default icon resolves its own image paths relative to the CSS, which
// breaks under a bundler (Vite rewrites the asset URLs). Rebind the default icon
// to the bundled asset URLs so the marker renders instead of showing a broken image.
export const defaultIcon = L.icon({
  iconUrl: markerIcon.src,
  iconRetinaUrl: markerIcon2x.src,
  shadowUrl: markerShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// OSM raster tiles — low volume, attribution required on every map (picker + view).
export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const OSM_MAX_ZOOM = 19;

export interface Coords {
  lat: number;
  lng: number;
}
