import { CacheStore } from "../../helpers/variables";
import { grab, poke } from "poke-object";

export const incrementFetcherSize = (projectUrl, size = 0) => incrementFetcherSizeCore(CacheStore.DatabaseStats, projectUrl, size);

export const incrementFetcherSizeCore = (baseObj, projectUrl, size = 0) => {
    baseObj._fetcher_size += size;
    const b4 = grab(baseObj.fetchers, [projectUrl], 0);
    poke(baseObj.fetchers, [projectUrl], b4 + size);
}