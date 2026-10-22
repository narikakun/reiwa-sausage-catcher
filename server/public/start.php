<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

// POST: called when a game starts. Returns a one-time token that must be sent
// back with the score.
run(function (): void {
    handle_cors(['POST']);
    rate_limit('start', 60, 600);
    cleanup();
    $token = bin2hex(random_bytes(16));
    db()->prepare('INSERT INTO sausage_plays (token, ip_hash, started_at) VALUES (?, ?, ?)')
        ->execute([$token, client_hash(), now()]);
    json_response(['token' => $token]);
});
