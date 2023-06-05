/**
 * @name BetterAudioPlayer
 * @author jaspwr
 * @description Adds a spectrograph and oscilloscope visualizer to audio attachment players.
 * @version 1.0.3
 * @source https://raw.githubusercontent.com/jaspwr/BDPlugins/master/BetterAudioPlayer/BetterAudioPlayer.plugin.js
 */

 const config = {
    info: {
        name: "BetterAudioPlayer",
        authors: [{
            name: "jaspwr"
        }],
        version: "1.0.3",
        description: "Adds a spectrograph and oscilloscope visualizer to audio attachment players.",
        github_raw: "https://raw.githubusercontent.com/jaspwr/BDPlugins/master/BetterAudioPlayer/BetterAudioPlayer.plugin.js",
    },
    changelog: [{
            type: "fixed",
            title : "v1.0.3",
            items: ["Fixed not working in other languages."],
        }
    ],
    defaultConfig: [{
            type: "switch",
            name: "Show spectrograph",
            note: "Displays a spectrograph visualizer on audio players. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
            id: "showSpectrograph",
            value: true
        },
        {
            type: "switch",
            name: "Show oscilloscope",
            note: "Displays an oscilloscope visualizer on audio players. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
            id: "showOscilloscope",
            value: true
        },
        {
            type: "switch",
            name: "Inherit colors from theme",
            note: "The visualizers will use the colors from your theme. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
            id: "inheritColors",
            value: true
        },
        {
            type: "category",
            name: "Manual color settings",
            id: "manualColorSettings",
            settings: [
                {
                    // Color picker doesn't work for some reason so I'm using a textbox for now
                    type: "textbox",
                    name: "Oscilliscope color",
                    note: "If not inheriting colors from theme, this will be the color of the oscilloscope visualizer. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
                    id: "oscilloscopeColorCustom",
                    value: "#FFFFFF",
                },
                {
                    type: "textbox",
                    name: "Spectrograph color",
                    note: "If not inheriting colors from theme, this will be the color of the spectrograph visualizer. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
                    id: "spectrographColorCustom",
                    value: "#738ADB",
                }
            ]
        },
        {
            type: "slider",
            name: "Specrograph segments",
            note: "Number of segments to use for the spectrograph visualizer. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
            id: "spectrographSegments",
            markers: [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
            keyboardStep: 1,
            minValue: 1,
            maxValue: 200,
            handleSize: 10,
            stickToMarkers: true,
            value: 110
        },
        {
            type: "switch",
            name: "Bypass file size limit",
            note: "Uses the visualizers on audio attachments larger than 12MB. Can cause serious lag and possibly crash client in some cases. Channel containing the audio attachment will need to be reloaded for changes to take effect.",
            id: "bypassFileSizeLimit",
            value: false
        },
    ]
};

module.exports = !global.ZeresPluginLibrary ? class {
        constructor() { this._config = config; }
        load() {
            BdApi.showConfirmationModal('Library plugin is needed', [`The library plugin needed for ${config.info.name} is missing. Please click Download Now to install it.`], {
                confirmText: 'Download',
                cancelText: 'Cancel',
                onConfirm: () => {
                    require("request").get('https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js', async(error, response, body) => {
                        if (error) return require('electron').shell.openExternal('https://betterdiscord.app/Download?id=9');
                        await new Promise(r => require('fs').writeFile(require('path').join(BdApi.Plugins.folder, '0PluginLibrary.plugin.js'), body, r));
                        window.location.reload();
                    });
                }
            });
        }
        start() {}
        stop() {}
    } :
    (([Plugin, Library]) => {
        const { WebpackModules, PluginUtilities, ReactTools } = Library;

        const audioPlayerClassName = WebpackModules.find(m => m?.wrapperAudio).wrapperAudio.split(' ')[0];
        const canvasClass = "audio-vis";

        const https = require('https');

        let canvasIdCounter = 0;
        let lines = 110;
        let fallSpeed = 0.12;
        let spectraColour = getComputedStyle(document.documentElement).getPropertyValue("--brand-experiment");
        let oscilloColour = getComputedStyle(document.documentElement).getPropertyValue("--text-normal");
        let showOscilloscope = true;
        let showSpectrograph = true;
        const spectrumRendererDestructors = {};

        class SpectrumRenderer {
            constructor(canvas, element) {
                this.canvas = canvas.getContext('2d');
                this.width = canvas.width;
                this.height = canvas.height;
                this.lineWidth = canvas.width/lines;
                this.time = 0; // in ms
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
                return ReactTools.getReactInstance(this.element.childNodes[2].childNodes[0]).child?.key === "pause"
            }

            getCurrentTime() {
                const timeStr = this.element.childNodes[2].childNodes[1].childNodes[0].innerHTML;
                const splTimeStr = timeStr.split(':');
                return +splTimeStr[0] * 60 + +splTimeStr[1];
            }

            initialiseAudioContext() {
                this.audioctx = new window.AudioContext;
                this.hasAudioData = false;
                this.audioSourceNode = this.audioctx.createBufferSource();
                this.analyserNode = this.audioctx.createAnalyser();
                this.analyserNode.fftSize = lines > 128 ? 512 : 256;
                this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
                this.startedAudioNode = false;
                this.initialised = false;
                this.levels = new Array(lines).fill(0);
                this.timeDomain = new Uint8Array(this.analyserNode.fftSize);
            }

            stopAudioNode() {
                if(this.startedAudioNode) {
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
                this.audioSourceNode.start(0, this.time/1000);
                this.startedAudioNode = true;
            }
            
            getAudioWithoutSameOrigin() {
                // The audio file needs to be downloaded again becuase if it tries to access the 
                // original one in the <audio> element there is a CORS error.
                if(this.initialised)
                    return;
                this.initialised = true;

                https.get(this.element.childNodes[1].childNodes[0].src, (resp) => { 
                    let data = new Uint8Array;
                    resp.on("data", (chunk) => {
                        let b = [data , chunk]
                        data = Buffer.concat(b);
                    });
                    resp.on("end", () => {
                        var arrayBuffer = new ArrayBuffer(data.length);
                        var typedArray = new Uint8Array(arrayBuffer);
                        for (var i = 0; i < data.length; ++i) {
                            typedArray[i] = data[i];
                        }
                        this.audioctx.decodeAudioData(arrayBuffer, (buffer) =>{
                            this.audioSourceNode.buffer = buffer;
                            this.audioSourceNode.connect(this.analyserNode);
                            this.hasAudioData = true;
                            if(this.getIsPlaying())
                                this.startAudioNode();
                        });
                    });
                });
            }
            
            draw(timestamp) {
                if(this.alive && this.canvas)
                    this.anim = window.requestAnimationFrame(this.draw);

                const playing = this.getIsPlaying();
                let delta_time = timestamp - this.lastRender;
                this.lastRender = timestamp;

                this.canvas.clearRect(0, 0, this.width, this.height);

                if(playing) {
                    this.time += delta_time;

                    if(!this.prePlaying) {
                        this.getAudioWithoutSameOrigin();
                        if(this.hasAudioData)
                            this.startAudioNode();
                    }

                    this.copySpectrumData();
                }else if(this.prePlaying && this.audioSourceNode)     
                    this.stopAudioNode();

                this.prePlaying = playing;

                const currentTime = this.getCurrentTime();
                if(Math.floor(this.time/1000) != currentTime) {
                    // This is unfortunatly only an int of seconds and will cause the time to be offset.
                    this.time = currentTime*1000;
                    if(playing) {
                        this.stopAudioNode();
                        this.prePlaying = false;
                    }
                }

                if(showSpectrograph)
                    this.drawSpectrum();
                if(showOscilloscope && playing && this.hasAudioData)
                    this.drawOscilloscope();
            }

            copySpectrumData() {
                this.analyserNode.getByteFrequencyData(this.dataArray);
                let new_lvl;
                let normal_line = lines > 128 ? 220 : 110;
                for(let i = 0; i < lines; i++) {
                    if(this.hasAudioData)
                        new_lvl = (this.dataArray[Math.floor((i / lines) * normal_line)] / 350) * (1 + i / 75);
                    else
                        new_lvl = Math.sin((i + this.time/20.)/15.)/4. + 0.35;
                    if(this.levels[i] < new_lvl)
                        this.levels[i] = new_lvl;
                }
            }

            drawSpectrum() {
                for(let i = 0; i < lines; i++) {
                    this.canvas.fillRect(i*this.lineWidth,
                                            this.height-(this.levels[i]*this.height),
                                            this.lineWidth+0.5,
                                            this.levels[i]*this.height);
                    if(this.levels[i] != 0) {
                        this.levels[i] -= fallSpeed;
                        if(this.levels[i] < 0)
                            this.levels[i] = 0;
                    }
                }
                this.canvas.fillStyle = spectraColour;
            }

            drawOscilloscope() {
                // Oscillocope drawer from: https://github.com/mathiasvr/audio-oscilloscope
                this.analyserNode.getByteTimeDomainData(this.timeDomain);
                const step = this.width / this.timeDomain.length;
                this.canvas.beginPath();
                for (let i = 0; i < this.timeDomain.length; i += 2) {
                    const percent = this.timeDomain[i] / 256;
                    const x = (i * step);
                    const y = (this.height * percent);
                    this.canvas.lineTo(x, y);
                }
                this.canvas.stroke();
                this.canvas.strokeStyle = oscilloColour;
            }

            destructor() {
                this.alive = false;
                window.cancelAnimationFrame(this.anim);
                this.audioctx.close();
                delete this;
            };
        }

        const parseFileSize = (str) => {
            const spl = str.split(' ');
            let magnitude;
            switch(spl[1]) {
            case "bytes":
                magnitude = 1; break;
            case "KB":
                magnitude = 1e3; break;
            case "MB":
                magnitude = 1e6; break;
            case "GB":
                magnitude = 1e9; break;
            default:
                magnitude = Infinity; break;
            }
            return parseFloat(spl[0]) * magnitude;
        }

        class _Plugin extends Plugin {
            constructor() {
                super();
                this.getSettingsPanel = () => this.buildSettingsPanel().getElement();
            }

            onStart() {
                PluginUtilities.addStyle("audio_spectrum_style", `
                .${canvasClass} {
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
            }

            observer({addedNodes, removedNodes}) {
                const fileSizeLimit = 12e6; // 12 MB
                for(const node of addedNodes) {
                    if(node.nodeType === Node.TEXT_NODE) continue;
                    const elements = Array.from(node.getElementsByClassName(audioPlayerClassName));
                    for (var i = 0; i < elements.length; i++) {
                        const element = elements[i];
                        const fileSize = parseFileSize(element.childNodes[0]?.childNodes[0]?.childNodes[1]?.innerHTML);
                        if(!fileSize || (!this.settings.bypassFileSizeLimit && fileSize > fileSizeLimit)) continue;

                        element.childNodes[0].style.zIndex = "1";
                        element.childNodes[1].style.zIndex = "1";
                        element.childNodes[2].style.zIndex = "1";
                        const canvas = document.createElement("canvas");
                        canvas.className = canvasClass;
                        element.appendChild(canvas);
                        const { width, height } = canvas.getBoundingClientRect();
                        canvas.width = width;
                        canvas.height = height;

                        spectraColour = this.settings.inheritColors ?
                            getComputedStyle(document.documentElement).getPropertyValue('--brand-experiment') 
                            : this.settings.manualColorSettings.spectrographColorCustom;
                        oscilloColour = this.settings.inheritColors ?
                            getComputedStyle(document.documentElement).getPropertyValue('--text-normal') 
                            : this.settings.manualColorSettings.oscilloscopeColorCustom;
                        lines = this.settings.spectrographSegments;
                        showSpectrograph = this.settings.showSpectrograph;
                        showOscilloscope = this.settings.showOscilloscope;

                        new SpectrumRenderer(canvas, element);
                    }
                }
                for(const node of removedNodes) {
                    if(node.nodeType === Node.TEXT_NODE) continue;
                    const elements = Array.from(node.getElementsByClassName(canvasClass));
                    for(var i = 0; i < elements.length; i++) {
                        const element = elements[i];
                        if(element.id && spectrumRendererDestructors[element.id]) {
                            spectrumRendererDestructors[element.id]();
                            spectrumRendererDestructors[element.id] = undefined;
                        }
                    }
                }
            }

            onStop() {
                PluginUtilities.removeStyle("audio_spectrum_style");
                document.querySelectorAll(`.${canvasClass}`).forEach(e => e._unmount?.());
            }
        }
        return _Plugin;
    })(global.ZeresPluginLibrary.buildPlugin(config));
