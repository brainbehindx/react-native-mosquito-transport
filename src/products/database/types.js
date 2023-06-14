
export const TIMESTAMP = { $timestamp: "now" };

export const IS_TIMESTAMP = (t) => t && (typeof t.$timestamp === 'number' || t.$timestamp === 'now') && Object.keys(t).length === 1;

export const INCREMENT = (t) => ({ $increment: t || 1 });

export const FIELD_DELETION = { $deletion: true };