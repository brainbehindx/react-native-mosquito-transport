
export const TIMESTAMP = { $timestamp: "now" };

export const IS_TIMESTAMP = (t) => t && (typeof t.$timestamp === 'number' || t.$timestamp === 'now') && Object.keys(t).length === 1;

export const DOCUMENT_EXTRACTION = (path) => ({ $dynamicValue: path });

export const GEO_JSON = (lat, lng) => ({
    type: "Point",
    coordinates: [lng, lat],
});

export const FIND_GEO_JSON = (location, offSetMeters, centerMeters) => ({
    $nearSphere: {
        $geometry: {
            type: "Point",
            coordinates: location.reverse()
        },
        $minDistance: centerMeters || 0,
        $maxDistance: offSetMeters
    }
});