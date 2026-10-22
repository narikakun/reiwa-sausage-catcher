<?php
declare(strict_types=1);

// Shared setup for every endpoint: config, database, CORS, JSON helpers and a
// small per-client rate limiter. Scores are stored in Japan time so "today"
// matches what players in Japan expect.
date_default_timezone_set('Asia/Tokyo');

const MIN_SECONDS_PER_SAUSAGE = 1.5; // spawn delay + shortest flight is ~1.75s
const MAX_PLAY_SECONDS = 6 * 60 * 60;
const MAX_SAUSAGES = 2000;
const NAME_MAX_LENGTH = 10;
const DAILY_BEST_KEEP_DAYS = 30;

function config(): array
{
    static $config;
    if ($config === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            json_response(['error' => 'server_not_configured'], 500);
        }
        $config = require $path;
    }
    return $config;
}

function db(): PDO
{
    static $pdo;
    if ($pdo === null) {
        $c = config()['db'];
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'] ?? 3306, $c['name']),
            $c['user'],
            $c['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
        );
    }
    return $pdo;
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Only the game's own pages may call the API from a browser.
function handle_cors(array $methods): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, config()['allowed_origins'], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: ' . implode(', ', $methods) . ', OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 86400');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $methods, true)) {
        json_response(['error' => 'method_not_allowed'], 405);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 4096);
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) {
        json_response(['error' => 'invalid_json'], 400);
    }
    return $data;
}

// Raw IP addresses are never stored; only a salted hash used for rate limits.
function client_hash(): string
{
    return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . config()['secret']);
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function rate_limit(string $action, int $limit, int $windowSeconds): void
{
    $pdo = db();
    $since = date('Y-m-d H:i:s', time() - $windowSeconds);
    $count = $pdo->prepare('SELECT COUNT(*) FROM sausage_rate_events WHERE ip_hash = ? AND action = ? AND created_at >= ?');
    $count->execute([client_hash(), $action, $since]);
    if ((int)$count->fetchColumn() >= $limit) {
        json_response(['error' => 'too_many_requests'], 429);
    }
    $pdo->prepare('INSERT INTO sausage_rate_events (ip_hash, action, created_at) VALUES (?, ?, ?)')
        ->execute([client_hash(), $action, now()]);
}

// Occasionally drop expired play tokens, old rate-limit rows and old daily bests.
function cleanup(): void
{
    if (random_int(1, 50) !== 1) {
        return;
    }
    $pdo = db();
    $pdo->prepare('DELETE FROM sausage_plays WHERE started_at < ?')->execute([date('Y-m-d H:i:s', time() - 86400)]);
    $pdo->prepare('DELETE FROM sausage_rate_events WHERE created_at < ?')->execute([date('Y-m-d H:i:s', time() - 86400)]);
    $pdo->prepare("DELETE FROM sausage_bests WHERE period <> 'all' AND period < ?")
        ->execute([date('Y-m-d', time() - DAILY_BEST_KEEP_DAYS * 86400)]);
}

// Returns the cleaned name, or null when it is empty, too long or contains an
// NG word.
function normalize_name(mixed $value): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $name = preg_replace('/\p{C}+/u', '', $value) ?? '';
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
    $length = mb_strlen($name);
    if ($length < 1 || $length > NAME_MAX_LENGTH) {
        return null;
    }
    $compact = mb_strtolower(preg_replace('/\s+/u', '', $name) ?? '');
    foreach (config()['ng_words'] as $word) {
        if ($word !== '' && mb_strpos($compact, mb_strtolower($word)) !== false) {
            return null;
        }
    }
    return $name;
}

function run(callable $handler): void
{
    try {
        $handler();
    } catch (Throwable $error) {
        error_log('[sausage-api] ' . $error->getMessage());
        json_response(['error' => 'server_error'], 500);
    }
}
