<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

// POST {playerKey, name}: sets the name shown for every ranking entry of the
// player who holds playerKey. The player must have recorded a game first.
run(function (): void {
    handle_cors(['POST']);
    $body = read_json_body();
    $playerKey = $body['playerKey'] ?? '';
    $name = normalize_name($body['name'] ?? null);
    if ($name === null) {
        json_response(['error' => 'invalid_name'], 400);
    }
    if (!is_string($playerKey) || !preg_match('/^[0-9a-f]{32}$/', $playerKey)) {
        json_response(['error' => 'invalid_key'], 400);
    }
    rate_limit('name', 20, 600);

    $update = db()->prepare('UPDATE sausage_players SET name = ?, updated_at = ? WHERE player_hash = ?');
    $update->execute([$name, now(), hash('sha256', $playerKey)]);
    $exists = db()->prepare('SELECT 1 FROM sausage_players WHERE player_hash = ?');
    $exists->execute([hash('sha256', $playerKey)]);
    if ($exists->fetchColumn() === false) {
        json_response(['error' => 'invalid_key'], 400);
    }
    json_response(['name' => $name]);
});
