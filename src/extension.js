/* extension.js
 *
 * This is a fork of <https://extensions.gnome.org/extension/4478/net-speed/>.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Attention: This module is not available as an ECMAScript Module
const ByteArray = imports.byteArray;

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Settings from './settings.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const netSpeedUnits = ['B', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];

let lastTotalNetDownBytes = 0;
let lastTotalNetUpBytes = 0;

let lastCPUUsed = 0;
let lastCPUTotal = 0;

// See <https://github.com/AlynxZhou/gnome-shell-extension-net-speed>.
const getCurrentNetSpeed = (refreshInterval) => {
    const netSpeed = { down: 0, up: 0 };

    try {
        const inputFile = Gio.File.new_for_path('/proc/net/dev');
        const [, content] = inputFile.load_contents(null);
        const contentStr = ByteArray.toString(content);
        const contentLines = contentStr.split('\n');

        // Caculate the sum of all interfaces' traffic line by line.
        let totalDownBytes = 0;
        let totalUpBytes = 0;

        for (let i = 0; i < contentLines.length; i++) {
            const fields = contentLines[i].trim().split(/\W+/);
            if (fields.length <= 2) {
                break;
            }

            // Skip virtual interfaces.
            const networkInterface = fields[0];
            const currentInterfaceDownBytes = Number.parseInt(fields[1]);
            const currentInterfaceUpBytes = Number.parseInt(fields[9]);
            if (
                networkInterface == 'lo' ||
                // Created by python-based bandwidth manager "traffictoll".
                networkInterface.match(/^ifb[0-9]+/) ||
                // Created by lxd container manager.
                networkInterface.match(/^lxdbr[0-9]+/) ||
                networkInterface.match(/^virbr[0-9]+/) ||
                networkInterface.match(/^br[0-9]+/) ||
                networkInterface.match(/^vnet[0-9]+/) ||
                networkInterface.match(/^tun[0-9]+/) ||
                networkInterface.match(/^tap[0-9]+/) ||
                isNaN(currentInterfaceDownBytes) ||
                isNaN(currentInterfaceUpBytes)
            ) {
                continue;
            }

            totalDownBytes += currentInterfaceDownBytes;
            totalUpBytes += currentInterfaceUpBytes;
        }

        if (lastTotalNetDownBytes === 0) {
            lastTotalNetDownBytes = totalDownBytes;
        }
        if (lastTotalNetUpBytes === 0) {
            lastTotalNetUpBytes = totalUpBytes;
        }

        netSpeed['down'] = (totalDownBytes - lastTotalNetDownBytes) / refreshInterval;
        netSpeed['up'] = (totalUpBytes - lastTotalNetUpBytes) / refreshInterval;

        lastTotalNetDownBytes = totalDownBytes;
        lastTotalNetUpBytes = totalUpBytes;
    } catch (e) {
        logError(e);
    }

    return netSpeed;
};

// See https://askubuntu.com/a/854029
const getCurrentTemperature = () => {
    let currentTemperature = 0;

    try {
	// TODO  which thermal zone?
        const inputFile = Gio.File.new_for_path('/sys/class/thermal/thermal_zone0/temp');
        const [, content] = inputFile.load_contents(null);
        const contentStr = ByteArray.toString(content);
        const contentLines = contentStr.split('\n');

        currentTemperature = parseInt(contentLines[0]);
    } catch (e) {
        logError(e);
    }
    return currentTemperature;
};

// See <https://stackoverflow.com/a/9229580>.
const getCurrentCPUUsage = () => {
    let currentCPUUsage = 0;

    try {
        const inputFile = Gio.File.new_for_path('/proc/stat');
        const [, content] = inputFile.load_contents(null);
        const contentStr = ByteArray.toString(content);
        const contentLines = contentStr.split('\n');

        let currentCPUUsed = 0;
        let currentCPUTotal = 0;

        for (let i = 0; i < contentLines.length; i++) {
            const fields = contentLines[i].trim().split(/\W+/);

            if (fields.length < 2) {
                continue;
            }

            const itemName = fields[0];
            if (itemName == 'cpu' && fields.length >= 5) {
                const user = Number.parseInt(fields[1]);
                const system = Number.parseInt(fields[3]);
                const idle = Number.parseInt(fields[4]);
                currentCPUUsed = user + system;
                currentCPUTotal = user + system + idle;
                break;
            }
        }

        // Avoid divide by zero
        if (currentCPUTotal - lastCPUTotal !== 0) {
            currentCPUUsage = (currentCPUUsed - lastCPUUsed) / (currentCPUTotal - lastCPUTotal);
        }

        lastCPUTotal = currentCPUTotal;
        lastCPUUsed = currentCPUUsed;
    } catch (e) {
        logError(e);
    }
    return currentCPUUsage;
};

const getCurrentSwapUsage = () => {
    let currentSwapUsage = 0;

    try {
        const inputFile = Gio.File.new_for_path('/proc/meminfo');
        const [, content] = inputFile.load_contents(null);
        const contentStr = ByteArray.toString(content);
        const contentLines = contentStr.split('\n');

        let swapTotal = -1;
        let swapFree = -1;

        for (let i = 0; i < contentLines.length; i++) {
            const fields = contentLines[i].trim().split(/\W+/);

            if (fields.length < 2) {
                break;
            }

            const itemName = fields[0];
            const itemValue = Number.parseInt(fields[1]);

            if (itemName == 'SwapTotal') {
                swapTotal = itemValue;
            }

            if (itemName == 'SwapFree') {
                swapFree = itemValue;
            }

            if (swapTotal !== -1 && swapFree !== -1) {
                break;
            }
        }

        if (swapTotal !== -1 && swapFree !== -1 && swapTotal !== 0) {
            currentSwapUsage = 1 - swapFree / swapTotal;
        }
    } catch (e) {
        logError(e);
    }

    return currentSwapUsage;
};

const getCurrentMemoryUsage = () => {
    let currentMemoryUsage = 0;

    try {
        const inputFile = Gio.File.new_for_path('/proc/meminfo');
        const [, content] = inputFile.load_contents(null);
        const contentStr = ByteArray.toString(content);
        const contentLines = contentStr.split('\n');

        let memTotal = -1;
        let memAvailable = -1;

        for (let i = 0; i < contentLines.length; i++) {
            const fields = contentLines[i].trim().split(/\W+/);

            if (fields.length < 2) {
                break;
            }

            const itemName = fields[0];
            const itemValue = Number.parseInt(fields[1]);

            if (itemName == 'MemTotal') {
                memTotal = itemValue;
            }

            if (itemName == 'MemAvailable') {
                memAvailable = itemValue;
            }

            if (memTotal !== -1 && memAvailable !== -1) {
                break;
            }
        }

        if (memTotal !== -1 && memAvailable !== -1) {
            const memUsed = memTotal - memAvailable;
            currentMemoryUsage = memUsed / memTotal;
        }
    } catch (e) {
        logError(e);
    }
    return currentMemoryUsage;
};

const formatNetSpeedWithUnit = (amount, showFullNetSpeedUnit) => {
    let unitIndex = 0;
    while (amount >= 1000 && unitIndex < netSpeedUnits.length - 1) {
        amount /= 1000;
        ++unitIndex;
    }

    let digits = 0;
    // Instead of showing 0.00123456 as 0.00, show it as 0.
    if (amount >= 100 || amount - 0 < 0.01) {
        // 100 M/s, 200 K/s, 300 B/s.
        digits = 0;
    } else if (amount >= 10) {
        // 10.1 M/s, 20.2 K/s, 30.3 B/s.
        digits = 1;
    } else {
        // 1.01 M/s, 2.02 K/s, 3.03 B/s.
        digits = 2;
    }

    // See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed>.
    return `${amount.toFixed(digits).toString().padStart(4)} ${netSpeedUnits[unitIndex]}${
        showFullNetSpeedUnit ? '/s' : ''
    }`;
};

// Format a usage value in [0, 1] as an integer percent value.
const formatUsageVal = (usage, showExtraSpaces, showPercentSign) => {
    return (
        Math.round(usage * 100)
            .toString()
            .padStart(showExtraSpaces ? 3 : 2) + (showPercentSign ? '%' : '')
    );
};

// Format temperature value in temp_Celsius * 1e3 as an float value xx.x °C or °F.
const formatTemperature = (temperature, showExtraSpaces, useFahrenheit) => {
    var temp = parseFloat(temperature) / 1e3;
    if (useFahrenheit) temp = (temp * 9) / 5 + 32;
    return temp.toFixed(1).padStart(showExtraSpaces ? 3 : 2) + (useFahrenheit ? '°F' : '°C');
};

const toDisplayString = (
    showFullNetSpeedUnit,
    showExtraSpaces,
    showPercentSign,
    useFahrenheit,
    texts,
    enable,
    cpuUsage,
    cpuTemperature,
    memoryUsage,
    netSpeed,
    swapUsage,
) => {
    const displayItems = [];
    if (enable.isCpuUsageEnable && cpuUsage !== null) {
        displayItems.push(
            `${texts.cpuUsageText} ${formatUsageVal(cpuUsage, showExtraSpaces, showPercentSign)}`,
        );
    }
    if (enable.isTemperatureEnable && cpuTemperature !== null) {
        displayItems.push(
            `${texts.temperatureText} ${formatTemperature(
                cpuTemperature,
                showExtraSpaces,
                useFahrenheit,
            )}`,
        );
    }
    if (enable.isMemoryUsageEnable && memoryUsage !== null) {
        displayItems.push(
            `${texts.memoryUsageText} ${formatUsageVal(
                memoryUsage,
                showExtraSpaces,
                showPercentSign,
            )}`,
        );
    }
    if (enable.isSwapUsageEnable && swapUsage !== null) {
        displayItems.push(
            `${texts.swapUsageText} ${formatUsageVal(swapUsage, showExtraSpaces, showPercentSign)}`,
        );
    }
    if (enable.isDownloadSpeedEnable && netSpeed !== null) {
        displayItems.push(
            `${texts.downloadSpeedText} ${formatNetSpeedWithUnit(
                netSpeed['down'],
                showFullNetSpeedUnit,
            )}`,
        );
    }
    if (enable.isUploadSpeedEnable && netSpeed !== null) {
        displayItems.push(
            `${texts.uploadSpeedText} ${formatNetSpeedWithUnit(
                netSpeed['up'],
                showFullNetSpeedUnit,
            )}`,
        );
    }
    return displayItems.join(texts.itemSeparator);
};

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        constructor() {
            super();
            this.extension = Extension.lookupByUUID('ssm-gnome@lgiki.net');
        }

        _init() {
            super._init(0.0, 'Simple System Monitor');

            this._label = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                text: 'Initialization',
            });

            this.add_child(this._label);

            const openSystemMonitorItem = new PopupMenu.PopupMenuItem(_('Open System Monitor'));
            openSystemMonitorItem.connect('activate', () => {
                const appSystem = Shell.AppSystem.get_default();
                let systemMonitorApp = appSystem.lookup_app('gnome-system-monitor.desktop');
                if (systemMonitorApp) {
                    systemMonitorApp.activate();
                } else {
                    systemMonitorApp = appSystem.lookup_app('org.gnome.Usage.desktop');
                    systemMonitorApp.activate();
                }
            });
            this.menu.addMenuItem(openSystemMonitorItem);

            const settingMenuItem = new PopupMenu.PopupMenuItem(_('Setting'));
            settingMenuItem.connect('activate', () => {
                this.extension.openPreferences();
            });
            this.menu.addMenuItem(settingMenuItem);
        }

        setFontStyle(fontFamily, fontSize, textColor, fontWeight) {
            return this._label.set_style(
                `font-family: "${fontFamily}"; font-size: ${fontSize}px; color: ${textColor}; font-weight: ${fontWeight};`,
            );
        }

        setText(text) {
            return this._label.set_text(text);
        }
    },
);

export default class SSMExtension extends Extension {
    enable() {
        lastTotalNetDownBytes = 0;
        lastTotalNetUpBytes = 0;

        lastCPUUsed = 0;
        lastCPUTotal = 0;

        this._prefs = new Settings.Prefs(this.getSettings(Settings.SETTING_SCHEMA));

        this._texts = {
            cpuUsageText: this._prefs.CPU_USAGE_TEXT.get(),
            memoryUsageText: this._prefs.MEMORY_USAGE_TEXT.get(),
            temperatureText: this._prefs.TEMPERATURE_TEXT.get(),
            downloadSpeedText: this._prefs.DOWNLOAD_SPEED_TEXT.get(),
            uploadSpeedText: this._prefs.UPLOAD_SPEED_TEXT.get(),
            swapUsageText: this._prefs.SWAP_USAGE_TEXT.get(),
            itemSeparator: this._prefs.ITEM_SEPARATOR.get(),
        };

        this._enable = {
            isCpuUsageEnable: this._prefs.IS_CPU_USAGE_ENABLE.get(),
            isMemoryUsageEnable: this._prefs.IS_MEMORY_USAGE_ENABLE.get(),
            isTemperatureEnable: this._prefs.IS_TEMPERATURE_ENABLE.get(),
            isDownloadSpeedEnable: this._prefs.IS_DOWNLOAD_SPEED_ENABLE.get(),
            isUploadSpeedEnable: this._prefs.IS_UPLOAD_SPEED_ENABLE.get(),
            isSwapUsageEnable: this._prefs.IS_SWAP_USAGE_ENABLE.get(),
        };

        this._isTemperatureFahrenheit = this._prefs.IS_TEMPERATURE_FAHRENHEIT.get();

        this._showExtraSpaces = this._prefs.SHOW_EXTRA_SPACES.get();

        this._showPercentSign = this._prefs.SHOW_PERCENT_SIGN.get();

        this._refresh_interval = this._prefs.REFRESH_INTERVAL.get();

        this._showFullNetSpeedUnit = this._prefs.SHOW_FULL_NET_SPEED_UNIT.get();

        this._indicator = new Indicator();

        this._update_text_style();

        const extensionPosition = this._prefs.EXTENSION_POSITION.get();
        const extensionOrder = this._prefs.EXTENSION_ORDER.get();

        Main.panel.addToStatusArea(this.uuid, this._indicator, extensionOrder, extensionPosition);

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE,
            this._refresh_interval,
            this._refresh_monitor.bind(this),
        );

        this._listen_setting_change();
    }

    disable() {
        this._destroy_setting_change_listener();
        if (this._indicator != null) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._timeout != null) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
    }

    _update_text_style() {
        this._indicator.setFontStyle(
            this._prefs.FONT_FAMILY.get(),
            this._prefs.FONT_SIZE.get(),
            this._prefs.TEXT_COLOR.get(),
            this._prefs.FONT_WEIGHT.get(),
        );
    }

    _refresh_monitor() {
        let currentCPUUsage = null;
        let currentMemoryUsage = null;
        let currentTemperature = null;
        let currentNetSpeed = null;
        let currentSwapUsage = null;
        if (this._enable.isCpuUsageEnable) {
            currentCPUUsage = getCurrentCPUUsage();
        }
        if (this._enable.isMemoryUsageEnable) {
            currentMemoryUsage = getCurrentMemoryUsage();
        }
        if (this._enable.isTemperatureEnable) {
            currentTemperature = getCurrentTemperature();
        }
        if (this._enable.isDownloadSpeedEnable || this._enable.isUploadSpeedEnable) {
            currentNetSpeed = getCurrentNetSpeed(this._refresh_interval);
        }
        if (this._enable.isSwapUsageEnable) {
            currentSwapUsage = getCurrentSwapUsage();
        }

        const displayText = toDisplayString(
            this._showFullNetSpeedUnit,
            this._showExtraSpaces,
            this._showPercentSign,
            this._isTemperatureFahrenheit,
            this._texts,
            this._enable,
            currentCPUUsage,
            currentTemperature,
            currentMemoryUsage,
            currentTemperature,
            currentNetSpeed,
            currentSwapUsage,
        );
        this._indicator.setText(displayText);
        return GLib.SOURCE_CONTINUE;
    }

    _listen_setting_change() {
        // TODO use value from callback instead of calling prefs.get()
        this._prefs.SHOW_EXTRA_SPACES.changed(() => {
            this._showExtraSpaces = this._prefs.SHOW_EXTRA_SPACES.get();
        });

        this._prefs.SHOW_PERCENT_SIGN.changed(() => {
            this._showPercentSign = this._prefs.SHOW_PERCENT_SIGN.get();
        });

        this._prefs.IS_CPU_USAGE_ENABLE.changed(() => {
            this._enable.isCpuUsageEnable = this._prefs.IS_CPU_USAGE_ENABLE.get();
        });

        this._prefs.IS_MEMORY_USAGE_ENABLE.changed(() => {
            this._enable.isMemoryUsageEnable = this._prefs.IS_MEMORY_USAGE_ENABLE.get();
        });

        this._prefs.IS_TEMPERATURE_ENABLE.changed(() => {
            this._enable.isTemperatureEnable = this._prefs.IS_TEMPERATURE_ENABLE.get();
        });

        this._prefs.IS_DOWNLOAD_SPEED_ENABLE.changed(() => {
            this._enable.isDownloadSpeedEnable = this._prefs.IS_DOWNLOAD_SPEED_ENABLE.get();
        });

        this._prefs.IS_UPLOAD_SPEED_ENABLE.changed(() => {
            this._enable.isUploadSpeedEnable = this._prefs.IS_UPLOAD_SPEED_ENABLE.get();
        });

        this._prefs.IS_SWAP_USAGE_ENABLE.changed(() => {
            this._enable.isSwapUsageEnable = this._prefs.IS_SWAP_USAGE_ENABLE.get();
        });

        this._prefs.CPU_USAGE_TEXT.changed(() => {
            this._texts.cpuUsageText = this._prefs.CPU_USAGE_TEXT.get();
        });

        this._prefs.MEMORY_USAGE_TEXT.changed(() => {
            this._texts.memoryUsageText = this._prefs.MEMORY_USAGE_TEXT.get();
        });

        this._prefs.TEMPERATURE_TEXT.changed(() => {
            this._texts.temperatureText = this._prefs.TEMPERATURE_TEXT.get();
        });

        this._prefs.DOWNLOAD_SPEED_TEXT.changed(() => {
            this._texts.downloadSpeedText = this._prefs.DOWNLOAD_SPEED_TEXT.get();
        });

        this._prefs.UPLOAD_SPEED_TEXT.changed(() => {
            this._texts.uploadSpeedText = this._prefs.UPLOAD_SPEED_TEXT.get();
        });

        this._prefs.SWAP_USAGE_TEXT.changed(() => {
            this._texts.swapUsageText = this._prefs.SWAP_USAGE_TEXT.get();
        });

        this._prefs.ITEM_SEPARATOR.changed(() => {
            this._texts.itemSeparator = this._prefs.ITEM_SEPARATOR.get();
        });

        this._prefs.IS_TEMPERATURE_FAHRENHEIT.changed(() => {
            this._isTemperatureFahrenheit = this._prefs.IS_TEMPERATURE_FAHRENHEIT.get();
        });

        this._prefs.SHOW_FULL_NET_SPEED_UNIT.changed(() => {
            this._showFullNetSpeedUnit = this._prefs.SHOW_FULL_NET_SPEED_UNIT.get();
        });

        this._prefs.FONT_FAMILY.changed(() => this._update_text_style());
        this._prefs.FONT_SIZE.changed(() => this._update_text_style());
        this._prefs.TEXT_COLOR.changed(() => this._update_text_style());
        this._prefs.FONT_WEIGHT.changed(() => this._update_text_style());

        this._prefs.REFRESH_INTERVAL.changed(() => {
            this._refresh_interval = this._prefs.REFRESH_INTERVAL.get();
            if (this._timeout != null) {
                GLib.source_remove(this._timeout);
            }
            this._timeout = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT_IDLE,
                this._refresh_interval,
                this._refresh_monitor.bind(this),
            );
        });
    }

    _destroy_setting_change_listener() {
        this._prefs.SHOW_EXTRA_SPACES.disconnect();
        this._prefs.SHOW_PERCENT_SIGN.disconnect();
        this._prefs.IS_CPU_USAGE_ENABLE.disconnect();
        this._prefs.IS_MEMORY_USAGE_ENABLE.disconnect();
        this._prefs.IS_TEMPERATURE_ENABLE.disconnect();
        this._prefs.IS_DOWNLOAD_SPEED_ENABLE.disconnect();
        this._prefs.IS_UPLOAD_SPEED_ENABLE.disconnect();
        this._prefs.CPU_USAGE_TEXT.disconnect();
        this._prefs.MEMORY_USAGE_TEXT.disconnect();
        this._prefs.TEMPERATURE_TEXT.disconnect();
        this._prefs.DOWNLOAD_SPEED_TEXT.disconnect();
        this._prefs.UPLOAD_SPEED_TEXT.disconnect();
        this._prefs.ITEM_SEPARATOR.disconnect();
        this._prefs.REFRESH_INTERVAL.disconnect();
        this._prefs.FONT_FAMILY.disconnect();
        this._prefs.FONT_SIZE.disconnect();
        this._prefs.TEXT_COLOR.disconnect();
        this._prefs.FONT_WEIGHT.disconnect();
        this._prefs.IS_SWAP_USAGE_ENABLE.disconnect();
        this._prefs.SWAP_USAGE_TEXT.disconnect();
        this._prefs.IS_TEMPERATURE_FAHRENHEIT.disconnect();
        this._prefs.SHOW_FULL_NET_SPEED_UNIT.disconnect();
    }
}
