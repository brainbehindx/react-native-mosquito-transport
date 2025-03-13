import { CacheStore } from "../../helpers/variables";
import getLodash from 'lodash/get';
import setLodash from 'lodash/set';

export const incrementFetcherSize = (projectUrl, size = 0) => incrementFetcherSizeCore(CacheStore.DatabaseStats, projectUrl, size);

export const incrementFetcherSizeCore = (baseObj, projectUrl, size = 0) => {
    baseObj._fetcher_size += size;
    const b4 = getLodash(baseObj.fetchers, [projectUrl], 0);
    setLodash(baseObj.fetchers, [projectUrl], b4 + size);
}