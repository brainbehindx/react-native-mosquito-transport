import { niceGuard } from "guard-object";

export const TIMESTAMP = { $timestamp: "now" };
export const TIMESTAMP_OFFSET = (v) => ({ $timestamp_offset: v });

export const IS_TIMESTAMP = (t) => niceGuard({ $timestamp: t => t === 'now' || typeof t.$timestamp === 'number' }, t);

export const DOCUMENT_EXTRACTION = (path) => ({ $dynamicValue: path });

export const GEO_JSON = (lat, lng) => ({
    type: "Point",
    coordinates: [lng, lat],
});

export const FIND_GEO_JSON = (location, offSetMeters, centerMeters) => ({
    $nearSphere: {
        $geometry: {
            type: "Point",
            coordinates: location.slice(0).reverse()
        },
        $minDistance: centerMeters || 0,
        $maxDistance: offSetMeters
    }
});