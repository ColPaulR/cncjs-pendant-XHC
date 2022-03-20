const fs = require('fs');
const path = require('path');
var program = require('commander');

// JSON configuration
var config;

// Get options from command line if any

program
	// .version(pkg.version)
	.usage('-p <port> [options]')
	.option('-p, --port <port>', 'path or name of serial port', 'COM4')
	.option('-b, --baudrate <baudrate>', 'baud rate (default: 115200)', 115200)
	.option('--socket-address <address>', 'socket address or hostname (default: localhost)', 'localhost')
	.option('--socket-port <port>', 'socket port (default: 8000)', 8000)
	.option('--controller-type <type>', 'controller type: Grbl|Smoothie|TinyG (default: Grbl)', 'Grbl')
    .option('--access-token-lifetime <lifetime>', 'access token lifetime in seconds or a time span string (default: 30d)', '30d')

program.parse(process.argv);

// Get reference to program.options
const prgoptions=program.opts();

var options = {
    port: prgoptions.port,
    baudrate: prgoptions.baudrate,
    socketAddress: prgoptions.socketAddress,
    socketPort: prgoptions.socketPort,
    controllerType: prgoptions.controllerType,
    accessTokenLifetime: prgoptions.accessTokenLifetime
};

// Read .rc file if it exists; exit otherwise
try {
    config = JSON.parse(fs.readFileSync('./.xhcrc', 'utf8'));
} catch (err) {
    console.error(err);
    process.exit(1);
}

if (config.DryRun) {
    // Dry run everything
    config.DryRunButtons = 1;
    config.DryRunJog = 1;
    config.DruRunProbeZ = 1;
}


module.exports = { config, options };