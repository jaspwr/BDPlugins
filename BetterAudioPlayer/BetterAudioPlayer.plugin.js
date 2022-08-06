/**
 * @name BetterAudioPlayer
 * @author jaspwr
 * @description Adds a spectrograph and oscilliscope visualiser to audio attachment players.
 * @version 1.0.0
 * @source https://raw.githubusercontent.com/jaspwr/BDPlugins/master/BetterAudioPlayer/BetterAudioPlayer.plugin.js
 */

 const config = {
    info: {
        name: "BetterAudioPlayer",
        authors: [{
            name: "jaspwr"
        }],
        version: "1.0.0",
        description: "Adds a spectrograph and oscilliscope visualiser to audio attachment players.",
        github_raw: "https://raw.githubusercontent.com/jaspwr/BDPlugins/master/BetterAudioPlayer/BetterAudioPlayer.plugin.js",
    },
    defaultConfig: []
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
        const { DiscordModules, WebpackModules, Patcher, PluginUtilities } = Library;
        const { ReactDOM } = DiscordModules;
        const MediaPlayer = WebpackModules.find(m => m?.default?.displayName === "MediaPlayer");
        const https = require('https');

        const lines = 110;
        let spectraColour = "#738ADB";
        let oscilloColour = "#FFFFFF";
        const fallSpeed = 0.12;

        const spectrumRendererList =[];
        class SpectrumRenderer{
            constructor(obj,canvas,element){
                spectrumRendererList.push(this);

                this.obj = obj;
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


                this.draw = this.draw.bind(this);
                this.destructor = this.destructor.bind(this);
                this.obj['spectrumRendererDestructor'] = this.destructor;

                this.initialiseAudioContext();
                this.draw();
            }

            initialiseAudioContext(){
                this.audioctx = new window.AudioContext;
                this.hasAudioData = false;
                this.audioSourceNode = this.audioctx.createBufferSource();
                this.analyserNode = this.audioctx.createAnalyser();
                this.analyserNode.fftSize = 256;
                this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
                this.startedAudioNode = false;
                this.initialised = false;
                this.levels = new Array(lines).fill(0);
                this.timeDomain = new Uint8Array(this.analyserNode.fftSize);
            }

            stopAudioNode(){
                if(this.startedAudioNode){
                    this.audioSourceNode.disconnect();
                    this.audioSourceNode.stop(0);
                    let newNode = this.audioctx.createBufferSource();
                    newNode.buffer = this.audioSourceNode.buffer;
                    this.audioSourceNode = newNode;
                    this.audioSourceNode.connect(this.analyserNode);
                    this.startedAudioNode = false;
                }
            }
            
            startAudioNode(){
                this.audioSourceNode.start(0, this.time/1000);
                this.startedAudioNode = true;
            }
            
            get_audio_without_same_origin(){
                // The audio file needs to be downloaded again becuase if it tries to access the 
                // original one in the <audio> element there is a CORS error.
                if(this.initialised)
                    return;
                this.initialised = true;

                https.get(this.obj.props.src, (resp) => { 
                    let data = new Uint8Array;
                    resp.on('data', (chunk) => {
                        let b = [data , chunk]
                        data = Buffer.concat(b);
                    });
                    resp.on('end', () => {
                        var arrayBuffer = new ArrayBuffer(data.length);
                        var typedArray = new Uint8Array(arrayBuffer);
                        for (var i = 0; i < data.length; ++i) {
                            typedArray[i] = data[i];
                        }
                        this.audioctx.decodeAudioData(arrayBuffer, (buffer) =>{
                            this.audioSourceNode.buffer = buffer;
                            this.audioSourceNode.connect(this.analyserNode);
                            this.hasAudioData = true;
                            if(this.obj.state.playing)
                                this.startAudioNode();
                        });
                    });
                });
            }
            
            draw(timestamp){
                if(this.alive && this.canvas)
                    this.anim = window.requestAnimationFrame(this.draw);

                let delta_time = timestamp - this.lastRender;
                this.lastRender = timestamp;

                this.canvas.clearRect(0, 0, this.width, this.height);

                if(this.obj.state.playing){
                    this.time += delta_time;

                    if(!this.prePlaying){
                        this.get_audio_without_same_origin();
                        if(this.hasAudioData)
                            this.startAudioNode();
                    }

                    this.copySpectrumData();
                }else if(this.prePlaying && this.audioSourceNode)     
                    this.stopAudioNode();

                this.prePlaying = this.obj.state.playing;

                if(Math.floor(this.time/1000) != this.obj.state.currentTime){
                    // This is unfortunatly only an int of seconds and will cause the time to be offset.
                    this.time = this.obj.state.currentTime*1000;
                    if(this.obj.state.playing){
                        this.stopAudioNode();
                        this.prePlaying = false;
                    }
                }

                this.drawSpectrum();

                if(this.obj.state.playing && this.hasAudioData){
                    this.drawOscilloscope();
                }
            }

            copySpectrumData(){
                this.analyserNode.getByteFrequencyData(this.dataArray);

                let new_lvl;
                for(let i = 0; i < lines; i++){
                    if(this.hasAudioData)
                        new_lvl = (this.dataArray[i]/350) * (1 + i/75);
                    else
                        new_lvl = Math.sin((i + this.time/20.)/15.)/4. + 0.35;
                    if(this.levels[i] < new_lvl)
                        this.levels[i] = new_lvl;
                }
            }

            drawSpectrum(){
                for(let i = 0; i < lines; i++){
                    this.canvas.fillRect(i*this.lineWidth,
                                            this.height-(this.levels[i]*this.height),
                                            this.lineWidth+0.5,
                                            this.levels[i]*this.height);
                    if(this.levels[i] != 0){
                        this.levels[i] -= fallSpeed;
                        if(this.levels[i] < 0)
                            this.levels[i] = 0;
                    }
                }
                this.canvas.fillStyle = spectraColour;
            }

            drawOscilloscope(){
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

            destructor(){
                this.alive = false;
                window.cancelAnimationFrame(this.anim);
                this.audioctx.close();
                delete this;
            };
        }

        const parseFileSize = (str) => {
            const spl = str.split(' ');
            let magnitude;
            switch(spl[1]){
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
            return parseFloat(spl[0])*magnitude;
        }

        class _Plugin extends Plugin {
            onStart() {
                this.patch();
                PluginUtilities.addStyle("audio_spectrum_style", `
                .audio_spectrum {
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
            onStop() {
                Patcher.unpatchAll();
                PluginUtilities.removeStyle("audio_spectrum_style");
            }
            patch() {
                const fileSizeLimit = 12e6; // 12 MB
                Patcher.after(MediaPlayer.default.prototype, "componentDidMount", (obj, [props], ret) => {
                    if(obj.props.type !== "AUDIO" || parseFileSize(obj.props.fileSize) > fileSizeLimit)
                        return;

                    spectraColour = getComputedStyle(document.documentElement).getPropertyValue('--brand-experiment');
                    oscilloColour = getComputedStyle(document.documentElement).getPropertyValue('--text-normal');
                    const element = ReactDOM.findDOMNode(obj);
                    element.childNodes[0].style.zIndex = "1";
                    element.childNodes[1].style.zIndex = "1";
                    element.childNodes[2].style.zIndex = "1";
                    const canvas = document.createElement("canvas");
                    canvas.className = "audio_spectrum";
                    element.appendChild(canvas);
                    const { width, height } = canvas.getBoundingClientRect();
                    canvas.width = width;
                    canvas.height = height;
                    new SpectrumRenderer(obj, canvas, element);
                });

                Patcher.after(MediaPlayer.default.prototype, "componentWillUnmount", (obj, [props], ret) => {
                    if(obj.props.type !== "AUDIO")
                        return;
                    if(obj.spectrumRendererDestructor)
                        obj.spectrumRendererDestructor();
                });
            }
        }
        return _Plugin;
    })(global.ZeresPluginLibrary.buildPlugin(config));
