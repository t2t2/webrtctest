<?php
require __DIR__ . '/../vendor/autoload.php';

use t2t2\WebRTC_test\App;
use Ratchet\Server\IoServer;
use Ratchet\WebSocket\WsServer;
use Ratchet\Wamp\WampServer;

$server = IoServer::factory(
	new WsServer(new WampServer(new App())),
	8911
);

echo "Started listening on :8911\n";
$server->run();