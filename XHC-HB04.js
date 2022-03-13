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
    port: 'COM1',
    baudrate: 115200,
    socketAddress: 'localhost',
    socketPort: 8000,
    controllerType: "Grbl",
    accessTokenLifetime: "30d"
};

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
    socket.emit('open', options.port, {
        baudrate: Number(options.baudrate),
        controllerType: options.controllerType
    });
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

socket.on('serialport:open', function (options) {
    options = options || {};

    console.log('Connected to port "' + options.port + '" (Baud rate: ' + options.baudrate + ')');

    // callback(null, socket);
});

socket.on('serialport:error', function (options) {
    // callback(new Error('Error opening serial port "' + options.port + '"'));
});

socket.on('serialport:read', function (data) {
    console.log((data || '').trim());
});


socket.on('serialport:write', function (data) {
    console.log((data || '').trim());
});
