#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const get = require('lodash.get');
const config = require('./xhcrc');
const HID = require('node-hid');

// socket to CNCjs
var socket;

// Array used to transmit selected axis
const axischars = "XYZA";

// initialize buttons to nothing pressed;
var prevButtons = [0, 0];

// Knobs
var feedknob;
var axisknob;

// Create USB transfer buffer
var buff = new Buffer.alloc(21);

// Set fixed headers that never get changed
buff[0] = 0xFE;
buff[1] = 0xFD;
buff[2] = 0x04;

var options = {
    // secret: program.secret,
    port: 'COM4',
    baudrate: 115200,
    socketAddress: 'localhost',
    socketPort: 8000,
    controllerType: "Grbl",
    accessTokenLifetime: "30d"
};

// CNCjs information
var store = {
    state: {
        status: {
            activeState: 'Undefined'
        }
    },
    settings: {}
};

// which com port are we using
var port_in_use;

// Initialize CNCjs client and connect to server
const generateAccessToken = function (payload, secret, expiration) {
    const token = jwt.sign(payload, secret, {
        expiresIn: expiration
    });

    return token;
};

// Get secret key from the config file and generate an access token
const getUserHome = function () {
    return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
};

const cncrc = path.resolve(getUserHome(), '.cncrc');
try {
    const config = JSON.parse(fs.readFileSync(cncrc, 'utf8'));
    options.secret = config.secret;
} catch (err) {
    console.error(err);
    process.exit(1);
}

const token = generateAccessToken({ id: '', name: 'cncjs-pendant' }, options.secret, options.accessTokenLifetime);
const url = 'ws://' + options.socketAddress + ':' + options.socketPort + '?token=' + token;

socket = io.connect('ws://' + options.socketAddress + ':' + options.socketPort, {
    'query': 'token=' + token
});

socket.on('connect', () => {
    console.log('Connected to ' + url);

    // Open port
    //
    // Need to connect to port to get GRBL updates?
    // var ports;
    socket.emit('list', null);
    // socket.emit('open', options.port, {
    //     baudrate: Number(options.baudrate),
    //     controllerType: options.controllerType
    // });
});

socket.on('error', (err) => {
    console.error('Connection error.');
    if (socket) {
        socket.destroy();
        socket = null;
    }
});

socket.on('close', () => {
    console.log('Connection closed.');
});

// Ignore raw serialport:open for now
socket.on('serialport:open', function (options) {
    options = options || {};

    console.log('Connected to port "' + options.port + '" (Baud rate: ' + options.baudrate + ')');

    //     // callback(null, socket);
});

// Quite on serial port error
socket.on('serialport:error', function (options) {
    console.log('Serial port error');
    process.exit(1);
    // callback(new Error('Error opening serial port "' + options.port + '"'));
});

socket.on('serialport:read', function (data) {
    // console.log("Serial port read");
    // console.log((data || '').trim());
});

socket.on('serialport:list', function (portlist) {
    console.log("Serial port list");
    // Check to see if a port is in use
    for (const portitem in portlist) {
        if (portlist[portitem].inuse) {
            port_in_use = portlist[portitem].port;
            break;
        }
    }

    // If no port in use is found, default to options.port
    if (!port_in_use) port_in_use = options.port;

    // baud and controller are required?
    socket.emit('open', port_in_use, {
        baudrate: Number(options.baudrate),
        controllerType: options.controllerType
    });
});

// Sender
// socket.on('sender:status', function(data) {
//     // console.log('sender:status');
//     // console.log(data);
//     store.sender.status = data;
// });

socket.on('serialport:write', function (data) {
    console.log((data || '').trim());
});

// Grbl
socket.on('Grbl:state', function (state) {
    console.log('Grbl:state');
    // console.log(state);

    // check to see if the state has changed
    if (store.state.status.activeState != state.status.activeState) {
        console.log('State changed from ' + store.state.status.activeState + ' to ' + state.status.activeState);
    }
    store.state = state;
    xhc_set_display(state);
    console.log(state.status.wpos);
});

socket.on('Grbl:settings', function (settings) {
    // console.log('Grbl:settings');
    // console.log(settings.settings);
    store.settings = settings;
});

// USB Output device
var dev_USB_OUT;

const devices = HID.devices(config.HID_VID, config.HID_PID);

if (devices.length === 0) {
    console.error("Could not find HID device with VID=0x%s and PID=0x%s", config.HID_VID.toString(16), config.HID_PID.toString(16));
    process.exit(1);
}

var dev_USB_IN;

if (devices.length > 1) {
    // Windows finds multiple HID devices for single XHC-HB04. 1 is input device and other is output device
    for (iLooper = 0; iLooper < devices.length; iLooper++) {
        // This works for 1 windows setup. Not sure if it is portable
        if (devices[iLooper].path.includes("col01")) {
            dev_USB_IN = new HID.HID(devices[iLooper].path);
        }

        if (devices[iLooper].path.includes("col02")) {
            dev_USB_OUT = new HID.HID(devices[iLooper].path);
        }
    }
} else {
    // Single device found for both input and output. 1 call to new HID with duplicate reference
    dev_USB_IN = new HID.HID(devices[0].path);
    dev_USB_OUT = dev_USB_IN;
}

if (!dev_USB_IN) {
    console.log('USB Pendant not found');
    process.exit(1);
}
if (!dev_USB_OUT) {
    console.log('USB Pendant not found');
    process.exit(1);
}

dev_USB_IN.on('error', function (error) {
    console.log("on error", error);
});
dev_USB_IN.on('end', function () {
    console.log("on end");
});

console.log("found XHC-HB04 device");

// Setup callback for data in
dev_USB_IN.on('data', function (data) {
    parseButtonData(data);
});

function xhc_encode_float(v, buff_offset) {
    // Make integer part fraction into unsigned integer number
    var unsigned_v = Math.abs(v);

    // Separate into whole and fractional parts
    var int_part = Math.trunc(unsigned_v);
    // truncateDecimals(unsigned_v,0);
    var frac_part = Math.trunc((unsigned_v - int_part) * 10000);

    // Write to buffer
    xhc_uint16_to_buffer(int_part, buff_offset);
    xhc_uint16_to_buffer(frac_part, buff_offset + 2);

    // Set negative bit if required
    if (v < 0)
        buff[buff_offset + 3] = buff[buff_offset + 3] | 0x80;
}

function xhc_uint16_to_buffer(v, offset) {
    buff[offset + 1] = v >> 8;
    buff[offset] = v & 0xff;
}

function xhc_set_display(state) {
    // Format the display data into a buffer
    var DispAxis;

    if (!state) return;
    if (config.WorkPos) {
        // quite if wpos is undefined
        // if (state.wpos) return;
        DispAxis = state.status.wpos;
        buff[3] |= 0x80;
    } else {
        // quite if mpos is undefined
        // if (!store.controller.state.mpos) return;
        DispAxis = state.status.mpos;
        buff[3] &= !0x80;
    }

    // Set display to step
    buff[3] |= 0x01;

    if (DispAxis.length < 1) {
        return;
    }
    // Stp, Cont, MPG or nothing [0:1]
    // MC 0; WC 1 [7]
    //buff[16]=6;

    // Update XYZ - assumes axis selector is not axis 4-6
    xhc_encode_float(DispAxis['x'], 4);
    xhc_encode_float(DispAxis['y'], 8);
    xhc_encode_float(DispAxis['z'], 12);

    // Packetize buffer
    var packets = Buffer.allocUnsafe(8);
    packets[0] = 6;

    // Send "6" and then 7 bytes of buffer
    var iIndex = 0;

    for (var iPacket = 0; iPacket < 3; iPacket++) {
        // Copy 7 bytes into packets[1:7]
        buff.copy(packets, 1, iIndex, iIndex + 7);
        // Move index to beginning of next 7 bytes
        iIndex += 7;

        // send packets
        dev_USB_OUT.sendFeatureReport(packets);
    }
}

// // Data available parsing function
function parseButtonData(data) {
    //console.log("usb data:", data, " len:", data.length);

    feedknob = data[4];

    // Process axis selector switch
    axisknob = data[5] - 0x11;

    // If axis selector is "off", clear last buttons and ignore everything else
    if (data[5] == 6) {
        // Axis selector is off
        // Clear all prior button presses
        prevButtons = [0, 0];

        // Don't process message any further
        return;
    }

    // Create newButtons slice of data buffer
    var newButtons = [data[2], data[3]];;

    // At least one button was pressed
    // Check to see if button 1 was recorded previously
    if ((newButtons[0]) && (!prevButtons.includes(newButtons[0]))) {
        // Button1 was not recorded previous
        // console.log("Button %d is down",newButtons[0]);

        // Process button press
        doButton(newButtons, 0, data[4]);
    }

    // Check to see if button 2 was recorded previously
    if ((newButtons[1]) && (!prevButtons.includes(newButtons[1]))) {
        // Button2 was not recorded previous
        // console.log("Button %d is down",newButtons[1]);

        // Process button press
        doButton(newButtons, 1, data[4]);
    }

    // Check to see if previous button 1 is release
    // if ((prevButtons[0]) && (!newButtons.includes(prevButtons[0]))) {
    // Previous Button 1 is released
    // console.log("Button %d is up",prevButtons[0]);
    // }

    // Check to see if previous button 2 is release
    // if ((prevButtons[1]) && (!newButtons.includes(prevButtons[1]))) {
    // Previous Button 2 is released
    // console.log("Button %d is up",prevButtons[1]);
    // }

    // Record new buttons
    prevButtons = newButtons;

    // Process jog dial
    if (data[6]) {
        // data[6] is a int8 need to determine sign
        var iJog = (data[6] > 127 ? data[6] - 256 : data[6]);
        //console.log("Jog dial is %i", iJog);

        switch (data[4]) {
            case 13:
                // 13 = 0.001
                iJog *= 0.001;
                break;
            case 14:
                // 14 = 0.01
                iJog *= 0.01;
                break;
            case 15:
                // 15 = 0.1
                iJog *= 0.1;
                break;
            case 16:
                // 16 = 1
                iJog *= 1;
                break;
            case 26:
                // 26 = 60%
                iJog *= 10;
                break;
            case 27:
                // 27 = 100%
                iJog *= 100;
                break;
            case 28:
                // 28 = Lead
                iJog *= 250;
                break;
            default:
                console.log("Feed select value %d not handled", data[4]);
                return;
        }
        // Send string to socket
        var strMaxRate = '$' + (110 + axisknob);
        if (typeof store.settings.settings[strMaxRate] == undefined) {
            console.log("store.settings.settings for " + axischars[axisknob] + " axis not set");
            return;
        }
        doJog("$J=G21G91" + axischars[axisknob] + iJog.toPrecision(4)
            + "F" + store.settings.settings[strMaxRate]);
    }
}

function doButton(newButtons, iButton, feedknob) {
    // console.log("Button %d is down",newButtons[iButton]);

    switch (newButtons[iButton]) {
        case 1:
            // Reset button
            Send_Button("$X\n");
            break;
        case 2:
            // Stop button
            Send_Button("!\n");
            break;
        case 3:
            // Start/pause button
            switch (CNC_state.state) {
                case "Idle":
                case "Run":
                case "Jog":
                    Send_Button("!\n");
                    break;
                case "Hold":
                    Send_Button("~\n");
                    break;
                default:
                    console.log("Cannot toggle pause/run in %s state", CNC_state.state);
            }
            // console.log("$X\r\n");
            break;
        case 4:
            // Feed+ button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                if (feedknob < 16) {
                    Send_Button(String.fromCharCode(0x93));
                } else {
                    Send_Button(String.fromCharCode(0x91));
                }
            } else {
                // Do Macro 1
                console.log("Macro 1");
            }
            break;
        case 5:
            // Feed- button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                if (feedknob < 16) {
                    Send_Button(String.fromCharCode(0x94));
                } else {
                    Send_Button(String.fromCharCode(0x92));
                }
            } else {
                // Do Macro 2
                console.log("Macro 2");
            }
            break;
        case 6:
            // Spindle+ button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                if (feedknob < 16) {
                    Send_Button(String.fromCharCode(0x9C));
                } else {
                    Send_Button(String.fromCharCode(0x9A));
                }
            } else {
                // Do Macro 3
                console.log("Macro 3");
            }
            break;
        case 7:
            // Spindle- button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                if (feedknob < 16) {
                    Send_Button(String.fromCharCode(0x9D));
                } else {
                    Send_Button(String.fromCharCode(0x9B));
                }
            } else {
                // Do Macro 4
                console.log("Macro 4");
            }
            break;
        case 8:
            // M-Home button
            if (newButtons.includes(12)) {
                switch (CNC_state.state) {
                    case "Idle":
                    case "Check":
                    case "Home":
                        Send_Button("$H\r\n");
                        break;
                    default:
                        console.log("Cannot home in state %s", CNC_state.state)
                }
            } else {
                // Do Macro 5
                console.log("Macro 5");
            }
            break;
        case 9:
            // Safe-Z button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                // Safe Z
                if (!CNC_state.Pull_Off) {
                    console.log("CNC_state.Pull_Off not set");
                    return;
                }
                if (!CNC_state.MaxRate[2]) {
                    console.log("CNC_state.MaxRate for Z axis not set");
                    return;
                }
                Send_Button("$J=G53G21Z-" + CNC_state.Pull_Off + "F" + CNC_state.MaxRate[2]);
            } else {
                // Do Macro 6
                console.log("Macro 6");
            }
            break;
        case 10:
            // W-Home button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                switch (CNC_state.state) {
                    case "Idle":
                    case "Check":
                        Send_Button("G10 P1 L20 X0 Y0 Z0\n");
                        break;
                    default:
                        console.log("Cannot set workpiece home in state %s", CNC_state.state)
                }
            } else {
                // Do Macro 7
                console.log("Macro 7");
            }
            break;
        case 11:
            // Spindle On/Off button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                // console.log("Spindle Toggle\r\n");
                switch (CNC_state.state) {
                    case "Idle":
                    case "Check":
                        if (CNC_state.SpindleSpeed > 0) {
                            Send_Button("M5");
                        } else {
                            Send_Button("M3");
                        }
                        break;
                    default:
                        console.log("Cannot toggle spindle in state %s", CNC_state.state)
                }
            } else {
                // Do Macro 8
                console.log("Macro 8");
            }
            break;
        case 13:
            // Probe-Z button
            if (newButtons.includes(12)) {
                // Function key is pressed.
                doProbeZ();
            } else {
                // Do Macro 9
                console.log("Macro 9");
            }
            break;
        case 16:
            // Do Macro 10
            // console.log("Macro 10");
            // Toggle between machine and work coordinates
            config.WorkPos = !config.WorkPos;
            break;
        default:
    }
}

function Send_Button(myGCode) {
    if (config.DryRunButtons) {
        console.log(myGCode);
    } else {
        // Append new line just in case (no harm with empty lines)
        mySocket.write(myGCode + "\n");
    }
}

function doProbeZ() {
    // Check to see if current state allows probing
    switch (CNC_state.state) {
        case "Idle":
            break;
        default:
            console.log("Cannot probe in %s state", CNC_state.state)
            return;
    }

    if (!config.ProbeZ) {
        console.log("No Probe macro defined");
        return;
    }
    if (config.DruRunProbeZ) {
        console.log(config.ProbeZ);
    } else {
        mySocket.write(config.ProbeZ);
    }
}

function doJog(myGCode) {
    // Check to see if current state allows jogging
    switch (store.state.status.activeState) {
        case "Idle":
        case "Jog":
        case "Check":
            break;
        default:
            console.log("Cannot jog in %s state", CNC_state.state)
            return;
    }

    if (config.DryRunJog) {
        console.log(myGCode);
    } else {
        console.log(myGCode);

        socket.emit("write", port_in_use, myGCode+'\n');
    }
}

