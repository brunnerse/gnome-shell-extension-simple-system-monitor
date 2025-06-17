export const SETTING_SCHEMA = 'org.gnome.shell.extensions.simple-system-monitor';

export var Prefs = class Prefs {
    constructor(settings) {
        this.EXTENSION_POSITION = new PrefValue(settings, 'extension-position', 'string');
        this.EXTENSION_ORDER = new PrefValue(settings, 'extension-order', 'int');
        this.FONT_WEIGHT = new PrefValue(settings, 'font-weight', 'int');
        this.SHOW_EXTRA_SPACES = new PrefValue(settings, 'show-extra-spaces', 'boolean');
        this.SHOW_PERCENT_SIGN = new PrefValue(settings, 'show-percent-sign', 'boolean');
        this.IS_CPU_USAGE_ENABLE = new PrefValue(settings, 'is-cpu-usage-enable', 'boolean');
        this.CPU_USAGE_TEXT = new PrefValue(settings, 'cpu-usage-text', 'string');
        this.IS_TEMPERATURE_ENABLE = new PrefValue(settings, 'is-temperature-enable', 'boolean');
        this.TEMPERATURE_TEXT = new PrefValue(settings, 'temperature-text', 'string');
        this.IS_TEMPERATURE_FAHRENHEIT = new PrefValue(
            settings,
            'is-temperature-fahrenheit',
            'boolean',
        );
        this.IS_MEMORY_USAGE_ENABLE = new PrefValue(settings, 'is-memory-usage-enable', 'boolean');
        this.MEMORY_USAGE_TEXT = new PrefValue(settings, 'memory-usage-text', 'string');
        this.IS_DOWNLOAD_SPEED_ENABLE = new PrefValue(
            settings,
            'is-download-speed-enable',
            'boolean',
        );
        this.DOWNLOAD_SPEED_TEXT = new PrefValue(settings, 'download-speed-text', 'string');
        this.IS_UPLOAD_SPEED_ENABLE = new PrefValue(settings, 'is-upload-speed-enable', 'boolean');
        this.UPLOAD_SPEED_TEXT = new PrefValue(settings, 'upload-speed-text', 'string');
        this.ITEM_SEPARATOR = new PrefValue(settings, 'item-separator', 'string');
        this.REFRESH_INTERVAL = new PrefValue(settings, 'refresh-interval', 'int');
        this.FONT_FAMILY = new PrefValue(settings, 'font-family', 'string');
        this.FONT_SIZE = new PrefValue(settings, 'font-size', 'string');
        this.TEXT_COLOR = new PrefValue(settings, 'text-color', 'string');
        this.IS_SWAP_USAGE_ENABLE = new PrefValue(settings, 'is-swap-usage-enable', 'boolean');
        this.SWAP_USAGE_TEXT = new PrefValue(settings, 'swap-usage-text', 'string');
        this.SHOW_FULL_NET_SPEED_UNIT = new PrefValue(
            settings,
            'show-full-net-speed-unit',
            'boolean',
        );
    }
};

export class PrefValue {
    constructor(gioSettings, key, type) {
        this._gioSettings = gioSettings;
        this._key = key;
        this._type = type;
        this._changedListenerId = -1;
    }

    get() {
        return this._gioSettings[`get_${this._type}`](this._key);
    }

    set(v) {
        return this._gioSettings[`set_${this._type}`](this._key, v);
    }

    changed(callback) {
        this._changedListenerId = this._gioSettings.connect(`changed::${this._key}`, callback);
        return this._changedListenerId;
    }

    disconnect() {
        if (this._changedListenerId > 0) {
            this._gioSettings.disconnect(this._changedListenerId);
        }
    }
}
