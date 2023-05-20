
export default class GlobalListener {
    constructor(initialValue) {
        this.listener = {};
        this.lastTriggerValue = initialValue || null;

        this.lastTriggerValueMap = {};
        this.lastListenerKey = 1;
    }

    setlastTriggerValue(value) {
        this.lastTriggerValue = value;
    }

    startListener(callback, useLastTriggerValue = false) {
        let key = `${++this.lastListenerKey}`;

        if (typeof key !== 'string' || typeof callback !== 'function' || typeof useLastTriggerValue !== 'boolean') throw 'Invalid param was parsed to startListener';

        if (this.listener[key])
            this.cancelListener(key);

        this.listener[key] = callback;

        if (useLastTriggerValue)
            setTimeout(() => {
                if (this.listener[key]) this.listener[key](...(this.lastTriggerValue || []));
            }, 3);

        return () => {
            this.cancelListener(key);
        }
    }

    startKeyListener(key, callback, useLastTriggerValue = false) {
        if (typeof key !== 'string' || typeof callback !== 'function' || typeof useLastTriggerValue !== 'boolean') throw 'Invalid param was parsed to startListener';

        if (this.listener[key])
            this.cancelListener(key);

        this.listener[key] = callback;

        if (useLastTriggerValue)
            this.listener[key](...(this.lastTriggerValueMap[key] || []));
    }

    cancelListener(ref) {
        if (typeof ref !== 'string') throw 'Invalid param was parsed to cancelListener';
        try {
            if (this.listener[ref])
                delete this.listener[ref];
        } catch (e) {
            console.error(`Unable to cancel global listener with ref "${ref}"`);
        }
    }

    triggerListener() {
        const param = [...(arguments || [])];

        // console.log('triggering ', param, ' &listener =', this.listener);
        Object.keys(this.listener || {}).forEach(key => {
            this.listener[key](...param);
        });
        this.lastTriggerValue = param;
    }

    triggerKeyListener() {
        // console.log('insider triggerKeyListener =', arguments);

        const param = [...(arguments || [])],  // un mutate reference to argument
            key = param[0],
            value = param.filter((v, i) => i);

        if (!key) throw 'a key must be provided to GlobalListener triggerKeyListener';

        // console.log('triggering ', param, ' &listener =', this.listener);

        if (this.listener[key]) {
            this.listener[key](...value);
        } // else console.warn(`no listener found for "${param[0]}"`);

        this.lastTriggerValueMap[key] = value;
        // console.log('triggerKeyListener finish');
    }
}