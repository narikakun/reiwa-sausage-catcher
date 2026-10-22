<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

// GET ?period=all|today: top players by their best score in that period.
// Equal scores share a rank; whoever reached it first is listed first.
const RANKING_LIMIT = 50;

run(function (): void {
    handle_cors(['GET']);
    $period = ($_GET['period'] ?? 'all') === 'today' ? 'today' : 'all';
    $query = db()->prepare('SELECT p.name, b.score, b.sausages FROM sausage_bests b'
        . ' JOIN sausage_players p ON p.player_hash = b.player_hash'
        . ' WHERE b.period = ? ORDER BY b.score DESC, b.achieved_at ASC LIMIT ' . RANKING_LIMIT);
    $query->execute([$period === 'today' ? date('Y-m-d') : 'all']);

    $entries = [];
    $previousScore = null;
    $rank = 0;
    foreach ($query->fetchAll() as $index => $row) {
        $score = (int)$row['score'];
        if ($score !== $previousScore) {
            $rank = $index + 1;
            $previousScore = $score;
        }
        $entries[] = ['rank' => $rank, 'name' => $row['name'], 'score' => $score, 'sausages' => (int)$row['sausages']];
    }
    header('Cache-Control: public, max-age=15');
    json_response(['period' => $period, 'entries' => $entries]);
});
