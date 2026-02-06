import { Region } from "react-native-maps";

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
