
export const TIMESTAMP = (time) => {
    if (time && (typeof time !== 'number' || time < 0)) throw 'Invalid value supplied to TIMESTAMP, expected a positive number';
    return ({ $timestamp: time || "now" });
};

export const IS_TIMESTAMP = (t) => t && (typeof t.$timestamp === 'number' || t.$timestamp === 'now') && Object.keys(t).length === 1;

export const INCREMENT = (t) => ({ $increment: t || 1 });

export const FIELD_DELETION = { $deletion: true };