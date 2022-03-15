#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const get = require('lodash.get');

// socket to CNCjs
var socket;

var options = {
    // secret: program.secret,
    port: 'COM4',
    baudrate: 115200,
    socketAddress: 'localhost',
    socketPort: 8000,
    controllerType: "Grbl",
    accessTokenLifetime: "30d"
};

var store = {
    controller: {
        state: {},
        settings: {}
    },
    sender: {
        status: {}
    }
};

function CNCjs_Client_Init(xhc_set_display){
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
        socket.emit('list',null);
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
        console.log("Serial port read");
        console.log((data || '').trim());
    });

    socket.on('serialport:list', function (portlist) {
        console.log("Serial port list");
        // Check to see if a port is in use
        var port_in_use;
        for (const portitem in portlist) {
            if (portlist[portitem].inuse) {
                port_in_use = portlist[portitem].port;
                break;
            }
        }

        // If no port in use is found, default to options.port
        if (!port_in_use) port_in_use=options.port;

        // baud and controller are required?
        socket.emit('open', port_in_use, {
            baudrate: Number(options.baudrate),
            controllerType: options.controllerType
        });
    });
    
    // Sender
    socket.on('sender:status', function(data) {
        // console.log('sender:status');
        // console.log(data);
        store.sender.status = data;
    });


    socket.on('serialport:write', function (data) {
        console.log((data || '').trim());
    });

    // Grbl
    socket.on('Grbl:state', function (state) {
        // console.log('Grbl:state');
        // console.log(state);
        store.controller.state = state;
        xhc_set_display(state);
        // console.log(state.status.wpos);
    });

    socket.on('Grbl:settings', function (settings) {
        console.log('Grbl:settings');
        // console.log(settings);
        store.controller.settings = settings;
    });

    // Pass reference to open socket back to caller
    return socket;
}

module.exports = { CNCjs_Client_Init, store };