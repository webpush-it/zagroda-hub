import React, { Suspense, useSyncExternalStore } from "react";

// Leaflet touches `window` at import, so the actual map is lazy-loaded and only
// evaluated on the client. This wrapper is server-safe: the dynamic import is not
// run at module load, so the island can be SSR'd (client:visible) without crashing.
const ZagrodaMapView = React.lazy(() => import("@/components/zagroda/ZagrodaMapView"));

interface Props {
  latitude: number;
  longitude: number;
}

export default function ZagrodaMapEmbed({ latitude, longitude }: Props) {
  // Returns false on the server and during hydration, then true on the client —
  // hydration-safe, mirrors the picker gate in ZagrodaProfileForm.
  const mapReady = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const placeholder = <div className="border-edge bg-surface h-64 w-full rounded-xl border" />;
  if (!mapReady) return placeholder;

  return (
    <Suspense fallback={placeholder}>
      <ZagrodaMapView latitude={latitude} longitude={longitude} />
    </Suspense>
  );
}
