<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

// Raises the best of $period for this player if $score beats it. Must run
// inside a transaction.
function update_best(PDO $pdo, string $player, string $period, int $score, int $sausages, string $at): void
{
    $current = $pdo->prepare('SELECT score FROM sausage_bests WHERE player_hash = ? AND period = ? FOR UPDATE');
    $current->execute([$player, $period]);
    $best = $current->fetchColumn();
    if ($best === false) {
        $pdo->prepare('INSERT INTO sausage_bests (player_hash, period, score, sausages, achieved_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$player, $period, $score, $sausages, $at]);
    } elseif ($score > (int)$best) {
        $pdo->prepare('UPDATE sausage_bests SET score = ?, sausages = ?, achieved_at = ? WHERE player_hash = ? AND period = ?')
            ->execute([$score, $sausages, $at, $player, $period]);
    }
}

// Rank of a player's best within a period. Equal scores share a rank.
function rank_of(PDO $pdo, string $player, string $period): array
{
    $best = $pdo->prepare('SELECT score FROM sausage_bests WHERE player_hash = ? AND period = ?');
    $best->execute([$player, $period]);
    $score = (int)$best->fetchColumn();
    $rank = $pdo->prepare('SELECT COUNT(*) + 1 FROM sausage_bests WHERE period = ? AND score > ?');
    $rank->execute([$period, $score]);
    return ['rank' => (int)$rank->fetchColumn(), 'best' => $score];
}

// POST {token, playerKey, score, sausages, name?}: records a finished game.
// Each player (identified by the random playerKey kept in their browser) has
// one entry per ranking, holding their best overall and their best today.
// A usable name updates the player's name; otherwise a new player gets the
// default name.
run(function (): void {
    handle_cors(['POST']);
    $body = read_json_body();
    $token = $body['token'] ?? '';
    $playerKey = $body['playerKey'] ?? '';
    $score = $body['score'] ?? null;
    $sausages = $body['sausages'] ?? null;
    $name = normalize_name($body['name'] ?? null);
    if (!is_string($playerKey) || !preg_match('/^[0-9a-f]{32}$/', $playerKey)) {
        json_response(['error' => 'invalid_key'], 400);
    }
    // Every sausage scores 50 (GOOD) or 100 (PERFECT).
    if (!is_string($token) || !preg_match('/^[0-9a-f]{32}$/', $token)
        || !is_int($score) || !is_int($sausages)
        || $sausages < 1 || $sausages > MAX_SAUSAGES
        || $score % 50 !== 0 || $score < $sausages * 50 || $score > $sausages * 100) {
        json_response(['error' => 'invalid_score'], 400);
    }
    rate_limit('score', 10, 600);

    $pdo = db();
    $pdo->beginTransaction();
    $play = $pdo->prepare('SELECT started_at, used_at FROM sausage_plays WHERE token = ? FOR UPDATE');
    $play->execute([$token]);
    $row = $play->fetch();
    if (!$row || $row['used_at'] !== null) {
        $pdo->rollBack();
        json_response(['error' => 'invalid_token'], 400);
    }
    $elapsed = time() - strtotime($row['started_at']);
    if ($elapsed > MAX_PLAY_SECONDS || $elapsed < $sausages * MIN_SECONDS_PER_SAUSAGE) {
        $pdo->rollBack();
        json_response(['error' => 'invalid_score'], 400);
    }

    $at = now();
    $player = hash('sha256', $playerKey);
    $today = date('Y-m-d');
    $pdo->prepare('UPDATE sausage_plays SET used_at = ? WHERE token = ?')->execute([$at, $token]);
    $existing = $pdo->prepare('SELECT name FROM sausage_players WHERE player_hash = ? FOR UPDATE');
    $existing->execute([$player]);
    $storedName = $existing->fetchColumn();
    if ($storedName === false) {
        $storedName = $name ?? (config()['default_name'] ?? 'ななしさん');
        $pdo->prepare('INSERT INTO sausage_players (player_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
            ->execute([$player, $storedName, $at, $at]);
    } elseif ($name !== null && $name !== $storedName) {
        $storedName = $name;
        $pdo->prepare('UPDATE sausage_players SET name = ?, updated_at = ? WHERE player_hash = ?')
            ->execute([$storedName, $at, $player]);
    }
    $pdo->prepare('INSERT INTO sausage_scores (player_hash, score, sausages, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$player, $score, $sausages, client_hash(), $at]);
    update_best($pdo, $player, 'all', $score, $sausages, $at);
    update_best($pdo, $player, $today, $score, $sausages, $at);
    $pdo->commit();

    $all = rank_of($pdo, $player, 'all');
    $day = rank_of($pdo, $player, $today);
    json_response([
        'name' => $storedName,
        'rankAll' => $all['rank'], 'bestAll' => $all['best'],
        'rankToday' => $day['rank'], 'bestToday' => $day['best'],
    ]);
});
