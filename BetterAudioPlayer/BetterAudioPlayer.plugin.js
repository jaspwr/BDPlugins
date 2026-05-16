/**
 * @name BetterAudioPlayer
 * @author jaspwr
 * @description Adds a spectrograph and oscilloscope visualizer to audio attachment players.
 * @version 1.0.4
 * @source https://raw.githubusercontent.com/jaspwr/BDPlugins/master/BetterAudioPlayer/BetterAudioPlayer.plugin.js
 */

const PLUGIN_ID = "BetterAudioPlayer";
const CANVAS_CLASS = "audio-vis";

const DEFAULT_SETTINGS = {
    showSpectrograph: true,
    showOscilloscope: true,
    inheritColors: true,
    manualColorSettings: {
        oscilloscopeColorCustom: "#FFFFFF",
        spectrographColorCustom: "#738ADB",
    },
    spectrographSegments: 110,
    fallSpeed: 0.3,
    smoothingConstant: 0.05,
    bypassFileSizeLimit: false,
};

const https = require("https");

let canvasIdCounter = 0;
const spectrumRendererDestructors = {};

class SpectrumRenderer {
    constructor(canvas, element, settings) {
        this._settings = settings;
        this.lines = settings.spectrographSegments;

        this.canvas = canvas.getContext("2d");
        this.width = canvas.width;
        this.height = canvas.height;
        this.lineWidth = canvas.width / this.lines;
        this.time = 0;
        this.alive = true;
        this.anim;
        this.pretime = 0;
        this.prePlaying = false;
        this.lastRender = 0;
        this.element = element;

        this.draw = this.draw.bind(this);
        this.destructor = this.destructor.bind(this);
        const canvasId = `audiovis${canvasIdCounter++}`;
        canvas.id = canvasId;
        spectrumRendererDestructors[canvasId] = this.destructor;

        this.initialiseAudioContext();
        this.draw();
    }

    getIsPlaying() {
        const playBtn = this.element?.childNodes[2]?.childNodes[0]?.childNodes[0];
        return playBtn?.getAttribute?.("aria-label") === "Pause";
    }

    getCurrentTime() {
        const timeStr = this.element?.childNodes[2]?.childNodes[0]?.childNodes[1]?.childNodes[0]?.innerHTML;
        if (!timeStr) return 0;
        const splTimeStr = timeStr.split(":");
        return +splTimeStr[0] * 60 + +splTimeStr[1];
    }

    initialiseAudioContext() {
        this.audioctx = new window.AudioContext;
        this.hasAudioData = false;
        this.audioSourceNode = this.audioctx.createBufferSource();
        this.analyserNode = this.audioctx.createAnalyser();
        this.analyserNode.fftSize = this.lines > 128 ? 512 : 256;
        this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.startedAudioNode = false;
        this.initialised = false;
        this.levels = new Array(this.lines).fill(0);
        this.timeDomain = new Uint8Array(this.analyserNode.fftSize);
    }

    stopAudioNode() {
        if (this.startedAudioNode) {
            this.audioSourceNode.disconnect();
            this.audioSourceNode.stop(0);
            let newNode = this.audioctx.createBufferSource();
            newNode.buffer = this.audioSourceNode.buffer;
            this.audioSourceNode = newNode;
            this.audioSourceNode.connect(this.analyserNode);
            this.startedAudioNode = false;
        }
    }

    startAudioNode() {
        this.audioSourceNode.start(0, this.time / 1000);
        this.startedAudioNode = true;
    }

    getAudioWithoutSameOrigin() {
        if (this.initialised) return;
        this.initialised = true;

        // audio element is childNodes[1], source is its first child
        const src = this.element?.childNodes[1]?.childNodes[0]?.src
                 || this.element?.childNodes[1]?.src;
        if (!src) return;

        https.get(src, (resp) => {
            let data = new Uint8Array;
            resp.on("data", (chunk) => {
                let b = [data, chunk];
                data = Buffer.concat(b);
            });
            resp.on("end", () => {
                var arrayBuffer = new ArrayBuffer(data.length);
                var typedArray = new Uint8Array(arrayBuffer);
                for (var i = 0; i < data.length; ++i) {
                    typedArray[i] = data[i];
                }
                this.audioctx.decodeAudioData(arrayBuffer, (buffer) => {
                    this.audioSourceNode.buffer = buffer;
                    this.audioSourceNode.connect(this.analyserNode);
                    this.hasAudioData = true;
                    if (this.getIsPlaying())
                        this.startAudioNode();
                });
            });
        });
    }

    draw(timestamp) {
        if (!this.element?.isConnected) {
            this.destructor();
            return;
        }

        if (this.alive && this.canvas)
            this.anim = window.requestAnimationFrame(this.draw);

        let playing = false;
        try { playing = this.getIsPlaying(); } catch {}

        let delta_time = timestamp - this.lastRender;
        this.lastRender = timestamp;

        this.canvas.clearRect(0, 0, this.width, this.height);

        if (playing) {
            this.time += delta_time;

            if (!this.prePlaying) {
                this.getAudioWithoutSameOrigin();
                if (this.hasAudioData)
                    this.startAudioNode();
            }

            this.copySpectrumData();
        } else if (this.prePlaying && this.audioSourceNode)
            this.stopAudioNode();

        this.prePlaying = playing;

        try {
            const currentTime = this.getCurrentTime();
            if (Math.floor(this.time / 1000) != currentTime) {
                this.time = currentTime * 1000;
                if (playing) {
                    this.stopAudioNode();
                    this.prePlaying = false;
                }
            }
        } catch {}

        if (this._settings.showSpectrograph)
            this.drawSpectrum(delta_time);
        if (this._settings.showOscilloscope && playing && this.hasAudioData)
            this.drawOscilloscope();
    }

    copySpectrumData() {
        this.analyserNode.smoothingTimeConstant = this._settings.smoothingConstant;
        this.analyserNode.getByteFrequencyData(this.dataArray);
        let new_lvl;
        const normal_line = this.lines > 128 ? 220 : 110;
        for (let i = 0; i < this.lines; i++) {
            if (this.hasAudioData)
                new_lvl = (this.dataArray[Math.floor((i / this.lines) * normal_line)] / 350) * (1 + i / 75);
            else
                new_lvl = Math.sin((i + this.time / 20.) / 15.) / 4. + 0.35;
            if (new_lvl > this.levels[i]) this.levels[i] = new_lvl;
        }
    }

    drawSpectrum(deltaTime) {
        const colour = this._settings.inheritColors
            ? getComputedStyle(document.documentElement).getPropertyValue("--brand-experiment")
            : this._settings.manualColorSettings.spectrographColorCustom;
        this.canvas.fillStyle = colour;
        // Cap delta to 50ms so a backgrounded tab doesn't cause a huge jump on refocus
        const dt = Math.min(isNaN(deltaTime) || deltaTime <= 0 ? 16.7 : deltaTime, 50) / 1000;
        const decay = this._settings.fallSpeed * 10 * dt;

        for (let i = 0; i < this.lines; i++) {
            const h = this.levels[i];
            this.canvas.fillRect(
                i * this.lineWidth,
                this.height - (h * this.height),
                this.lineWidth + 0.5,
                h * this.height
            );
            if (this.levels[i] > 0) {
                this.levels[i] -= decay;
                if (this.levels[i] < 0) this.levels[i] = 0;
            }
        }
    }

    drawOscilloscope() {
        const colour = this._settings.inheritColors
            ? getComputedStyle(document.documentElement).getPropertyValue("--text-normal")
            : this._settings.manualColorSettings.oscilloscopeColorCustom;
        this.analyserNode.getByteTimeDomainData(this.timeDomain);
        const step = this.width / this.timeDomain.length;
        this.canvas.strokeStyle = colour;
        this.canvas.beginPath();
        for (let i = 0; i < this.timeDomain.length; i += 2) {
            const percent = this.timeDomain[i] / 256;
            const x = (i * step);
            const y = (this.height * percent);
            this.canvas.lineTo(x, y);
        }
        this.canvas.stroke();
    }

    destructor() {
        this.alive = false;
        window.cancelAnimationFrame(this.anim);
        this.audioctx.close();
        delete this;
    }
}

const parseFileSize = (str) => {
    if (!str) return 0;
    try {
        const spl = str.trim().split(" ");
        let magnitude;
        switch (spl[1]) {
            case "bytes": magnitude = 1; break;
            case "KB":    magnitude = 1e3; break;
            case "MB":    magnitude = 1e6; break;
            case "GB":    magnitude = 1e9; break;
            default:      magnitude = 0; break;
        }
        return parseFloat(spl[0]) * magnitude;
    } catch { return 0; }
};

module.exports = class BetterAudioPlayer {
    getName()        { return "BetterAudioPlayer"; }
    getAuthor()      { return "jaspwr"; }
    getVersion()     { return "1.0.5"; }
    getDescription() { return "Adds a spectrograph and oscilloscope visualizer to audio attachment players."; }

    _loadSettings() {
        const saved = BdApi.Data.load(PLUGIN_ID, "settings") || {};
        this._settings = {
            ...DEFAULT_SETTINGS,
            ...saved,
            manualColorSettings: {
                ...DEFAULT_SETTINGS.manualColorSettings,
                ...(saved.manualColorSettings || {}),
            },
        };
    }

    _saveSettings() {
        BdApi.Data.save(PLUGIN_ID, "settings", this._settings);
    }

    start() {
        this._loadSettings();

        const audioModule = BdApi.Webpack.getModule(m => m?.wrapperAudio);
        this._audioPlayerClassName = audioModule?.wrapperAudio?.split(" ")[0];
        if (!this._audioPlayerClassName)
            console.warn("BetterAudioPlayer: Could not find audio player class name, falling back to attribute selector");

        BdApi.DOM.addStyle(PLUGIN_ID, `
            .${CANVAS_CLASS} {
                position: absolute;
                top: 0px;
                left: 0px;
                height: 100%;
                width: 100%;
                border-radius: inherit;
                z-index: 0;
                pointer-events: none;
            }
        `);

        this._observer = new MutationObserver(mutations => {
            for (const mutation of mutations)
                this._handleMutation(mutation.addedNodes, mutation.removedNodes);
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    }

    stop() {
        this._observer?.disconnect();
        BdApi.DOM.removeStyle(PLUGIN_ID);
        document.querySelectorAll(`.${CANVAS_CLASS}`).forEach(e => e._unmount?.());
    }

    _handleMutation(addedNodes, removedNodes) {
        const fileSizeLimit = 12e6;

        for (const node of addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) continue;
            const elements = this._audioPlayerClassName
                ? Array.from(node.getElementsByClassName(this._audioPlayerClassName))
                : Array.from(node.querySelectorAll('[class*="wrapperAudio"]'));
            for (var i = 0; i < elements.length; i++) {
                const element = elements[i];

                // skip if canvas already added
                if (element.querySelector(`.${CANVAS_CLASS}`)) continue;

                const fileSize = parseFileSize(element.childNodes[0]?.childNodes[0]?.childNodes[1]?.innerHTML);
                // 0 = unknown size, don't skip; only skip if we know it's over the limit
                if (fileSize > 0 && !this._settings.bypassFileSizeLimit && fileSize > fileSizeLimit) continue;

                element.childNodes[0].style.zIndex = "1";
                element.childNodes[1].style.zIndex = "1";
                element.childNodes[2].style.zIndex = "1";

                const canvas = document.createElement("canvas");
                canvas.className = CANVAS_CLASS;
                element.appendChild(canvas);
                const { width, height } = canvas.getBoundingClientRect();
                canvas.width = width;
                canvas.height = height;

                new SpectrumRenderer(canvas, element, this._settings);
            }
        }

        for (const node of removedNodes) {
            if (node.nodeType === Node.TEXT_NODE) continue;
            const elements = Array.from(node.getElementsByClassName(CANVAS_CLASS));
            for (var i = 0; i < elements.length; i++) {
                const element = elements[i];
                if (element.id && spectrumRendererDestructors[element.id]) {
                    spectrumRendererDestructors[element.id]();
                    spectrumRendererDestructors[element.id] = undefined;
                }
            }
        }
    }

    getSettingsPanel() {
        const s = this._settings;
        return BdApi.UI.buildSettingsPanel({
            settings: [
                {
                    type: "switch", id: "showSpectrograph", name: "Show spectrograph",
                    note: "Displays a spectrograph visualizer on audio players. Reload the channel for changes to take effect.",
                    value: s.showSpectrograph,
                    onChange: v => { s.showSpectrograph = v; this._saveSettings(); },
                },
                {
                    type: "switch", id: "showOscilloscope", name: "Show oscilloscope",
                    note: "Displays an oscilloscope visualizer on audio players. Reload the channel for changes to take effect.",
                    value: s.showOscilloscope,
                    onChange: v => { s.showOscilloscope = v; this._saveSettings(); },
                },
                {
                    type: "switch", id: "inheritColors", name: "Inherit colors from theme",
                    note: "The visualizers will use the colors from your theme. Reload the channel for changes to take effect.",
                    value: s.inheritColors,
                    onChange: v => { s.inheritColors = v; this._saveSettings(); },
                },
                {
                    type: "text", id: "oscilloscopeColorCustom", name: "Oscilloscope color",
                    note: "Hex color for the oscilloscope when not inheriting from theme. Reload the channel for changes to take effect.",
                    value: s.manualColorSettings.oscilloscopeColorCustom,
                    onChange: v => { s.manualColorSettings.oscilloscopeColorCustom = v; this._saveSettings(); },
                },
                {
                    type: "text", id: "spectrographColorCustom", name: "Spectrograph color",
                    note: "Hex color for the spectrograph when not inheriting from theme. Reload the channel for changes to take effect.",
                    value: s.manualColorSettings.spectrographColorCustom,
                    onChange: v => { s.manualColorSettings.spectrographColorCustom = v; this._saveSettings(); },
                },
                {
                    type: "slider", id: "spectrographSegments", name: "Spectrograph segments",
                    note: "Number of segments for the spectrograph. Reload the channel for changes to take effect.",
                    value: s.spectrographSegments,
                    min: 1, max: 200, step: 1, units: "bars",
                    markers: [1, 25, 50, 75, 100, 125, 150, 175, 200],
                    onChange: v => { s.spectrographSegments = Math.round(v); this._saveSettings(); },
                },
                {
                    type: "slider", id: "fallSpeed", name: "Bar fall speed",
                    note: "How fast the spectrograph bars decay. Higher = snappier. Takes effect immediately.",
                    value: s.fallSpeed,
                    min: 0.05, max: 1.0, step: 0.05, units: "x",
                    markers: [0.05, 0.2, 0.4, 0.6, 0.8, 1.0],
                    onChange: v => { s.fallSpeed = v; this._saveSettings(); },
                },
                {
                    type: "slider", id: "smoothingConstant", name: "Analyser smoothing",
                    note: "Web Audio analyser smoothing. At 0, bars are raw and your fall speed setting is fully in control. At higher values, the analyser's own smoothing fights the fall speed slider — bars will ignore it and fall slowly regardless of your setting. Takes effect immediately.",
                    value: s.smoothingConstant,
                    min: 0, max: 1, step: 0.05, units: "",
                    markers: [0, 0.25, 0.5, 0.75, 1.0],
                    onChange: v => { s.smoothingConstant = v; this._saveSettings(); },
                },
                {
                    type: "switch", id: "bypassFileSizeLimit", name: "Bypass file size limit",
                    note: "Use visualizers on audio files larger than 12MB. Can cause lag or crashes. Reload the channel for changes to take effect.",
                    value: s.bypassFileSizeLimit,
                    onChange: v => { s.bypassFileSizeLimit = v; this._saveSettings(); },
                },
            ],
        });
    }
};
