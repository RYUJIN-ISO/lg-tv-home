// lg-tv-home remote mapper: a surface-manager key filter.
// Loaded via Qt.include by surface-manager's StarfishKeyFilterLoader when this
// file is listed in configd "com.webos.surfacemanager.keyFilters" (inserted at
// runtime by remote-mapper.sh; a reboot without the boot hook restores stock).
// Gets the same globals as LG's KeyFilters (lunaCall, KeyPolicy, WebOS, Qt).
//
// map.json: {"learn": false,
//            "buttons": {"<button>": {"app": "<appId>", "params": {}} | {"action": "none"}}}
// <button> = LG key name (Key_webOS_Netflix, Key_webOS_RakutenTV, ...),
//            "Qt.<Key_Name>" for standard keys, or "code:<n>" for anything else.
// Any error -> NextPolicy, i.e. LG's normal handling continues.

var MAP_FILE = "file:///var/lib/webosbrew/remote-mapper/map.json";
var LEARN_CONFIG = "com.iso.remotemapper.learned";   // read by the Remote Mapper app

// WebOS.Key_* names referenced by LG's own KeyFilters (enums can't be
// enumerated with for..in, so they are resolved by name).
var WEBOS_KEYS = [
    "Key_webOS_3DigitInput", "Key_webOS_3DMode", "Key_webOS_4K_BS", "Key_webOS_4K_BS_11",
    "Key_webOS_4K_BS_12", "Key_webOS_4K_CS", "Key_webOS_4K_CS_11", "Key_webOS_4K_CS_12",
    "Key_webOS_ALEXA", "Key_webOS_Amazon", "Key_webOS_Apps", "Key_webOS_AspectRatio",
    "Key_webOS_AudioDescription", "Key_webOS_Back", "Key_webOS_Bendable", "Key_webOS_Blue",
    "Key_webOS_BlueLong", "Key_webOS_BMLData", "Key_webOS_BS", "Key_webOS_BS_11",
    "Key_webOS_BS_12", "Key_webOS_ChannelBack", "Key_webOS_ChannelDash", "Key_webOS_ChannelDown",
    "Key_webOS_ChannelUp", "Key_webOS_Close", "Key_webOS_CoupangPlay", "Key_webOS_CS1",
    "Key_webOS_CS1_11", "Key_webOS_CS1_12", "Key_webOS_CS2", "Key_webOS_CS2_11",
    "Key_webOS_CS2_12", "Key_webOS_CursorHide", "Key_webOS_CursorShow", "Key_webOS_Disneyplus",
    "Key_webOS_Exit", "Key_webOS_FactoryAdjust", "Key_webOS_FactoryComponent1", "Key_webOS_FactoryComponent2",
    "Key_webOS_FactoryComponent3", "Key_webOS_FactoryEyeQ", "Key_webOS_FactoryHdmi1", "Key_webOS_FactoryHdmi2",
    "Key_webOS_FactoryHdmi3", "Key_webOS_FactoryHdmi4", "Key_webOS_FactoryInStart", "Key_webOS_FactoryInStop",
    "Key_webOS_FactoryLocalEnter", "Key_webOS_FactoryMultiSoundSetting", "Key_webOS_FactoryPictureCheck", "Key_webOS_FactoryPictureMode",
    "Key_webOS_FactoryPowerOnly", "Key_webOS_FactoryRgbPc", "Key_webOS_FactorySoundCheck", "Key_webOS_FactorySoundMode",
    "Key_webOS_FactoryTilt", "Key_webOS_FactoryTv", "Key_webOS_FactoryVideo1", "Key_webOS_FactoryVideo2",
    "Key_webOS_Favorite", "Key_webOS_FPTPlay", "Key_webOS_FreeviewPlay", "Key_webOS_Gamepad_Back",
    "Key_webOS_Gamepad_ChannelDown", "Key_webOS_Gamepad_ChannelUp", "Key_webOS_Gamepad_DPAD_Down", "Key_webOS_Gamepad_DPAD_Left",
    "Key_webOS_Gamepad_DPAD_Right", "Key_webOS_Gamepad_DPAD_Up", "Key_webOS_Gamepad_Gameportal", "Key_webOS_Gamepad_Menu",
    "Key_webOS_Gamepad_Select", "Key_webOS_Gamepad_Settings", "Key_webOS_Gamepad_VolumeDown", "Key_webOS_Gamepad_VolumeMute",
    "Key_webOS_Gamepad_VolumeUp", "Key_webOS_Globoplay", "Key_webOS_GoogleVoice", "Key_webOS_Green",
    "Key_webOS_HotelModeReady", "Key_webOS_Hotstar", "Key_webOS_Hulu", "Key_webOS_Info",
    "Key_webOS_InputSource", "Key_webOS_InputTV", "Key_webOS_InputTVRadio", "Key_webOS_IPlayer",
    "Key_webOS_IVI", "Key_webOS_Kinopoisk", "Key_webOS_LGChannels", "Key_webOS_Lighting",
    "Key_webOS_LiveTVMenu", "Key_webOS_LiveZoom", "Key_webOS_LocalAuto", "Key_webOS_LocalDown",
    "Key_webOS_LocalEnter", "Key_webOS_LocalInputSource", "Key_webOS_LocalLeft", "Key_webOS_LocalLongPress",
    "Key_webOS_LocalOneKeyLong", "Key_webOS_LocalOneKeyShort", "Key_webOS_LocalPower", "Key_webOS_LocalRight",
    "Key_webOS_LocalSettings", "Key_webOS_LocalUp", "Key_webOS_MagicLink", "Key_webOS_MagnifierZoom",
    "Key_webOS_MHP", "Key_webOS_Multikey", "Key_webOS_Netflix", "Key_webOS_New",
    "Key_webOS_Nhkplus", "Key_webOS_Okko", "Key_webOS_Premier", "Key_webOS_ProgramList",
    "Key_webOS_RakutenTV", "Key_webOS_Recent", "Key_webOS_RecordList", "Key_webOS_Red",
    "Key_webOS_ScreenDown", "Key_webOS_ScreenRemote", "Key_webOS_Seniortv_Help", "Key_webOS_Seniortv_Zoom",
    "Key_webOS_SetChannel", "Key_webOS_Settings", "Key_webOS_Shade", "Key_webOS_Shahid",
    "Key_webOS_Shop", "Key_webOS_Simplink", "Key_webOS_SlingTV", "Key_webOS_SonyLiv",
    "Key_webOS_Stan", "Key_webOS_StartRu", "Key_webOS_STBMenu", "Key_webOS_STBPower",
    "Key_webOS_StoreMode", "Key_webOS_Teletext", "Key_webOS_TeletextInTime", "Key_webOS_TER",
    "Key_webOS_TER_11", "Key_webOS_TER_12", "Key_webOS_TextOption", "Key_webOS_TimerPowerOn",
    "Key_webOS_Tod", "Key_webOS_TonePlusVoice", "Key_webOS_TV360", "Key_webOS_Tver",
    "Key_webOS_TVGuide", "Key_webOS_Twin", "Key_webOS_UNext", "Key_webOS_UpDown",
    "Key_webOS_UsbHeadsetMute", "Key_webOS_UsbSwitchingLong", "Key_webOS_UsbSwitchingShort", "Key_webOS_USP",
    "Key_webOS_VKVideo", "Key_webOS_Voice", "Key_webOS_VoiceBack", "Key_webOS_VoiceExit",
    "Key_webOS_VTVGo", "Key_webOS_Watchaplay", "Key_webOS_Wavve", "Key_webOS_Wink",
    "Key_webOS_XBox_Gamepad_App", "Key_webOS_Yandex", "Key_webOS_Yellow"
];
var QT_KEYS = [
    "Key_Up", "Key_Down", "Key_Left", "Key_Right",
    "Key_Return", "Key_Enter", "Key_Select", "Key_Super_L",
    "Key_VolumeMute", "Key_VolumeUp", "Key_VolumeDown", "Key_Menu",
    "Key_Search", "Key_Subtitle", "Key_Sleep", "Key_Option",
    "Key_Help", "Key_Video", "Key_Game", "Key_MediaPlay",
    "Key_MediaPause", "Key_MediaStop", "Key_MediaRecord", "Key_AudioForward",
    "Key_AudioRewind", "Key_Red", "Key_Green", "Key_Yellow",
    "Key_Blue", "Key_0", "Key_1", "Key_2",
    "Key_3", "Key_4", "Key_5", "Key_6",
    "Key_7", "Key_8", "Key_9", "Key_Escape",
    "Key_Back", "Key_Home", "Key_Settings", "Key_Guide",
    "Key_Info"
];

// Never swallowed in learn mode, so the menu stays usable while learning.
var NAV_KEYS = /^(Qt\.Key_(Up|Down|Left|Right|Return|Enter|Select|Super_L|Back|Escape|Home|VolumeUp|VolumeDown)|Key_webOS_(Back|Exit))$/;

var remap = {};
var learn = false;
var learnUntil = 0;
var keyNames = null;

// No toast here: a toast sent from inside surface-manager also opened LG's
// quick settings (at every boot while learn mode was left on). The Remote
// Buttons menu shows its own hint while learning.
function init() {
    reloadMap();
}

function reloadMap() {
    try {
        var x = new XMLHttpRequest();
        x.open("GET", MAP_FILE, false);
        x.send(null);
        var cfg = JSON.parse(x.responseText || "{}");
        remap = cfg.buttons || {};
        learn = !!cfg.learn;
        learnUntil = Date.now() + 30000;   // learn mode always expires on its own
    } catch (e) {
        remap = {};
        log("map read failed: " + e);
    }
}

function names() {
    if (!keyNames) {
        keyNames = {};
        var i, v;
        for (i = 0; i < WEBOS_KEYS.length; i++) {
            try { v = WebOS[WEBOS_KEYS[i]]; } catch (e) { v = undefined; }
            if (typeof v === "number") keyNames[v] = WEBOS_KEYS[i];
        }
        for (i = 0; i < QT_KEYS.length; i++) {
            try { v = Qt[QT_KEYS[i]]; } catch (e) { v = undefined; }
            if (typeof v === "number" && keyNames[v] === undefined) keyNames[v] = "Qt." + QT_KEYS[i];
        }
    }
    return keyNames;
}

// Learn mode / errors: publish the last 20 events as a configd value that the
// Remote Mapper app reads (surface-manager may not call Homebrew's exec).
var learned = [];
function publish(entry) {
    try {
        learned.unshift(entry);
        if (learned.length > 20) learned.length = 20;
        var cfg = {};
        cfg[LEARN_CONFIG] = learned;
        lunaCall.send("com.webos.service.config", "/setConfigs", JSON.stringify({ "configs": cfg }));
    } catch (e) {}
}

function log(msg) { publish({ "t": Date.now(), "msg": String(msg) }); }

function remapKeys(key, pressed, autoRepeat, deviceId) {
    try {
        var name = names()[key];
        if (learn && Date.now() > learnUntil) learn = false;
        if (learn) {
            if (pressed && !autoRepeat) publish({ "t": Date.now(), "code": key, "name": name || null });
            // Learning: a pressed button must not also do its normal job.
            if (!NAV_KEYS.test(name || "")) return KeyPolicy.Accepted;
        }
        var a = (name && remap[name]) || remap["code:" + key];
        if (!a) return KeyPolicy.NextPolicy;
        if (pressed && !autoRepeat && a.app) {
            lunaCall.send("com.webos.applicationManager", "/launch",
                JSON.stringify({ "id": a.app, "params": a.params || {} }));
        }
        return KeyPolicy.Accepted;   // swallow press + release of a remapped key
    } catch (e) {
        log("error " + e);
        return KeyPolicy.NextPolicy;
    }
}
