<?php
// Copy this file to config.php in the same folder and fill in the values.
// config.php is not committed to git.
return [
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'database_name',
        'user' => 'database_user',
        'password' => 'database_password',
    ],
    // Pages allowed to call the API from a browser.
    'allowed_origins' => [
        'https://reiwa-sausage-catcher.nakn.jp',
    ],
    // Any long random string. Used to hash client IP addresses for rate limits.
    'secret' => 'change-me-to-a-long-random-string',
    // Names containing any of these (case-insensitive, spaces ignored) are rejected.
    'ng_words' => [],
    // Name used when a game is recorded before the player enters one.
    'default_name' => 'ななしさん',
];
