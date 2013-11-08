<?php
namespace t2t2\WebRTC_test;

use Ratchet\Wamp\WampServerInterface;
use Ratchet\ConnectionInterface;

class App implements WampServerInterface  {

	public $clients, $lookup, $topics;

	public function __construct() {
		$this->clients = new \SplObjectStorage;
		$this->lookup = array();
		$this->topics = array();
	}
	// Generic
	public function onOpen(ConnectionInterface $conn) {
		$conn->chat = new \StdClass;
		$conn->chat->name = 'Anon '.$conn->resourceId;
		$conn->chat->id   = $conn->WAMP->sessionId;

		// Store to memory
		$this->clients->attach($conn);
		$this->lookup[$conn->chat->id] = $conn;


		echo "New connection! ({$conn->chat->id})\n";

	}
	public function onClose(ConnectionInterface $conn) {
		if($this->topics["users"]) {
			$this->topics["users"]->broadcast(array('type' => 'leave', 'userid' => $conn->chat->id));
		}

		$this->clients->detach($conn);
		unset($this->lookup[$conn->chat->id]);

		echo "Connection {$conn->chat->id} has disconnected\n";
	}
	public function onError(ConnectionInterface $conn, \Exception $e) {
		echo "An error has occurred: {$e->getMessage()}\n";

		$conn->close();
	}


	// Rooms
	// No need to anything, since WampServer adds and removes subscribers to Topics automatically
	public function onSubscribe(ConnectionInterface $conn, $topic) {
		if (!array_key_exists($topic->getId(), $this->topics)) {
			$this->topics[$topic->getId()] = $topic;
		}
   		if($topic == 'users') {
			foreach ($topic as $client) {
				$conn->event($topic, array('type' => 'join', 'username' => $client->chat->name, 'userid' => $client->chat->id, 'masstxt' => 1));
				if ($client != $conn) {
					$client->event($topic, array('type' => 'join', 'username' => $conn->chat->name, 'userid' => $conn->chat->id));
				}
			}
		}
	}
	public function onUnSubscribe(ConnectionInterface $conn, $topic) {
		if($topic == 'users') {
			foreach ($topic as $client) {
				$client->event($topic, array('type' => 'leave', 'userid' => $conn->chat->id));
			}
		}
	}
	public function onPublish(ConnectionInterface $conn, $topic, $event, array $exclude, array $eligible) {
		if(in_array($topic->getId(), array('candidate', 'offer', 'answer', 'renegotiate', 'chat'))) {
			if(!isset($eligible[0]) || !($target = $this->lookup[$eligible[0]])) {
				return;
			}
			$target->event($topic, array("from" => $conn->chat->id, "payload" => $event));
		}
		// $topic->broadcast($event);
	}

	// RPC
	public function onCall(ConnectionInterface $conn, $id, $topic, array $params) {
		$conn->callError($id, $topic, 'RPC not supported on this');
	}



	/*
	// MessageComponentInterface
	public function onOpen(ConnectionInterface $conn) {
		// Store to memory
		$this->clients->attach($conn->resourceId, $conn);

		echo "New connection! ({$conn->resourceId})\n";
	}

	public function onMessage(ConnectionInterface $from, $msg) {
		echo "Recieved: $msg\n";

		foreach ($this->clients as $clientId) {
			$this->clients[$clientId]->send($msg);
		}
	}
	*/
}
