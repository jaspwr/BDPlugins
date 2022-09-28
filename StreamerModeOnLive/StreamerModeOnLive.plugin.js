/**
 * @name StreamerModeOnLive
 * @author jaspwr
 * @description Enables streamer mode when you go live on discord.
 * @version 0.0.2
 * @source https://raw.githubusercontent.com/jaspwr/BDPlugins/master/StreamerModeOnLive/StreamerModeOnLive.plugin.js
 */
const config = {
    info: {
        name: "StreamerModeOnLive",
        authors: [{
            name: "jaspwr"
        }],
        version: "0.0.2",
        description: "Enables streamer mode when you go live in a voice channel.",
        github_raw: "https://raw.githubusercontent.com/jaspwr/BDPlugins/master/StreamerModeOnLive/StreamerModeOnLive.plugin.js",
    },
    changelog: [{
        type: "fixed",
        title: "v0.0.2",
        items: [
            "Fixed for new discord update."
        ]
    }],
    defaultConfig: []
};

module.exports = !global.ZeresPluginLibrary ? class {
        constructor() { this._config = config; }
        load() {
            BdApi.showConfirmationModal('Library plugin is needed', [`The library plugin needed for ${config.info.name} is missing. Please click Download Now to install it.`], {
                confirmText: 'Download',
                cancelText: 'Cancel',
                onConfirm: () => {
                    require('request').get('https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js', async(error, response, body) => {
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
        const { WebpackModules } = Library;
        const Dispatcher = WebpackModules.getByProps("dispatch", "register");

        class _Plugin extends Plugin {
            onStreamStarted() {
                Dispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: "enabled", value: true });
            }
            onStreamStopped() {
                Dispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: "enabled", value: false });
            }
            onStart() {
                Dispatcher.subscribe("STREAM_START", this.onStreamStarted);
                Dispatcher.subscribe("STREAM_STOP", this.onStreamStopped);
            }
            onStop() {
                Dispatcher.unsubscribe("STREAM_START", this.onStreamStarted);
                Dispatcher.unsubscribe("STREAM_STOP", this.onStreamStopped);
            }
        }
        return _Plugin;
    })(global.ZeresPluginLibrary.buildPlugin(config));