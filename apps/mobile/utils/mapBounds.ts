import type { LatLng, Region } from "react-native-maps";

export function getBoundingBox(region: Region): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const minLat = region.latitude - region.latitudeDelta / 2;
  const maxLat = region.latitude + region.latitudeDelta / 2;
  const minLng = region.longitude - region.longitudeDelta / 2;
  const maxLng = region.longitude + region.longitudeDelta / 2;

  return { minLat, maxLat, minLng, maxLng };
}

export function getVisibleAreaMeters(region: Region): {
  width: number;
  height: number;
  area: number;
} {
  const latMeters = region.latitudeDelta * 111320;
  const lngMeters =
    region.longitudeDelta *
    111320 *
    Math.cos((region.latitude * Math.PI) / 180);

  return {
    width: Math.round(lngMeters),
    height: Math.round(latMeters),
    area: Math.round(latMeters * lngMeters),
  };
}

export class BoundsCache {
  private cache: Map<string, any> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 2000) {
    this.maxSize = maxSize;
  }

  private getCacheKey(bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }): string {
    return `${bounds.minLat.toFixed(4)},${bounds.maxLat.toFixed(
      4
    )},${bounds.minLng.toFixed(4)},${bounds.maxLng.toFixed(4)}`;
  }

  set(
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    posts: any[]
  ): void {
    const key = this.getCacheKey(bounds);
    this.cache.set(key, { posts, timestamp: Date.now() });

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  get(bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }): any[] | null {
    const key = this.getCacheKey(bounds);
    const cached = this.cache.get(key);

    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > 5 * 60 * 1000) {
      this.cache.delete(key);
      return null;
    }

    return cached.posts;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

/**
 * The region the map is really showing, from getMapBoundaries(). The map
 * fits whatever region it's asked for to the screen, so its real spans
 * differ from the requested ones -- on a Mercator map a fixed latitude
 * span needs ever more longitude as latitude rises (#97). Returns null
 * for a degenerate box (map not laid out yet).
 */
export function regionFromBoundaries(bounds: {
  northEast: LatLng;
  southWest: LatLng;
}): Region | null {
  const latitudeDelta = bounds.northEast.latitude - bounds.southWest.latitude;
  let longitudeDelta = bounds.northEast.longitude - bounds.southWest.longitude;
  // Crossing the antimeridian.
  if (longitudeDelta < 0) longitudeDelta += 360;
  if (!(latitudeDelta > 0) || !(longitudeDelta > 0)) return null;
  let longitude = bounds.southWest.longitude + longitudeDelta / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (bounds.northEast.latitude + bounds.southWest.latitude) / 2,
    longitude,
    latitudeDelta,
    longitudeDelta,
  };
}

/**
 * Whether `shown` is the map's fit of `requested`: same center, and the
 * span that governed the fit kept exactly (the map only ever widens the
 * other one). False while the map is still showing an earlier view.
 */
export function isFitOf(shown: Region, requested: Region): boolean {
  const near = (a: number, b: number, span: number) =>
    Math.abs(a - b) <= span * 0.01;
  return (
    near(shown.latitude, requested.latitude, shown.latitudeDelta) &&
    near(shown.longitude, requested.longitude, shown.longitudeDelta) &&
    (near(shown.latitudeDelta, requested.latitudeDelta, requested.latitudeDelta) ||
      near(shown.longitudeDelta, requested.longitudeDelta, requested.longitudeDelta))
  );
}
